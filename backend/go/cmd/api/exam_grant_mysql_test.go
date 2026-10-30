package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

func TestExamGrantConcurrentResumeRetainsIdentityAcrossLoginExpiryMySQL(t *testing.T) {
	f, _ := readyContinuityIELTS(t)
	c := f.candidates[0]
	app := continuityApp(f)
	app.Config.ExamAccessEnabled = true
	app.Config.ExamAccessMaxHours = 12
	accountID, cookie, _, err := auth.CreateSession(context.Background(), f.db, app.Config, c.UserID, auth.RoleStudent, auth.SessionProof{Source: auth.SessionSourceAccount}, nil, nil, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec("DELETE FROM attempt_sessions WHERE attempt_id = ?", c.AttemptID); err != nil {
		t.Fatal(err)
	}
	issue := func() (string, time.Time, error) {
		var token string
		var expiry time.Time
		err := tx.NewRunner(f.db).WithTxRCRetry(context.Background(), 3, func(ctx context.Context, q tx.Tx) error {
			var id string
			if err := q.QueryRowContext(ctx, "SELECT id FROM student_attempts WHERE id = ? FOR UPDATE", c.AttemptID).Scan(&id); err != nil {
				return err
			}
			var now time.Time
			if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
				return err
			}
			var err error
			token, expiry, err = auth.IssueExamGrantTx(ctx, q, app.Config, c.UserID, f.scheduleID, c.AttemptID, c.ClientSessionID, nil, 1, now, auth.ExamGrantOptions{AccountSessionID: accountID})
			return err
		})
		return token, expiry, err
	}
	token, expiry, err := issue()
	if err != nil {
		t.Fatal(err)
	}
	// The older same-owner takeover endpoint must not shorten or rotate a
	// sitting grant even when an older client invokes it.
	takeover, err := app.Attempts.Takeover(context.Background(), token, c.AttemptID, c.ClientSessionID, "same browser retry")
	if err != nil {
		t.Fatal(err)
	}
	if takeover.Token != token || !takeover.ExpiresAt.Equal(expiry) || takeover.CredentialPolicy != auth.ExamCredentialSitting {
		t.Fatal("legacy takeover changed a sitting grant")
	}
	// Turning off NEW issuance must never downgrade a grant already in use.
	app.Config.ExamAccessEnabled = false
	var wg sync.WaitGroup
	errors := make(chan error, 20)
	tokens := make(chan string, 20)
	expiries := make(chan time.Time, 20)
	for range 20 {
		wg.Add(1)
		go func() { defer wg.Done(); tok, exp, err := issue(); tokens <- tok; expiries <- exp; errors <- err }()
	}
	wg.Wait()
	close(errors)
	close(tokens)
	close(expiries)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}
	for resumed := range tokens {
		if resumed != token {
			t.Fatal("resume rotated the credential")
		}
	}
	for exp := range expiries {
		if !exp.Equal(expiry) {
			t.Fatal("resume extended the deadline")
		}
	}
	if _, err = f.db.Exec("UPDATE user_sessions SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?", accountID); err != nil {
		t.Fatal(err)
	}
	router := BuildRouter(app)
	req := httptest.NewRequest(http.MethodPost, "/api/v2/student/attempts/"+c.AttemptID+"/access:resume", nil)
	req.AddCookie(&http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: cookie})
	req.Header.Set("Authorization", "Bearer "+token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var access attempts.Access
	if err = json.Unmarshal(rec.Body.Bytes(), &access); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 200 || access.AttemptToken != token || access.CredentialPolicy != auth.ExamCredentialSitting {
		t.Fatalf("resume after account expiry: %d %+v", rec.Code, access)
	}
	// Reload/content projections use the same narrowly scoped grant, never a
	// fabricated account session or a candidate-ID-only recovery shortcut.
	for _, suffix := range []string{"", "/static", "/live"} {
		projection := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/"+f.scheduleID+suffix+"?clientSessionId="+c.ClientSessionID, nil)
		projection.Header.Set("Authorization", "Bearer "+token)
		projection.AddCookie(&http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: cookie})
		out := httptest.NewRecorder()
		router.ServeHTTP(out, projection)
		if out.Code != 200 {
			t.Fatalf("projection %s with expired login: %d %s", suffix, out.Code, out.Body.String())
		}
	}
	rec = continuitySave(t, router, c, f.questions["reading"][0], token, app.Config.EffectiveSessionCookieName(), cookie)
	if rec.Code != 200 {
		t.Fatalf("save after login expiry: %d %s", rec.Code, rec.Body.String())
	}
	// Advance only the authorization clock: this proves the credential remains
	// usable after four hours, not that browser/network behavior has been soaked.
	later := attempts.NewService(tx.NewRunner(f.db), clock.FixedAt(time.Now().UTC().Add(4*time.Hour)), []byte(submitTestSecret))
	if _, err = later.ResumeAccess(context.Background(), token, c.AttemptID); err != nil {
		t.Fatalf("four-hour grant continuity: %v", err)
	}
	var count int
	if err = f.db.QueryRow("SELECT COUNT(*) FROM attempt_sessions WHERE attempt_id = ?", c.AttemptID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("concurrent resume created %d grants", count)
	}
}

func TestExamGrantReceiptReadIncludesCommittedFinalAcknowledgementsMySQL(t *testing.T) {
	f, svc := readyContinuityIELTS(t)
	c := f.candidates[0]
	endIELTSSectionsForSubmit(t, f.db, "a.id = ?", c.AttemptID)
	command := attempts.SubmitCommand{AttemptID: c.AttemptID, LeaseEpoch: 1, ExpectedControlEpoch: 1, SubmissionID: uuid.NewString(), ActorKind: "student", FinalCommands: ieltsBudgetCommands("receipt-final", f.questions["reading"], "B")}
	submitted, err := svc.saver.Submit(context.Background(), c.Token, command, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, svc.sealer)
	if err != nil {
		t.Fatal(err)
	}
	router := BuildRouter(continuityApp(f))
	req := httptest.NewRequest(http.MethodGet, "/api/v2/student/attempts/"+c.AttemptID+"/submission-receipt?submissionId="+command.SubmissionID, nil)
	req.Header.Set("Authorization", "Bearer "+c.Token)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	var receipt attempts.ReceiptSnapshot
	if err = json.Unmarshal(rec.Body.Bytes(), &receipt); err != nil {
		t.Fatal(err)
	}
	if rec.Code != 200 || receipt.FinalResponseDigest != submitted.FinalDigest || receipt.Status != "submitted" || len(receipt.Acknowledgements) != 1 {
		t.Fatalf("durable receipt: %d %+v", rec.Code, receipt)
	}
	if receipt.Acknowledgements[0].WriteID != command.FinalCommands[0].WriteID || receipt.Acknowledgements[0].CanonicalResponse.Answer != "B" {
		t.Fatalf("lost final acknowledgement: %+v", receipt.Acknowledgements)
	}
	claims, err := crypto.VerifyAttemptToken([]byte(submitTestSecret), time.Now().UTC(), c.Token)
	if err != nil {
		t.Fatal(err)
	}
	claims.Exp = time.Now().Add(-time.Second).Unix()
	expired, err := crypto.SignAttemptToken([]byte(submitTestSecret), claims)
	if err != nil {
		t.Fatal(err)
	}
	req = httptest.NewRequest(http.MethodGet, req.URL.String(), nil)
	req.Header.Set("Authorization", "Bearer "+expired)
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 401 {
		t.Fatalf("expired credential read receipt: %d", rec.Code)
	}
	var seals int
	if err = f.db.QueryRow("SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?", c.AttemptID).Scan(&seals); err != nil {
		t.Fatal(err)
	}
	if seals != 1 {
		t.Fatalf("receipt read resealed attempt: %d", seals)
	}
}

func TestExamGrantBrowserLogoutDoesNotRevokeAnotherDeviceMySQL(t *testing.T) {
	f := seedIELTSLoadFixture(t, 2, 1, []string{"reading"}, 1)
	cfg := continuityApp(f).Config
	cfg.ExamAccessEnabled = true
	cfg.ExamAccessMaxHours = 12
	user := f.candidates[0].UserID
	cookies := make([]string, 2)
	tokens := make([]string, 2)
	for i, c := range f.candidates {
		if _, err := f.db.Exec("UPDATE student_attempts SET user_id = ? WHERE id = ?", user, c.AttemptID); err != nil {
			t.Fatal(err)
		}
		if _, err := f.db.Exec("DELETE FROM attempt_sessions WHERE attempt_id = ?", c.AttemptID); err != nil {
			t.Fatal(err)
		}
		accountID, cookie, _, err := auth.CreateSession(context.Background(), f.db, cfg, user, auth.RoleStudent, auth.SessionProof{Source: auth.SessionSourceAccount}, nil, nil, time.Now().UTC())
		if err != nil {
			t.Fatal(err)
		}
		cookies[i] = cookie
		err = tx.NewRunner(f.db).WithTxRC(context.Background(), func(ctx context.Context, q tx.Tx) error {
			var id string
			if err := q.QueryRowContext(ctx, "SELECT id FROM student_attempts WHERE id = ? FOR UPDATE", c.AttemptID).Scan(&id); err != nil {
				return err
			}
			var err error
			tokens[i], _, err = auth.IssueExamGrantTx(ctx, q, cfg, user, c.ScheduleID, c.AttemptID, c.ClientSessionID, nil, 1, time.Now().UTC(), auth.ExamGrantOptions{AccountSessionID: accountID})
			return err
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := auth.RevokeBrowserSessionWithCache(context.Background(), f.db, nil, cookies[0], time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := auth.VerifyAttemptRead(context.Background(), f.db, cfg, time.Now().UTC(), tokens[0]); err == nil {
		t.Fatal("logout left browser's exam grant active")
	}
	if _, err := auth.VerifyAttemptRead(context.Background(), f.db, cfg, time.Now().UTC(), tokens[1]); err != nil {
		t.Fatalf("logout revoked another device: %v", err)
	}
	if session, err := auth.LookupSession(context.Background(), f.db, cfg, cookies[1]); err != nil || session == nil {
		t.Fatalf("other account session was revoked: %v", err)
	}
}

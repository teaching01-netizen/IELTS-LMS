package main

// Characterization tests: these prove today's continuity guarantees AND the
// authorization gaps the continuity design must address. They require an
// isolated, fully migrated TEST_MYSQL_DSN, like the fixtures reused below.
import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"github.com/google/uuid"
)

func readyContinuityIELTS(t *testing.T) (ieltsLoadFixture, ieltsBudgetServices) {
	t.Helper()
	f := seedIELTSLoadFixture(t, 1, 1, []string{"reading"}, 1)
	svc := newIELTSBudgetServices(t, true, false)
	c := f.candidates[0]
	ready := true
	out, err := svc.room.ReadyCohortSection(context.Background(), f.scheduleID, "reading", c.AttemptID, c.UserID, nil,
		examruntime.IELTSReadinessSignals{ContentReady: &ready, LocalStorageReady: &ready, AudioReady: &ready})
	if err != nil || out.Status != "active" {
		t.Fatalf("ready IELTS: %+v %v", out, err)
	}
	return f, svc
}

func continuityApp(f ieltsLoadFixture) *App {
	cfg := config.Load()
	cfg.AuthSecret = submitTestSecret
	cfg.RateLimitMode = config.RateLimitModeLocal
	cfg.SessionCacheEnabled = false
	return BuildApp(cfg, f.db)
}

func continuitySave(t *testing.T, router http.Handler, c ieltsLoadCandidate, question, token, cookieName, cookie string) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(map[string]any{"leaseEpoch": 1, "controlEpoch": 1, "commands": []attempts.ResponseCommand{{
		QuestionID: question, WriteID: uuid.NewString(), ClientVersion: 1, Response: attempts.ResponsePayload{Answer: "B"},
	}}})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodPost, "/api/v2/student/attempts/"+c.AttemptID+"/responses:batch", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	if cookie != "" {
		req.AddCookie(&http.Cookie{Name: cookieName, Value: cookie})
	}
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestExamContinuityExpiredLoginStillSavesButCannotRenewMySQL(t *testing.T) {
	f, _ := readyContinuityIELTS(t)
	c := f.candidates[0]
	app := continuityApp(f)
	sessionID, cookie, _, err := auth.CreateSession(context.Background(), f.db, app.Config, c.UserID, auth.RoleStudent,
		auth.SessionProof{Source: auth.SessionSourceAccount}, nil, nil, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if _, err = f.db.Exec("UPDATE user_sessions SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?", sessionID); err != nil {
		t.Fatal(err)
	}
	router := BuildRouter(app)
	rec := continuitySave(t, router, c, f.questions["reading"][0], c.Token, app.Config.EffectiveSessionCookieName(), cookie)
	if rec.Code != 200 {
		t.Fatalf("valid attempt bearer with expired login: %d %s", rec.Code, rec.Body.String())
	}
	req := httptest.NewRequest(http.MethodGet, fmt.Sprintf("/api/v1/student/sessions/%s?refreshAttemptCredential=true&clientSessionId=%s", f.scheduleID, c.ClientSessionID), nil)
	req.AddCookie(&http.Cookie{Name: app.Config.EffectiveSessionCookieName(), Value: cookie})
	rec = httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 401 || decodeCode(t, rec) != "SESSION_EXPIRED" {
		t.Fatalf("renewal must expose login dependency: %d %s", rec.Code, rec.Body.String())
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
	rec = continuitySave(t, router, c, f.questions["reading"][0], expired, app.Config.EffectiveSessionCookieName(), cookie)
	if rec.Code != 401 {
		t.Fatalf("expired bearer must stop saves: %d %s", rec.Code, rec.Body.String())
	}
	var count int
	if err = f.db.QueryRow("SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ?", c.AttemptID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("accepted answer must survive failed save/renewal: %d", count)
	}
}

func TestExamContinuityAmbientCookiesCannotBlockExamSavesMySQL(t *testing.T) {
	for _, withCookie := range []bool{true, false} {
		t.Run(fmt.Sprint(withCookie), func(t *testing.T) {
			f, _ := readyContinuityIELTS(t)
			c := f.candidates[0]
			app := continuityApp(f)
			_, cookie, _, err := auth.CreateSession(context.Background(), f.db, app.Config, c.UserID, auth.RoleStudent, auth.SessionProof{Source: auth.SessionSourceAccount}, nil, nil, time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			if !withCookie {
				cookie = ""
			}
			rec := continuitySave(t, BuildRouter(app), c, f.questions["reading"][0], c.Token, app.Config.EffectiveSessionCookieName(), cookie)
			if rec.Code != 200 {
				t.Fatalf("valid exam credential with cookie=%v: %d %s", withCookie, rec.Code, rec.Body.String())
			}
		})
	}
}

func TestExamContinuityRenewalInvalidatesUnexpiredBearerMySQL(t *testing.T) {
	f, _ := readyContinuityIELTS(t)
	c := f.candidates[0]
	app := continuityApp(f)
	ctx := context.Background()
	var renewed string
	lease := uint64(1)
	err := tx.NewRunner(f.db).WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		var err error
		renewed, _, err = auth.IssueAttemptTokenTx(ctx, q, app.Config, c.UserID, f.scheduleID, c.AttemptID, c.ClientSessionID, nil, &lease, time.Now().UTC())
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	if _, err = crypto.VerifyAttemptToken([]byte(submitTestSecret), time.Now().UTC(), c.Token); err != nil {
		t.Fatalf("old bearer must still be cryptographically unexpired: %v", err)
	}
	router := BuildRouter(app)
	rec := continuitySave(t, router, c, f.questions["reading"][0], c.Token, "", "")
	if rec.Code != 401 {
		t.Fatalf("old bearer after rotation: %d %s", rec.Code, rec.Body.String())
	}
	rec = continuitySave(t, router, c, f.questions["reading"][0], renewed, "", "")
	if rec.Code != 200 {
		t.Fatalf("renewed bearer: %d %s", rec.Code, rec.Body.String())
	}
}

func TestExamContinuityLostSubmitReceiptSurvivesServiceRecreationButNotExpiredBearerMySQL(t *testing.T) {
	for _, provider := range []string{"sat", "ielts"} {
		t.Run(provider, func(t *testing.T) {
			ctx := context.Background()
			var svc *attempts.Service
			var bearer, attemptID string
			var sealer terminalSealer
			var f ieltsLoadFixture
			if provider == "sat" {
				sat := newSATV2CompletionFixture(t)
				svc, bearer, attemptID, sealer = sat.submitter, sat.bearer, sat.attemptID, sat.sealer
				f.db = sat.db
			} else {
				var services ieltsBudgetServices
				f, services = readyContinuityIELTS(t)
				c := f.candidates[0]
				cmd := attempts.SaveResponsesCommand{AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: ieltsBudgetCommands("continuity", f.questions["reading"], "B")}
				if _, err := services.saver.SaveResponses(ctx, c.Token, cmd, v2Resolver{}, v2Locker{}); err != nil {
					t.Fatal(err)
				}
				endIELTSSectionsForSubmit(t, f.db, "a.id = ?", c.AttemptID)
				svc, bearer, attemptID, sealer = services.saver, c.Token, c.AttemptID, services.sealer
			}
			cmd := attempts.SubmitCommand{AttemptID: attemptID, LeaseEpoch: 1, ExpectedControlEpoch: 1, SubmissionID: uuid.NewString(), ActorKind: "student"}
			first, err := svc.Submit(ctx, bearer, cmd, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, sealer)
			if err != nil {
				t.Fatal(err)
			}
			// Discard the first response and recreate the service, retaining only DB state.
			restarted := attempts.NewService(tx.NewRunner(f.db), clock.System{}, []byte(submitTestSecret))
			replay, err := restarted.Submit(ctx, bearer, cmd, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, sealer)
			if err != nil || !replay.Replayed || replay.FinalDigest != first.FinalDigest {
				t.Fatalf("receipt recovery: %+v %v", replay, err)
			}
			expired := attempts.NewService(tx.NewRunner(f.db), clock.FixedAt(time.Now().UTC().Add(3*time.Hour)), []byte(submitTestSecret))
			if _, err = expired.Submit(ctx, bearer, cmd, v2Resolver{}, v2Locker{}, v2ProviderResolver{}, sealer); err == nil {
				t.Fatal("expired bearer unexpectedly recovered receipt")
			} else if appErr, ok := apperrors.As(err); !ok || appErr.HTTPStatus != 401 {
				t.Fatalf("expected credential rejection, got %v", err)
			}
			var receipts, seals int
			if err = f.db.QueryRow("SELECT COUNT(*) FROM attempt_submissions_v2 WHERE attempt_id = ?", attemptID).Scan(&receipts); err != nil {
				t.Fatal(err)
			}
			if err = f.db.QueryRow("SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?", attemptID).Scan(&seals); err != nil {
				t.Fatal(err)
			}
			if receipts != 1 || seals != 1 {
				t.Fatalf("receipt/seal counts %d/%d, want 1/1", receipts, seals)
			}
		})
	}
}

// Deliberate security revocation must apply to exam grants as well as login sessions.
func TestExamContinuityAccountRevocationRejectsAttemptMySQL(t *testing.T) {
	for _, action := range []string{"logout_all", "disable_user"} {
		t.Run(action, func(t *testing.T) {
			f, _ := readyContinuityIELTS(t)
			c := f.candidates[0]
			app := continuityApp(f)
			_, _, _, err := auth.CreateSession(context.Background(), f.db, app.Config, c.UserID, auth.RoleStudent,
				auth.SessionProof{Source: auth.SessionSourceAccount}, nil, nil, time.Now().UTC())
			if err != nil {
				t.Fatal(err)
			}
			if action == "logout_all" {
				err = auth.RevokeAllSessions(context.Background(), f.db, c.UserID, action, time.Now().UTC())
			} else {
				_, err = f.db.Exec("UPDATE users SET state = 'disabled' WHERE id = ?", c.UserID)
			}
			if err != nil {
				t.Fatal(err)
			}
			rec := continuitySave(t, BuildRouter(app), c, f.questions["reading"][0], c.Token, "", "")
			if rec.Code != 401 {
				t.Fatalf("security revocation must reject attempt: %d %s", rec.Code, rec.Body.String())
			}
			var count int
			if err := f.db.QueryRow("SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ?", c.AttemptID).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 0 {
				t.Fatalf("revoked attempt persisted %d unauthorized answers", count)
			}
		})
	}
}

func TestExamContinuityReceiptAcrossKilledAPIProcessMySQL(t *testing.T) {
	// Confirm the isolated database is configured before building the binary.
	_ = staleETagTestDB(t)
	binary := filepath.Join(t.TempDir(), "api")
	buildSATProcessBinary(t, binary, ".")
	env := withTestEnv(os.Environ(), map[string]string{
		"DATABASE_URL": os.Getenv("TEST_MYSQL_DSN"), "AUTH_SECRET": submitTestSecret,
		"APP_ENV": "test", "ENVIRONMENT": "test", "COOKIE_SECURE": "false",
		"SESSION_COOKIE_NAME": "session", "CSRF_COOKIE_NAME": "csrf",
		"BACKGROUND_RUNTIME_MODE": "continuous",
	})
	for _, provider := range []string{"sat", "ielts"} {
		t.Run(provider, func(t *testing.T) {
			var bearer, attemptID string
			var proofDB *sql.DB
			if provider == "sat" {
				f := newSATV2CompletionFixture(t)
				bearer, attemptID, proofDB = f.bearer, f.attemptID, f.db
			} else {
				f, svc := readyContinuityIELTS(t)
				c := f.candidates[0]
				commands := ieltsBudgetCommands("process-continuity", f.questions["reading"], "B")
				if _, err := svc.saver.SaveResponses(context.Background(), c.Token, attempts.SaveResponsesCommand{AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: commands}, v2Resolver{}, v2Locker{}); err != nil {
					t.Fatal(err)
				}
				endIELTSSectionsForSubmit(t, f.db, "a.id = ?", c.AttemptID)
				bearer, attemptID, proofDB = c.Token, c.AttemptID, f.db
			}
			submissionID := uuid.NewString()
			var firstDigest string
			for _, phase := range []string{"commit_then_kill", "restart_and_replay"} {
				if !t.Run(phase, func(t *testing.T) {
					// This helper kills and waits for the process at subtest cleanup, so
					// the replay process has no memory of the first request.
					base := startSATRecoveryAPIProcess(t, binary, env)
					body, err := json.Marshal(map[string]any{"submissionId": submissionID, "leaseEpoch": 1, "controlEpoch": 1})
					if err != nil {
						t.Fatal(err)
					}
					req, err := http.NewRequest(http.MethodPost, base+"/api/v2/student/attempts/"+attemptID+"/submit", bytes.NewReader(body))
					if err != nil {
						t.Fatal(err)
					}
					req.Header.Set("Authorization", "Bearer "+bearer)
					req.Header.Set("Content-Type", "application/json")
					client := &http.Client{Timeout: 15 * time.Second}
					response, err := client.Do(req)
					if err != nil {
						t.Fatal(err)
					}
					defer response.Body.Close()
					var envelope struct {
						FinalResponseDigest string `json:"finalResponseDigest"`
						Status              string `json:"status"`
						Code                string `json:"code"`
						Message             string `json:"message"`
					}
					if err := json.NewDecoder(response.Body).Decode(&envelope); err != nil {
						t.Fatal(err)
					}
					if response.StatusCode != 200 || envelope.Status != "submitted" || envelope.FinalResponseDigest == "" {
						t.Fatalf("submission: status=%d receipt=%+v", response.StatusCode, envelope)
					}
					if phase == "commit_then_kill" {
						firstDigest = envelope.FinalResponseDigest
					} else if envelope.FinalResponseDigest != firstDigest {
						t.Fatal("restart changed committed digest")
					}
				}) {
					return
				}
			}
			for _, table := range []string{"attempt_submissions_v2", "attempt_terminalizations"} {
				var count int
				if err := proofDB.QueryRow("SELECT COUNT(*) FROM "+table+" WHERE attempt_id = ?", attemptID).Scan(&count); err != nil {
					t.Fatal(err)
				}
				if count != 1 {
					t.Fatalf("%s after process replay: %d rows, want 1", table, count)
				}
			}
		})
	}
}

func TestExamContinuityIELTSDeadlineKeepsCommittedAnswerMySQL(t *testing.T) {
	f, svc := readyContinuityIELTS(t)
	c := f.candidates[0]
	command := attempts.SaveResponsesCommand{AttemptID: c.AttemptID, LeaseEpoch: 1, ControlEpoch: 1, Commands: ieltsBudgetCommands("before-deadline", f.questions["reading"], "B")}
	if _, err := svc.saver.SaveResponses(context.Background(), c.Token, command, v2Resolver{}, v2Locker{}); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec("UPDATE ielts_attempt_section_timelines SET state = 'completed', deadline_at = UTC_TIMESTAMP(6) - INTERVAL 2 MINUTE, finished_at = UTC_TIMESTAMP(6) - INTERVAL 2 MINUTE WHERE attempt_id = ?", c.AttemptID); err != nil {
		t.Fatal(err)
	}
	command.Commands[0].WriteID = "after-deadline"
	command.Commands[0].ClientVersion = 2
	command.Commands[0].Response.Answer = "C"
	if _, err := svc.saver.SaveResponses(context.Background(), c.Token, command, v2Resolver{}, v2Locker{}); err == nil {
		t.Fatal("answer after deadline was accepted")
	} else if appErr, ok := apperrors.As(err); !ok || (appErr.Code != apperrors.CodeDeadlineExpired && appErr.Code != apperrors.CodeAttemptNotWritable) {
		t.Fatalf("expected section/deadline rejection, got %v", err)
	}
	var answer string
	if err := f.db.QueryRow("SELECT JSON_UNQUOTE(JSON_EXTRACT(response, '$.answer')) FROM attempt_responses_v2 WHERE attempt_id = ?", c.AttemptID).Scan(&answer); err != nil {
		t.Fatal(err)
	}
	if answer != "B" {
		t.Fatalf("deadline rejection changed committed answer to %q", answer)
	}
}

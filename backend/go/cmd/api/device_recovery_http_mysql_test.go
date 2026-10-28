package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/config"
	"github.com/google/uuid"
)

// The entire production router participates: anonymous capability routes,
// cookies/CSRF, session lookup, route scope, and bearer authorization. Neither
// the claim nor the ready request receives an account session.
func TestStaffDeviceRecoveryColdHTTPMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, base, _, _ := seedStaleETagExam(t, db)
	cfg := config.Load()
	cfg.AuthSecret = "staff-recovery-http-test-secret-at-least-32"
	cfg.StaffDeviceRecoveryEnabled = true
	cfg.CookieSecure = false
	cfg.OutboxExecOnly = true
	student, staff := uuid.NewString(), uuid.NewString()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatal(err)
		}
	}
	for _, u := range []struct{ id, role string }{{student, "student"}, {staff, "admin"}} {
		exec(`INSERT INTO users (id,email,display_name,role,state,organization_id) VALUES (?,?,'Recovery HTTP',?,'active','stale-etag-org')`, u.id, u.id+"@example.test", u.role)
	}
	exec(`INSERT INTO staff_profiles (user_id,full_name,email) VALUES (?,'Recovery HTTP',?)`, staff, staff+"@example.test")
	registration := uuid.NewString()
	exec(`INSERT INTO schedule_registrations (id,schedule_id,student_key,student_id,student_name,access_state,wcode,user_id) SELECT ?,schedule_id,student_key,candidate_id,candidate_name,'checked_in',wcode,? FROM student_attempts WHERE id=?`, registration, student, attempt)
	exec(`UPDATE student_attempts SET user_id=?,registration_id=?,active_client_session_id='original-http-browser' WHERE id=?`, student, registration, attempt)
	exec(`UPDATE assessment_module_attempts SET started_at=UTC_TIMESTAMP(6),allocated_seconds=1800 WHERE attempt_id=?`, attempt)
	t.Cleanup(func() {
		// Delete credentials before the fixture's own attempt cleanup runs.
		_, _ = db.Exec(`DELETE FROM user_sessions WHERE user_id IN (?,?)`, student, staff)
		_, _ = db.Exec(`DELETE FROM attempt_device_recovery_grants WHERE attempt_id=?`, attempt)
		_, _ = db.Exec(`UPDATE student_attempts SET registration_id=NULL,user_id=NULL WHERE id=?`, attempt)
		_, _ = db.Exec(`DELETE FROM schedule_registrations WHERE id=?`, registration)
		_, _ = db.Exec(`DELETE FROM staff_profiles WHERE user_id=?`, staff)
		_, _ = db.Exec(`DELETE FROM users WHERE id IN (?,?)`, student, staff)
	})
	lease := uint64(1)
	oldBearer, _, err := auth.IssueAttemptToken(ctx, db, cfg, student, schedule, attempt, "original-http-browser", nil, &lease, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	_, staffCookie, staffCSRF, err := auth.CreateSession(ctx, db, cfg, staff, auth.RoleAdmin, auth.SessionProof{Source: auth.SessionSourceAccount}, nil, nil, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	app := BuildApp(cfg, db)
	router := BuildRouter(app)
	call := func(method, path string, body any, cookies []*http.Cookie, csrf, bearer string) *httptest.ResponseRecorder {
		t.Helper()
		raw, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req.Header.Set("Content-Type", "application/json")
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		if csrf != "" {
			req.Header.Set("X-CSRF-Token", csrf)
		}
		if bearer != "" {
			req.Header.Set("Authorization", "Bearer "+bearer)
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		return rec
	}
	decode := func(rec *httptest.ResponseRecorder, into any) {
		t.Helper()
		if rec.Code != http.StatusOK {
			t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
		}
		if err := json.Unmarshal(rec.Body.Bytes(), into); err != nil {
			t.Fatal(err)
		}
	}
	staffCookies := []*http.Cookie{{Name: cfg.EffectiveSessionCookieName(), Value: staffCookie}}
	staffPath := "/api/v1/proctor/sessions/" + schedule + "/attempts/" + attempt + "/device-recovery"
	var options delivery.DeviceRecoveryOptions
	decode(call("GET", staffPath, nil, staffCookies, "", ""), &options)
	seconds := 420
	var issued delivery.IssuedDeviceRecovery
	decode(call("POST", staffPath, delivery.IssueDeviceRecoveryRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch, Target: examdomain.RecoveryTarget{SectionKey: "reading-writing", ModuleID: base, ModuleAttemptID: options.Targets[0].ModuleAttemptID}, RemainingSeconds: &seconds}, staffCookies, staffCSRF, ""), &issued)
	grantPath := "/api/v1/student/device-recovery/" + issued.Grant.GrantID
	proof := "fresh-browser-" + uuid.NewString()
	var ready delivery.RecoveryReadyView
	claim := call("POST", grantPath+"/claim", delivery.ClaimDeviceRecoveryRequest{OperationID: uuid.NewString(), LinkSecret: issued.LinkSecret, Code: issued.Code, BrowserProof: proof}, nil, "", "")
	decode(claim, &ready)
	if len(claim.Result().Cookies()) != 0 || strings.Contains(claim.Body.String(), "attemptToken") || strings.Contains(claim.Body.String(), "correctOptionId") || strings.Contains(claim.Body.String(), "answers") {
		t.Fatal("preparation exposed exam authority or answers")
	}
	if claim.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("capability response can be cached")
	}
	bootstrapPath := "/api/v1/assessment-delivery/schedules/" + schedule + "/bootstrap"
	if rec := call("POST", bootstrapPath, nil, nil, "", oldBearer); rec.Code == 200 {
		t.Fatal("old browser retained content access")
	}
	var begun struct {
		Recovery          delivery.RecoveryBeginResult `json:"recovery"`
		AttemptCredential struct {
			AttemptToken string `json:"attemptToken"`
		} `json:"attemptCredential"`
	}
	beginRequest := delivery.BeginDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof, ExpectedGrantRevision: ready.GrantRevision}
	response := call("POST", grantPath+"/begin", beginRequest, nil, "", "")
	decode(response, &begun)
	cookies := response.Result().Cookies()
	var csrf string
	for _, c := range cookies {
		if c.Name == cfg.EffectiveCsrfCookieName() {
			csrf = c.Value
		}
	}
	if len(cookies) != 2 || csrf == "" || begun.AttemptCredential.AttemptToken == "" {
		t.Fatal("Continue did not deliver both scoped cookies and the attempt bearer")
	}
	var session map[string]any
	decode(call("GET", "/api/v1/auth/session", nil, cookies, "", ""), &session)
	for _, prefix := range []string{"/api/v2", "/v2"} {
		var snapshot map[string]any
		decode(call("GET", prefix+"/student/attempts/"+attempt+"/responses", nil, cookies, "", begun.AttemptCredential.AttemptToken), &snapshot)
	}
	var bootstrap delivery.Bootstrap
	decode(call("POST", bootstrapPath, nil, cookies, csrf, begun.AttemptCredential.AttemptToken), &bootstrap)
	if len(bootstrap.Sections) != 1 || len(bootstrap.Sections[0].Modules) != 1 || bootstrap.Sections[0].Modules[0].ID != base {
		t.Fatal("recovery bootstrap exposed another module")
	}
	var poll struct {
		Revision        int64      `json:"revision"`
		ActiveSection   string     `json:"activeSection"`
		FocusDeadlineAt *time.Time `json:"focusDeadlineAt"`
	}
	pollPath := "/api/v1/student/sessions/" + schedule + "/runtime"
	decode(call("GET", pollPath, nil, cookies, "", ""), &poll)
	if poll.ActiveSection != "reading-writing" || poll.FocusDeadlineAt == nil || !poll.FocusDeadlineAt.Equal(*begun.Recovery.EffectiveDeadlineAt) {
		t.Fatalf("runtime poll disagrees with the recovered clock: %+v", poll)
	}
	if rec := call("GET", pollPath+"?sinceRevision="+strconv.FormatInt(poll.Revision, 10), nil, cookies, "", ""); rec.Code != http.StatusNotModified {
		t.Fatalf("unchanged recovery poll status=%d body=%s", rec.Code, rec.Body.String())
	}
	if rec := call("GET", "/api/v1/proctor/sessions/"+schedule, nil, cookies, "", ""); rec.Code != http.StatusForbidden {
		t.Fatalf("recovery cookie escaped to staff routes: %d", rec.Code)
	}
	if rec := call("GET", "/api/v2/student/attempts/"+uuid.NewString()+"/responses", nil, cookies, "", begun.AttemptCredential.AttemptToken); rec.Code != http.StatusForbidden {
		t.Fatalf("recovery cookie escaped to another attempt: %d", rec.Code)
	}
}

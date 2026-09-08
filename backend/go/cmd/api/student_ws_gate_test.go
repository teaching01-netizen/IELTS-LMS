package main

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
)

func sessionCtx(ctx context.Context, sess *auth.Session) context.Context {
	return context.WithValue(ctx, sessionCtxKey, sess)
}

// C3 RED: STUDENT_WS=gone retires student sockets with 410 + use pointer.
func TestStudentWSGone410(t *testing.T) {
	cfg := config.Load()
	cfg.StudentWS = config.StudentWSGone
	app := &App{Config: cfg}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/live?scheduleId=sched-1", nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "u1", Role: auth.RoleStudent}))
	rec := httptest.NewRecorder()
	liveWebSocketHandler(app)(rec, req)
	res := rec.Result()
	defer res.Body.Close()
	if res.StatusCode != http.StatusGone {
		t.Fatalf("retired student WS must 410, got %d", res.StatusCode)
	}
	if body := rec.Body.String(); !containsStr(body, "runtime-poll") {
		t.Fatalf("410 must point at runtime-poll, got %s", body)
	}
}

// C3 RED: staff WS is kept under gone (proctors keep sockets).
func TestStaffWSKeptUnderGone(t *testing.T) {
	cfg := config.Load()
	cfg.StudentWS = config.StudentWSGone
	app := &App{Config: cfg}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/live?scheduleId=sched-1", nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "p1", Role: auth.RoleProctor}))
	rec := httptest.NewRecorder()
	liveWebSocketHandler(app)(rec, req)
	// No DB/hub wired -> 503 past the gate proves staff was NOT 410'd.
	if rec.Result().StatusCode != http.StatusServiceUnavailable {
		t.Fatalf("staff must pass the student gate, got %d", rec.Result().StatusCode)
	}
}

// C3 RED: allow (default) keeps student sockets (no 410 pre-DB).
func TestStudentWSAllowKeepsSocket(t *testing.T) {
	app := &App{Config: config.Load()}
	req := httptest.NewRequest(http.MethodGet, "/api/v1/ws/live?scheduleId=sched-1", nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "u1", Role: auth.RoleStudent}))
	rec := httptest.NewRecorder()
	liveWebSocketHandler(app)(rec, req)
	if rec.Result().StatusCode == http.StatusGone {
		t.Fatalf("allow must not 410 student sockets")
	}
}

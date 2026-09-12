package main

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

// WS-06b: wrong-method requests render 405 METHOD_NOT_ALLOWED (not 400)
// with an Allow header listing the path's registered methods (RFC 9110
// Section 15.5.6).

func decodeEnvelope(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var env map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("405 body must be the JSON error envelope, got %q: %v", rec.Body.String(), err)
	}
	return env
}

func TestMethodNotAllowedHealthzListsGET(t *testing.T) {
	h := BuildRouter(BuildApp(config.Load(), nil))
	req := httptest.NewRequest(http.MethodPost, "/healthz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /healthz must be 405, got %d (%s)", rec.Code, rec.Body.String())
	}
	if allow := rec.Header().Get("Allow"); !strings.Contains(allow, "GET") {
		t.Fatalf("Allow header must contain GET, got %q", allow)
	}
	if env := decodeEnvelope(t, rec); env["code"] != "METHOD_NOT_ALLOWED" {
		t.Fatalf("envelope code must be METHOD_NOT_ALLOWED, got %v", env["code"])
	}
}

func TestMethodNotAllowedLoginListsPOST(t *testing.T) {
	h := BuildRouter(BuildApp(config.Load(), nil))
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/login", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET /api/v1/auth/login must be 405, got %d (%s)", rec.Code, rec.Body.String())
	}
	if allow := rec.Header().Get("Allow"); !strings.Contains(allow, "POST") {
		t.Fatalf("Allow header must contain POST, got %q", allow)
	}
	if env := decodeEnvelope(t, rec); env["code"] != "METHOD_NOT_ALLOWED" {
		t.Fatalf("envelope code must be METHOD_NOT_ALLOWED, got %v", env["code"])
	}
}

// A path with several registered methods must list all of them: the chi
// route walk (not a static map) keeps this correct as routes evolve.
func TestMethodNotAllowedExamListsAllMethods(t *testing.T) {
	h := BuildRouter(BuildApp(config.Load(), nil))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/exams/some-id", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("POST /api/v1/exams/{id} must be 405, got %d (%s)", rec.Code, rec.Body.String())
	}
	allow := rec.Header().Get("Allow")
	for _, want := range []string{"GET", "PATCH", "DELETE"} {
		if !strings.Contains(allow, want) {
			t.Fatalf("Allow header must contain %s, got %q", want, allow)
		}
	}
}

// Unknown paths still 404 (the 405 path must never swallow NotFound).
func TestUnknownPathStill404(t *testing.T) {
	h := BuildRouter(BuildApp(config.Load(), nil))
	req := httptest.NewRequest(http.MethodGet, "/no-such-route-xyz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown path must stay 404, got %d", rec.Code)
	}
}

// sameRouteShape unit-pins the walk matcher: {param} segments match any
// single non-empty segment; literals compare exactly; segment count must
// agree (so /exams/{id} never matches /exams/{id}/events).
func TestSameRouteShape(t *testing.T) {
	cases := []struct {
		pattern string
		path    string
		want    bool
	}{
		{"/healthz", "/healthz", true},
		{"/api/v1/exams/{id}", "/api/v1/exams/abc-123", true},
		{"/api/v1/exams/{id}", "/api/v1/exams/abc-123/events", false},
		{"/api/v1/exams/{id}/events", "/api/v1/exams/abc-123/events", true},
		{"/api/v1/exams/{id}", "/api/v1/schedules/abc-123", false},
		{"/api/v1/auth/login", "/api/v1/auth/login", true},
		{"/api/v1/auth/login", "/api/v1/auth/logout", false},
		{"/{scheduleID}/mutations:batch", "/sched-1/mutations:batch", true},
		{"/", "/", true},
	}
	for _, c := range cases {
		if got := sameRouteShape(c.pattern, c.path); got != c.want {
			t.Errorf("sameRouteShape(%q, %q) = %v, want %v", c.pattern, c.path, got, c.want)
		}
	}
}

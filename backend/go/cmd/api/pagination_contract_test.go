package main

// WS-13.1/13.4 pins: malformed list numerics fail closed (400 + field
// pointers) instead of silently coercing to defaults; absent values keep
// legacy defaults and shapes so old clients keep working.
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
)

func authedAdminReq(method, target string) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	return req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "u1", Role: auth.RoleAdmin}))
}

func decodeDetails(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var env map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body must be the JSON error envelope, got %q", rec.Body.String())
	}
	details, _ := env["details"].(map[string]any)
	return details
}

// Grading queue: ?limit=abc is 400 with a limit field pointer (not a
// silent default-200 list).
func TestPaginationGradingQueueRejectsMalformedLimit(t *testing.T) {
	h := authzTestRouter()
	req := authedAdminReq(http.MethodGet, "/api/v1/grading/sessions?limit=abc")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed queue limit must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeCode(t, rec); code != "BAD_REQUEST" {
		t.Fatalf("envelope code must be BAD_REQUEST, got %q", code)
	}
	if details := decodeDetails(t, rec); details == nil {
		t.Fatal("400 must carry details.fields naming limit")
	}
}

// Grading queue: ?page=abc is 400 (not a silent page-1 list).
func TestPaginationGradingQueueRejectsMalformedPage(t *testing.T) {
	h := authzTestRouter()
	req := authedAdminReq(http.MethodGet, "/api/v1/grading/sessions?page=abc&search=x")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed queue page must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Roster: ?limit=abc is 400 (not a silent default-200 page).
func TestPaginationRosterRejectsMalformedLimit(t *testing.T) {
	h := authzTestRouter()
	req := authedAdminReq(http.MethodGet, "/api/v1/proctor/sessions/sched-1/roster?limit=abc")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed roster limit must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeCode(t, rec); code != "BAD_REQUEST" {
		t.Fatalf("envelope code must be BAD_REQUEST, got %q", code)
	}
}

// Proctor detail: ?mode=dashboard&auditLimit=abc is 400.
func TestPaginationProctorDetailRejectsMalformedDashboardLimit(t *testing.T) {
	h := authzTestRouter()
	req := authedAdminReq(http.MethodGet, "/api/v1/proctor/sessions/sched-1?mode=dashboard&auditLimit=abc")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed dashboard limit must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Answer-history replay: ?cursor=abc is 400 (not a silent first-page).
func TestPaginationAnswerHistoryRejectsMalformedCursor(t *testing.T) {
	h := authzTestRouter()
	req := authedAdminReq(http.MethodGet, "/api/v1/answer-history/submissions/sub-1/targets/t-1?cursor=abc")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed answer-history cursor must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Answer-history replay: ?limit=abc is 400 (not a silent default-200 page).
func TestPaginationAnswerHistoryRejectsMalformedLimit(t *testing.T) {
	h := authzTestRouter()
	req := authedAdminReq(http.MethodGet, "/api/v1/answer-history/submissions/sub-1/targets/t-1?limit=abc")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed answer-history limit must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Library lists: ?limit=abc is 400 (not a silent service-default list).
func TestPaginationLibraryRejectsMalformedLimit(t *testing.T) {
	h := authzTestRouter()
	req := authedAdminReq(http.MethodGet, "/api/v1/library/passages?limit=abc")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed library limit must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Delete guards: ?revision=abc is 400 (never silently drop the guard).
// DELETE passes CSRF first, so the request carries a session-bound token.
func TestPaginationDeleteRejectsMalformedRevision(t *testing.T) {
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/library/passages/p-1?revision=abc", nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "u1", Role: auth.RoleAdmin, CSRFToken: "test-csrf"}))
	req.Header.Set("X-CSRF-Token", "test-csrf")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed delete revision must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Grading detail: ?page=abc is 400 (not a silent page-1 detail).
func TestPaginationGradingDetailRejectsMalformedPage(t *testing.T) {
	h := authzTestRouter()
	req := authedAdminReq(http.MethodGet, "/api/v1/grading/sessions/sess-1?page=abc")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed detail page must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Questions delete: ?revision=abc is 400 (never silently drop the guard).
func TestPaginationQuestionDeleteRejectsMalformedRevision(t *testing.T) {
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/library/questions/q-1?revision=abc", nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "u1", Role: auth.RoleAdmin, CSRFToken: "test-csrf"}))
	req.Header.Set("X-CSRF-Token", "test-csrf")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("malformed question delete revision must 400, got %d (%s)", rec.Code, rec.Body.String())
	}
}

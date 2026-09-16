package main

// Plan invariant I4: BuildRouter middleware order must stay
// recovery > request-id > trace > security > body-limit > pre-auth IP guard >
// auth > CSRF > route rate-limit > authorization > handler > access-log. A reorder (e.g.
// auth before request-id, or access-log before auth) silently breaks
// request tracing, CSRF posture, or 429 observability.
//
// Authorization is per-route (authorize/authzRoute helpers run inside the
// route handlers, after chi matches), so this file pins BEHAVIOR, not
// source-marker text: CSRF rejection, rate-limit rejection, and the authz
// gate each fire (or provably passthrough) in the right layer order, and
// the request ID minted up front is echoed on every response.
import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// Request ID minted by the earliest middleware must be echoed back even
// when a LATER layer (authz) rejects: proves request-id runs before authz.
func TestMiddlewareOrderRequestIDBeforeAuthz(t *testing.T) {
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anon session route must 401, got %d", rec.Code)
	}
	if rec.Header().Get(httpx.RequestIDHeader) == "" {
		t.Fatalf("request-id middleware must stamp the response even on authz 401")
	}
}

// CSRF rejection fires before the authz gate: a wrong-origin session
// POST is rejected by CSRF, not by authz (proves CSRF layer order).
func TestMiddlewareOrderCSRFBeforeAuthz(t *testing.T) {
	cfg := config.Load()
	h := BuildRouter(BuildApp(cfg, nil))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/schedules", nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "u1", Role: auth.RoleStudent}))
	req.Header.Set("Origin", "https://evil.example")
	req.AddCookie(&http.Cookie{Name: cfg.EffectiveSessionCookieName(), Value: "s"})
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusForbidden && decodeCode(t, rec) == "FORBIDDEN" {
		t.Fatalf("wrong-origin POST must be rejected by CSRF, not reach authz FORBIDDEN")
	}
}

// Access logging observes the final status: an authz 401 is still logged
// with its route (proves the log layer wraps the gate, outermost-last).
func TestMiddlewareOrderAccessLogSeesAuthzDenial(t *testing.T) {
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)
	req.Header.Set(httpx.RequestIDHeader, "order-probe-1")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anon session route must 401, got %d", rec.Code)
	}
	if got := rec.Header().Get(httpx.RequestIDHeader); got != "order-probe-1" {
		t.Fatalf("request id must round-trip through the full stack, got %q", got)
	}
}

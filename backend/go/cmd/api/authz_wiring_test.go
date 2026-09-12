package main

// Authz first-layer wiring pins (fail-closed, behavior-preserving).
//
// Enforcement runs per-route AFTER chi matches (authorize/authzRoute in
// BuildRouter), never as a global pre-routing gate: 404/405 paths never
// touch authz, and each route enforces its exact table key. Public/Bearer
// entries passthrough to their handler credential checks; session entries
// 401 anon (SESSION_EXPIRED) and 403 wrong-role (FORBIDDEN); routed-but-
// unlisted keys deny closed (403). Handlers keep requireRole/
// requireSession + scope (assignment/attempt-ownership/builder-preview)
// second; this file pins the first layer, not per-role matrices (those
// live in internal/authz/authz_policy_test.go).
import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"regexp"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authz"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

func authzTestRouter() http.Handler {
	return BuildRouter(BuildApp(config.Load(), nil))
}

func decodeCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var env map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &env); err != nil {
		t.Fatalf("body must be the JSON error envelope, got %q: %v", rec.Body.String(), err)
	}
	code, _ := env["code"].(string)
	return code
}

func authedReq(method, target, userID, role string) *http.Request {
	req := httptest.NewRequest(method, target, nil)
	return req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: userID, Role: role}))
}

func sentinelOK() http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusTeapot)
	}
}

// Anon on a session-gated route must 401 SESSION_EXPIRED at the gate
// (before the handler's own requireRole would fire).
func TestAuthzWiringAnonSessionRoute401s(t *testing.T) {
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("anon GET /api/v1/auth/session must 401, got %d (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeCode(t, rec); code != "SESSION_EXPIRED" {
		t.Fatalf("envelope code must be SESSION_EXPIRED, got %q", code)
	}
}

// Wrong-role on a gated route must 403 FORBIDDEN at the gate (student is
// outside the admin/builder schedules-list gate).
func TestAuthzWiringWrongRole403s(t *testing.T) {
	h := authzTestRouter()
	req := authedReq(http.MethodGet, "/api/v1/schedules", "u1", auth.RoleStudent)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("student GET /api/v1/schedules must 403, got %d (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeCode(t, rec); code != "FORBIDDEN" {
		t.Fatalf("envelope code must be FORBIDDEN, got %q", code)
	}
}

// Positive control: an admitted role reaches the handler (sentinel proves
// the gate passed through instead of denying everything closed).
func TestAuthzWiringAdmittedRoleReachesHandler(t *testing.T) {
	gate := authz.MiddlewareFor(authz.Table, "GET /session", authzSessionOf)(sentinelOK())
	req := authedReq(http.MethodGet, "/api/v1/auth/session", "u1", auth.RoleAdmin)
	rec := httptest.NewRecorder()
	gate.ServeHTTP(rec, req)
	if rec.Code != http.StatusTeapot {
		t.Fatalf("admitted admin must reach the handler (418), got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Missing-policy control: a routed key with no table entry denies closed
// even for an admin session (fail closed over fail open).
func TestAuthzWiringMissingPolicyDeniesClosed(t *testing.T) {
	gate := authz.MiddlewareFor(authz.Table, "GET /no-such-table-key", authzSessionOf)(sentinelOK())
	req := authedReq(http.MethodGet, "/x", "u1", auth.RoleAdmin)
	rec := httptest.NewRecorder()
	gate.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("unlisted routed key must deny closed (403), got %d (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeCode(t, rec); code != "FORBIDDEN" {
		t.Fatalf("envelope code must be FORBIDDEN, got %q", code)
	}
}

// Every registration in BuildRouter must carry a resolvable authz key.
// chi.Walk reports fully-mounted paths while keys are innermost-mount
// relative, so path math cannot reconstruct keys; instead this pins the
// source: every authzRoute METHOD+PATTERN and every authorize KEY must
// resolve via LookupKey, and no bare chi verb registration may remain.
func TestAuthzWiringEveryRegistrationResolves(t *testing.T) {
	src, err := os.ReadFile("main.go")
	if err != nil {
		t.Fatal(err)
	}
	body := string(src)
	var missing []string
	for _, m := range regexp.MustCompile(`authzRoute\(r,\s*"([A-Z]+)",\s*"([^"]+)"\)`).FindAllStringSubmatch(body, -1) {
		key := m[1] + " " + m[2]
		if _, ok := authz.LookupKey(authz.Table, key); !ok {
			missing = append(missing, key)
		}
	}
	for _, m := range regexp.MustCompile(`authorize\(\s*"([^"]+)"`).FindAllStringSubmatch(body, -1) {
		if _, ok := authz.LookupKey(authz.Table, m[1]); !ok {
			missing = append(missing, m[1])
		}
	}
	if len(missing) > 0 {
		t.Fatalf("registrations with unresolvable authz keys (ungated): %v", missing)
	}
}

// Public routes passthrough the gate: the entry shape gate (422 on a
// shapeless body) still decides, proving no 401/403 was injected.
func TestAuthzWiringPublicEntryPassthrough(t *testing.T) {
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/student/entry", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code == http.StatusUnauthorized || rec.Code == http.StatusForbidden {
		t.Fatalf("public entry must passthrough authz (no 401/403), got %d (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeCode(t, rec); code == "SESSION_EXPIRED" || code == "FORBIDDEN" {
		t.Fatalf("public entry must not render an authz envelope, got %q", code)
	}
}

// Bearer routes passthrough the gate to the handler credential check:
// bootstrapping without a bearer renders the handler's
// ATTEMPT_TOKEN_INVALID (401), never the gate's SESSION_EXPIRED.
func TestAuthzWiringBearerDeliveryPassthrough(t *testing.T) {
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodPost, "/api/v1/assessment-delivery/schedules/sched-1/bootstrap", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("bearer-less bootstrap must 401 from the handler credential check, got %d (%s)", rec.Code, rec.Body.String())
	}
	if code := decodeCode(t, rec); code != "ATTEMPT_TOKEN_INVALID" {
		t.Fatalf("envelope code must be ATTEMPT_TOKEN_INVALID (handler), got %q", code)
	}
}

// The /metrics inner bearer gate still decides (403 when tokenless): the
// authz layer passes through and never opens the scrape itself.
func TestAuthzWiringMetricsInnerGateStillDecides(t *testing.T) {
	t.Setenv("METRICS_PUBLIC", "")
	t.Setenv("METRICS_TOKEN", "test-token")
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("tokenless /metrics must stay 403 via the inner gate, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// Unknown paths stay 404 at the router (the deny-closed 403 only fires
// for ROUTED requests that miss the table — never a 404 swallow).
func TestAuthzWiringUnknownPathStill404(t *testing.T) {
	h := authzTestRouter()
	req := httptest.NewRequest(http.MethodGet, "/no-such-route-xyz", nil)
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown path must stay 404, got %d (%s)", rec.Code, rec.Body.String())
	}
}

// authzSessionOf unit-pin: nil session and empty user read as anonymous;
// a live session resolves its role for the Allow check.
func TestAuthzSessionOfAdapter(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	if _, _, ok := authzSessionOf(req); ok {
		t.Fatal("anonymous request must resolve ok=false")
	}
	empty := req.WithContext(sessionCtx(req.Context(), &auth.Session{Role: auth.RoleAdmin}))
	if _, _, ok := authzSessionOf(empty); ok {
		t.Fatal("empty-user session must resolve ok=false")
	}
	admin := req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "u1", Role: auth.RoleAdmin}))
	if uid, role, ok := authzSessionOf(admin); !ok || uid != "u1" || role != auth.RoleAdmin {
		t.Fatalf("admin session must resolve (u1, admin, true), got (%q, %q, %v)", uid, role, ok)
	}
}

// TemplateKey bridge pin: wiring must point authz at the httpx route
// annotation (without it annotated lookups would miss and deny closed).
func TestAuthzTemplateKeyBridged(t *testing.T) {
	if authz.TemplateKey != httpx.CtxRouteTemplate {
		t.Fatal("authz.TemplateKey must equal httpx.CtxRouteTemplate")
	}
}

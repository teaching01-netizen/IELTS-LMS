package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func persistentRouterCfg() config.Config {
	cfg := config.Load()
	cfg.RateLimitMode = config.RateLimitModeLocal
	cfg.SessionCacheEnabled = false
	cfg.Environment = "test"
	cfg.CookieSecure = false
	cfg.AuthPublicOrigin = "http://example.com"
	return cfg
}

// routerWithSession builds the production router with a fake resolver that
// admits sess for any cookie (nil sess = anonymous).
func routerWithSession(t *testing.T, cfg config.Config, sess *auth.Session) http.Handler {
	t.Helper()
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	app := &App{Config: cfg, DB: db, SessionCache: auth.NewSessionCache(auth.SessionCacheConfig{Enabled: false}),
		SessionResolver: func(context.Context, *sql.DB, *auth.SessionCache, config.Config, string) (*auth.Session, error) {
			if sess == nil {
				return nil, nil
			}
			copy := *sess
			return &copy, nil
		}}
	return BuildRouter(app)
}

func responseCode(t *testing.T, rec *httptest.ResponseRecorder) string {
	t.Helper()
	var body struct {
		Code string `json:"code"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &body)
	return body.Code
}

func TestRememberedStaffCookiesPersistToAbsoluteDeadline(t *testing.T) {
	cfg := config.Load()
	cfg.Environment = "production"
	cfg.CookieSecure = true
	cfg.SessionCookieName = "__Host-session"
	cfg.CsrfCookieName = "__Host-csrf"
	app := &App{Config: cfg}
	now := time.Now().UTC().Truncate(time.Second)
	credentialAt := now
	created := auth.CreatedSession{
		Token: "raw-bearer",
		User:  auth.SessionUser{ID: "u-1", Email: "b@example.test", Role: auth.RoleBuilder, State: "active"},
		Session: auth.Session{ID: "s-1", UserID: "u-1", Role: auth.RoleBuilder, CSRFToken: "csrf-1", IssuedAt: now,
			ExpiresAt: now.Add(720 * time.Hour), IdleTimeoutAt: now.Add(168 * time.Hour), Remembered: true, CredentialAuthenticatedAt: &credentialAt},
	}
	rec := httptest.NewRecorder()
	writeAccountSession(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil), app, created)
	cookies := rec.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("want session + csrf cookies, got %+v", cookies)
	}
	for _, c := range cookies {
		if !c.Expires.Equal(created.Session.ExpiresAt) || c.MaxAge > 720*60*60 || c.MaxAge < 720*60*60-2 {
			t.Fatalf("remembered cookie must live to the absolute deadline, not idle: %+v", c)
		}
		if c.Path != "/" || !c.Secure || c.Domain != "" || c.SameSite != http.SameSiteStrictMode {
			t.Fatalf("cookie scope/security attributes: %+v", c)
		}
	}
	if cookies[0].Name != "__Host-session" || !cookies[0].HttpOnly || cookies[1].HttpOnly {
		t.Fatalf("session cookie must be HttpOnly __Host-, csrf readable: %+v", cookies)
	}
	var payload map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload["remembered"] != true || payload["credentialAuthenticatedAt"] == nil {
		t.Fatalf("payload must expose the stored policy: %v", payload)
	}
	if strings.Contains(rec.Body.String(), "raw-bearer") {
		t.Fatal("the bearer token must never appear in JSON")
	}

	created.Session.Remembered = false
	rec = httptest.NewRecorder()
	writeAccountSession(rec, httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", nil), app, created)
	for _, c := range rec.Result().Cookies() {
		if !c.Expires.IsZero() || c.MaxAge != 0 {
			t.Fatalf("opted-out staff cookie must be browser-session scoped: %+v", c)
		}
	}
}

func TestAuthResponsesAreNoStoreEvenOnErrors(t *testing.T) {
	router := routerWithSession(t, persistentRouterCfg(), nil)
	for _, path := range []string{"/api/v1/auth/session", "/api/v1/auth/logout-all"} {
		method := http.MethodGet
		if strings.HasSuffix(path, "logout-all") {
			method = http.MethodPost
		}
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, httptest.NewRequest(method, path, nil))
		if rec.Code < 400 {
			t.Fatalf("%s anonymous: want an error, got %d", path, rec.Code)
		}
		if got := rec.Header().Get("Cache-Control"); got != "no-store" {
			t.Fatalf("%s %d Cache-Control = %q, want no-store", path, rec.Code, got)
		}
	}
}

func TestLoginRememberMeRequiresBoolean(t *testing.T) {
	router := routerWithSession(t, persistentRouterCfg(), nil)
	for _, value := range []string{`null`, `"true"`, `1`, `{}`, `[]`} {
		req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/login", strings.NewReader(`{"email":"x@example.test","password":"p","rememberMe":`+value+`}`))
		req.Header.Set("Origin", "http://example.com")
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != http.StatusBadRequest {
			t.Fatalf("rememberMe=%s: got %d", value, rec.Code)
		}
		if len(rec.Result().Cookies()) != 0 {
			t.Fatal("invalid login set cookies")
		}
	}
}

func TestCredentialRoutesRequireExactOrigin(t *testing.T) {
	router := routerWithSession(t, persistentRouterCfg(), nil)
	body := `{"email":"x@example.test","password":"p"}`
	cases := []struct {
		name    string
		headers map[string]string
		reject  bool
	}{
		{"foreign origin", map[string]string{"Origin": "https://evil.example"}, true},
		{"null origin", map[string]string{"Origin": "null"}, true},
		{"port mismatch", map[string]string{"Origin": "http://example.com:8080"}, true},
		{"scheme mismatch", map[string]string{"Origin": "https://example.com"}, true},
		{"suffix host", map[string]string{"Origin": "http://evil-example.com"}, true},
		{"foreign referer", map[string]string{"Referer": "https://evil.example/login"}, true},
		{"no origin from non-browser", nil, true},
		{"cross-site fetch metadata", map[string]string{"Sec-Fetch-Site": "cross-site"}, true},
		{"exact origin", map[string]string{"Origin": "http://example.com"}, false},
		{"exact referer", map[string]string{"Referer": "http://example.com/login?next=/admin"}, false},
		{"same-origin fetch metadata", map[string]string{"Sec-Fetch-Site": "same-origin"}, false},
	}
	for _, route := range []string{"/api/v1/auth/login", "/api/v1/auth/activate", "/api/v1/auth/password/reset-complete", "/api/v1/auth/logout"} {
		for _, tc := range cases {
			t.Run(route+"/"+tc.name, func(t *testing.T) {
				req := httptest.NewRequest(http.MethodPost, route, strings.NewReader(body))
				req.Header.Set("Content-Type", "application/json")
				for k, v := range tc.headers {
					req.Header.Set(k, v)
				}
				rec := httptest.NewRecorder()
				router.ServeHTTP(rec, req)
				rejected := rec.Code == http.StatusForbidden && responseCode(t, rec) == "CSRF_REJECTED"
				if rejected != tc.reject {
					t.Fatalf("reject=%t, got %d %s", tc.reject, rec.Code, rec.Body.String())
				}
			})
		}
	}
}

// Logout works without a live session (expired/revoked/no cookie): it
// clears cookies and never needs account authority.
func TestAnonymousLogoutClearsCookies(t *testing.T) {
	router := routerWithSession(t, persistentRouterCfg(), nil)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout", nil)
	req.Header.Set("Origin", "http://example.com")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("anonymous logout = %d %s", rec.Code, rec.Body.String())
	}
	cleared := 0
	for _, c := range rec.Result().Cookies() {
		if c.MaxAge < 0 {
			cleared++
		}
	}
	if cleared != 2 {
		t.Fatalf("logout must clear both cookies, got %+v", rec.Result().Cookies())
	}
}

func liveStaff(role string, credentialAge time.Duration, validatedAt time.Time) *auth.Session {
	s := &auth.Session{ID: "s-1", UserID: "u-1", Role: role, CSRFToken: "csrf-1", Proof: auth.SessionProof{Source: auth.SessionSourceAccount},
		ExpiresAt: validatedAt.Add(time.Hour), IdleTimeoutAt: validatedAt.Add(time.Hour), ValidatedAt: validatedAt}
	if credentialAge >= 0 {
		at := validatedAt.Add(-credentialAge)
		s.CredentialAuthenticatedAt = &at
	}
	return s
}

var sensitiveRouteManifest = []struct{ method, path string }{
	{http.MethodDelete, "/api/v1/exams/11111111-1111-1111-1111-111111111111"},
	{http.MethodPost, "/api/v1/grading/submissions/sub-1/release-now"},
	{http.MethodPost, "/api/v1/grading/submissions/sub-1/schedule-release"},
	{http.MethodPost, "/api/v1/grading/export"},
	{http.MethodPost, "/api/v1/results/export"},
	{http.MethodGet, "/api/v1/results/sat/export/rawdata"},
	{http.MethodGet, "/api/v1/answer-history/submissions/sub-1/export"},
	{http.MethodPost, "/api/v1/sat-answered-pdf/attempts/att-1"},
	{http.MethodPost, "/api/v1/sat-answered-pdf/attempts/att-1/prepare"},
}

func serveAs(router http.Handler, method, path string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(method, path, strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Origin", "http://example.com")
	req.Header.Set("X-CSRF-Token", "csrf-1")
	req.AddCookie(&http.Cookie{Name: "session", Value: "cookie"})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

// Password confirmation never gates the sensitive routes: a staff session
// without any recent password verification reaches authorization like any
// other, and a student is still denied by it.
func TestSensitiveRouteManifestNeverRequiresPasswordConfirmation(t *testing.T) {
	cfg := persistentRouterCfg()
	cfg.SessionCookieName = "session"
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	staff := routerWithSession(t, cfg, liveStaff(auth.RoleAdmin, -1, now))
	student := routerWithSession(t, cfg, &auth.Session{ID: "s-2", UserID: "u-2", Role: auth.RoleStudent, CSRFToken: "csrf-1", Proof: auth.SessionProof{Source: auth.SessionSourceAccount}, ValidatedAt: now})
	for _, route := range sensitiveRouteManifest {
		t.Run(route.method+" "+route.path, func(t *testing.T) {
			if rec := serveAs(staff, route.method, route.path); responseCode(t, rec) == "REAUTH_REQUIRED" {
				t.Fatalf("staff session must not need password confirmation: %d %s", rec.Code, rec.Body.String())
			}
			if rec := serveAs(student, route.method, route.path); rec.Code < 400 {
				t.Fatalf("student must be denied by authorization: %d %s", rec.Code, rec.Body.String())
			}
		})
	}
	// The deprecated results/export-profile alias has no authz table entry, so
	// it denies closed.
	if rec := serveAs(staff, http.MethodPost, "/api/v1/results/export-profile"); rec.Code != http.StatusForbidden || responseCode(t, rec) != "FORBIDDEN" {
		t.Fatalf("export-profile alias must stay denied: %d %s", rec.Code, rec.Body.String())
	}
}

// Staff requests never re-issue cookies on ordinary polling, remembered or not.
func TestStaffPollingNeverReissuesCookies(t *testing.T) {
	cfg := persistentRouterCfg()
	cfg.SessionCookieName = "session"
	sess := liveStaff(auth.RoleBuilder, time.Minute, time.Now().UTC())
	sess.Remembered = true
	router := routerWithSession(t, cfg, sess)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)
	req.AddCookie(&http.Cookie{Name: "session", Value: "cookie"})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if len(rec.Result().Cookies()) != 0 {
		t.Fatalf("session check re-issued cookies: %+v", rec.Result().Cookies())
	}
}

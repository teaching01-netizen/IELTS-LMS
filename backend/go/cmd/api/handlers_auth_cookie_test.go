package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
)

// Regression (SAT exam-day logout): an idle window shorter than the sitting
// must not cut the browser cookie short. The server slides idle on every
// request but never re-issues the cookie, so an idle-bound cookie vanished one
// idle window after entry and stranded every student on "Time is up".
func TestStudentSessionCookiesOutliveTheIdleWindow(t *testing.T) {
	cfg := config.Load()
	cfg.Environment = "production"
	cfg.CookieSecure = true
	cfg.SessionCookieName = "__Host-session"
	cfg.CsrfCookieName = "__Host-csrf"
	app := &App{Config: cfg}

	now := time.Date(2026, 9, 23, 10, 0, 0, 0, time.UTC)
	expiresAt := now.Add(12 * time.Hour)
	response := httptest.NewRecorder()
	setCreatedSessionCookies(response, app, auth.RoleStudent, "session-token", "csrf-token", expiresAt, now)

	cookies := response.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("expected auth and csrf cookies, got %d", len(cookies))
	}
	for _, cookie := range cookies {
		if cookie.Path != "/" || !cookie.Secure || cookie.SameSite != http.SameSiteStrictMode {
			t.Fatalf("unexpected cookie scope/security attributes: %+v", cookie)
		}
		if !cookie.Expires.Equal(expiresAt) {
			t.Fatalf("cookie expiry = %s, want absolute deadline %s", cookie.Expires, expiresAt)
		}
		if cookie.MaxAge != 12*60*60 {
			t.Fatalf("cookie MaxAge = %d, want %d", cookie.MaxAge, 12*60*60)
		}
	}
	if !cookies[0].HttpOnly || cookies[1].HttpOnly {
		t.Fatalf("session cookie must be HttpOnly and CSRF cookie readable: session=%t csrf=%t", cookies[0].HttpOnly, cookies[1].HttpOnly)
	}
}

func TestStaffSessionCookiesRemainSessionScoped(t *testing.T) {
	cfg := config.Load()
	app := &App{Config: cfg}
	now := time.Now().UTC()
	response := httptest.NewRecorder()
	setCreatedSessionCookies(response, app, auth.RoleAdmin, "session-token", "csrf-token", now.Add(time.Hour), now)

	for _, cookie := range response.Result().Cookies() {
		if !cookie.Expires.IsZero() || cookie.MaxAge != 0 {
			t.Fatalf("staff cookie behavior must remain session-scoped: %+v", cookie)
		}
	}
}

func TestLogoutExpiresMatchingStudentCookies(t *testing.T) {
	cfg := config.Load()
	cfg.Environment = "production"
	cfg.CookieSecure = true
	cfg.SessionCookieName = "__Host-session"
	cfg.CsrfCookieName = "__Host-csrf"
	response := httptest.NewRecorder()
	clearSessionCookies(response, &App{Config: cfg})

	cookies := response.Result().Cookies()
	if len(cookies) != 2 {
		t.Fatalf("expected two expired cookies, got %d", len(cookies))
	}
	for _, cookie := range cookies {
		if cookie.Path != "/" || !cookie.Secure || cookie.MaxAge != -1 || cookie.Expires.After(time.Now()) {
			t.Fatalf("logout cookie did not expire with matching scope: %+v", cookie)
		}
	}
}

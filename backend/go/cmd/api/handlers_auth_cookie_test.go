package main

import (
	"context"
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// A student already sitting when the fix deploys holds a cookie minted with
// the old idle-bound lifetime. Their next authenticated request must carry a
// replacement cookie that lives to the session's absolute deadline; staff
// sessions stay session-scoped and get no refresh.
func TestAuthMiddlewareRefreshesLiveStudentCookieToAbsoluteDeadline(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := config.Load()
	cfg.Environment = "production"
	cfg.CookieSecure = true
	cfg.SessionCookieName = "__Host-session"
	cfg.CsrfCookieName = "__Host-csrf"
	expiresAt := time.Now().UTC().Add(11 * time.Hour)

	for _, role := range []string{auth.RoleStudent, auth.RoleAdmin} {
		t.Run(role, func(t *testing.T) {
			app := &App{Config: cfg, DB: db, SessionResolver: func(context.Context, *sql.DB, *auth.SessionCache, config.Config, string) (*auth.Session, error) {
				return &auth.Session{ID: "s-1", UserID: "u-1", Role: role, CSRFToken: "csrf-1", ExpiresAt: expiresAt, IdleTimeoutAt: time.Now().UTC().Add(time.Hour)}, nil
			}}
			handler := authMiddleware(app)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.WriteHeader(http.StatusOK)
			}))
			request := httptest.NewRequest(http.MethodGet, "/api/v1/assessment-delivery/schedules/sched-1/state", nil)
			request.AddCookie(&http.Cookie{Name: cfg.EffectiveSessionCookieName(), Value: "old-idle-bound-cookie"})
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)

			cookies := response.Result().Cookies()
			if role != auth.RoleStudent {
				if len(cookies) != 0 {
					t.Fatalf("staff request must not re-issue cookies, got %+v", cookies)
				}
				return
			}
			if len(cookies) != 2 {
				t.Fatalf("expected refreshed session and csrf cookies, got %+v", cookies)
			}
			if cookies[0].Value != "old-idle-bound-cookie" || cookies[1].Value != "csrf-1" {
				t.Fatalf("refresh must keep the same session and csrf tokens: %+v", cookies)
			}
			for _, cookie := range cookies {
				if !cookie.Expires.Equal(expiresAt.Truncate(time.Second)) || cookie.MaxAge < 10*60*60 {
					t.Fatalf("refreshed cookie must live to the absolute deadline %s, got %+v", expiresAt, cookie)
				}
			}
		})
	}
}

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

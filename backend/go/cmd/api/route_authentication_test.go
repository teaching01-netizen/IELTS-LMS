package main

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestDeclaredBearerRoutesDoNotResolveAmbientCookies(t *testing.T) {
	for _, path := range []string{
		"/api/v2/student/attempts/attempt-1/responses",
		"/api/v1/assessment-delivery/schedules/schedule-1/state",
		"/api/v1/student/sessions/schedule-1/runtime",
	} {
		t.Run(path, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			cfg := persistentRouterCfg()
			cfg.AuthSecret = "route-auth-test-secret-with-32-characters"
			calls := 0
			app := BuildApp(cfg, db)
			app.SessionResolver = func(context.Context, *sql.DB, *auth.SessionCache, config.Config, string) (*auth.Session, error) {
				calls++
				return nil, errors.New("cookie store must not be consulted")
			}
			req := httptest.NewRequest(http.MethodGet, path, nil)
			req.AddCookie(&http.Cookie{Name: cfg.EffectiveSessionCookieName(), Value: "stale-cookie"})
			req.Header.Set("Authorization", "Bearer malformed")
			rec := httptest.NewRecorder()
			BuildRouter(app).ServeHTTP(rec, req)
			if calls != 0 {
				t.Fatalf("bearer route resolved cookie %d times", calls)
			}
			if rec.Code != 401 {
				t.Fatalf("invalid bearer must be rejected by its handler: %d %s", rec.Code, rec.Body.String())
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Mixed routes keep their cookie path when no bearer is presented. Media
// content serves staff authoring previews by cookie and exam browsers by bearer.
func TestMixedRouteWithoutBearerKeepsCookieSession(t *testing.T) {
	cfg := persistentRouterCfg()
	router := routerWithSession(t, cfg, &auth.Session{UserID: "staff", Role: auth.RoleBuilder, CSRFToken: "csrf"})
	req := httptest.NewRequest(http.MethodGet, "/api/v1/media/asset-1/content", nil)
	req.AddCookie(&http.Cookie{Name: cfg.EffectiveSessionCookieName(), Value: "cookie"})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	// The session reached the handler, which then reports the unwired store.
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("cookie session did not reach media content: %d %s", rec.Code, rec.Body.String())
	}
}

func TestAuthorizationHeaderCannotBypassAccountCSRF(t *testing.T) {
	cfg := persistentRouterCfg()
	sess := &auth.Session{UserID: "user", Role: auth.RoleAdmin, CSRFToken: "csrf"}
	router := routerWithSession(t, cfg, sess)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/logout-all", strings.NewReader("{}"))
	req.AddCookie(&http.Cookie{Name: cfg.EffectiveSessionCookieName(), Value: "cookie"})
	req.Header.Set("Authorization", "Bearer malformed")
	req.Header.Set("Origin", "http://example.com")
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != 403 || decodeCode(t, rec) != "CSRF_REJECTED" {
		t.Fatalf("account CSRF was bypassed: %d %s", rec.Code, rec.Body.String())
	}
}

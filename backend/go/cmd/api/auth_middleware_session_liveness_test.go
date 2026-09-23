package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestAuthMiddlewareRejectsPersistentCookieForExpiredOrRevokedDatabaseSession(t *testing.T) {
	now := time.Now().UTC()
	cases := []struct {
		name      string
		expiresAt time.Time
		revokedAt any
	}{
		{name: "absolute expiry", expiresAt: now.Add(-time.Second)},
		{name: "revoked session", expiresAt: now.Add(time.Hour), revokedAt: now},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			rows := sqlmock.NewRows([]string{
				"id", "user_id", "role_snapshot", "csrf_token", "organization_id", "expires_at", "idle_timeout_at", "revoked_at",
			}).AddRow("session-1", "student-1", auth.RoleStudent, "csrf-1", nil, tc.expiresAt, now.Add(time.Hour), tc.revokedAt)
			mock.ExpectQuery("SELECT s.id").WillReturnRows(rows)

			cfg := config.Load()
			cfg.RateLimitMode = config.RateLimitModeLocal
			cfg.SessionCacheEnabled = false
			app := &App{
				Config:         cfg,
				DB:             db,
				SessionResolver: defaultSessionResolver,
				SessionCache:   auth.NewSessionCache(auth.SessionCacheConfig{Enabled: false}),
			}
			router := BuildRouter(app)
			request := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)
			request.AddCookie(&http.Cookie{
				Name: cfg.EffectiveSessionCookieName(), Value: "persistent-browser-cookie",
				Path: "/", HttpOnly: true, Expires: now.Add(24 * time.Hour), MaxAge: 24 * 60 * 60,
			})
			response := httptest.NewRecorder()
			router.ServeHTTP(response, request)

			if response.Code != http.StatusUnauthorized {
				t.Fatalf("persistent cookie for %s session must receive 401, got %d (%s)", tc.name, response.Code, response.Body.String())
			}
			if code := decodeCode(t, response); code != "SESSION_EXPIRED" {
				t.Fatalf("error code = %q, want SESSION_EXPIRED", code)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

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

func requestWithSessionCookie(router http.Handler, name, value string) *httptest.ResponseRecorder {
	req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/session", nil)
	req.AddCookie(&http.Cookie{Name: name, Value: value})
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	return rec
}

func TestPreAuthBackstopRejectsBeforeSessionLookup(t *testing.T) {
	cfg := config.Load()
	cfg.RateLimitMode = config.RateLimitModeLocal
	cfg.RateLimitBackstopPerMin = 1
	cfg.RateLimitBurst = 0

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	lookupCalls := 0
	app := &App{
		Config: cfg,
		DB:     db,
		SessionResolver: func(context.Context, *sql.DB, *auth.SessionCache, config.Config, string, time.Time) (*auth.Session, error) {
			lookupCalls++
			return nil, nil
		},
	}
	router := BuildRouter(app)

	first := requestWithSessionCookie(router, cfg.EffectiveSessionCookieName(), "session-1")
	if first.Code == http.StatusTooManyRequests {
		t.Fatalf("first request must reach authentication before the bucket is exhausted: %d", first.Code)
	}
	if lookupCalls != 1 {
		t.Fatalf("allowed cookie request must reach session resolution once; calls=%d", lookupCalls)
	}

	second := requestWithSessionCookie(router, cfg.EffectiveSessionCookieName(), "session-1")
	if second.Code != http.StatusTooManyRequests {
		t.Fatalf("exhausted pre-auth guard must return 429, got %d", second.Code)
	}
	if lookupCalls != 1 {
		t.Fatalf("rejected request must not resolve a session; calls=%d", lookupCalls)
	}
}

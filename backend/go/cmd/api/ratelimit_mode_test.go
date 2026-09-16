package main

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/httpx"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// A1 RED: buildTierSet honors RATE_LIMIT_MODE=local — zero DB checkers wired
// even with a pool present, all tiers still budgeted.
func TestBuildTierSetLocalModeWiresNoDBCheckers(t *testing.T) {
	cfg := config.Load()
	cfg.RateLimitMode = config.RateLimitModeLocal
	app := &App{Config: cfg, DB: nil}
	// NOTE: nil DB today also yields local-only; the stronger assertion is
	// below with a non-nil pool (sqlmock-free: *sql.DB zero value is enough
	// because buildTierSet only nil-checks before wiring checkers).
	buildTierSet(app)
	if app.Tiers == nil {
		t.Fatalf("buildTierSet must always set Tiers")
	}
	if n := app.Tiers.DBCheckerCount(); n != 0 {
		t.Fatalf("local mode must wire 0 DB checkers, got %d", n)
	}
	for _, tier := range []string{httpx.TierAuthCritical, httpx.TierAnonAuth, httpx.TierAuthedReads, httpx.TierPolling, httpx.TierHeartbeat, httpx.TierWrites} {
		if !app.Tiers.HasTier(tier) {
			t.Fatalf("local mode must still budget tier %q", tier)
		}
	}
}

// A1: buildTierSet in local mode with a REAL pool still wires zero DB
// checkers (the mode gate, not nil-DB, is what drops the per-request
// UPSERT+SELECT). sqlmock pool proves the gate holds with DB present.
func TestBuildTierSetLocalModeWithPoolWiresNoDBCheckers(t *testing.T) {
	pool, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pool.Close() }()
	cfg := config.Load()
	cfg.RateLimitMode = config.RateLimitModeLocal
	app := &App{Config: cfg, DB: pool}
	buildTierSet(app)
	if app.Tiers == nil {
		t.Fatalf("buildTierSet must always set Tiers")
	}
	if n := app.Tiers.DBCheckerCount(); n != 0 {
		t.Fatalf("local mode with pool must wire 0 DB checkers, got %d", n)
	}
	if !app.Tiers.LocalOnly() {
		t.Fatalf("local mode must set the TierSet localOnly flag")
	}
}

// A1: buildTierSet in dual mode with a pool wires one checker per tier
// (today's behavior preserved: 6 tiers, backstop excluded).
func TestBuildTierSetDualModeWithPoolWiresDBCheckers(t *testing.T) {
	pool, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pool.Close() }()
	cfg := config.Load()
	cfg.RateLimitMode = config.RateLimitModeDual
	app := &App{Config: cfg, DB: pool}
	buildTierSet(app)
	if app.Tiers == nil {
		t.Fatalf("buildTierSet must always set Tiers")
	}
	if n := app.Tiers.DBCheckerCount(); n != 6 {
		t.Fatalf("dual mode with pool must wire 6 DB checkers, got %d", n)
	}
	if app.Tiers.LocalOnly() {
		t.Fatalf("dual mode must not set the TierSet localOnly flag")
	}
}

// A1 RED: buildTierSet in dual mode with nil DB stays local-only (existing
// behavior preserved: tests without a pool never touch the DB).
func TestBuildTierSetDualNilDBStaysLocalOnly(t *testing.T) {
	cfg := config.Load()
	cfg.RateLimitMode = config.RateLimitModeDual
	app := &App{Config: cfg, DB: nil}
	buildTierSet(app)
	if app.Tiers == nil {
		t.Fatalf("buildTierSet must always set Tiers")
	}
	if n := app.Tiers.DBCheckerCount(); n != 0 {
		t.Fatalf("nil DB must wire 0 DB checkers, got %d", n)
	}
}

func TestBuildTierSetUsesIndependentMaxKeysAndBurstConfig(t *testing.T) {
	cfg := config.Load()
	cfg.RateLimitMode = config.RateLimitModeLocal
	cfg.RateLimitMaxKeys = 1
	cfg.RateLimitBurst = 0
	cfg.RateLimitWritesPerMin = 1
	app := &App{Config: cfg}
	buildTierSet(app)

	handler := app.Tiers.Middleware(httpx.TierWrites, func(r *http.Request) string {
		return r.URL.Path
	})(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))

	first := httptest.NewRecorder()
	handler.ServeHTTP(first, httptest.NewRequest(http.MethodPost, "/key-a", nil))
	if first.Code != http.StatusOK {
		t.Fatalf("first configured key must pass, got %d", first.Code)
	}

	secondKey := httptest.NewRecorder()
	handler.ServeHTTP(secondKey, httptest.NewRequest(http.MethodPost, "/key-b", nil))
	if secondKey.Code != http.StatusTooManyRequests {
		t.Fatalf("second active key must hit the configured store cap, got %d", secondKey.Code)
	}

	activeKey := httptest.NewRecorder()
	handler.ServeHTTP(activeKey, httptest.NewRequest(http.MethodPost, "/key-a", nil))
	if activeKey.Code != http.StatusTooManyRequests {
		t.Fatalf("active key must retain its exact quota, got %d", activeKey.Code)
	}
}

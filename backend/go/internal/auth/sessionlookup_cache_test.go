package auth

import (
	"context"
	"database/sql"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"example.com/ielts-proctoring/internal/platform/config"
)

func testCfg() config.Config {
	cfg := config.Load()
	cfg.SessionIdleStaffMins = 30
	cfg.SessionIdleStudentMins = 60
	cfg.SessionAbsoluteHours = 12
	return cfg
}

// A2 RED: LookupSessionWithCache serves the second lookup with zero SQL.
func TestLookupSessionCacheHitNoSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	cache := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100, TouchCoalesceSecs: 300})
	cfg := testCfg()

	rows := sqlmock.NewRows([]string{"id", "user_id", "role_snapshot", "csrf_token", "organization_id", "expires_at", "idle_timeout_at", "revoked_at"}).
		AddRow("s1", "u1", "student", "csrf-1", nil, now.Add(time.Hour), now.Add(30*time.Minute), nil)
	mock.ExpectQuery("SELECT s.id").WillReturnRows(rows)
	// Touch UPDATE may or may not fire on first load depending on coalesce
	// origin; allow but do not require it.
	mock.ExpectExec("UPDATE user_sessions SET last_seen_at").WillReturnResult(sqlmock.NewResult(0, 1))

	ctx := context.Background()
	s1, err := LookupSessionWithCache(ctx, db, cache, cfg, "raw-token-1", now)
	if err != nil {
		t.Fatalf("first lookup: %v", err)
	}
	if s1 == nil || s1.UserID != "u1" {
		t.Fatalf("first lookup mismatch: %+v", s1)
	}
	// Second lookup must hit cache: no further expectations queued, so any
	// SQL fails the test via unfulfilled-mock error.
	s2, err := LookupSessionWithCache(ctx, db, cache, cfg, "raw-token-1", now.Add(time.Second))
	if err != nil {
		t.Fatalf("cached lookup must never 503: %v", err)
	}
	if s2 == nil || s2.ID != "s1" {
		t.Fatalf("cached lookup mismatch: %+v", s2)
	}
}

// A2 RED: revocation is visible immediately through the cache.
func TestLookupSessionCacheRevokeVisible(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	cache := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100, TouchCoalesceSecs: 300})
	cfg := testCfg()

	rows := sqlmock.NewRows([]string{"id", "user_id", "role_snapshot", "csrf_token", "organization_id", "expires_at", "idle_timeout_at", "revoked_at"}).
		AddRow("s1", "u1", "student", "csrf-1", nil, now.Add(time.Hour), now.Add(30*time.Minute), nil)
	mock.ExpectQuery("SELECT s.id").WillReturnRows(rows)
	mock.ExpectExec("UPDATE user_sessions SET last_seen_at").WillReturnResult(sqlmock.NewResult(0, 1))

	ctx := context.Background()
	if _, err := LookupSessionWithCache(ctx, db, cache, cfg, "raw-token-1", now); err != nil {
		t.Fatal(err)
	}
	mock.ExpectExec("UPDATE user_sessions SET revoked_at").WillReturnResult(sqlmock.NewResult(0, 1))
	if err := RevokeSessionWithCache(ctx, db, cache, "raw-token-1", now); err != nil {
		t.Fatal(err)
	}
	// Next lookup: cache entry gone. DB now reports revoked -> (nil, nil).
	revoked := sql.NullTime{}
	_ = revoked
	rows2 := sqlmock.NewRows([]string{"id", "user_id", "role_snapshot", "csrf_token", "organization_id", "expires_at", "idle_timeout_at", "revoked_at"}).
		AddRow("s1", "u1", "student", "csrf-1", nil, now.Add(time.Hour), now.Add(30*time.Minute), now)
	mock.ExpectQuery("SELECT s.id").WillReturnRows(rows2)
	got, err := LookupSessionWithCache(ctx, db, cache, cfg, "raw-token-1", now)
	if err != nil {
		t.Fatalf("revoked lookup must be 401-shaped (nil,nil), not error: %v", err)
	}
	if got != nil {
		t.Fatalf("revoked session must not authenticate: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A2 RED: N lookups inside the coalesce window produce at most 1 touch UPDATE.
func TestLookupSessionTouchCoalesced(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	cache := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100, TouchCoalesceSecs: 300})
	cfg := testCfg()

	rows := sqlmock.NewRows([]string{"id", "user_id", "role_snapshot", "csrf_token", "organization_id", "expires_at", "idle_timeout_at", "revoked_at"}).
		AddRow("s1", "u1", "student", "csrf-1", nil, now.Add(time.Hour), now.Add(30*time.Minute), nil)
	mock.ExpectQuery("SELECT s.id").WillReturnRows(rows)
	mock.ExpectExec("UPDATE user_sessions SET last_seen_at").WillReturnResult(sqlmock.NewResult(0, 1))

	ctx := context.Background()
	for i := 0; i < 20; i++ {
		if _, err := LookupSessionWithCache(ctx, db, cache, cfg, "raw-token-1", now.Add(time.Duration(i)*time.Second)); err != nil {
			t.Fatalf("lookup %d: %v", i, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("coalesce violated (want <=1 touch UPDATE for 20 lookups): %v", err)
	}
}

// A2 RED: disabled cache preserves today's exact behavior (SELECT + UPDATE
// per lookup, DB error -> 503-shaped error).
func TestLookupSessionCacheDisabledPassthrough(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	cache := NewSessionCache(SessionCacheConfig{Enabled: false})
	cfg := testCfg()

	for i := 0; i < 3; i++ {
		rows := sqlmock.NewRows([]string{"id", "user_id", "role_snapshot", "csrf_token", "organization_id", "expires_at", "idle_timeout_at", "revoked_at"}).
			AddRow("s1", "u1", "student", "csrf-1", nil, now.Add(time.Hour), now.Add(30*time.Minute), nil)
		mock.ExpectQuery("SELECT s.id").WillReturnRows(rows)
		mock.ExpectExec("UPDATE user_sessions SET last_seen_at").WillReturnResult(sqlmock.NewResult(0, 1))
		if _, err := LookupSessionWithCache(context.Background(), db, cache, cfg, "raw-token-1", now); err != nil {
			t.Fatalf("lookup %d: %v", i, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

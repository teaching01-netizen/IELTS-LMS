package auth

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func testCfg() config.Config {
	cfg := config.Load()
	cfg.SessionIdleStaffMins = 30
	cfg.SessionIdleStudentMins = 60
	cfg.SessionAbsoluteHours = 12
	return cfg
}

var lockedSessionCols = []string{"id", "user_id", "role_snapshot", "csrf_token", "issued_at", "last_seen_at", "expires_at", "idle_timeout_at", "revoked_at", "authentication_source", "practice_schedule_id", "recovery_attempt_id", "remembered", "idle_window_seconds", "credential_authenticated_at"}

// lookupRow describes the locked session row a mocked lookup returns.
type lookupRow struct {
	role, source            string
	lastSeen, expires, idle time.Time
	revoked                 any
	remembered              bool
	idleWindow              any
	credentialAt            any
	userRole, userState     string
}

func liveStudentRow(now time.Time) lookupRow {
	return lookupRow{role: "student", source: "account", lastSeen: now.Add(-time.Minute), expires: now.Add(time.Hour), idle: now.Add(30 * time.Minute), userRole: "student", userState: "active"}
}

// expectLookupUntilClock queues the locator, begin, user lock, session lock
// and database-clock reads of one LookupSession call.
func expectLookupUntilClock(mock sqlmock.Sqlmock, row lookupRow, dbNow time.Time) {
	mock.ExpectQuery("SELECT user_id FROM user_sessions WHERE session_token_hash").
		WillReturnRows(sqlmock.NewRows([]string{"user_id"}).AddRow("u1"))
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT role, state, organization_id FROM users WHERE id = \\? FOR SHARE").
		WillReturnRows(sqlmock.NewRows([]string{"role", "state", "organization_id"}).AddRow(row.userRole, row.userState, nil))
	mock.ExpectQuery("FROM user_sessions WHERE session_token_hash = \\? FOR UPDATE").
		WillReturnRows(sqlmock.NewRows(lockedSessionCols).AddRow("s1", "u1", row.role, "csrf-1", row.lastSeen.Add(-time.Hour), row.lastSeen, row.expires, row.idle, row.revoked, row.source, nil, nil, row.remembered, row.idleWindow, row.credentialAt))
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(dbNow))
}

func TestLookupSessionTouchesWithDatabaseTimeAndCommits(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	expectLookupUntilClock(mock, liveStudentRow(now), now)
	mock.ExpectExec("UPDATE user_sessions SET last_seen_at = \\?, idle_timeout_at = \\? WHERE id = \\?").
		WithArgs(now, now.Add(60*time.Minute), "s1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	got, err := LookupSession(context.Background(), db, testCfg(), "raw-token")
	if err != nil || got == nil {
		t.Fatalf("live session must authenticate: %+v %v", got, err)
	}
	if !got.ValidatedAt.Equal(now) || !got.IdleTimeoutAt.Equal(now.Add(60*time.Minute)) {
		t.Fatalf("admission must use DB time: validated=%s idle=%s", got.ValidatedAt, got.IdleTimeoutAt)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The clock is read after the row lock: a request that queued past a
// deadline (equality included) or behind a revocation must not touch.
func TestLookupSessionRejectsDeadRowsWithoutTouch(t *testing.T) {
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	cases := map[string]func(*lookupRow){
		"absolute expiry":     func(r *lookupRow) { r.expires = now.Add(-time.Second) },
		"absolute equality":   func(r *lookupRow) { r.expires = now },
		"idle expiry":         func(r *lookupRow) { r.idle = now.Add(-time.Second) },
		"idle equality":       func(r *lookupRow) { r.idle = now },
		"revoked":             func(r *lookupRow) { r.revoked = now.Add(-time.Minute) },
		"account disabled":    func(r *lookupRow) { r.userState = "disabled" },
		"role changed":        func(r *lookupRow) { r.userRole = "builder" },
		"remembered student":  func(r *lookupRow) { r.remembered, r.idleWindow, r.credentialAt = true, int64(3600), now.Add(-time.Hour) },
		"remembered no idle":  func(r *lookupRow) { r.role, r.userRole, r.remembered, r.credentialAt = "builder", "builder", true, now.Add(-time.Hour) },
		"remembered no proof": func(r *lookupRow) { r.role, r.userRole, r.remembered, r.idleWindow = "builder", "builder", true, int64(3600) },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			row := liveStudentRow(now)
			mutate(&row)
			expectLookupUntilClock(mock, row, now)
			mock.ExpectRollback()
			got, err := LookupSession(context.Background(), db, testCfg(), "raw-token")
			if err != nil {
				t.Fatalf("dead session must be 401-shaped (nil,nil), got error %v", err)
			}
			if got != nil {
				t.Fatalf("dead session must not authenticate: %+v", got)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// INV-2: idle only moves forward and never past the absolute deadline; a
// concurrent touch that already advanced idle further is not shortened.
func TestLookupSessionIdleIsMonotonicAndCapped(t *testing.T) {
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		name     string
		row      func() lookupRow
		wantIdle time.Time
		wantSeen time.Time
	}{
		{"remembered snapshot window", func() lookupRow {
			r := liveStudentRow(now)
			r.role, r.userRole, r.remembered = "builder", "builder", true
			r.idleWindow, r.credentialAt = int64(7*24*3600), now.Add(-48*time.Hour)
			r.expires = now.Add(20 * 24 * time.Hour)
			return r
		}, now.Add(7 * 24 * time.Hour), now},
		{"capped at absolute", func() lookupRow {
			r := liveStudentRow(now)
			r.expires = now.Add(10 * time.Minute)
			r.idle = now.Add(5 * time.Minute)
			return r
		}, now.Add(10 * time.Minute), now},
		{"newer idle kept", func() lookupRow {
			r := liveStudentRow(now)
			r.idle = now.Add(90 * time.Minute)
			r.expires = now.Add(3 * time.Hour)
			return r
		}, now.Add(90 * time.Minute), now},
		{"newer last seen kept", func() lookupRow {
			r := liveStudentRow(now)
			r.lastSeen = now.Add(2 * time.Second)
			return r
		}, now.Add(60 * time.Minute), now.Add(2 * time.Second)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			expectLookupUntilClock(mock, tc.row(), now)
			mock.ExpectExec("UPDATE user_sessions SET last_seen_at").
				WithArgs(tc.wantSeen, tc.wantIdle, "s1").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectCommit()
			got, err := LookupSession(context.Background(), db, testCfg(), "raw-token")
			if err != nil || got == nil {
				t.Fatalf("lookup: %+v %v", got, err)
			}
			if !got.IdleTimeoutAt.Equal(tc.wantIdle) {
				t.Fatalf("idle = %s, want %s", got.IdleTimeoutAt, tc.wantIdle)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// A physically unchanged row needs no UPDATE; it is still a valid session.
func TestLookupSessionSkipsNoOpTouch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	row := liveStudentRow(now)
	row.lastSeen, row.idle = now, now.Add(60*time.Minute)
	expectLookupUntilClock(mock, row, now)
	mock.ExpectCommit()
	got, err := LookupSession(context.Background(), db, testCfg(), "raw-token")
	if err != nil || got == nil {
		t.Fatalf("unchanged session must stay valid: %+v %v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Operational failures are errors (503), never absence (401).
func TestLookupSessionStoreFailuresAreErrors(t *testing.T) {
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	boom := errors.New("connection reset")
	t.Run("locator", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		mock.ExpectQuery("SELECT user_id FROM user_sessions").WillReturnError(boom)
		if got, err := LookupSession(context.Background(), db, testCfg(), "t"); err == nil || got != nil {
			t.Fatalf("want error, got %+v %v", got, err)
		}
	})
	t.Run("commit", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		expectLookupUntilClock(mock, liveStudentRow(now), now)
		mock.ExpectExec("UPDATE user_sessions SET last_seen_at").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectCommit().WillReturnError(boom)
		if got, err := LookupSession(context.Background(), db, testCfg(), "t"); err == nil || got != nil {
			t.Fatalf("an unacknowledged touch must not publish a session: %+v %v", got, err)
		}
	})
	t.Run("unknown token", func(t *testing.T) {
		db, mock, _ := sqlmock.New()
		defer db.Close()
		mock.ExpectQuery("SELECT user_id FROM user_sessions").WillReturnError(sql.ErrNoRows)
		if got, err := LookupSession(context.Background(), db, testCfg(), "t"); err != nil || got != nil {
			t.Fatalf("unknown token is absence: %+v %v", got, err)
		}
	})
}

// Disabled cache is exactly LookupSession on every call.
func TestLookupSessionCacheDisabledPassthrough(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	cache := NewSessionCache(SessionCacheConfig{Enabled: false})
	for i := 0; i < 3; i++ {
		expectLookupUntilClock(mock, liveStudentRow(now), now)
		mock.ExpectExec("UPDATE user_sessions SET last_seen_at").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectCommit()
		if _, err := LookupSessionWithCache(context.Background(), db, cache, testCfg(), "raw-token-1", now); err != nil {
			t.Fatalf("lookup %d: %v", i, err)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Enabled cache (benchmark-only; the API refuses it): a hit serves without
// the locked lookup and revocation drops the entry on this process.
func TestLookupSessionCacheHitAndRevoke(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Truncate(time.Second)
	cache := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100, TouchCoalesceSecs: 300})
	expectLookupUntilClock(mock, liveStudentRow(now), now)
	mock.ExpectExec("UPDATE user_sessions SET last_seen_at").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	ctx := context.Background()
	if s, err := LookupSessionWithCache(ctx, db, cache, testCfg(), "raw-token-1", now); err != nil || s == nil {
		t.Fatalf("first lookup: %+v %v", s, err)
	}
	if s, err := LookupSessionWithCache(ctx, db, cache, testCfg(), "raw-token-1", now.Add(time.Second)); err != nil || s == nil || s.ID != "s1" {
		t.Fatalf("cached lookup: %+v %v", s, err)
	}
	mock.ExpectExec("UPDATE user_sessions SET revoked_at").WillReturnResult(sqlmock.NewResult(0, 1))
	if err := RevokeSessionWithCache(ctx, db, cache, "raw-token-1", now); err != nil {
		t.Fatal(err)
	}
	row := liveStudentRow(now)
	row.revoked = now
	expectLookupUntilClock(mock, row, now)
	mock.ExpectRollback()
	if got, err := LookupSessionWithCache(ctx, db, cache, testCfg(), "raw-token-1", now); err != nil || got != nil {
		t.Fatalf("revoked session must not authenticate: %+v %v", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

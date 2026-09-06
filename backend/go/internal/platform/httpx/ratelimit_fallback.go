// Package httpx distributed rate-limit fallback (round 75): the middleware
// contract already accepts a dbLimited func; this file implements it against
// distributed_rate_limit_counters so multi-instance deploys share one
// ceiling. Local buckets stay the fast path; the DB verdict only ADDS
// denials (a DB error keeps the local verdict, never opens the gate).
package httpx

import (
	"context"
	"database/sql"
	"time"
)

// DBRateLimiter enforces per-key fixed windows in MySQL/TiDB. One row per
// (route_key, bucket_key, window_start); expired windows are pruned lazily
// by the retention job (maintenance RunRetention), not per-request.
type DBRateLimiter struct {
	db          *sql.DB
	routeKey    string
	maxRequests int
	window      time.Duration
}

// NewDBRateLimiter wires the pool explicitly; maxRequests<=0 means 1.
func NewDBRateLimiter(db *sql.DB, routeKey string, maxRequests int, window time.Duration) *DBRateLimiter {
	if maxRequests <= 0 {
		maxRequests = 1
	}
	if window <= 0 {
		window = time.Minute
	}
	return &DBRateLimiter{db: db, routeKey: routeKey, maxRequests: maxRequests, window: window}
}

// Check atomically increments the current window and reports the verdict.
// The increment and the count read are one statement (LAST_INSERT_ID
// carries request_count back on this connection), so concurrent checkers
// can never interleave INSERT-then-SELECT and under-count each other.
// A DB error returns (true, 0, err) so the caller keeps the local verdict.
func (l *DBRateLimiter) Check(ctx context.Context, key string) (bool, time.Duration, error) {
	now := time.Now().UTC()
	winStart := now.Truncate(l.window).Format("2006-01-02 15:04:05")
	expires := now.Add(l.window).Format("2006-01-02 15:04:05")
	// Pin one pooled connection: LAST_INSERT_ID() is connection-scoped, so
	// the upsert + read below are atomic per checker (pool handoffs between
	// separate Exec/Query calls would break that). MySQL has no RETURNING.
	conn, err := l.db.Conn(ctx)
	if err != nil {
		return true, 0, err
	}
	defer func() { _ = conn.Close() }()
	if _, err := conn.ExecContext(ctx, "INSERT INTO distributed_rate_limit_counters (route_key, bucket_key, window_start, request_count, expires_at) VALUES (?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE request_count = LAST_INSERT_ID(request_count + 1), expires_at = VALUES(expires_at)", l.routeKey, key, winStart, expires); err != nil {
		return true, 0, err
	}
	var count int
	if err := conn.QueryRowContext(ctx, "SELECT LAST_INSERT_ID()").Scan(&count); err != nil {
		return true, 0, err
	}
	if count == 0 {
		// Fresh insert: LAST_INSERT_ID() is only set by the UPDATE arm,
		// so 0 means this checker created the row (count is 1).
		count = 1
	}
	if count > l.maxRequests {
		retry := now.Truncate(l.window).Add(l.window).Sub(now)
		if retry < time.Second {
			retry = time.Second
		}
		return false, retry, nil
	}
	return true, 0, nil
}

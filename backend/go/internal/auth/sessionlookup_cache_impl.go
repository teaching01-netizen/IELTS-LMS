// LookupSessionWithCache is the plan-A2 session read path.
//
// Semantics (must match LookupSession exactly):
//   - (nil, nil) for unknown / revoked / expired sessions (401-shaped).
//   - non-nil error only on DB failure (503-shaped, fail closed).
//
// Disabled or nil cache -> exactly LookupSession, the single authoritative
// admission owner. The serving API refuses SESSION_CACHE=on
// (config.ValidateForAPI): a process-local cache cannot observe a revocation
// committed on another instance, so remembered sessions must never be served
// from it. The cache path is kept for isolated single-process benchmarks.
//
// Cache behavior when enabled:
//   - Hit + unexpired -> return copy; the coalesced touch (at most one per
//     window) is a monotonic conditional UPDATE that can never revive a
//     revoked row or move a deadline backwards.
//   - Miss -> LookupSession (locked admission + touch), then Put. Revoked or
//     expired rows are never cached.
package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
)

// LookupSessionWithCache loads a live session, serving from cache when hot.
func LookupSessionWithCache(ctx context.Context, db *sql.DB, cache *SessionCache, cfg config.Config, sessionToken string, now time.Time) (*Session, error) {
	if cache == nil || !cache.Enabled() {
		return LookupSession(ctx, db, cfg, sessionToken)
	}
	now = now.UTC()
	tokenHash := SHA256Hex(sessionToken)
	if s, ok := cache.Get(tokenHash, now); ok {
		if cache.TouchDue(tokenHash, now) {
			newIdle := now.Add(s.effectiveIdleWindow(cfg))
			if newIdle.After(s.ExpiresAt) {
				newIdle = s.ExpiresAt
			}
			if _, err := db.ExecContext(ctx,
				`UPDATE user_sessions SET last_seen_at = GREATEST(last_seen_at, ?), idle_timeout_at = LEAST(expires_at, GREATEST(idle_timeout_at, ?)) WHERE id = ? AND revoked_at IS NULL AND expires_at > ? AND idle_timeout_at > ?`,
				now, newIdle, s.ID, now, now); err != nil {
				return nil, fmt.Errorf("auth: touch session: %w", err)
			}
			cache.MarkFlushed(tokenHash, now)
			if newIdle.After(s.IdleTimeoutAt) {
				s.IdleTimeoutAt = newIdle
			}
		}
		s.ValidatedAt = now
		out := s
		return &out, nil
	}
	s, err := LookupSession(ctx, db, cfg, sessionToken)
	if err != nil || s == nil {
		return s, err
	}
	cache.Put(tokenHash, *s, now)
	return s, nil
}

// RevokeSessionWithCache revokes one session and drops its cache entry
// synchronously (stale-session acceptance stays 0 on this process).
func RevokeSessionWithCache(ctx context.Context, db Execer, cache *SessionCache, sessionToken string, now time.Time) error {
	now = now.UTC()
	if err := RevokeSession(ctx, db, sessionToken, now); err != nil {
		return err
	}
	if cache != nil {
		cache.Invalidate(SHA256Hex(sessionToken))
	}
	return nil
}

// RevokeAllSessionsWithCache revokes every live session for a user and
// drops all of their cache entries synchronously.
func RevokeAllSessionsWithCache(ctx context.Context, db *sql.DB, cache *SessionCache, userID, reason string, now time.Time) error {
	now = now.UTC()
	if err := RevokeAllSessions(ctx, db, userID, reason, now); err != nil {
		return err
	}
	if cache != nil {
		cache.InvalidateUser(userID)
	}
	return nil
}

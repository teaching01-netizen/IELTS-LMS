// LookupSessionWithCache is the plan-A2 session read path.
//
// Semantics (must match LookupSession exactly):
//   - (nil, nil) for unknown / revoked / expired sessions (401-shaped).
//   - non-nil error only on DB failure (503-shaped, fail closed).
//   - idle extension equals idleTimeoutFor(role, cfg) from lookup time.
//
// Cache behavior:
//   - Hit + unexpired -> return copy, zero SQL (touch coalesced: the DB
//     UPDATE fires only when TouchDue, i.e. at most once per window).
//   - Miss -> today's SELECT; on live row, conditional touch UPDATE (only
//     when TouchDue, which a fresh Put suppresses for one window after a
//     touch just happened), then Put. Revoked/expired rows are never
//     cached, so revocation is visible on the very next lookup.
//   - Disabled or nil cache -> byte-identical behavior to LookupSession.
package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
)

// LookupSessionWithCache loads a live session, serving from cache when hot.
func LookupSessionWithCache(ctx context.Context, db Querier, cache *SessionCache, cfg config.Config, sessionToken string, now time.Time) (*Session, error) {
	now = now.UTC()
	tokenHash := SHA256Hex(sessionToken)
	if cache != nil {
		if s, ok := cache.Get(tokenHash, now); ok {
			// Hit: the cached copy already carries extended idle state.
			// Coalesced write-behind is owned by the flusher (Phase A2 ships
			// the read path; the periodic flusher lands with the middleware
			// wiring in the same change). Opportunistic due-touch here keeps
			// single-process idle deadlines advancing even before the flusher
			// interval elapses, bounded to one UPDATE per window.
			if cache.TouchDue(tokenHash, now) {
				newIdle := now.Add(idleTimeoutFor(s.Role, cfg))
				if querier, ok := db.(interface {
					ExecContext(context.Context, string, ...any) (sql.Result, error)
				}); ok {
					if _, err := querier.ExecContext(ctx,
						`UPDATE user_sessions SET last_seen_at = ?, idle_timeout_at = ? WHERE id = ?`,
						now, newIdle, s.ID); err != nil {
						return nil, fmt.Errorf("auth: touch session: %w", err)
					}
					cache.MarkFlushed(tokenHash, now)
					s.IdleTimeoutAt = newIdle
				}
			}
			hit := s
			out := hit
			return &out, nil
		}
	}
	var s Session
	var revokedAt sql.NullTime
	var orgID sql.NullString
	var uaHash sql.NullString
	_ = uaHash
	err := db.QueryRowContext(ctx,
		`SELECT s.id, s.user_id, s.role_snapshot, s.csrf_token, u.organization_id, s.expires_at, s.idle_timeout_at, s.revoked_at
		 FROM user_sessions s JOIN users u ON u.id = s.user_id
		 WHERE s.session_token_hash = ?`, tokenHash).Scan(
		&s.ID, &s.UserID, &s.Role, &s.CSRFToken, &orgID, &s.ExpiresAt, &s.IdleTimeoutAt, &revokedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("auth: lookup session: %w", err)
	}
	if orgID.Valid {
		v := orgID.String
		s.OrganizationID = &v
	}
	if revokedAt.Valid || !s.ExpiresAt.After(now) || !s.IdleTimeoutAt.After(now) {
		return nil, nil
	}
	// Conditional touch: a fresh Put suppresses the UPDATE for one window
	// after a touch just happened (Put marks flushedAt=now). First-ever
	// load has no entry -> TouchDue false -> touch fires (today's behavior).
	if cache != nil {
		if _, present := cache.peek(tokenHash); present {
			if !cache.TouchDue(tokenHash, now) {
				cache.Put(tokenHash, withIdle(s, now.Add(idleTimeoutFor(s.Role, cfg))), now)
				out := s
				out.IdleTimeoutAt = now.Add(idleTimeoutFor(s.Role, cfg))
				return &out, nil
			}
		}
	}
	newIdle := now.Add(idleTimeoutFor(s.Role, cfg))
	if querier, ok := db.(interface {
		ExecContext(context.Context, string, ...any) (sql.Result, error)
	}); ok {
		if _, err := querier.ExecContext(ctx,
			`UPDATE user_sessions SET last_seen_at = ?, idle_timeout_at = ? WHERE id = ?`,
			now, newIdle, s.ID); err != nil {
			return nil, fmt.Errorf("auth: touch session: %w", err)
		}
	} else {
		return nil, fmt.Errorf("auth: touch session: db handle cannot exec")
	}
	s.IdleTimeoutAt = newIdle
	if cache != nil {
		cache.Put(tokenHash, s, now)
	}
	out := s
	return &out, nil
}

func withIdle(s Session, idle time.Time) Session {
	s.IdleTimeoutAt = idle
	return s
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

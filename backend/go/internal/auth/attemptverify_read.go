package auth

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
)

// VerifyAttemptRead verifies an attempt bearer for READ paths in every
// verify posture (strict and stateless alike): HMAC + expiry, then a single
// indexed session-table touch
//
//	SELECT token_id, revoked_at, lease_epoch
//	FROM attempt_sessions WHERE token_id = ? AND revoked_at IS NULL
//
// A revoked, rotated (takeover-superseded), unknown, or expired row fails
// closed (error; callers render 401). This closes the stateless read-replay
// window: VerifyAttemptTokenRouted in stateless mode verifies HMAC + expiry
// only (zero SQL, by design for the write fast-path whose in-tx lease fence
// still applies), so reads — which have no in-tx fence — must take this
// explicit session touch instead of relying on the routed verifier.
//
// The lease_epoch column is informational (a later migration adds it);
// schemas predating it fall back to the token_id/revoked_at probe so reads
// never break pre-migration. Only a missing-column (1054) error takes the
// fallback; any other DB error surfaces immediately. expires_at is enforced
// DB-side as defense in depth behind the crypto Exp check.
func VerifyAttemptRead(ctx context.Context, db Querier, cfg config.Config, now time.Time, token string) (crypto.AttemptClaims, error) {
	var zero crypto.AttemptClaims
	claims, err := crypto.VerifyAttemptToken([]byte(cfg.AuthSecret), now, token)
	if err != nil {
		return zero, fmt.Errorf("auth: verify attempt token: %w", err)
	}
	if db == nil {
		return zero, fmt.Errorf("auth: attempt read requires a session binding")
	}
	if claims.TokenID == "" {
		return zero, fmt.Errorf("auth: unknown attempt session")
	}
	now = now.UTC()
	var tokenID string
	var revokedAt sql.NullTime
	var expiresAt time.Time
	var rowLease sql.NullInt64
	err = db.QueryRowContext(ctx,
		`SELECT token_id, revoked_at, expires_at, lease_epoch FROM attempt_sessions WHERE token_id = ? AND revoked_at IS NULL`,
		claims.TokenID).Scan(&tokenID, &revokedAt, &expiresAt, &rowLease)
	if err != nil && !isMissingColumn(err) {
		if err == sql.ErrNoRows {
			return zero, fmt.Errorf("auth: unknown attempt session")
		}
		return zero, fmt.Errorf("auth: load attempt session: %w", err)
	}
	if err != nil {
		// Pre-migration schema: lease_epoch is absent; the
		// token_id/revoked_at probe is authoritative.
		err = db.QueryRowContext(ctx,
			`SELECT token_id, revoked_at, expires_at FROM attempt_sessions WHERE token_id = ? AND revoked_at IS NULL`,
			claims.TokenID).Scan(&tokenID, &revokedAt, &expiresAt)
		if err == sql.ErrNoRows {
			return zero, fmt.Errorf("auth: unknown attempt session")
		}
		if err != nil {
			return zero, fmt.Errorf("auth: load attempt session: %w", err)
		}
		rowLease.Valid = false
	}
	if revokedAt.Valid || tokenID == "" || tokenID != claims.TokenID || !expiresAt.After(now) {
		return zero, fmt.Errorf("auth: attempt session mismatch or revoked")
	}
	if rowLease.Valid && (claims.LeaseEpoch == nil || int64(*claims.LeaseEpoch) != rowLease.Int64) {
		return zero, fmt.Errorf("auth: attempt session lease mismatch")
	}
	return claims, nil
}

package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// BindExamGrantAccountSession links the browser cookie just issued at entry.
// Account expiry never affects the grant; an explicit logout can revoke it.
// The account row is locked first so this cannot interleave with logout-all
// or a security reset (users -> attempt_sessions, see LockExamPrincipalTx).
func BindExamGrantAccountSession(ctx context.Context, db *sql.DB, cfg config.Config, bearer, accountID string, now time.Time) error {
	claims, err := crypto.VerifyAttemptToken([]byte(cfg.AuthSecret), now, bearer)
	if err != nil {
		return err
	}
	if claims.CredentialPolicy != ExamCredentialSitting {
		return nil
	}
	return tx.NewRunner(db).WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		if err := LockExamPrincipalTx(ctx, q, claims.UserID); err != nil {
			return err
		}
		result, err := q.ExecContext(ctx, `UPDATE attempt_sessions SET account_session_id = ? WHERE token_id = ? AND user_id = ? AND revoked_at IS NULL AND `+ActiveAttemptPrincipalSQL+` AND EXISTS (SELECT 1 FROM user_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > ? AND idle_timeout_at > ?)`, accountID, claims.TokenID, claims.UserID, accountID, claims.UserID, now.UTC(), now.UTC())
		if err != nil {
			return fmt.Errorf("auth: bind exam browser: %w", err)
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected != 1 {
			return ExamAccessRevokedError()
		}
		return nil
	})
}

// RevokeBrowserSessionWithCache atomically revokes this cookie and the grants
// it established. It does not affect another device's account session/grants.
// Lock order is account session -> exam grant, matching logout-all's suffix;
// exam writes never lock account sessions, so this cannot invert their locks.
func RevokeBrowserSessionWithCache(ctx context.Context, db *sql.DB, cache *SessionCache, rawToken string, now time.Time) error {
	err := tx.NewRunner(db).WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		var id string
		err := q.QueryRowContext(ctx, `SELECT id FROM user_sessions WHERE session_token_hash = ? FOR UPDATE`, SHA256Hex(rawToken)).Scan(&id)
		if errors.Is(err, sql.ErrNoRows) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("auth: find browser session: %w", err)
		}
		if _, err = q.ExecContext(ctx, `UPDATE attempt_sessions SET revoked_at = ?, revocation_reason = 'logout' WHERE account_session_id = ? AND revoked_at IS NULL`, now.UTC(), id); err != nil {
			return fmt.Errorf("auth: revoke browser exam grants: %w", err)
		}
		return RevokeSession(ctx, q, rawToken, now)
	})
	if err == nil && cache != nil {
		cache.Invalidate(SHA256Hex(rawToken))
	}
	return err
}

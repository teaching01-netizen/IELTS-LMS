package auth

// Password-session workflows. Each function owns its transaction; HTTP
// handlers never compose partial commits around them.
//
// Lock order (every runtime credential writer and issuer follows it):
//
//	users -> user_password_credentials -> reset/activation token ->
//	user_sessions (stable id order) -> user_session_events
//
// Issuance holds the user row FOR SHARE; reset, activation, reauth, login
// and revoke-all hold it FOR UPDATE. Password hashing and verification run
// outside any lock; the locked transaction then re-reads the exact stored
// hash, so a password changed after verification can never authorize a new
// session with the old proof.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// Failed-login lockout policy (unchanged from the pre-persistence handler).
const (
	maxFailedLogins = 5
	loginLockout    = 15 * time.Minute
)

func invalidCredentials() *apperrors.Error {
	return apperrors.New(apperrors.CodeUnauthorized, "Invalid credentials.")
}

func accountLocked() *apperrors.Error {
	return apperrors.New(apperrors.CodeUnauthorized, "Account locked.")
}

// lockedUser is a users row read under FOR UPDATE.
type lockedUser struct {
	SessionUser
	lockedUntil sql.NullTime
	failed      int
}

func lockUserForUpdate(ctx context.Context, q tx.Tx, userID string) (lockedUser, error) {
	var u lockedUser
	u.ID = userID
	err := q.QueryRowContext(ctx,
		`SELECT role, state, email, COALESCE(display_name, ''), locked_until, failed_login_count FROM users WHERE id = ? FOR UPDATE`, userID).
		Scan(&u.Role, &u.State, &u.Email, &u.DisplayName, &u.lockedUntil, &u.failed)
	return u, err
}

// loginEligible decides whether a locked user may authenticate at now.
// Only the timed failed-login lock clears automatically once its valid
// deadline has passed; disabled, pending-activation and indefinitely locked
// accounts are never reactivated by a correct password.
func loginEligible(u lockedUser, now time.Time) *apperrors.Error {
	switch u.State {
	case "active":
		if u.lockedUntil.Valid && u.lockedUntil.Time.After(now) {
			return accountLocked()
		}
		return nil
	case "locked":
		if !u.lockedUntil.Valid {
			return invalidCredentials()
		}
		if u.lockedUntil.Time.After(now) {
			return accountLocked()
		}
		return nil
	default:
		return invalidCredentials()
	}
}

// recordFailedPassword counts one wrong password and applies the timed
// lockout at the threshold. An expired timed lock restarts the count.
func recordFailedPassword(ctx context.Context, q tx.Tx, u lockedUser, now time.Time) error {
	failed := u.failed
	if u.State == "locked" {
		failed = 0
	}
	failed++
	state, lockedUntil := "active", any(nil)
	if failed >= maxFailedLogins {
		state, lockedUntil = "locked", now.Add(loginLockout)
	}
	if _, err := q.ExecContext(ctx,
		`UPDATE users SET failed_login_count = ?, state = ?, locked_until = ?, updated_at = ? WHERE id = ?`,
		failed, state, lockedUntil, now, u.ID); err != nil {
		return fmt.Errorf("auth: record failed password: %w", err)
	}
	return nil
}

// lockCredentialHash re-reads the stored hash under lock ("" when absent).
func lockCredentialHash(ctx context.Context, q tx.Tx, userID string) (string, error) {
	var hash string
	err := q.QueryRowContext(ctx, `SELECT password_hash FROM user_password_credentials WHERE user_id = ? FOR UPDATE`, userID).Scan(&hash)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return hash, err
}

func beginAuthTx(ctx context.Context, db *sql.DB) (*sql.Tx, error) {
	sqlTx, err := tx.Begin(ctx, db, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("auth: begin: %w", err)
	}
	return sqlTx, nil
}

func commitAuthTx(sqlTx *sql.Tx) error {
	if err := sqlTx.Commit(); err != nil {
		// The outcome of a failed commit is unknown to the caller: report a
		// retryable service error, never success and never a false 401.
		return fmt.Errorf("auth: commit: %w", err)
	}
	return nil
}

// LoginWithPassword verifies email/password and opens an account session.
// remember requests the remembered staff policy; the server decides from the
// locked role and configuration whether it applies.
func LoginWithPassword(ctx context.Context, db *sql.DB, cfg config.Config, email, password string, remember bool, userAgentHash *string) (CreatedSession, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var userID, state string
	var lockedUntil sql.NullTime
	var snapshot sql.NullString
	err := db.QueryRowContext(ctx,
		`SELECT u.id, u.state, u.locked_until, c.password_hash FROM users u LEFT JOIN user_password_credentials c ON c.user_id = u.id WHERE LOWER(u.email) = ?`,
		email).Scan(&userID, &state, &lockedUntil, &snapshot)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatedSession{}, invalidCredentials()
	}
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: login lookup: %w", err)
	}
	// Cheap pre-check so an ineligible account does not cost an Argon2 run.
	// The authoritative decision is repeated under lock below.
	if perr := loginEligible(lockedUser{SessionUser: SessionUser{State: state}, lockedUntil: lockedUntil}, time.Now().UTC()); perr != nil {
		return CreatedSession{}, perr
	}
	if !snapshot.Valid || snapshot.String == "" {
		return CreatedSession{}, invalidCredentials()
	}
	matched := VerifyPassword(password, snapshot.String)

	sqlTx, err := beginAuthTx(ctx, db)
	if err != nil {
		return CreatedSession{}, err
	}
	defer func() { _ = sqlTx.Rollback() }()
	u, err := lockUserForUpdate(ctx, sqlTx, userID)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatedSession{}, invalidCredentials()
	}
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: login lock user: %w", err)
	}
	current, err := lockCredentialHash(ctx, sqlTx, userID)
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: login lock credential: %w", err)
	}
	if current != snapshot.String {
		// The password changed after our verification: the proof is stale.
		return CreatedSession{}, invalidCredentials()
	}
	now, err := dbNow(ctx, sqlTx)
	if err != nil {
		return CreatedSession{}, err
	}
	if perr := loginEligible(u, now); perr != nil {
		return CreatedSession{}, perr
	}
	if !matched {
		if err := recordFailedPassword(ctx, sqlTx, u, now); err != nil {
			return CreatedSession{}, err
		}
		if err := commitAuthTx(sqlTx); err != nil {
			return CreatedSession{}, err
		}
		return CreatedSession{}, invalidCredentials()
	}
	if _, err := sqlTx.ExecContext(ctx,
		`UPDATE users SET failed_login_count = 0, state = 'active', locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?`,
		now, now, userID); err != nil {
		return CreatedSession{}, fmt.Errorf("auth: login record success: %w", err)
	}
	policy, err := policyForPassword(cfg, u.Role, remember)
	if err != nil {
		return CreatedSession{}, err
	}
	var credentialAt *time.Time
	if u.Role != RoleStudent {
		credentialAt = &now
	}
	created, err := insertSessionInTx(ctx, sqlTx, userID, u.Role, SessionProof{Source: SessionSourceAccount}, policy, credentialAt, userAgentHash, nil, now)
	if err != nil {
		return CreatedSession{}, err
	}
	if err := commitAuthTx(sqlTx); err != nil {
		return CreatedSession{}, err
	}
	created.User.State = "active"
	return created, nil
}

// ErrReauthSessionGone reports that the session being confirmed is no longer
// live (revoked, expired or replaced by a concurrent confirmation).
func reauthSessionGone() *apperrors.Error {
	return apperrors.New(apperrors.CodeSessionExpired, "Session expired.")
}

// Reauthenticate confirms the current session owner's password and replaces
// the session: the old row is revoked and a new one (same remembered choice,
// fresh password time, new absolute lifetime) is created in one commit.
// Identity comes only from current; a wrong password leaves the session
// intact unless it reaches the real lockout threshold.
func Reauthenticate(ctx context.Context, db *sql.DB, cfg config.Config, current *Session, password string, userAgentHash *string) (CreatedSession, error) {
	if current == nil || current.UserID == "" {
		return CreatedSession{}, reauthSessionGone()
	}
	if current.Role == RoleStudent || current.Proof.Source != SessionSourceAccount || current.Proof.PracticeScheduleID != "" || current.Proof.RecoveryAttemptID != "" {
		return CreatedSession{}, apperrors.New(apperrors.CodeForbidden, "The authenticated user is not allowed to access this route.")
	}
	var snapshot string
	err := db.QueryRowContext(ctx, `SELECT password_hash FROM user_password_credentials WHERE user_id = ?`, current.UserID).Scan(&snapshot)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatedSession{}, invalidCredentials()
	}
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: reauth lookup: %w", err)
	}
	matched := VerifyPassword(password, snapshot)

	sqlTx, err := beginAuthTx(ctx, db)
	if err != nil {
		return CreatedSession{}, err
	}
	defer func() { _ = sqlTx.Rollback() }()
	u, err := lockUserForUpdate(ctx, sqlTx, current.UserID)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatedSession{}, reauthSessionGone()
	}
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: reauth lock user: %w", err)
	}
	hash, err := lockCredentialHash(ctx, sqlTx, current.UserID)
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: reauth lock credential: %w", err)
	}
	if hash != snapshot {
		return CreatedSession{}, invalidCredentials()
	}
	old, err := scanLockedSession(sqlTx.QueryRowContext(ctx, `SELECT `+sessionColumns+` FROM user_sessions WHERE id = ? FOR UPDATE`, current.ID))
	if errors.Is(err, sql.ErrNoRows) {
		return CreatedSession{}, reauthSessionGone()
	}
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: reauth lock session: %w", err)
	}
	now, err := dbNow(ctx, sqlTx)
	if err != nil {
		return CreatedSession{}, err
	}
	if u.State != "active" || u.Role != current.Role {
		return CreatedSession{}, reauthSessionGone()
	}
	if old.UserID != current.UserID || old.Role != current.Role || old.Proof.Source != SessionSourceAccount || !old.liveAt(now) {
		return CreatedSession{}, reauthSessionGone()
	}
	if !matched {
		if err := recordFailedPassword(ctx, sqlTx, u, now); err != nil {
			return CreatedSession{}, err
		}
		if err := commitAuthTx(sqlTx); err != nil {
			return CreatedSession{}, err
		}
		return CreatedSession{}, invalidCredentials()
	}
	if _, err := sqlTx.ExecContext(ctx,
		`UPDATE user_sessions SET revoked_at = ?, revocation_reason = 'reauthenticated' WHERE id = ? AND revoked_at IS NULL`, now, old.ID); err != nil {
		return CreatedSession{}, fmt.Errorf("auth: reauth revoke: %w", err)
	}
	if _, err := sqlTx.ExecContext(ctx,
		`INSERT INTO user_session_events (id, session_id, user_id, event_type, created_at) VALUES (?, ?, ?, 'reauthenticated', ?)`,
		uuid.NewString(), old.ID, old.UserID, now); err != nil {
		return CreatedSession{}, fmt.Errorf("auth: reauth audit: %w", err)
	}
	if u.failed != 0 {
		if _, err := sqlTx.ExecContext(ctx, `UPDATE users SET failed_login_count = 0, updated_at = ? WHERE id = ?`, now, u.ID); err != nil {
			return CreatedSession{}, fmt.Errorf("auth: reauth reset failures: %w", err)
		}
	}
	policy, err := policyForPassword(cfg, u.Role, old.Remembered)
	if err != nil {
		return CreatedSession{}, err
	}
	created, err := insertSessionInTx(ctx, sqlTx, u.ID, u.Role, SessionProof{Source: SessionSourceAccount}, policy, &now, userAgentHash, nil, now)
	if err != nil {
		return CreatedSession{}, err
	}
	if err := commitAuthTx(sqlTx); err != nil {
		return CreatedSession{}, err
	}
	return created, nil
}

// tokenPasswordFlow describes one single-use token that sets a password.
type tokenPasswordFlow struct {
	table         string // password_reset_tokens | account_activation_tokens
	invalid       string // generic invalid-token message
	revokeReason  string
	allowedStates map[string]bool
}

var (
	resetFlow = tokenPasswordFlow{
		table:         "password_reset_tokens",
		invalid:       "Reset token is invalid.",
		revokeReason:  "password_reset",
		allowedStates: map[string]bool{"active": true, "locked": true, "pending_activation": true},
	}
	activationFlow = tokenPasswordFlow{
		table:         "account_activation_tokens",
		invalid:       "Activation token is invalid.",
		revokeReason:  "activation",
		allowedStates: map[string]bool{"active": true, "locked": true, "pending_activation": true},
	}
)

// CompletePasswordReset consumes a reset token, sets the password, revokes
// every prior session and opens one short replacement — all in one commit.
func CompletePasswordReset(ctx context.Context, db *sql.DB, cfg config.Config, token, newPassword string, userAgentHash *string) (CreatedSession, error) {
	return completeTokenPassword(ctx, db, cfg, resetFlow, token, newPassword, "", userAgentHash)
}

// CompleteActivation consumes an activation token, sets the password (and an
// optional display name), revokes prior sessions and opens a short session.
// A disabled account is never reactivated by an old token.
func CompleteActivation(ctx context.Context, db *sql.DB, cfg config.Config, token, newPassword, displayName string, userAgentHash *string) (CreatedSession, error) {
	return completeTokenPassword(ctx, db, cfg, activationFlow, token, newPassword, strings.TrimSpace(displayName), userAgentHash)
}

func completeTokenPassword(ctx context.Context, db *sql.DB, cfg config.Config, flow tokenPasswordFlow, token, newPassword, displayName string, userAgentHash *string) (CreatedSession, error) {
	tokenHash := SHA256Hex(token)
	var ownerID string
	err := db.QueryRowContext(ctx, `SELECT user_id FROM `+flow.table+` WHERE token_hash = ?`, tokenHash).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatedSession{}, apperrors.New(apperrors.CodeUnauthorized, flow.invalid)
	}
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: %s lookup: %w", flow.table, err)
	}
	hash, err := HashPassword(newPassword)
	if err != nil {
		return CreatedSession{}, err
	}

	sqlTx, err := beginAuthTx(ctx, db)
	if err != nil {
		return CreatedSession{}, err
	}
	defer func() { _ = sqlTx.Rollback() }()
	u, err := lockUserForUpdate(ctx, sqlTx, ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatedSession{}, apperrors.New(apperrors.CodeUnauthorized, flow.invalid)
	}
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: %s lock user: %w", flow.table, err)
	}
	if _, err := lockCredentialHash(ctx, sqlTx, ownerID); err != nil {
		return CreatedSession{}, fmt.Errorf("auth: %s lock credential: %w", flow.table, err)
	}
	var tokenID, tokenOwner string
	var expiresAt time.Time
	var usedAt sql.NullTime
	err = sqlTx.QueryRowContext(ctx, `SELECT id, user_id, expires_at, used_at FROM `+flow.table+` WHERE token_hash = ? FOR UPDATE`, tokenHash).
		Scan(&tokenID, &tokenOwner, &expiresAt, &usedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return CreatedSession{}, apperrors.New(apperrors.CodeUnauthorized, flow.invalid)
	}
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: %s lock token: %w", flow.table, err)
	}
	now, err := dbNow(ctx, sqlTx)
	if err != nil {
		return CreatedSession{}, err
	}
	if tokenOwner != ownerID || usedAt.Valid || !expiresAt.UTC().After(now) || !flow.allowedStates[u.State] {
		return CreatedSession{}, apperrors.New(apperrors.CodeUnauthorized, flow.invalid)
	}
	if _, err := sqlTx.ExecContext(ctx,
		`INSERT INTO user_password_credentials (user_id, password_hash) VALUES (?, ?) ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash)`,
		ownerID, hash); err != nil {
		return CreatedSession{}, fmt.Errorf("auth: %s set password: %w", flow.table, err)
	}
	res, err := sqlTx.ExecContext(ctx, `UPDATE `+flow.table+` SET used_at = ? WHERE id = ? AND used_at IS NULL`, now, tokenID)
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: %s consume token: %w", flow.table, err)
	}
	if n, err := res.RowsAffected(); err != nil || n != 1 {
		return CreatedSession{}, apperrors.New(apperrors.CodeUnauthorized, flow.invalid)
	}
	if displayName != "" {
		if _, err := sqlTx.ExecContext(ctx, `UPDATE users SET display_name = ? WHERE id = ?`, displayName, ownerID); err != nil {
			return CreatedSession{}, fmt.Errorf("auth: %s display name: %w", flow.table, err)
		}
	}
	if _, err := sqlTx.ExecContext(ctx,
		`UPDATE users SET state = 'active', failed_login_count = 0, locked_until = NULL, updated_at = ? WHERE id = ?`, now, ownerID); err != nil {
		return CreatedSession{}, fmt.Errorf("auth: %s activate: %w", flow.table, err)
	}
	if _, err := revokeUserSessionsInTx(ctx, sqlTx, ownerID, flow.revokeReason, now); err != nil {
		return CreatedSession{}, err
	}
	created, err := insertSessionInTx(ctx, sqlTx, ownerID, u.Role, SessionProof{Source: SessionSourceAccount}, legacyPolicy(cfg, u.Role), nil, userAgentHash, nil, now)
	if err != nil {
		return CreatedSession{}, err
	}
	if err := commitAuthTx(sqlTx); err != nil {
		return CreatedSession{}, err
	}
	return created, nil
}

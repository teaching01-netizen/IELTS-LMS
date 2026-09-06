// Package auth owns cookie-session authentication, CSRF verification,
// password hashing, attempt-token issuance and role helpers.
//
// Identity model mirrors backend/crates/domain/src/auth.rs and
// backend/crates/application/src/auth.rs:
//   - sessions live in user_sessions (+ user_session_events audit rows)
//   - staff sessions idle out after 30m, students after 60m, absolute 12h
//   - attempt bearer tokens are HMAC-SHA256 payload.signature (see platform/crypto)
//     with server rows in attempt_sessions (TTL 15m, touch 60s, refresh at <=5m)
//   - ActorContext is re-checked at the data boundary; there is no DB RLS.
package auth

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// Roles. Wire values match the Rust UserRole snake_case encoding and the
// actor_context ActorRole strings.
const (
	RoleAdmin         = "admin"
	RoleAdminObserver = "admin_observer"
	RoleBuilder       = "builder"
	RoleProctor       = "proctor"
	RoleGrader        = "grader"
	RoleStudent       = "student"
)

// AllRoles lists every known role.
var AllRoles = []string{RoleAdmin, RoleAdminObserver, RoleBuilder, RoleProctor, RoleGrader, RoleStudent}

// ActorContext is the immutable authorization scope carried from
// authentication into services. Tenant identifiers are never read from
// command payloads. Mirrors infrastructure::actor_context::ActorContext.
type ActorContext struct {
	UserID        string
	Role          string
	OrgID         *string
	ScheduleScope []string
	StudentKey    *string
}

// NewActorContext builds a platform-scoped actor (no tenant/schedule scope).
func NewActorContext(userID, role string) ActorContext {
	return ActorContext{UserID: userID, Role: role}
}

// WithOrgID returns a copy scoped to an organization.
func (a ActorContext) WithOrgID(orgID string) ActorContext {
	a.OrgID = &orgID
	return a
}

// WithScheduleScope returns a copy scoped to the given schedules.
func (a ActorContext) WithScheduleScope(scheduleIDs ...string) ActorContext {
	a.ScheduleScope = append([]string(nil), scheduleIDs...)
	return a
}

// WithStudentKey returns a copy scoped to one student key.
func (a ActorContext) WithStudentKey(key string) ActorContext {
	a.StudentKey = &key
	return a
}

// IsPlatformWrite reports whether the actor has platform write scope (admin).
func (a ActorContext) IsPlatformWrite() bool { return a.Role == RoleAdmin }

// IsPlatformRead reports whether the actor has platform read scope
// (admin + read-only admin observer).
func (a ActorContext) IsPlatformRead() bool {
	return a.Role == RoleAdmin || a.Role == RoleAdminObserver
}

// RequireOneOf enforces that the actor carries one of the allowed roles.
// It returns a *apperrors.Error with FORBIDDEN so handlers can render the
// stable envelope directly.
func (a ActorContext) RequireOneOf(roles ...string) *apperrors.Error {
	for _, r := range roles {
		if a.Role == r {
			return nil
		}
	}
	return apperrors.New(apperrors.CodeForbidden, "The authenticated user is not allowed to access this route.")
}

// RequireOneOf is the exported package-level helper: nil when the actor
// carries one of roles, else a FORBIDDEN *apperrors.Error.
func RequireOneOf(actor ActorContext, roles ...string) *apperrors.Error {
	return actor.RequireOneOf(roles...)
}

// ---- password hashing (bcrypt) ----

// HashPassword hashes a password with bcrypt. Cost is bcrypt.DefaultCost to
// match the Argon2id-strength default posture of the Rust backend while using
// the standard Go password-hashing primitive.
func HashPassword(password string) (string, error) {
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return "", fmt.Errorf("auth: hash password: %w", err)
	}
	return string(hash), nil
}

// VerifyPassword reports whether password matches the stored bcrypt hash.
// Unknown hash formats fail closed (false, nil): callers map that to
// invalid credentials, never to an internal error.
func VerifyPassword(password, hash string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// ---- token helpers ----

// SHA256Hex hex-encodes sha256(value); session tokens are stored hashed.
func SHA256Hex(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

// RandomToken returns base64url (no pad) random bytes like the Rust
// infrastructure::auth::random_token helper.
func RandomToken(byteLen int) (string, error) {
	if byteLen <= 0 {
		return "", fmt.Errorf("auth: random token length must be positive")
	}
	b := make([]byte, byteLen)
	if _, err := rand.Read(b); err != nil {
		return "", fmt.Errorf("auth: random token: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

// ---- session SQL ----

// Session is the authenticated session row subset handlers need.
type Session struct {
	ID             string
	UserID         string
	Role           string
	CSRFToken      string
	OrganizationID *string
	ExpiresAt      time.Time
	IdleTimeoutAt  time.Time
}

// idleTimeoutFor returns the idle window: 30m staff, 60m student.
func idleTimeoutFor(role string, cfg config.Config) time.Duration {
	if role == RoleStudent {
		mins := cfg.SessionIdleStudentMins
		if mins <= 0 {
			mins = 60
		}
		return time.Duration(mins) * time.Minute
	}
	mins := cfg.SessionIdleStaffMins
	if mins <= 0 {
		mins = 30
	}
	return time.Duration(mins) * time.Minute
}

// absoluteLifetime returns the absolute session lifetime (default 12h).
func absoluteLifetime(cfg config.Config) time.Duration {
	h := cfg.SessionAbsoluteHours
	if h <= 0 {
		h = 12
	}
	return time.Duration(h) * time.Hour
}

// SessionExpiry returns the deadlines that CreateSession persists. Keeping
// this calculation at the auth boundary lets entry flows return the same
// timestamps the browser session will actually enforce.
func SessionExpiry(cfg config.Config, role string, now time.Time) (expiresAt, idleTimeoutAt time.Time) {
	now = now.UTC()
	return now.Add(absoluteLifetime(cfg)), now.Add(idleTimeoutFor(role, cfg))
}

// CreateSession inserts a user_sessions row + a created audit event and
// returns the session id, the raw bearer session token (only copy) and the
// csrf token. now should be UTC (callers may pass DB time).
func CreateSession(ctx context.Context, db *sql.DB, cfg config.Config, userID, role string, userAgentHash *string, ipMetadata *string, now time.Time) (sessionID, sessionToken, csrfToken string, err error) {
	now = now.UTC()
	sessionID = uuid.NewString()
	sessionToken, err = RandomToken(32)
	if err != nil {
		return "", "", "", fmt.Errorf("auth: create session token: %w", err)
	}
	csrfToken, err = RandomToken(24)
	if err != nil {
		return "", "", "", fmt.Errorf("auth: create csrf token: %w", err)
	}
	expiresAt, idleAt := SessionExpiry(cfg, role, now)
	tokenHash := SHA256Hex(sessionToken)

	tx, err := db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return "", "", "", fmt.Errorf("auth: create session begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var ua any
	if userAgentHash != nil {
		ua = *userAgentHash
	}
	var ipMeta any
	if ipMetadata != nil {
		ipMeta = *ipMetadata
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO user_sessions (id, user_id, session_token_hash, csrf_token, role_snapshot, issued_at, last_seen_at, expires_at, idle_timeout_at, user_agent_hash, ip_metadata) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		sessionID, userID, tokenHash, csrfToken, role, now, now, expiresAt, idleAt, ua, ipMeta); err != nil {
		return "", "", "", fmt.Errorf("auth: insert user_sessions: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO user_session_events (id, session_id, user_id, event_type, created_at) VALUES (?, ?, ?, 'created', ?)`,
		uuid.NewString(), sessionID, userID, now); err != nil {
		return "", "", "", fmt.Errorf("auth: insert user_session_events: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", "", "", fmt.Errorf("auth: create session commit: %w", err)
	}
	return sessionID, sessionToken, csrfToken, nil
}

// LookupSession loads a live session by raw token and touches idle state.
// It returns (nil, nil) when the session is unknown, revoked or expired —
// callers map that to 401 UNAUTHORIZED/SESSION_EXPIRED without leaking why.
func LookupSession(ctx context.Context, db Querier, cfg config.Config, sessionToken string, now time.Time) (*Session, error) {
	now = now.UTC()
	tokenHash := SHA256Hex(sessionToken)
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
	newIdle := now.Add(idleTimeoutFor(s.Role, cfg))
	if _, err := db.ExecContext(ctx,
		`UPDATE user_sessions SET last_seen_at = ?, idle_timeout_at = ? WHERE id = ?`,
		now, newIdle, s.ID); err != nil {
		return nil, fmt.Errorf("auth: touch session: %w", err)
	}
	s.IdleTimeoutAt = newIdle
	return &s, nil
}

// RevokeSession revokes one session by raw token (logout).
func RevokeSession(ctx context.Context, db Execer, sessionToken string, now time.Time) error {
	now = now.UTC()
	if _, err := db.ExecContext(ctx,
		`UPDATE user_sessions SET revoked_at = ?, revocation_reason = 'logout' WHERE session_token_hash = ? AND revoked_at IS NULL`,
		now, SHA256Hex(sessionToken)); err != nil {
		return fmt.Errorf("auth: revoke session: %w", err)
	}
	return nil
}

// RevokeAllSessions revokes every live session for a user (logout-all).
func RevokeAllSessions(ctx context.Context, db *sql.DB, userID, reason string, now time.Time) error {
	now = now.UTC()
	if reason == "" {
		reason = "logout_all"
	}
	tx, err := db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return fmt.Errorf("auth: revoke all begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		`UPDATE user_sessions SET revoked_at = ?, revocation_reason = ? WHERE user_id = ? AND revoked_at IS NULL`,
		now, reason, userID); err != nil {
		return fmt.Errorf("auth: revoke all sessions: %w", err)
	}
	// Audit fan-out: capture the revoked session IDs first, then write one
	// event row per revoked session. The timestamp-range predicate covers
	// rows whose revoked_at was just set above without relying on exact
	// timestamp equality (fractional-second truncation makes `= now`
	// miss). Audit failures are logged, never swallowed silently, and never
	// fail logout-all itself.
	rows, err := tx.QueryContext(ctx,
		`SELECT id FROM user_sessions WHERE user_id = ? AND revoked_at IS NOT NULL AND revoked_at >= ?`,
		userID, now)
	if err != nil {
		fmt.Printf("auth: revoke-all audit list: %v\n", err)
	} else {
		var ids []string
		for rows.Next() {
			var sid string
			if serr := rows.Scan(&sid); serr != nil {
				fmt.Printf("auth: revoke-all audit scan: %v\n", serr)
				break
			}
			ids = append(ids, sid)
		}
		rows.Close()
		if rerr := rows.Err(); rerr != nil {
			fmt.Printf("auth: revoke-all audit rows: %v\n", rerr)
		} else {
			for _, sid := range ids {
				if _, aerr := tx.ExecContext(ctx,
					`INSERT INTO user_session_events (id, session_id, user_id, event_type, created_at) VALUES (?, ?, ?, 'revoked_all', ?)`,
					uuid.NewString(), sid, userID, now); aerr != nil {
					fmt.Printf("auth: revoke-all audit insert session %s: %v\n", sid, aerr)
				}
			}
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("auth: revoke all commit: %w", err)
	}
	return nil
}

// ---- master key (emergency admin login) ----

// IsMasterKeyLogin reports whether the presented credentials match the
// configured emergency master key. It mirrors the Rust
// application::auth::is_master_key_login: matching is gated on
// MasterKeyEnabled, the email is compared case-insensitively against the
// configured username (default "master"), and the password comparison is
// constant-time. A blank configured username or password never matches.
func IsMasterKeyLogin(cfg config.Config, email, password string) bool {
	if !cfg.MasterKeyEnabled {
		return false
	}
	wantUser := strings.ToLower(strings.TrimSpace(cfg.MasterKeyUsername))
	if wantUser == "" || cfg.MasterKeyPassword == "" {
		return false
	}
	// Always run the constant-time password comparison (even on username
	// mismatch) so the timing delta never oracles whether the username
	// exists. Lengths are equalized before compare to avoid a len leak.
	userOK := subtle.ConstantTimeCompare([]byte(strings.ToLower(strings.TrimSpace(email))), []byte(wantUser)) == 1
	wantPW := []byte(cfg.MasterKeyPassword)
	gotPW := []byte(password)
	if len(gotPW) != len(wantPW) {
		pad := make([]byte, len(wantPW))
		copy(pad, gotPW)
		gotPW = pad
	}
	pwOK := subtle.ConstantTimeCompare(gotPW, wantPW) == 1
	return userOK && pwOK
}

// EnsureMasterKeyUser provisions (or repairs) the admin user row for a
// master-key login and returns its id. It mirrors the Rust
// ensure_master_key_user: upsert users (admin/active, reset lockout) +
// upsert staff_profiles, then re-read the canonical id by email so a
// pre-existing row (not the fresh uuid) wins on conflict.
func EnsureMasterKeyUser(ctx context.Context, db *sql.DB, email string, now time.Time) (string, error) {
	now = now.UTC()
	userID := uuid.NewString()
	// Single transaction for the 3 statements (upsert user, re-read
	// canonical id, upsert staff profile) so a crash cannot leave the
	// admin user without its staff profile.
	tx, err := db.BeginTx(ctx, &sql.TxOptions{})
	if err != nil {
		return "", fmt.Errorf("auth: ensure master key begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO users (id, email, display_name, role, state, failed_login_count, locked_until, last_login_at, created_at, updated_at)
		 VALUES (?, ?, ?, 'admin', 'active', 0, NULL, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
			 display_name = COALESCE(users.display_name, VALUES(display_name)),
			 role = 'admin',
			 state = 'active',
			 failed_login_count = 0,
			 locked_until = NULL,
			 last_login_at = VALUES(last_login_at),
			 updated_at = VALUES(updated_at)`,
		userID, email, "Master Key Admin", now, now, now); err != nil {
		return "", fmt.Errorf("auth: ensure master key user: %w", err)
	}
	var actualID string
	if err := tx.QueryRowContext(ctx,
		`SELECT id FROM users WHERE email = ?`, email).Scan(&actualID); err != nil {
		return "", fmt.Errorf("auth: read master key user: %w", err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO staff_profiles (user_id, staff_code, full_name, email, created_at, updated_at)
		 VALUES (?, NULL, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE
			 full_name = VALUES(full_name),
			 email = VALUES(email),
			 updated_at = VALUES(updated_at)`,
		actualID, "Master Key Admin", email, now, now); err != nil {
		return "", fmt.Errorf("auth: ensure master key staff profile: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return "", fmt.Errorf("auth: ensure master key commit: %w", err)
	}
	return actualID, nil
}

// Querier/Execer are the minimal DB surfaces session helpers need so tests
// and services can pass *sql.DB, *sql.Tx or *sql.Conn interchangeably.
type Querier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// Execer is the write-only DB surface.
type Execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// ---- CSRF ----

// CSRFHeader is the request header carrying the CSRF token.
const CSRFHeader = "X-Csrf-Token"

// VerifyCSRF checks cookie + x-csrf-token header == the session csrf token
// plus a same-origin check. It returns a 403 CSRF_REJECTED *apperrors.Error
// on any mismatch so handlers fail closed.
func VerifyCSRF(r *http.Request, sessionCSRFToken string) *apperrors.Error {
	reject := func(msg string) *apperrors.Error {
		err := apperrors.New(apperrors.CodeCSRF, msg)
		err.HTTPStatus = http.StatusForbidden
		// Normalize code string to the spec wire value.
		err.Code = apperrors.Code("CSRF_REJECTED")
		return err
	}
	headerToken := r.Header.Get(CSRFHeader)
	if headerToken == "" {
		headerToken = r.Header.Get("X-CSRF-Token")
		if headerToken == "" {
			// Fall back to a case-insensitive scan (Go canonicalizes, but be
			// explicit for non-standard clients).
			for k, vs := range r.Header {
				if strings.EqualFold(k, "x-csrf-token") && len(vs) > 0 {
					headerToken = vs[0]
					break
				}
			}
		}
	}
	if headerToken == "" {
		return reject("Missing x-csrf-token header.")
	}
	if subtle.ConstantTimeCompare([]byte(headerToken), []byte(sessionCSRFToken)) != 1 {
		return reject("CSRF token mismatch.")
	}
	if !sameOriginAllowed(r) {
		return reject("Origin validation failed.")
	}
	return nil
}

// sameOriginAllowed enforces origin/referer binding when present: if
// either header exists, its hostname must exactly equal the request host
// (case-insensitive, port-insensitive); unparseable values fail closed.
// A Substring match ("evil-example.com".Contains("example.com")) must
// never satisfy this check.
func sameOriginAllowed(r *http.Request) bool {
	host := r.Host
	if host == "" {
		host = r.Header.Get("Host")
	}
	reqHost := strings.ToLower(hostnameOnly(host))
	if reqHost == "" {
		return true
	}
	for _, h := range []string{"Origin", "Referer"} {
		v := strings.TrimSpace(r.Header.Get(h))
		if v == "" {
			continue
		}
		u, err := url.Parse(v)
		if err != nil || u.Hostname() == "" {
			return false
		}
		if !strings.EqualFold(u.Hostname(), reqHost) {
			return false
		}
	}
	return true
}

// hostnameOnly strips an optional port (and brackets) from a Host value.
func hostnameOnly(host string) string {
	host = strings.TrimSpace(host)
	if host == "" {
		return ""
	}
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.Trim(host, "[]")
}

// ---- attempt tokens ----

// AttemptTokenTTL returns the server TTL (default 15m).
func AttemptTokenTTL(cfg config.Config) time.Duration {
	mins := cfg.AttemptTokenTTLMins
	if mins <= 0 {
		mins = 15
	}
	return time.Duration(mins) * time.Minute
}

// IssueAttemptToken persists/refreshes the attempt_sessions row and signs a
// fresh HMAC bearer token binding token/user/schedule/attempt/client/org.
func IssueAttemptToken(ctx context.Context, db *sql.DB, cfg config.Config, userID, scheduleID, attemptID, clientSessionID string, organizationID *string, leaseEpoch *uint64, now time.Time) (token string, expiresAt time.Time, err error) {
	now = now.UTC()
	expiresAt = now.Add(AttemptTokenTTL(cfg))
	tokenID, err := RandomToken(24)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: attempt token id: %w", err)
	}
	sessionID := uuid.NewString()
	var org any
	if organizationID != nil {
		org = *organizationID
	}
	var lease any
	if leaseEpoch != nil {
		lease = *leaseEpoch
	}
	// organization_id/lease_epoch are informational (added by a later
	// migration outside auth-platform scope): write them when the columns
	// exist, else fall back to the base upsert so issuance never breaks on
	// older schemas.
	if _, err := db.ExecContext(ctx,
		`INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, device_fingerprint_hash, issued_at, last_seen_at, expires_at, organization_id, lease_epoch)
		 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), token_id = VALUES(token_id), issued_at = VALUES(issued_at), last_seen_at = VALUES(last_seen_at), expires_at = VALUES(expires_at), organization_id = VALUES(organization_id), lease_epoch = VALUES(lease_epoch), revoked_at = NULL, revocation_reason = NULL`,
		sessionID, userID, scheduleID, attemptID, clientSessionID, tokenID, now, now, expiresAt, org, lease); err != nil {
		if _, ferr := db.ExecContext(ctx,
			`INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, device_fingerprint_hash, issued_at, last_seen_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), token_id = VALUES(token_id), issued_at = VALUES(issued_at), last_seen_at = VALUES(last_seen_at), expires_at = VALUES(expires_at), revoked_at = NULL, revocation_reason = NULL`,
			sessionID, userID, scheduleID, attemptID, clientSessionID, tokenID, now, now, expiresAt); ferr != nil {
			return "", time.Time{}, fmt.Errorf("auth: upsert attempt_sessions: %w", ferr)
		}
	}
	// Re-read the canonical row: on upsert races the row id may differ from
	// the freshly generated one (React StrictMode / retries), mirroring Rust.
	var canonicalTokenID string
	err = db.QueryRowContext(ctx,
		`SELECT token_id FROM attempt_sessions WHERE attempt_id = ? AND client_session_id = ?`,
		attemptID, clientSessionID).Scan(&canonicalTokenID)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: read attempt_sessions: %w", err)
	}
	claims := crypto.AttemptClaims{
		TokenID:         canonicalTokenID,
		UserID:          userID,
		ScheduleID:      scheduleID,
		AttemptID:       attemptID,
		ClientSessionID: clientSessionID,
		LeaseEpoch:      leaseEpoch,
		Exp:             expiresAt.Unix(),
	}
	if organizationID != nil {
		claims.OrganizationID = *organizationID
	}
	signed, err := crypto.SignAttemptToken([]byte(cfg.AuthSecret), claims)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: sign attempt token: %w", err)
	}
	return signed, expiresAt, nil
}

// VerifyAttemptToken checks signature + expiry and binds claims to the
// attempt_sessions row (revoked/mismatched rows fail closed).
func VerifyAttemptToken(ctx context.Context, db Querier, cfg config.Config, now time.Time, token string) (crypto.AttemptClaims, error) {
	var zero crypto.AttemptClaims
	claims, err := crypto.VerifyAttemptToken([]byte(cfg.AuthSecret), now, token)
	if err != nil {
		return zero, fmt.Errorf("auth: verify attempt token: %w", err)
	}
	var userID, scheduleID, attemptID, clientSessionID string
	var expiresAt time.Time
	var revokedAt sql.NullTime
	var rowOrg sql.NullString
	var rowLease sql.NullInt64
	// organization_id/lease_epoch are verified when the columns exist (a
	// later migration adds them); older schemas fall back to the base
	// select so verification never breaks pre-migration.
	err = db.QueryRowContext(ctx,
		`SELECT user_id, schedule_id, attempt_id, client_session_id, expires_at, revoked_at, organization_id, lease_epoch FROM attempt_sessions WHERE token_id = ? AND revoked_at IS NULL`,
		claims.TokenID).Scan(&userID, &scheduleID, &attemptID, &clientSessionID, &expiresAt, &revokedAt, &rowOrg, &rowLease)
	if err != nil {
		err = db.QueryRowContext(ctx,
			`SELECT user_id, schedule_id, attempt_id, client_session_id, expires_at, revoked_at FROM attempt_sessions WHERE token_id = ? AND revoked_at IS NULL`,
			claims.TokenID).Scan(&userID, &scheduleID, &attemptID, &clientSessionID, &expiresAt, &revokedAt)
		if err == sql.ErrNoRows {
			return zero, fmt.Errorf("auth: unknown attempt session")
		}
		if err != nil {
			return zero, fmt.Errorf("auth: load attempt session: %w", err)
		}
		rowOrg.Valid = false
		rowLease.Valid = false
	}
	if revokedAt.Valid || !expiresAt.After(now.UTC()) ||
		userID != claims.UserID || scheduleID != claims.ScheduleID ||
		attemptID != claims.AttemptID || clientSessionID != claims.ClientSessionID {
		return zero, fmt.Errorf("auth: attempt session mismatch or expired")
	}
	if rowOrg.Valid && rowOrg.String != "" && claims.OrganizationID != rowOrg.String {
		return zero, fmt.Errorf("auth: attempt session organization mismatch")
	}
	if rowLease.Valid && (claims.LeaseEpoch == nil || int64(*claims.LeaseEpoch) != rowLease.Int64) {
		return zero, fmt.Errorf("auth: attempt session lease mismatch")
	}
	return claims, nil
}

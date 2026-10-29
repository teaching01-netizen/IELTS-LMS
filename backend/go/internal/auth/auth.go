// Package auth owns cookie-session authentication, CSRF verification,
// password hashing, attempt-token issuance and role helpers.
//
// Identity model mirrors backend/crates/domain/src/auth.rs and
// backend/crates/application/src/auth.rs:
//   - sessions live in user_sessions (+ user_session_events audit rows)
//   - staff sessions idle out after 30m, students after 60m, absolute 12h,
//     unless a staff password login chose a remembered policy (session_policy.go)
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
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
	"golang.org/x/crypto/argon2"
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

// ---- password hashing (argon2id primary, bcrypt legacy) ----

// HashPassword hashes a password with Argon2id, matching the Rust backend
// (argon2::Argon2::default(), PHC string format). New hashes are Argon2id so
// both backends verify them; bcrypt hashes minted by earlier Go builds remain
// verifiable via VerifyPassword.
func HashPassword(password string) (string, error) {
	salt := make([]byte, argon2idSaltLen)
	if _, err := rand.Read(salt); err != nil {
		return "", fmt.Errorf("auth: hash password: %w", err)
	}
	h := argon2.IDKey([]byte(password), salt, argon2idIterations, argon2idMemoryKiB, argon2idParallelism, argon2idKeyLen)
	return fmt.Sprintf("$argon2id$v=%d$m=%d,t=%d,p=%d$%s$%s",
		argon2.Version,
		argon2idMemoryKiB, argon2idIterations, argon2idParallelism,
		base64.RawStdEncoding.EncodeToString(salt),
		base64.RawStdEncoding.EncodeToString(h),
	), nil
}

// Argon2id parameters mirror argon2::Argon2::default() (RFC 9106 first
// recommendation): m=19456 KiB, t=2, p=1, 32-byte output.
const (
	argon2idIterations  = 2
	argon2idMemoryKiB   = 19456
	argon2idParallelism = 1
	argon2idKeyLen      = 32
	argon2idSaltLen     = 16
)

// VerifyPassword reports whether password matches the stored hash. Argon2id
// PHC strings (the Rust backend format, and everything HashPassword mints)
// verify via x/crypto/argon2 with a constant-time comparison; $2a$/$2b$
// bcrypt strings (earlier Go builds) verify via bcrypt. Unknown hash formats
// fail closed (false): callers map that to invalid credentials, never to an
// internal error.
func VerifyPassword(password, hash string) bool {
	if strings.HasPrefix(hash, "$argon2id$") {
		return verifyArgon2id(password, hash)
	}
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// verifyArgon2id parses a $argon2id$v=19$m=...,t=...,p=...$salt$hash PHC
// string and compares in constant time. Anything malformed returns false.
func verifyArgon2id(password, hash string) bool {
	parts := strings.Split(hash, "$")
	// ["", "argon2id", "v=19", "m=19456,t=2,p=1", salt, hash]
	if len(parts) != 6 || parts[1] != "argon2id" {
		return false
	}
	if parts[2] != fmt.Sprintf("v=%d", argon2.Version) {
		return false
	}
	var memory uint32
	var iterations uint32
	var parallelism uint8
	for _, kv := range strings.Split(parts[3], ",") {
		k, v, ok := strings.Cut(kv, "=")
		if !ok {
			return false
		}
		switch k {
		case "m":
			var n uint64
			if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n == 0 || n > 1<<22 {
				return false
			}
			memory = uint32(n)
		case "t":
			var n uint64
			if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n == 0 || n > 255 {
				return false
			}
			iterations = uint32(n)
		case "p":
			var n uint64
			if _, err := fmt.Sscanf(v, "%d", &n); err != nil || n == 0 || n > 255 {
				return false
			}
			parallelism = uint8(n)
		default:
			return false
		}
	}
	if memory == 0 || iterations == 0 || parallelism == 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[4])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[5])
	if err != nil || len(want) == 0 {
		return false
	}
	got := argon2.IDKey([]byte(password), salt, iterations, memory, parallelism, uint32(len(want)))
	return subtle.ConstantTimeCompare(got, want) == 1
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
	IssuedAt       time.Time
	ExpiresAt      time.Time
	IdleTimeoutAt  time.Time
	Proof          SessionProof
	// Remembered is the staff "keep me signed in" choice made at password
	// issuance; it decides only cookie persistence, never authority.
	Remembered bool
	// IdleWindowSeconds is the stored idle policy snapshot (nil = legacy).
	IdleWindowSeconds *int64
	// CredentialAuthenticatedAt is the last accepted real password
	// verification for this session (nil = never; remembered sessions must carry one).
	CredentialAuthenticatedAt *time.Time
	// ValidatedAt is the database time at which lookup admitted this request.
	// It is derived, never stored, so API hosts never need synchronized clocks.
	ValidatedAt time.Time
}

// SessionUser is the minimal identity summary a created session returns.
type SessionUser struct {
	ID          string
	Email       string
	DisplayName string
	Role        string
	State       string
}

// CreatedSession is the result of a committed issuance. Token is the raw
// bearer: it may only cross the HTTP cookie boundary and is never logged or
// JSON-encoded.
type CreatedSession struct {
	Session Session
	Token   string
	User    SessionUser
}

// RecoveryScoped reports whether this session exists only to continue one
// staff-approved attempt. Such sessions never gain general account authority.
func (s *Session) RecoveryScoped() bool {
	return s != nil && s.Proof.IsRecovery()
}

// RecoveryAttemptID returns the bound attempt for a recovery session.
func (s *Session) RecoveryAttemptID() string {
	if s == nil {
		return ""
	}
	return s.Proof.RecoveryAttemptID
}

// RecoveryScheduleID returns the schedule derived from the bound attempt.
func (s *Session) RecoveryScheduleID() string {
	if s == nil {
		return ""
	}
	return s.Proof.RecoveryScheduleID
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

// SessionExpiry returns the deadlines that legacy CreateSession persists.
// Keeping this calculation at the auth boundary lets student/recovery entry
// flows return the same timestamps the browser session will enforce.
func SessionExpiry(cfg config.Config, role string, now time.Time) (expiresAt, idleTimeoutAt time.Time) {
	return policyDeadlines(legacyPolicy(cfg, role), now)
}

// policyDeadlines applies a policy at now. The idle deadline never exceeds
// the absolute deadline.
func policyDeadlines(p SessionPolicy, now time.Time) (expiresAt, idleTimeoutAt time.Time) {
	now = now.UTC()
	expiresAt = now.Add(p.AbsoluteLifetime)
	idleTimeoutAt = now.Add(p.IdleWindow)
	if idleTimeoutAt.After(expiresAt) {
		idleTimeoutAt = expiresAt
	}
	return expiresAt, idleTimeoutAt
}

// CreateSession inserts a user_sessions row + a created audit event and
// returns the session id, the raw bearer session token (only copy) and the
// csrf token. now should be UTC (callers may pass DB time).
//
// It remains the public entry point for flows that own no transaction and
// issue legacy (non-remembered) sessions: student
// entry, practice, master key, and bootstrap paths. Password workflows use
// LoginWithPassword instead.
func CreateSession(ctx context.Context, db *sql.DB, cfg config.Config, userID, role string, proof SessionProof, userAgentHash *string, ipMetadata *string, now time.Time) (sessionID, sessionToken, csrfToken string, err error) {
	sqlTx, err := tx.Begin(ctx, db, &sql.TxOptions{})
	if err != nil {
		// Round 152: same client-gone honesty as the issuance re-read —
		// a canceled begin is a gone client, not an INTERNAL.
		if isClientGone(err) {
			return "", "", "", apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
		}
		return "", "", "", fmt.Errorf("auth: create session begin: %w", err)
	}
	defer func() { _ = sqlTx.Rollback() }()
	sessionID, sessionToken, csrfToken, err = CreateSessionInTx(ctx, sqlTx, cfg, userID, role, proof, userAgentHash, ipMetadata, now)
	if err != nil {
		return "", "", "", err
	}
	if err := sqlTx.Commit(); err != nil {
		// Round 158: a commit racing a gone client is retryable 503.
		if isClientGone(err) {
			return "", "", "", apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
		}
		return "", "", "", fmt.Errorf("auth: create session commit: %w", err)
	}
	return sessionID, sessionToken, csrfToken, nil
}

// CreateSessionInTx inserts a legacy user_sessions row + a created audit
// event into the caller's transaction and returns the uncommitted
// credentials. The caller commits; on any error the whole transaction
// (including a recovery attempt credential) rolls back.
func CreateSessionInTx(ctx context.Context, q tx.Tx, cfg config.Config, userID, role string, proof SessionProof, userAgentHash *string, ipMetadata *string, now time.Time) (sessionID, sessionToken, csrfToken string, err error) {
	created, err := insertSessionInTx(ctx, q, userID, role, proof, legacyPolicy(cfg, role), nil, userAgentHash, ipMetadata, now)
	if err != nil {
		return "", "", "", err
	}
	return created.Session.ID, created.Token, created.Session.CSRFToken, nil
}

// insertSessionInTx is the single session insertion owner. It takes a shared
// lock on the user row (so revoke-all, which holds it exclusively, serializes
// against issuance), rechecks the account, and writes the row plus its
// created audit event. credentialAt is set only by real password workflows.
func insertSessionInTx(ctx context.Context, q tx.Tx, userID, role string, proof SessionProof, policy SessionPolicy, credentialAt *time.Time, userAgentHash, ipMetadata *string, now time.Time) (CreatedSession, error) {
	if err := proof.validate(role); err != nil {
		return CreatedSession{}, err
	}
	if policy.IdleWindow <= 0 || policy.AbsoluteLifetime <= 0 {
		return CreatedSession{}, fmt.Errorf("auth: create session: invalid policy")
	}
	if policy.Remembered && (proof.Source != SessionSourceAccount || !rememberableRole(role) || credentialAt == nil || !policy.snapshot) {
		return CreatedSession{}, fmt.Errorf("auth: create session: remembered policy requires a password-authenticated staff account")
	}
	now = now.UTC()
	sessionID := uuid.NewString()
	sessionToken, err := RandomToken(32)
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: create session token: %w", err)
	}
	csrfToken, err := RandomToken(24)
	if err != nil {
		return CreatedSession{}, fmt.Errorf("auth: create csrf token: %w", err)
	}
	expiresAt, idleAt := policyDeadlines(policy, now)

	user := SessionUser{ID: userID}
	if err := q.QueryRowContext(ctx, "SELECT role, state, email, COALESCE(display_name, '') FROM users WHERE id = ? FOR SHARE", userID).Scan(&user.Role, &user.State, &user.Email, &user.DisplayName); err != nil {
		if isClientGone(err) {
			return CreatedSession{}, apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
		}
		return CreatedSession{}, err
	}
	if user.Role != role || user.State != "active" {
		return CreatedSession{}, apperrors.New(apperrors.CodeUnauthorized, "Account authentication changed; please authenticate again.")
	}

	var ua, ipMeta, idleSnapshot, credAt any
	if userAgentHash != nil {
		ua = *userAgentHash
	}
	if ipMetadata != nil {
		ipMeta = *ipMetadata
	}
	var idleSeconds *int64
	if policy.snapshot {
		v := int64(policy.IdleWindow / time.Second)
		idleSeconds = &v
		idleSnapshot = v
	}
	var credentialAtUTC *time.Time
	if credentialAt != nil {
		v := credentialAt.UTC()
		credentialAtUTC = &v
		credAt = v
	}
	if _, err := q.ExecContext(ctx,
		`INSERT INTO user_sessions (id, user_id, session_token_hash, csrf_token, role_snapshot, issued_at, last_seen_at, expires_at, idle_timeout_at, user_agent_hash, ip_metadata, authentication_source, practice_schedule_id, recovery_attempt_id, remembered, idle_window_seconds, credential_authenticated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), NULLIF(?, ''), ?, ?, ?)`,
		sessionID, userID, SHA256Hex(sessionToken), csrfToken, role, now, now, expiresAt, idleAt, ua, ipMeta, proof.Source, proof.PracticeScheduleID, proof.RecoveryAttemptID, policy.Remembered, idleSnapshot, credAt); err != nil {
		// Round 157: same client-gone honesty (r156: 5 masked 500s) —
		// a client gone mid-session-row insert is retryable 503.
		if isClientGone(err) {
			return CreatedSession{}, apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
		}
		return CreatedSession{}, fmt.Errorf("auth: insert user_sessions: %w", err)
	}
	if _, err := q.ExecContext(ctx,
		`INSERT INTO user_session_events (id, session_id, user_id, event_type, created_at) VALUES (?, ?, ?, 'created', ?)`,
		uuid.NewString(), sessionID, userID, now); err != nil {
		// Round 158: same client-gone honesty (r157: 1 masked 500) —
		// a client gone mid-events insert is retryable 503.
		if isClientGone(err) {
			return CreatedSession{}, apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
		}
		return CreatedSession{}, fmt.Errorf("auth: insert user_session_events: %w", err)
	}
	return CreatedSession{
		Session: Session{
			ID:                        sessionID,
			UserID:                    userID,
			Role:                      role,
			CSRFToken:                 csrfToken,
			IssuedAt:                  now,
			ExpiresAt:                 expiresAt,
			IdleTimeoutAt:             idleAt,
			Proof:                     proof,
			Remembered:                policy.Remembered,
			IdleWindowSeconds:         idleSeconds,
			CredentialAuthenticatedAt: credentialAtUTC,
			ValidatedAt:               now,
		},
		Token: sessionToken,
		User:  user,
	}, nil
}

// dbNow reads the database clock inside q. Decisions that must hold after a
// lock wait use this instead of a request-start timestamp.
func dbNow(ctx context.Context, q tx.Tx) (time.Time, error) {
	var now time.Time
	if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP()").Scan(&now); err != nil {
		return time.Time{}, fmt.Errorf("auth: read database time: %w", err)
	}
	return now.UTC(), nil
}

const sessionColumns = `id, user_id, role_snapshot, csrf_token, issued_at, last_seen_at, expires_at, idle_timeout_at, revoked_at, authentication_source, practice_schedule_id, recovery_attempt_id, remembered, idle_window_seconds, credential_authenticated_at`

// lockedSession is one user_sessions row read under FOR UPDATE.
type lockedSession struct {
	Session
	lastSeenAt time.Time
	revoked    bool
}

func scanLockedSession(row *sql.Row) (lockedSession, error) {
	var s lockedSession
	var revokedAt, credentialAt sql.NullTime
	var source, practiceScope, recoveryAttempt sql.NullString
	var idleWindow sql.NullInt64
	if err := row.Scan(&s.ID, &s.UserID, &s.Role, &s.CSRFToken, &s.IssuedAt, &s.lastSeenAt, &s.ExpiresAt, &s.IdleTimeoutAt, &revokedAt, &source, &practiceScope, &recoveryAttempt, &s.Remembered, &idleWindow, &credentialAt); err != nil {
		return lockedSession{}, err
	}
	s.revoked = revokedAt.Valid
	s.Proof = SessionProof{Source: source.String, PracticeScheduleID: practiceScope.String, RecoveryAttemptID: recoveryAttempt.String}
	if idleWindow.Valid {
		v := idleWindow.Int64
		s.IdleWindowSeconds = &v
	}
	if credentialAt.Valid {
		v := credentialAt.Time.UTC()
		s.CredentialAuthenticatedAt = &v
	}
	s.IssuedAt, s.lastSeenAt = s.IssuedAt.UTC(), s.lastSeenAt.UTC()
	s.ExpiresAt, s.IdleTimeoutAt = s.ExpiresAt.UTC(), s.IdleTimeoutAt.UTC()
	return s, nil
}

// effectiveIdleWindow is the stored snapshot when present, else legacy.
func (s *Session) effectiveIdleWindow(cfg config.Config) time.Duration {
	if s.IdleWindowSeconds != nil && *s.IdleWindowSeconds > 0 {
		return time.Duration(*s.IdleWindowSeconds) * time.Second
	}
	return idleTimeoutFor(s.Role, cfg)
}

// liveAt reports whether the locked row may authorize a request at now.
// Deadlines are strict: a deadline equal to now is expired.
func (s *lockedSession) liveAt(now time.Time) bool {
	if s.revoked || !s.ExpiresAt.After(now) || !s.IdleTimeoutAt.After(now) {
		return false
	}
	// Remembered rows must carry the metadata the CHECK constraint demands;
	// anything else fails closed rather than inheriting staff persistence.
	if s.Remembered && (s.IdleWindowSeconds == nil || s.CredentialAuthenticatedAt == nil || !rememberableRole(s.Role) || s.Proof.Source != SessionSourceAccount) {
		return false
	}
	return true
}

// LookupSession is the authoritative session admission. It returns
// (nil, nil) when the session is unknown, revoked, expired or no longer
// matches its account — callers map that to 401 without leaking why — and
// an error only for operational failures (503, never a false 401).
//
// The token hash first locates the owning user without locks. Then, in one
// READ COMMITTED transaction: user FOR SHARE -> session FOR UPDATE -> database
// time read AFTER the locks were granted -> validation -> monotonic touch ->
// commit. Reading the clock after the lock wait means a request that queued
// behind a revocation or across a deadline can never extend the session.
// The touch only advances last_seen_at and the idle deadline, capped by the
// absolute deadline; it never moves expires_at or the password time.
func LookupSession(ctx context.Context, db *sql.DB, cfg config.Config, sessionToken string) (result *Session, lookupErr error) {
	started := time.Now()
	defer func() {
		outcome := "restored"
		if lookupErr != nil {
			outcome = "transient"
		} else if result == nil {
			outcome = "absent"
		}
		telemetry.IncCounter(telemetry.MAuthSessionLookupTotal, "outcome", outcome)
		telemetry.ObserveSeconds(telemetry.MAuthSessionLookupSeconds, time.Since(started).Seconds(), "outcome", outcome)
	}()
	tokenHash := SHA256Hex(sessionToken)
	var ownerID string
	err := db.QueryRowContext(ctx, `SELECT user_id FROM user_sessions WHERE session_token_hash = ?`, tokenHash).Scan(&ownerID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("auth: lookup session: %w", err)
	}
	sqlTx, err := tx.Begin(ctx, db, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, fmt.Errorf("auth: lookup session begin: %w", err)
	}
	defer func() { _ = sqlTx.Rollback() }()

	var currentRole, currentState string
	var orgID sql.NullString
	err = sqlTx.QueryRowContext(ctx, `SELECT role, state, organization_id FROM users WHERE id = ? FOR SHARE`, ownerID).Scan(&currentRole, &currentState, &orgID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("auth: lookup session user: %w", err)
	}
	locked, err := scanLockedSession(sqlTx.QueryRowContext(ctx, `SELECT `+sessionColumns+` FROM user_sessions WHERE session_token_hash = ? FOR UPDATE`, tokenHash))
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("auth: lookup session row: %w", err)
	}
	if locked.UserID != ownerID {
		return nil, nil
	}
	now, err := dbNow(ctx, sqlTx)
	if err != nil {
		return nil, err
	}
	if locked.Proof.RecoveryAttemptID != "" {
		// Non-locking consistent read: lookup never joins attempt locks.
		var scheduleID string
		err := sqlTx.QueryRowContext(ctx, `SELECT schedule_id FROM student_attempts WHERE id = ?`, locked.Proof.RecoveryAttemptID).Scan(&scheduleID)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return nil, fmt.Errorf("auth: lookup recovery scope: %w", err)
		}
		locked.Proof.RecoveryScheduleID = scheduleID
	}
	if locked.Proof.validateStored(locked.Role) != nil || currentRole != locked.Role || currentState != "active" || !locked.liveAt(now) {
		return nil, nil
	}
	if orgID.Valid {
		v := orgID.String
		locked.OrganizationID = &v
	}

	newLastSeen := locked.lastSeenAt
	if now.After(newLastSeen) {
		newLastSeen = now
	}
	newIdle := now.Add(locked.effectiveIdleWindow(cfg))
	if locked.IdleTimeoutAt.After(newIdle) {
		newIdle = locked.IdleTimeoutAt
	}
	if newIdle.After(locked.ExpiresAt) {
		newIdle = locked.ExpiresAt
	}
	if !newLastSeen.Equal(locked.lastSeenAt) || !newIdle.Equal(locked.IdleTimeoutAt) {
		if _, err := sqlTx.ExecContext(ctx,
			`UPDATE user_sessions SET last_seen_at = ?, idle_timeout_at = ? WHERE id = ?`,
			newLastSeen, newIdle, locked.ID); err != nil {
			return nil, fmt.Errorf("auth: touch session: %w", err)
		}
	}
	if err := sqlTx.Commit(); err != nil {
		return nil, fmt.Errorf("auth: touch session commit: %w", err)
	}
	s := locked.Session
	s.IdleTimeoutAt = newIdle
	s.ValidatedAt = now
	return &s, nil
}

// RevokeSession revokes one session by raw token (logout). Unknown or
// already-revoked tokens are a successful no-op.
func RevokeSession(ctx context.Context, db Execer, sessionToken string, now time.Time) error {
	now = now.UTC()
	if _, err := db.ExecContext(ctx,
		`UPDATE user_sessions SET revoked_at = ?, revocation_reason = 'logout' WHERE session_token_hash = ? AND revoked_at IS NULL`,
		now, SHA256Hex(sessionToken)); err != nil {
		return fmt.Errorf("auth: revoke session: %w", err)
	}
	return nil
}

// revokeUserSessionsInTx revokes every live session of userID and writes one
// audit row per revoked session, all inside q. The caller must already hold
// the user row FOR UPDATE: issuance takes it FOR SHARE, so the live set
// captured here is exactly the set revoked (no session can slip in between),
// and the audit names precisely those IDs instead of inferring them from a
// timestamp range that could include earlier revocations.
func revokeUserSessionsInTx(ctx context.Context, q tx.Tx, userID, reason string, now time.Time) ([]string, error) {
	rows, err := q.QueryContext(ctx,
		`SELECT id FROM user_sessions WHERE user_id = ? AND revoked_at IS NULL ORDER BY id FOR UPDATE`, userID)
	if err != nil {
		return nil, fmt.Errorf("auth: revoke all list: %w", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, fmt.Errorf("auth: revoke all scan: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Close(); err != nil {
		return nil, fmt.Errorf("auth: revoke all close: %w", err)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("auth: revoke all rows: %w", err)
	}
	for _, id := range ids {
		if _, err := q.ExecContext(ctx,
			`UPDATE user_sessions SET revoked_at = ?, revocation_reason = ? WHERE id = ? AND revoked_at IS NULL`,
			now, reason, id); err != nil {
			return nil, fmt.Errorf("auth: revoke all sessions: %w", err)
		}
		if _, err := q.ExecContext(ctx,
			`INSERT INTO user_session_events (id, session_id, user_id, event_type, metadata, created_at) VALUES (?, ?, ?, 'revoked_all', JSON_OBJECT('reason', ?), ?)`,
			uuid.NewString(), id, userID, reason, now); err != nil {
			return nil, fmt.Errorf("auth: revoke all audit: %w", err)
		}
	}
	return ids, nil
}

// RevokeAllSessions revokes every live session for a user (logout-all) in
// one transaction serialized against issuance by the user row lock.
func RevokeAllSessions(ctx context.Context, db *sql.DB, userID, reason string, now time.Time) error {
	now = now.UTC()
	if reason == "" {
		reason = "logout_all"
	}
	sqlTx, err := tx.Begin(ctx, db, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return fmt.Errorf("auth: revoke all begin: %w", err)
	}
	defer func() { _ = sqlTx.Rollback() }()
	var lockedID string
	err = sqlTx.QueryRowContext(ctx, `SELECT id FROM users WHERE id = ? FOR UPDATE`, userID).Scan(&lockedID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("auth: revoke all lock user: %w", err)
	}
	if _, err := revokeUserSessionsInTx(ctx, sqlTx, userID, reason, now); err != nil {
		return err
	}
	if err := sqlTx.Commit(); err != nil {
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
// Round 166: the single-statement upsert is deadlock-prone under entry-wave
// concurrency (game-day r166: 7 x 1213 masked as 500 on the bootstrap
// re-issuance path): retry the upsert legs on InnoDB transients (bounded,
// same classifier as tx.transient) and surface exhaustion as retryable 503.
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
	// older schemas. The fallback triggers ONLY on missing-column (1054)
	// - any other wide-insert failure (FK 1452, dup-key, conn loss) must
	// surface immediately, not masquerade behind a second failing insert
	// (round 73 live rehearsal: the blind fallback hid the real error
	// and both failures escaped as unknown-500).
	execWide := func() error {
		_, err := db.ExecContext(ctx,
			`INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, device_fingerprint_hash, issued_at, last_seen_at, expires_at, organization_id, lease_epoch)
		 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), token_id = VALUES(token_id), issued_at = VALUES(issued_at), last_seen_at = VALUES(last_seen_at), expires_at = VALUES(expires_at), organization_id = VALUES(organization_id), lease_epoch = VALUES(lease_epoch), revoked_at = NULL, revocation_reason = NULL`,
			sessionID, userID, scheduleID, attemptID, clientSessionID, tokenID, now, now, expiresAt, org, lease)
		return err
	}
	execBase := func() error {
		_, err := db.ExecContext(ctx,
			`INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, device_fingerprint_hash, issued_at, last_seen_at, expires_at)
		 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), token_id = VALUES(token_id), issued_at = VALUES(issued_at), last_seen_at = VALUES(last_seen_at), expires_at = VALUES(expires_at), revoked_at = NULL, revocation_reason = NULL`,
			sessionID, userID, scheduleID, attemptID, clientSessionID, tokenID, now, now, expiresAt)
		return err
	}
	wideErr := execWide()
	if wideErr == nil {
		goto issued
	}
	if isClientGone(wideErr) {
		return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
	}
	if !isMissingColumn(wideErr) {
		// Deadlock/lock-wait on the upsert's unique-key dance is
		// transient: one bounded re-drive, then retryable 503
		// (never INTERNAL) so the client replays the issuance.
		if isTransientDB(wideErr) {
			rerr := execWide()
			if rerr == nil {
				goto issued
			}
			if isClientGone(rerr) {
				return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
			}
			if !isMissingColumn(rerr) {
				return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Session issuance contended; please retry.")
			}
			wideErr = rerr
		} else {
			return "", time.Time{}, fmt.Errorf("auth: upsert attempt_sessions: %w", wideErr)
		}
	}
	if !isMissingColumn(wideErr) {
		// Unreachable by construction (non-1054 wide errors returned
		// above), kept as a fail-closed guard.
		return "", time.Time{}, fmt.Errorf("auth: upsert attempt_sessions: %w", wideErr)
	}
	{
		if ferr := execBase(); ferr != nil {
			// Round 156: the fallback leg needs the same client-gone
			// honesty — live schemas predate organization_id/lease_epoch
			// (verified absent), so EVERY issuance takes this branch and
			// a client gone mid-fallback masked as 500 (r155: 418 of them
			// despite the guarded wide leg directly above).
			// Round 166: same transient honesty on the fallback leg —
			// a deadlock here re-drives once, then retryable 503.
			if isTransientDB(ferr) {
				rerr := execBase()
				if rerr == nil {
					goto issued
				}
				if isClientGone(rerr) {
					return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
				}
				return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Session issuance contended; please retry.")
			}
			if isClientGone(ferr) {
				return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
			}
			return "", time.Time{}, fmt.Errorf("auth: upsert attempt_sessions: %w", ferr)
		}
	}
issued:
	// Re-read the canonical row: on upsert races the row id may differ from
	// the freshly generated one (React StrictMode / retries), mirroring Rust.
	var canonicalTokenID string
	err = db.QueryRowContext(ctx,
		`SELECT token_id FROM attempt_sessions WHERE attempt_id = ? AND client_session_id = ?`,
		attemptID, clientSessionID).Scan(&canonicalTokenID)
	if err != nil {
		// Round 151: a client that went away mid-statement must not
		// mask as unknown-500 — return retryable 503 (E1 honesty).
		if isClientGone(err) {
			return "", time.Time{}, apperrors.New(apperrors.CodeServiceUnavailable, "Client went away; please retry.")
		}
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

// AttemptSessionExecer is the statement surface IssueAttemptTokenTx needs; a
// *sql.Tx and the platform tx.Tx both satisfy it.
type AttemptSessionExecer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// IssueAttemptTokenTx is IssueAttemptToken for callers that decide writer
// ownership in the same transaction (SAT admission and device transfer): the
// attempt_sessions upsert commits or rolls back together with the ownership
// decision, so a credential can never outlive a refused or rolled-back claim.
// No statement-level retry here — a deadlock aborts the whole transaction and
// the caller's tx runner re-drives the ownership decision with it.
func IssueAttemptTokenTx(ctx context.Context, q AttemptSessionExecer, cfg config.Config, userID, scheduleID, attemptID, clientSessionID string, organizationID *string, leaseEpoch *uint64, now time.Time) (token string, expiresAt time.Time, err error) {
	now = now.UTC()
	expiresAt = now.Add(AttemptTokenTTL(cfg))
	tokenID, err := RandomToken(24)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: attempt token id: %w", err)
	}
	var org, lease any
	if organizationID != nil {
		org = *organizationID
	}
	if leaseEpoch != nil {
		lease = *leaseEpoch
	}
	_, err = q.ExecContext(ctx,
		`INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, device_fingerprint_hash, issued_at, last_seen_at, expires_at, organization_id, lease_epoch)
		 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
		 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), token_id = VALUES(token_id), issued_at = VALUES(issued_at), last_seen_at = VALUES(last_seen_at), expires_at = VALUES(expires_at), organization_id = VALUES(organization_id), lease_epoch = VALUES(lease_epoch), revoked_at = NULL, revocation_reason = NULL`,
		uuid.NewString(), userID, scheduleID, attemptID, clientSessionID, tokenID, now, now, expiresAt, org, lease)
	if err != nil && isMissingColumn(err) {
		_, err = q.ExecContext(ctx,
			`INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, device_fingerprint_hash, issued_at, last_seen_at, expires_at)
			 VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), token_id = VALUES(token_id), issued_at = VALUES(issued_at), last_seen_at = VALUES(last_seen_at), expires_at = VALUES(expires_at), revoked_at = NULL, revocation_reason = NULL`,
			uuid.NewString(), userID, scheduleID, attemptID, clientSessionID, tokenID, now, now, expiresAt)
	}
	if err != nil {
		return "", time.Time{}, err
	}
	var canonicalTokenID string
	if err := q.QueryRowContext(ctx,
		`SELECT token_id FROM attempt_sessions WHERE attempt_id = ? AND client_session_id = ?`,
		attemptID, clientSessionID).Scan(&canonicalTokenID); err != nil {
		return "", time.Time{}, err
	}
	claims := crypto.AttemptClaims{
		TokenID: canonicalTokenID, UserID: userID, ScheduleID: scheduleID, AttemptID: attemptID,
		ClientSessionID: clientSessionID, LeaseEpoch: leaseEpoch, Exp: expiresAt.Unix(),
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

// isClientGone reports a dead client context (canceled/timeout): the
// caller went away mid-statement (round 151: 5k entry-wave queue-aged
// admissions timing out client-side inside IssueAttemptToken's re-read).
// errors.Is (not ==): sql + service layers wrap ctx.Err() with %w.
// Round 154: ALSO string-match the terminal cause — database/sql and the
// mysql driver surface cancellations through paths that preserve the
// message but not the identity (r153 live: 201 x the exact wrapped string
// `auth: upsert attempt_sessions: context canceled` still 500 despite the
// errors.Is guard directly above the wrap site, unit-green but prod-dark).
func isClientGone(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return true
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "context canceled") || strings.Contains(s, "context deadline exceeded")
}

// isTransientDB reports InnoDB transients safe for one bounded re-drive
// (round 166: 1213 deadlocks on the issuance upsert under wave
// concurrency): mirrors tx.transient's deadlock/lock-wait spellings.
func isTransientDB(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "deadlock") ||
		strings.Contains(s, "lock wait timeout") ||
		strings.Contains(s, "try restarting transaction")
}

// isMissingColumn reports MySQL 1054 (unknown column): the wide
// attempt_sessions upsert names organization_id/lease_epoch on a schema
// that predates them. ONLY this case falls back to the base upsert.
func isMissingColumn(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "1054") || strings.Contains(s, "unknown column")
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
	// Round 168: live schemas predate organization_id/lease_epoch (verified
	// absent locally AND live). A hard 1054 here fails EVERY bearer verify
	// (strict mode) — fall back to the base select ONLY on missing-column,
	// surface any other wide-leg error (conn loss, etc.) immediately.
	if err != nil && !isMissingColumn(err) {
		return zero, fmt.Errorf("auth: load attempt session: %w", err)
	}
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

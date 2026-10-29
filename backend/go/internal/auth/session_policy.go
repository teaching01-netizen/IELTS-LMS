package auth

import (
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
)

// SessionPolicy is the lifetime chosen for one session at issuance. The idle
// window is persisted as a snapshot so a later config change never moves the
// deadlines of rows already issued; the absolute lifetime fixes expires_at.
type SessionPolicy struct {
	Remembered       bool
	IdleWindow       time.Duration
	AbsoluteLifetime time.Duration
	// snapshot reports whether IdleWindow is stored in idle_window_seconds.
	// Legacy issuance leaves it NULL so lookup keeps the role/config window.
	snapshot bool
}

// legacyPolicy is the pre-persistence policy: configured role idle window,
// configured absolute lifetime, no snapshot, browser-session staff cookie.
func legacyPolicy(cfg config.Config, role string) SessionPolicy {
	return SessionPolicy{IdleWindow: idleTimeoutFor(role, cfg), AbsoluteLifetime: absoluteLifetime(cfg)}
}

// rememberableRole reports the staff roles this release can remember.
// admin_observer is excluded until the frontend supports that role.
func rememberableRole(role string) bool {
	switch role {
	case RoleAdmin, RoleBuilder, RoleProctor, RoleGrader:
		return true
	}
	return false
}

// policyForPassword chooses the policy for a real password authentication.
// Students keep the legacy policy and metadata path; staff persist their idle
// snapshot; only a supported role that explicitly asked, while issuance is
// enabled, is remembered. Unknown roles are refused rather than defaulted.
func policyForPassword(cfg config.Config, role string, remember bool) (SessionPolicy, error) {
	switch role {
	case RoleStudent:
		return legacyPolicy(cfg, role), nil
	case RoleAdmin, RoleAdminObserver, RoleBuilder, RoleProctor, RoleGrader:
	default:
		return SessionPolicy{}, apperrors.New(apperrors.CodeUnauthorized, "Invalid credentials.")
	}
	if !remember || !cfg.PersistentLoginEnabled || !rememberableRole(role) {
		p := legacyPolicy(cfg, role)
		p.snapshot = true
		return p, nil
	}
	idle, total := cfg.SessionRememberStaffIdleHours, cfg.SessionRememberStaffAbsoluteHours
	if role == RoleAdmin {
		idle, total = cfg.SessionRememberAdminIdleHours, cfg.SessionRememberAdminAbsoluteHours
	}
	// Config validation bounds these; refuse to issue on a config that was
	// never validated instead of minting an unbounded or inverted window.
	if idle <= 0 || total <= 0 || idle > total || total > config.MaxRememberedSessionHours {
		return SessionPolicy{}, apperrors.New(apperrors.CodeServiceUnavailable, "Session policy is not configured.")
	}
	return SessionPolicy{
		Remembered:       true,
		IdleWindow:       time.Duration(idle) * time.Hour,
		AbsoluteLifetime: time.Duration(total) * time.Hour,
		snapshot:         true,
	}, nil
}

// CredentialFreshWindow is the sensitive-action password window (default 15m).
func CredentialFreshWindow(cfg config.Config) time.Duration {
	mins := cfg.SessionCredentialFreshMins
	if mins <= 0 || mins > config.MaxCredentialFreshMins {
		mins = 15
	}
	return time.Duration(mins) * time.Minute
}

// ReauthRequiredError is the stable 403 a sensitive route returns when the
// session is valid but its password verification is missing or stale.
func ReauthRequiredError() *apperrors.Error {
	return apperrors.New(apperrors.CodeReauthRequired, "Confirm your password to continue.")
}

// RequireFreshPassword enforces that s is a live staff account session whose
// real password verification happened within window of now. now must be the
// database admission time (Session.ValidatedAt); a zero now fails closed.
// issued_at and source "account" are never accepted as password evidence.
func RequireFreshPassword(s *Session, now time.Time, window time.Duration) error {
	if s == nil {
		return apperrors.New(apperrors.CodeSessionExpired, "Session expired.")
	}
	if s.Role == RoleStudent || s.Proof.Source != SessionSourceAccount || s.Proof.PracticeScheduleID != "" || s.Proof.RecoveryAttemptID != "" {
		return apperrors.New(apperrors.CodeForbidden, "The authenticated user is not allowed to access this route.")
	}
	if now.IsZero() || window <= 0 || s.CredentialAuthenticatedAt == nil {
		return ReauthRequiredError()
	}
	at := s.CredentialAuthenticatedAt.UTC()
	if at.After(now) || now.Sub(at) >= window {
		return ReauthRequiredError()
	}
	return nil
}

// FreshUntil returns when s's password freshness ends (zero if never fresh).
func FreshUntil(s *Session, window time.Duration) time.Time {
	if s == nil || s.CredentialAuthenticatedAt == nil || window <= 0 {
		return time.Time{}
	}
	return s.CredentialAuthenticatedAt.UTC().Add(window)
}

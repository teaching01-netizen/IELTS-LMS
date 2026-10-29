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

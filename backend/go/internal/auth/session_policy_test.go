package auth

import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestPolicyForPassword(t *testing.T) {
	cfg := testCfg()
	cfg.PersistentLoginEnabled = true
	cfg.SessionRememberStaffIdleHours, cfg.SessionRememberStaffAbsoluteHours = 168, 720
	cfg.SessionRememberAdminIdleHours, cfg.SessionRememberAdminAbsoluteHours = 24, 168

	cases := []struct {
		name           string
		role           string
		remember       bool
		enabled        bool
		wantRemembered bool
		wantIdle       time.Duration
		wantAbsolute   time.Duration
		wantSnapshot   bool
	}{
		{"builder remembered", RoleBuilder, true, true, true, 168 * time.Hour, 720 * time.Hour, true},
		{"proctor remembered", RoleProctor, true, true, true, 168 * time.Hour, 720 * time.Hour, true},
		{"grader remembered", RoleGrader, true, true, true, 168 * time.Hour, 720 * time.Hour, true},
		{"admin remembered", RoleAdmin, true, true, true, 24 * time.Hour, 168 * time.Hour, true},
		{"builder opt out", RoleBuilder, false, true, false, 30 * time.Minute, 12 * time.Hour, true},
		{"feature off", RoleBuilder, true, false, false, 30 * time.Minute, 12 * time.Hour, true},
		{"observer short", RoleAdminObserver, true, true, false, 30 * time.Minute, 12 * time.Hour, true},
		{"student legacy", RoleStudent, true, true, false, 60 * time.Minute, 12 * time.Hour, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			c := cfg
			c.PersistentLoginEnabled = tc.enabled
			p, err := policyForPassword(c, tc.role, tc.remember)
			if err != nil {
				t.Fatal(err)
			}
			if p.Remembered != tc.wantRemembered || p.IdleWindow != tc.wantIdle || p.AbsoluteLifetime != tc.wantAbsolute || p.snapshot != tc.wantSnapshot {
				t.Fatalf("policy = %+v", p)
			}
		})
	}
	if _, err := policyForPassword(cfg, "superuser", true); err == nil {
		t.Fatal("unknown role must be refused, not defaulted to staff")
	}
	bad := cfg
	bad.SessionRememberStaffIdleHours = 900
	if _, err := policyForPassword(bad, RoleBuilder, true); err == nil {
		t.Fatal("an unvalidated, out-of-bounds policy must not issue")
	}
}

func TestPolicyDeadlinesCapIdleAtAbsolute(t *testing.T) {
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	expires, idle := policyDeadlines(SessionPolicy{IdleWindow: 48 * time.Hour, AbsoluteLifetime: 24 * time.Hour}, now)
	if !expires.Equal(now.Add(24*time.Hour)) || !idle.Equal(expires) {
		t.Fatalf("expires=%s idle=%s", expires, idle)
	}
}

func TestRequireFreshPassword(t *testing.T) {
	now := time.Date(2026, 10, 29, 9, 0, 0, 0, time.UTC)
	window := 15 * time.Minute
	at := func(d time.Duration) *time.Time { v := now.Add(d); return &v }
	staff := func(cred *time.Time) *Session {
		return &Session{Role: RoleAdmin, Proof: SessionProof{Source: SessionSourceAccount}, CredentialAuthenticatedAt: cred}
	}
	cases := []struct {
		name string
		s    *Session
		now  time.Time
		want string
	}{
		{"fresh", staff(at(-time.Minute)), now, ""},
		{"just inside", staff(at(-window + time.Second)), now, ""},
		{"exact boundary is stale", staff(at(-window)), now, string(apperrors.CodeReauthRequired)},
		{"stale", staff(at(-time.Hour)), now, string(apperrors.CodeReauthRequired)},
		{"never verified", staff(nil), now, string(apperrors.CodeReauthRequired)},
		{"future time", staff(at(time.Minute)), now, string(apperrors.CodeReauthRequired)},
		{"zero admission time", staff(at(-time.Minute)), time.Time{}, string(apperrors.CodeReauthRequired)},
		{"student", &Session{Role: RoleStudent, Proof: SessionProof{Source: SessionSourceAccount}, CredentialAuthenticatedAt: at(-time.Minute)}, now, string(apperrors.CodeForbidden)},
		{"legacy origin", &Session{Role: RoleAdmin, CredentialAuthenticatedAt: at(-time.Minute)}, now, string(apperrors.CodeForbidden)},
		{"no session", nil, now, string(apperrors.CodeSessionExpired)},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := RequireFreshPassword(tc.s, tc.now, window)
			if tc.want == "" {
				if err != nil {
					t.Fatalf("want fresh, got %v", err)
				}
				return
			}
			ae, ok := apperrors.As(err)
			if !ok || string(ae.Code) != tc.want {
				t.Fatalf("want %s, got %v", tc.want, err)
			}
		})
	}
}

package auth

import (
	"testing"
	"time"
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

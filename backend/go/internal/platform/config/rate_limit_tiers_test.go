package config

import (
	"os"
	"testing"
)

func clearTierEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"RATE_LIMIT_GLOBAL", "RATE_LIMIT_BUCKET_CAP",
		"RATE_LIMIT_AUTH_CRITICAL_PER_MIN", "RATE_LIMIT_ANON_AUTH_PER_MIN",
		"RATE_LIMIT_AUTHED_READS_PER_MIN", "RATE_LIMIT_POLLING_PER_MIN",
		"RATE_LIMIT_HEARTBEAT_PER_MIN", "RATE_LIMIT_WRITES_PER_MIN",
		"RATE_LIMIT_BACKSTOP_PER_MIN",
	} {
		_ = os.Unsetenv(k)
	}
}

// Legacy-only deployment must boot with sane per-tier budgets (AT-12).
func TestTierLimitsDeriveFromLegacyDefaults(t *testing.T) {
	clearTierEnv(t)
	cfg := Load()
	if cfg.RateLimitGlobalPerMin != 600 {
		t.Fatalf("legacy global default must be 600, got %d", cfg.RateLimitGlobalPerMin)
	}
	if cfg.RateLimitAuthCriticalPerMin != 120 {
		t.Fatalf("auth-critical default must be 120, got %d", cfg.RateLimitAuthCriticalPerMin)
	}
	if cfg.RateLimitAnonAuthPerMin != 30 {
		t.Fatalf("anon-auth default must be 30, got %d", cfg.RateLimitAnonAuthPerMin)
	}
	if cfg.RateLimitAuthedReadsPerMin != 300 {
		t.Fatalf("authed-reads default must be 300, got %d", cfg.RateLimitAuthedReadsPerMin)
	}
	if cfg.RateLimitPollingPerMin != 240 {
		t.Fatalf("polling default must be 240, got %d", cfg.RateLimitPollingPerMin)
	}
	if cfg.RateLimitHeartbeatPerMin != 120 {
		t.Fatalf("heartbeat default must be 120, got %d", cfg.RateLimitHeartbeatPerMin)
	}
	if cfg.RateLimitWritesPerMin != 120 {
		t.Fatalf("writes default must be 120, got %d", cfg.RateLimitWritesPerMin)
	}
	if cfg.RateLimitBackstopPerMin != 3000 {
		t.Fatalf("backstop default must be 3000, got %d", cfg.RateLimitBackstopPerMin)
	}
}

// Explicit per-tier env must win over defaults.
func TestTierLimitsExplicitEnvWins(t *testing.T) {
	clearTierEnv(t)
	t.Setenv("RATE_LIMIT_POLLING_PER_MIN", "60")
	t.Setenv("RATE_LIMIT_WRITES_PER_MIN", "45")
	cfg := Load()
	if cfg.RateLimitPollingPerMin != 60 {
		t.Fatalf("explicit polling budget must win, got %d", cfg.RateLimitPollingPerMin)
	}
	if cfg.RateLimitWritesPerMin != 45 {
		t.Fatalf("explicit writes budget must win, got %d", cfg.RateLimitWritesPerMin)
	}
	if cfg.RateLimitAuthCriticalPerMin != 120 {
		t.Fatalf("unspecified tier must keep default, got %d", cfg.RateLimitAuthCriticalPerMin)
	}
}

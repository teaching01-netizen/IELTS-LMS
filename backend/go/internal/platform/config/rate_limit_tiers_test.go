package config

import (
	"os"
	"testing"
)

func clearTierEnv(t *testing.T) {
	t.Helper()
	for _, k := range []string{
		"RATE_LIMIT_GLOBAL", "RATE_LIMIT_BUCKET_CAP", "RATE_LIMIT_MAX_KEYS", "RATE_LIMIT_BURST",
		"RATE_LIMIT_EXPORT_PER_USER", "RATE_LIMIT_EXPORT_PER_USER_WINDOW_SECS",
		"RATE_LIMIT_AUTH_CRITICAL_PER_MIN", "RATE_LIMIT_ANON_AUTH_PER_MIN",
		"RATE_LIMIT_AUTHED_READS_PER_MIN", "RATE_LIMIT_POLLING_PER_MIN",
		"RATE_LIMIT_HEARTBEAT_PER_MIN", "RATE_LIMIT_WRITES_PER_MIN",
		"RATE_LIMIT_BACKSTOP_PER_MIN",
	} {
		_ = os.Unsetenv(k)
	}
}

// Per-tier defaults stay authoritative even when the removed global setting
// is present in a legacy deployment.
func TestTierLimitsDeriveFromLegacyDefaults(t *testing.T) {
	clearTierEnv(t)
	t.Setenv("RATE_LIMIT_GLOBAL", "1")
	cfg := Load()
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

func TestRateLimitConfigUsesCanonicalKeyAndBurstSettings(t *testing.T) {
	clearTierEnv(t)
	t.Setenv("RATE_LIMIT_MAX_KEYS", "123")
	t.Setenv("RATE_LIMIT_BURST", "7")
	t.Setenv("RATE_LIMIT_BUCKET_CAP", "456")
	t.Setenv("RATE_LIMIT_GLOBAL", "1")

	cfg := Load()
	if cfg.RateLimitMaxKeys != 123 {
		t.Fatalf("canonical max-key setting must win, got %d", cfg.RateLimitMaxKeys)
	}
	if cfg.RateLimitBurst != 7 {
		t.Fatalf("burst setting must be independent, got %d", cfg.RateLimitBurst)
	}
	if cfg.RateLimitPollingPerMin != 240 {
		t.Fatalf("legacy global must not derive tier budgets, got polling=%d", cfg.RateLimitPollingPerMin)
	}
}

func TestRateLimitConfigUsesBucketCapAsDeprecatedMaxKeyAlias(t *testing.T) {
	clearTierEnv(t)
	t.Setenv("RATE_LIMIT_BUCKET_CAP", "321")

	cfg := Load()
	if cfg.RateLimitMaxKeys != 321 {
		t.Fatalf("bucket-cap alias must populate max keys, got %d", cfg.RateLimitMaxKeys)
	}
	if cfg.RateLimitBurst != 0 {
		t.Fatalf("bucket-cap alias must not populate burst, got %d", cfg.RateLimitBurst)
	}
}

func TestRateLimitConfigRejectsInvalidValues(t *testing.T) {
	base := Load()
	base.DatabaseURL = "user:pass@tcp(localhost:3306)/db?parseTime=true"
	base.AuthSecret = "test-only-auth-secret-32-chars-min"

	cases := []struct {
		name   string
		mutate func(*Config)
	}{
		{name: "max keys", mutate: func(c *Config) { c.RateLimitMaxKeys = 0 }},
		{name: "negative burst", mutate: func(c *Config) { c.RateLimitBurst = -1 }},
		{name: "tier budget", mutate: func(c *Config) { c.RateLimitWritesPerMin = 0 }},
		{name: "export count", mutate: func(c *Config) { c.RateLimitExportPerUser = 0 }},
		{name: "export window", mutate: func(c *Config) { c.RateLimitExportPerUserWindowSecs = 0 }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			cfg := base
			tc.mutate(&cfg)
			if err := cfg.ValidateForRuntime(); err == nil {
				t.Fatalf("invalid %s must be rejected", tc.name)
			}
		})
	}
}

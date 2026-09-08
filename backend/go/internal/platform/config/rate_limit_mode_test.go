package config

import (
	"testing"
)

func clearRateLimitModeEnv(t *testing.T) {
	t.Helper()
	// os.Getenv cannot distinguish unset from empty, and the parser
	// contract is empty == unset == dual; setting empty restores default.
	t.Setenv("RATE_LIMIT_MODE", "")
}

// A1 RED: RATE_LIMIT_MODE defaults to dual (behavior-preserving ship state).
func TestRateLimitModeDefaultsDual(t *testing.T) {
	clearRateLimitModeEnv(t)
	cfg := Load()
	if cfg.RateLimitMode != RateLimitModeDual {
		t.Fatalf("default RATE_LIMIT_MODE = %q, want %q", cfg.RateLimitMode, RateLimitModeDual)
	}
}

// A1 RED: explicit local mode parses.
func TestRateLimitModeLocalParses(t *testing.T) {
	clearRateLimitModeEnv(t)
	t.Setenv("RATE_LIMIT_MODE", "local")
	cfg := Load()
	if cfg.RateLimitMode != RateLimitModeLocal {
		t.Fatalf("RATE_LIMIT_MODE=local parsed as %q", cfg.RateLimitMode)
	}
	if !cfg.RateLimitLocalOnly() {
		t.Fatalf("local mode must report RateLimitLocalOnly()=true")
	}
}

// A1 RED: mode parsing is case-insensitive and trims space.
func TestRateLimitModeParsingForgiving(t *testing.T) {
	clearRateLimitModeEnv(t)
	t.Setenv("RATE_LIMIT_MODE", "  LOCAL ")
	if got := Load().RateLimitMode; got != RateLimitModeLocal {
		t.Fatalf("forgiving parse got %q, want local", got)
	}
}

// A1 RED: unknown values fail closed at validation (never silently local).
func TestRateLimitModeUnknownRejected(t *testing.T) {
	clearRateLimitModeEnv(t)
	t.Setenv("RATE_LIMIT_MODE", "yolo")
	cfg := Load()
	if cfg.RateLimitMode == RateLimitModeLocal {
		t.Fatalf("unknown mode must never parse as local")
	}
	good := cfg
	good.DatabaseURL = "user:pass@tcp(localhost:3306)/db?parseTime=true"
	good.AuthSecret = "test-only-auth-secret-32-chars-min"
	if err := good.ValidateForRuntime(); err == nil {
		t.Fatalf("unknown RATE_LIMIT_MODE must fail ValidateForRuntime")
	}
}

// A1 RED: dual-mode fixture still validates (ship state stays green).
func TestRateLimitModeDualValidates(t *testing.T) {
	clearRateLimitModeEnv(t)
	cfg := Load()
	cfg.DatabaseURL = "user:pass@tcp(localhost:3306)/db?parseTime=true"
	cfg.AuthSecret = "test-only-auth-secret-32-chars-min"
	if err := cfg.ValidateForRuntime(); err != nil {
		t.Fatalf("dual-mode valid fixture rejected: %v", err)
	}
}

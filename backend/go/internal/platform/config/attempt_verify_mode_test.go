package config

import (
	"testing"
)

// A3 RED: ATTEMPT_VERIFY defaults strict (behavior-preserving ship state).
func TestAttemptVerifyDefaultsStrict(t *testing.T) {
	t.Setenv("ATTEMPT_VERIFY", "")
	cfg := Load()
	if cfg.AttemptVerify != AttemptVerifyStrict {
		t.Fatalf("default ATTEMPT_VERIFY = %q, want %q", cfg.AttemptVerify, AttemptVerifyStrict)
	}
	if cfg.AttemptVerifyStateless() {
		t.Fatalf("default must not be stateless")
	}
}

// A3 RED: explicit stateless parses (forgiving case/space).
func TestAttemptVerifyStatelessParses(t *testing.T) {
	t.Setenv("ATTEMPT_VERIFY", "  STATELESS ")
	cfg := Load()
	if cfg.AttemptVerify != AttemptVerifyStateless {
		t.Fatalf("ATTEMPT_VERIFY=stateless parsed as %q", cfg.AttemptVerify)
	}
	if !cfg.AttemptVerifyStateless() {
		t.Fatalf("stateless mode must report AttemptVerifyStateless()=true")
	}
}

// A3 RED: unknown values fail closed at validation (never silently
// stateless — that would drop the DB binding without operator intent).
func TestAttemptVerifyUnknownRejected(t *testing.T) {
	t.Setenv("ATTEMPT_VERIFY", "yolo")
	cfg := Load()
	if cfg.AttemptVerify == AttemptVerifyStateless {
		t.Fatalf("unknown mode must never parse as stateless")
	}
	good := cfg
	good.DatabaseURL = "user:pass@tcp(localhost:3306)/db?parseTime=true"
	good.AuthSecret = "test-only-auth-secret-32-chars-min"
	if err := good.ValidateForRuntime(); err == nil {
		t.Fatalf("unknown ATTEMPT_VERIFY must fail ValidateForRuntime")
	}
}

// A3 RED: strict fixture still validates (ship state stays green).
func TestAttemptVerifyStrictValidates(t *testing.T) {
	t.Setenv("ATTEMPT_VERIFY", "strict")
	cfg := Load()
	cfg.DatabaseURL = "user:pass@tcp(localhost:3306)/db?parseTime=true"
	cfg.AuthSecret = "test-only-auth-secret-32-chars-min"
	if err := cfg.ValidateForRuntime(); err != nil {
		t.Fatalf("strict-mode valid fixture rejected: %v", err)
	}
}

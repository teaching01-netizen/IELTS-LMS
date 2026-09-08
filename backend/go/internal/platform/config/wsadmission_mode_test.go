package config

import (
	"testing"
)

// C2 RED: WS_ADMISSION selects the gate. db (ship state) keeps the
// singleton-row lease tx; memory is the zero-SQL in-process gate.
// Unknown values fail closed (never silently permissive).
func TestWSAdmissionDefaultsDB(t *testing.T) {
	t.Setenv("WS_ADMISSION", "")
	if cfg := Load(); cfg.WSAdmission != WSAdmissionDB {
		t.Fatalf("WS_ADMISSION must default db, got %q", cfg.WSAdmission)
	}
}

func TestWSAdmissionMemoryParses(t *testing.T) {
	t.Setenv("WS_ADMISSION", "memory")
	if cfg := Load(); cfg.WSAdmission != WSAdmissionMemory {
		t.Fatalf("memory must parse, got %q", cfg.WSAdmission)
	}
}

func TestWSAdmissionUnknownFailsClosed(t *testing.T) {
	t.Setenv("WS_ADMISSION", "bogus")
	cfg := Load()
	if cfg.WSAdmissionMemory() {
		t.Fatalf("unknown mode must not report memory")
	}
	if err := cfg.ValidateForRuntime(); err == nil {
		t.Fatalf("unknown WS_ADMISSION must fail validation")
	}
}

// C2 RED: caps parse with plan defaults (30000/5/20000) and clamp
// non-positive values back to defaults (never unbounded, never deny-all).
func TestWSAdmissionCapsDefaults(t *testing.T) {
	t.Setenv("WS_CAP_TOTAL", "")
	t.Setenv("WS_CAP_USER", "")
	t.Setenv("WS_CAP_SCHEDULE", "")
	cfg := Load()
	if cfg.WSCapTotal != DefaultWSCapTotal || cfg.WSCapUser != DefaultWSCapUser || cfg.WSCapSchedule != DefaultWSCapSchedule {
		t.Fatalf("cap defaults drifted: %+v/%+v/%+v", cfg.WSCapTotal, cfg.WSCapUser, cfg.WSCapSchedule)
	}
}

func TestWSAdmissionCapsClamp(t *testing.T) {
	t.Setenv("WS_CAP_TOTAL", "0")
	t.Setenv("WS_CAP_USER", "-3")
	t.Setenv("WS_CAP_SCHEDULE", "notanint")
	cfg := Load()
	if cfg.WSCapTotal != DefaultWSCapTotal || cfg.WSCapUser != DefaultWSCapUser || cfg.WSCapSchedule != DefaultWSCapSchedule {
		t.Fatalf("non-positive caps must clamp to defaults: %+v/%+v/%+v", cfg.WSCapTotal, cfg.WSCapUser, cfg.WSCapSchedule)
	}
}

func TestWSAdmissionCapsExplicit(t *testing.T) {
	t.Setenv("WS_CAP_TOTAL", "1000")
	t.Setenv("WS_CAP_USER", "2")
	t.Setenv("WS_CAP_SCHEDULE", "500")
	cfg := Load()
	if cfg.WSCapTotal != 1000 || cfg.WSCapUser != 2 || cfg.WSCapSchedule != 500 {
		t.Fatalf("explicit caps must hold: %+v/%+v/%+v", cfg.WSCapTotal, cfg.WSCapUser, cfg.WSCapSchedule)
	}
}

package config

import (
	"testing"
)

// B2 RED: RUNTIME_SNAPSHOT defaults off (behavior-preserving ship state).
func TestRuntimeSnapshotDefaultsOff(t *testing.T) {
	t.Setenv("RUNTIME_SNAPSHOT", "")
	cfg := Load()
	if cfg.RuntimeSnapshotEnabled {
		t.Fatalf("RUNTIME_SNAPSHOT must default off")
	}
}

// B2 RED: explicit on parses (forgiving values).
func TestRuntimeSnapshotOnParses(t *testing.T) {
	for _, v := range []string{"on", "1", "true", " ON "} {
		t.Setenv("RUNTIME_SNAPSHOT", v)
		if cfg := Load(); !cfg.RuntimeSnapshotEnabled {
			t.Fatalf("RUNTIME_SNAPSHOT=%q must enable", v)
		}
	}
}

// B2 RED: explicit off stays off.
func TestRuntimeSnapshotOffStaysOff(t *testing.T) {
	for _, v := range []string{"off", "0", "false"} {
		t.Setenv("RUNTIME_SNAPSHOT", v)
		if cfg := Load(); cfg.RuntimeSnapshotEnabled {
			t.Fatalf("RUNTIME_SNAPSHOT=%q must stay off", v)
		}
	}
}

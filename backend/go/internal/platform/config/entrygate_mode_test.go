package config

import (
	"testing"
)

// D3 RED: ENTRY_GATE defaults off (today's shape); on enables the
// per-schedule bucket. Unknown fails closed (never silently throttles).
func TestEntryGateDefaultsOff(t *testing.T) {
	t.Setenv("ENTRY_GATE", "")
	if cfg := Load(); cfg.EntryGateEnabled {
		t.Fatalf("ENTRY_GATE must default off")
	}
}

func TestEntryGateOnParses(t *testing.T) {
	t.Setenv("ENTRY_GATE", "on")
	if cfg := Load(); !cfg.EntryGateEnabled {
		t.Fatalf("ENTRY_GATE=on must enable")
	}
}

// D3 RED: rate envs default 500/2000 and clamp non-positive to defaults.
func TestEntryGateRates(t *testing.T) {
	t.Setenv("ENTRY_PER_SEC_PER_SCHEDULE", "")
	t.Setenv("ENTRY_BURST", "")
	cfg := Load()
	if cfg.EntryPerSec != 500 || cfg.EntryBurst != 2000 {
		t.Fatalf("rate defaults drifted: %v/%v", cfg.EntryPerSec, cfg.EntryBurst)
	}
	t.Setenv("ENTRY_PER_SEC_PER_SCHEDULE", "0")
	t.Setenv("ENTRY_BURST", "-5")
	cfg = Load()
	if cfg.EntryPerSec != 500 || cfg.EntryBurst != 2000 {
		t.Fatalf("non-positive rates must clamp: %v/%v", cfg.EntryPerSec, cfg.EntryBurst)
	}
}

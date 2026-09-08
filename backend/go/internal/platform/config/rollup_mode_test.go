package config

import (
	"testing"
)

// D4 RED: ROLLUP defaults off (dashboard keeps the full roster); on enables
// the worker GROUP BY refresh + 1-row header reads.
func TestRollupDefaultsOff(t *testing.T) {
	t.Setenv("ROLLUP", "")
	if cfg := Load(); cfg.RollupEnabled {
		t.Fatalf("ROLLUP must default off")
	}
}

func TestRollupOnParses(t *testing.T) {
	t.Setenv("ROLLUP", "on")
	if cfg := Load(); !cfg.RollupEnabled {
		t.Fatalf("ROLLUP=on must enable")
	}
}

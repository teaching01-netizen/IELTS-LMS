package config

import (
	"testing"
)

// B3 RED: ROW_FIRST_WRITES defaults off (behavior-preserving ship state).
func TestRowFirstDefaultsOff(t *testing.T) {
	t.Setenv("ROW_FIRST_WRITES", "")
	cfg := Load()
	if cfg.RowFirstWrites {
		t.Fatalf("ROW_FIRST_WRITES must default off")
	}
}

// B3 RED: explicit on parses (forgiving values).
func TestRowFirstOnParses(t *testing.T) {
	for _, v := range []string{"on", "1", "true", " ON "} {
		t.Setenv("ROW_FIRST_WRITES", v)
		if cfg := Load(); !cfg.RowFirstWrites {
			t.Fatalf("ROW_FIRST_WRITES=%q must enable", v)
		}
	}
}

// B3 RED: explicit off stays off.
func TestRowFirstOffStaysOff(t *testing.T) {
	for _, v := range []string{"off", "0", "false"} {
		t.Setenv("ROW_FIRST_WRITES", v)
		if cfg := Load(); cfg.RowFirstWrites {
			t.Fatalf("ROW_FIRST_WRITES=%q must stay off", v)
		}
	}
}

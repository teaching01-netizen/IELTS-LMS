package config

import (
	"testing"
)

// D2 RED: PRESENCE_MODE defaults inline (today's per-beat tx); memory selects
// the PresenceMap path (zero SQL steady-state + 60s flush). Unknown fails
// closed (never silently drops beats into a map nobody flushes... and never
// silently keeps the tx path when the operator asked memory: fail closed =
// inline).
func TestPresenceModeDefaultsInline(t *testing.T) {
	t.Setenv("PRESENCE_MODE", "")
	if cfg := Load(); cfg.PresenceMode != PresenceInline {
		t.Fatalf("PRESENCE_MODE must default inline, got %q", cfg.PresenceMode)
	}
}

func TestPresenceModeMemoryParses(t *testing.T) {
	t.Setenv("PRESENCE_MODE", "memory")
	if cfg := Load(); cfg.PresenceMode != PresenceMemory {
		t.Fatalf("PRESENCE_MODE=memory must parse, got %q", cfg.PresenceMode)
	}
}

func TestPresenceModeUnknownFailsClosed(t *testing.T) {
	t.Setenv("PRESENCE_MODE", "redis")
	if err := Load().ValidateForRuntime(); err == nil {
		t.Fatalf("unknown PRESENCE_MODE must fail closed")
	}
}

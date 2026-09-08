package main

import (
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
)

// B2 RED: BuildApp wires a snapshot cache from config — always non-nil
// (off = present-but-unused, today's FOR UPDATE path untouched), on =
// shared cache the V2 handlers route through.
func TestBuildAppRuntimeSnapshotWiring(t *testing.T) {
	cfg := config.Load()
	cfg.RuntimeSnapshotEnabled = false
	app := BuildApp(cfg, nil)
	if app.RuntimeSnapshots == nil {
		t.Fatalf("BuildApp must always set RuntimeSnapshots (disabled cache, never nil)")
	}
	if app.RuntimeSnapshots.Len() != 0 {
		t.Fatalf("fresh snapshot cache must be empty")
	}
	if app.RuntimeLockerFor() == nil {
		t.Fatalf("RuntimeLockerFor must never return nil")
	}

	cfg2 := config.Load()
	cfg2.RuntimeSnapshotEnabled = true
	app2 := BuildApp(cfg2, nil)
	if app2.RuntimeSnapshots == nil {
		t.Fatalf("BuildApp must set RuntimeSnapshots when enabled")
	}
}

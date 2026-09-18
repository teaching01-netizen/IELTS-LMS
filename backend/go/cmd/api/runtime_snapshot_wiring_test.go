package main

import (
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/runtime"
)

// WS-16: BuildApp runtime wiring. RUNTIME_SNAPSHOT chooses the LOCKING of the V2
// write gate, not its authority: both lockers read current runtime state on the
// writing transaction. The SnapshotCache stays wired (always non-nil) because it
// serves student runtime polls, and it is deliberately not consulted by the
// write gate — a cached view must never authorize a write.
// Load-bearing lines: main.go RuntimeSnapshots wiring +
// RuntimeLockerFor Config.RuntimeSnapshotEnabled branch.
func TestBuildAppRuntimeSnapshotWiring(t *testing.T) {
	now := time.Now().UTC()
	live := "live"
	seedLive := func(c *runtime.SnapshotCache) {
		if _, err := c.Get("sched-1", now, func() (runtime.Snapshot, error) {
			return runtime.Snapshot{Status: runtime.StatusLive, ActiveSectionKey: &live, Revision: 1, TimingModel: "legacy_section_v1", SectionLive: true, SectionStarted: true, LoadedAt: now}, nil
		}); err != nil {
			t.Fatal(err)
		}
	}

	cfg := config.Load()
	cfg.RuntimeSnapshotEnabled = false
	off := BuildApp(cfg, nil)
	if off.RuntimeSnapshots == nil {
		t.Fatalf("BuildApp must always set RuntimeSnapshots (disabled cache, never nil)")
	}
	if _, ok := off.RuntimeLockerFor().(v2Locker); !ok {
		t.Fatalf("snapshot-off must route through v2Locker (legacy FOR UPDATE path), got %T", off.RuntimeLockerFor())
	}

	pool, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pool.Close() }()
	cfg2 := config.Load()
	cfg2.RuntimeSnapshotEnabled = true
	on := BuildApp(cfg2, pool)
	if on.RuntimeSnapshots == nil {
		t.Fatalf("BuildApp must set RuntimeSnapshots when enabled")
	}
	if _, ok := on.RuntimeLockerFor().(snapshotLocker); !ok {
		t.Fatalf("snapshot-on with pool must route through snapshotLocker, got %T", on.RuntimeLockerFor())
	}
	// The cache remains available to the poll path (one TTL view per schedule).
	seedLive(on.RuntimeSnapshots)
	if got := on.RuntimeSnapshots.Len(); got != 1 {
		t.Fatalf("seeded snapshot cache must hold 1 entry, got %d", got)
	}
}

package main

// Plan E3/§7: pool waits split API/worker. The worker pool (RoleWorker)
// reports its Stats() every hot cycle via db.ReportPoolStats — the
// worker-side half of the split. observeWorkerPoolStats is the seam:
// nil-safe (tests + early boot), role-pinned to worker. RED: emits.
import (
	"database/sql"
	"testing"

	"example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

type statsDB interface{ Stats() sql.DBStats }

func TestObserveWorkerPoolStatsEmits(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	observeWorkerPoolStats(nil)
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolOpen, "role", "worker"); got != 0 {
		t.Fatalf("nil pool must not emit, got %v", got)
	}
	observeWorkerPoolStats(sqlStatsFunc(func() sql.DBStats {
		return sql.DBStats{OpenConnections: 10, InUse: 4, WaitCount: 7}
	}))
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolOpen, "role", "worker"); got != 10 {
		t.Fatalf("worker pool open must be 10, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolWait, "role", "worker"); got != 7 {
		t.Fatalf("worker pool wait must be 7, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolOpen, "role", "api"); got != 0 {
		t.Fatalf("api series must be untouched, got %v", got)
	}
	var _ statsDB = (*sql.DB)(nil)
	_ = db.RoleWorker
}

type sqlStatsFunc func() sql.DBStats

func (f sqlStatsFunc) Stats() sql.DBStats { return f() }

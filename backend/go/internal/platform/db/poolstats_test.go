package db

// Plan E3 dashboards + §7 baseline item 4: pool waits split API/worker.
// database/sql exposes Stats() with zero new deps; ReportPoolStats maps
// one snapshot to the three pool gauges with a role label (api|worker so
// the split the plan requires is queryable). Pure function, no DB.
// RED: snapshot mapping + role label.
import (
	"database/sql"
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestReportPoolStats(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()
	st := sql.DBStats{OpenConnections: 17, InUse: 9, WaitCount: 42}
	ReportPoolStats(RoleAPI, st)
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolOpen, "role", "api"); got != 17 {
		t.Fatalf("pool open api must be 17, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolInUse, "role", "api"); got != 9 {
		t.Fatalf("pool in-use api must be 9, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolWait, "role", "api"); got != 42 {
		t.Fatalf("pool wait api must be 42, got %v", got)
	}
	ReportPoolStats(RoleWorker, st)
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolOpen, "role", "worker"); got != 17 {
		t.Fatalf("pool open worker must be 17, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolWait, "role", "api"); got != 42 {
		t.Fatalf("api series must be untouched by worker report, got %v", got)
	}
}

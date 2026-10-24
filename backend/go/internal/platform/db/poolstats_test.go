package db

// Plan E3 dashboards + §7 baseline item 4: pool waits split API/worker.
// database/sql exposes Stats() with zero new deps; ReportPoolStats maps
// one snapshot to the three pool gauges with a role label (api|worker so
// the split the plan requires is queryable). Pure function, no DB.
// RED: snapshot mapping + role label.
import (
	"database/sql"
	"strings"
	"testing"
	"time"

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
	full := sql.DBStats{MaxOpenConnections: 40, Idle: 3, WaitDuration: 1500 * time.Millisecond, MaxIdleClosed: 4, MaxIdleTimeClosed: 5, MaxLifetimeClosed: 6}
	ReportPoolStats(RoleAPI, full)
	for _, c := range []struct {
		name  string
		gauge bool
		want  float64
		extra []string
	}{
		{telemetry.MPoolIdle, true, 3, nil},
		{telemetry.MPoolMaxOpen, true, 40, nil},
		{telemetry.MPoolWaitSeconds, false, 1.5, nil},
		{telemetry.MPoolClosed, false, 4, []string{"reason", "max_idle"}},
		{telemetry.MPoolClosed, false, 5, []string{"reason", "max_idle_time"}},
		{telemetry.MPoolClosed, false, 6, []string{"reason", "max_lifetime"}},
	} {
		labels := append([]string{"role", "api"}, c.extra...)
		got := telemetry.CounterValueForTest(reg, c.name, labels...)
		if c.gauge {
			got = telemetry.GaugeValueForTest(reg, c.name, labels...)
		}
		if got != c.want {
			t.Fatalf("%s%v = %v, want %v", c.name, c.extra, got, c.want)
		}
	}
	snap := reg.Snapshot()
	for _, header := range []string{"# TYPE db_pool_wait_seconds_total counter", "# TYPE db_pool_closed_total counter", "# TYPE db_pool_idle gauge"} {
		if !strings.Contains(snap, header) {
			t.Fatalf("missing %q in:\n%s", header, snap)
		}
	}
	ReportPoolStats(RoleAPI, st)
	ReportPoolStats(RoleWorker, st)
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolOpen, "role", "worker"); got != 17 {
		t.Fatalf("pool open worker must be 17, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MPoolWait, "role", "api"); got != 42 {
		t.Fatalf("api series must be untouched by worker report, got %v", got)
	}
}

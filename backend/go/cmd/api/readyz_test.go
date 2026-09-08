package main

// Plan E1: the readiness probe must bound its DB waits. An unbounded
// PingContext/SchemaVersion under a wedged MySQL holds the probe (and the
// orchestrator's rollout decision) forever; a bounded probe fails fast so
// the platform restarts or reroutes instead of piling up.
import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestReadyzBoundsDBWaits(t *testing.T) {
	app := &App{DB: nil}
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	start := time.Now()
	readyz(app)(rec, req)
	if elapsed := time.Since(start); elapsed > 5*time.Second {
		t.Fatalf("readyz without DB must fail fast, took %v", elapsed)
	}
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz without DB must 503, got %d", rec.Code)
	}
}

// E-exam-day: a DB-less probe must NOT touch the pool gauges — absent
// stats are not zero stats, and emitting 0 would fake a healthy-idle pool
// on the dashboard during a real outage.
func TestReadyzNoDBEmitsNoPoolGauges(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	app := &App{DB: nil}
	req := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	rec := httptest.NewRecorder()
	readyz(app)(rec, req)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("readyz without DB must 503, got %d", rec.Code)
	}
	for _, m := range []string{telemetry.MPoolOpen, telemetry.MPoolInUse, telemetry.MPoolWait} {
		if got := telemetry.GaugeValueForTest(reg, m); got != 0 {
			t.Fatalf("pool gauge %s must stay absent without DB, got %v", m, got)
		}
	}
}

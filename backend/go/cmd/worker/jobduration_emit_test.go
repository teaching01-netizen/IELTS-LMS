package main

// Plan E-exam-day: every worker cycle must report its wall-clock duration
// on worker_job_duration_seconds{job} — the stalled-worker signal. The
// helper runs on defer so every return path reports. RED: observe emits.
import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestObserveJobDurationEmits(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	observeJobDuration("hot", time.Now().Add(-1500*time.Millisecond))
	if got := telemetry.GaugeValueForTest(reg, telemetry.MJobDuration, "job", "hot"); got < 1.4 || got > 30 {
		t.Fatalf("hot duration gauge must be ~1.5s, got %v", got)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MJobDuration, "job", "slow"); got != 0 {
		t.Fatalf("unrun job must be absent, got %v", got)
	}
}

package main

// Plan D3/E-exam-day: the entry-gate dashboard slice (admit vs queued)
// is the operator's entry-wave signal. Admits and queues must count on
// their own series — a wave that queues 4k behind the gate must not look
// like 5k clean admits. RED: admit + queued counters track Allow().
import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestEntryGateEmitsAdmitAndQueued(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	g := newEntryGate(entryGateConfig{PerSec: 10, Burst: 2})
	now := time.Now()
	if !g.Allow("sched-1", now).Allowed {
		t.Fatalf("token 1 must admit")
	}
	if !g.Allow("sched-1", now).Allowed {
		t.Fatalf("token 2 must admit")
	}
	if g.Allow("sched-1", now).Allowed {
		t.Fatalf("over-burst must queue")
	}
	if g.Allow("sched-1", now).Allowed {
		t.Fatalf("still over-burst must queue")
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MEntryGateAdmit); got != 2 {
		t.Fatalf("admit counter must be 2, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MEntryGateQueued); got != 2 {
		t.Fatalf("queued counter must be 2, got %v", got)
	}
}

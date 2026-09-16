package main

// Plan D3/E-exam-day: the entry-gate dashboard slice (admit vs bounded retry)
// is the operator's entry-wave signal. Admits and bounded retries must count on
// their own series — a wave that sheds 4k behind the gate must not look
// like 5k clean admits. RED: admit + retry counters track Allow().
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
		t.Fatalf("over-burst must return bounded retry")
	}
	if g.Allow("sched-1", now).Allowed {
		t.Fatalf("still over-burst must return bounded retry")
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MEntryGateAdmit); got != 2 {
		t.Fatalf("admit counter must be 2, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MEntryGateQueued); got != 2 {
		t.Fatalf("queued counter must be 2, got %v", got)
	}

	capacityGate := newEntryGate(entryGateConfig{PerSec: 10, Burst: 1, MaxSchedules: 1})
	if !capacityGate.Allow("active", now).Allowed {
		t.Fatalf("capacity fixture's first schedule must admit")
	}
	if result := capacityGate.Allow("new", now); result.Allowed || !result.CapacityLimited {
		t.Fatalf("capacity fixture must reject the new schedule: %+v", result)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MEntryGateCapacityTotal, "tier", "student-entry", "key_class", "schedule"); got != 1 {
		t.Fatalf("capacity counter must be 1, got %v", got)
	}
}

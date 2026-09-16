package main

import (
	"testing"
	"time"
)

// D3: fresh gate admits up to burst, then 429s with honest retryAfter.
func TestEntryGateBurstThen429(t *testing.T) {
	g := newEntryGate(entryGateConfig{PerSec: 10, Burst: 3})
	for i := 0; i < 3; i++ {
		if res := g.Allow("sched-1", time.Now()); !res.Allowed {
			t.Fatalf("burst token %d must admit", i)
		}
	}
	now := time.Now()
	res := g.Allow("sched-1", now)
	if res.Allowed {
		t.Fatalf("over-burst must 429")
	}
	if res.RetryAfterSecs < 1 {
		t.Fatalf("retryAfter must be honest (>=1s at 10/s), got %d", res.RetryAfterSecs)
	}
	if res.CapacityLimited {
		t.Fatal("token exhaustion must not be reported as schedule-capacity exhaustion")
	}
}

// D3 RED: refill over time readmits (token bucket, not fixed window).
func TestEntryGateRefills(t *testing.T) {
	g := newEntryGate(entryGateConfig{PerSec: 10, Burst: 1})
	start := time.Now()
	if !g.Allow("sched-1", start).Allowed {
		t.Fatalf("must admit")
	}
	if g.Allow("sched-1", start).Allowed {
		t.Fatalf("must 429 immediately")
	}
	if !g.Allow("sched-1", start.Add(200*time.Millisecond)).Allowed {
		t.Fatalf("10/s refills 2 tokens in 200ms; must admit")
	}
}

// D3 RED: per-schedule isolation (one hot schedule doesn't starve others).
func TestEntryGateIsolation(t *testing.T) {
	g := newEntryGate(entryGateConfig{PerSec: 1, Burst: 1})
	now := time.Now()
	if !g.Allow("hot", now).Allowed {
		t.Fatalf("must admit")
	}
	if g.Allow("hot", now).Allowed {
		t.Fatalf("hot must 429")
	}
	if !g.Allow("cold", now).Allowed {
		t.Fatalf("cold schedule must admit")
	}
}

func TestEntryGateCapacityRejectsWithoutCreatingActiveSchedule(t *testing.T) {
	g := newEntryGate(entryGateConfig{PerSec: 10, Burst: 1, MaxSchedules: 1})
	now := time.Now()
	if !g.Allow("hot", now).Allowed {
		t.Fatal("first schedule must admit")
	}

	res := g.Allow("cold", now)
	if res.Allowed || !res.CapacityLimited {
		t.Fatalf("active schedule cap must reject as capacity-limited: %+v", res)
	}
	if res.RetryAfterSecs < 1 {
		t.Fatalf("capacity rejection must be retryable, got %d seconds", res.RetryAfterSecs)
	}
	if len(g.buckets) != 1 {
		t.Fatalf("capacity rejection must not create a schedule entry, entries=%d", len(g.buckets))
	}
}

func TestEntryGateEvictsIdleScheduleBeforeRejectingCapacity(t *testing.T) {
	g := newEntryGate(entryGateConfig{PerSec: 10, Burst: 1, MaxSchedules: 1, IdleAfter: time.Second})
	start := time.Now()
	if !g.Allow("old", start).Allowed {
		t.Fatal("old schedule must admit")
	}

	if res := g.Allow("new", start.Add(2*time.Second)); !res.Allowed {
		t.Fatalf("idle schedule must be evicted so new schedule can admit: %+v", res)
	}
	if len(g.buckets) != 1 {
		t.Fatalf("idle eviction must preserve the schedule cap, entries=%d", len(g.buckets))
	}
}

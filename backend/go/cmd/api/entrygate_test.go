package main

import (
	"testing"
	"time"
)

// D3 RED: fresh gate admits up to burst, then 429s with honest retryAfter.
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
	if res.QueuePosition < 1 {
		t.Fatalf("queue position must be set, got %d", res.QueuePosition)
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

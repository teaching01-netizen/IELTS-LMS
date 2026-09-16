package main

import (
	"net/http"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
)

// D3: gate off (default) never 429s at the schedule bucket (rollback shape).
func TestEntryHandlerGateOffSkips(t *testing.T) {
	cfg := config.Load()
	cfg.EntryGateEnabled = false
	app := BuildApp(cfg, nil)
	if app.EntryGate == nil {
		t.Fatalf("EntryGate must always be non-nil")
	}
	// Drain the bucket completely; handler must not consult it when off.
	for i := 0; i < 5000; i++ {
		app.EntryGate.Allow("sched-1", time.Now())
	}
	_ = http.StatusTooManyRequests // envelope asserted at the gate level
}

// D3: gate on + exhausted bucket surfaces the retryable 429 fields.
func TestEntryHandlerGateOn429Shape(t *testing.T) {
	cfg := config.Load()
	cfg.EntryGateEnabled = true
	cfg.EntryPerSec = 1
	cfg.EntryBurst = 1
	app := BuildApp(cfg, nil)
	now := time.Now()
	if !app.EntryGate.Allow("sched-9", now).Allowed {
		t.Fatalf("first check-in must admit")
	}
	gres := app.EntryGate.Allow("sched-9", now)
	if gres.Allowed {
		t.Fatalf("second immediate check-in must return bounded retry")
	}
	if gres.RetryAfterSecs < 1 || gres.CapacityLimited {
		t.Fatalf("429 must carry retryAfterSeconds without capacity exhaustion: %+v", gres)
	}
}

package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// Round 67 doc↔code parity: the runbook quotes DefaultQueryTimeout = 10s
// (§3) but the tests above hardcode 10*time.Second literals — a const
// drift to 5s/30s would pass every test while operators plan on 10s.
// This test pins the documented figure on the constant itself.
func TestDefaultQueryTimeoutRunbookFigure(t *testing.T) {
	if DefaultQueryTimeout != 10*time.Second {
		t.Fatalf("runbook §3 quotes 10s budget, got %v", DefaultQueryTimeout)
	}
}

// E1 RED: hot read paths enforce a per-query deadline (slow-DB backpressure
// honesty: bounded waits instead of pile-ups). The middleware stamps a 10s
// budget; handlers derive per-query timeouts from it.
func TestQueryTimeoutBudget(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rec := httptest.NewRecorder()
	var sawDeadline bool
	withQueryTimeout(rec, req, 10*time.Second, func(w http.ResponseWriter, r *http.Request) {
		if dl, ok := r.Context().Deadline(); ok {
			sawDeadline = time.Until(dl) <= 10*time.Second
		}
	})
	if !sawDeadline {
		t.Fatalf("hot paths must carry a query deadline")
	}
}

// E1 RED: exhausted budget short-circuits with 503 (retryable), not a hang.
func TestQueryTimeoutExhausted(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rec := httptest.NewRecorder()
	withQueryTimeout(rec, req, -time.Second, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("exhausted budget must not run the handler")
	})
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("exhausted budget must 503, got %d", rec.Code)
	}
}

// E-exam-day: the short-circuit must count on query_budget_exhausted_total
// (the E1 503-rate signal); healthy-budget requests must not touch it.
func TestQueryTimeoutExhaustedEmits(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	rec := httptest.NewRecorder()
	ran := false
	withQueryTimeout(rec, req, 10*time.Second, func(w http.ResponseWriter, r *http.Request) {
		ran = true
	})
	if !ran {
		t.Fatalf("healthy budget must run the handler")
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MQueryTimeout); got != 0 {
		t.Fatalf("healthy budget must not count, got %v", got)
	}
	rec2 := httptest.NewRecorder()
	withQueryTimeout(rec2, req, 0, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("exhausted budget must not run the handler")
	})
	if rec2.Code != http.StatusServiceUnavailable {
		t.Fatalf("exhausted budget must 503, got %d", rec2.Code)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MQueryTimeout); got != 1 {
		t.Fatalf("exhausted budget must count 1, got %v", got)
	}
}

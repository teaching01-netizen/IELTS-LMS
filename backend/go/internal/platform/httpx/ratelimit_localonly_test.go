package httpx

import (
	"net/http"
	"testing"
	"time"
)

// A1 RED: local-only TierSet performs zero distributed verdicts.
func TestTierLocalOnlyZeroDBCalls(t *testing.T) {
	db := &countingDBChecker{allow: true}
	ts := NewTierSet(
		map[string]TierBudget{TierWrites: {PerMin: 1000, Window: time.Minute}},
		map[string]DBChecker{TierWrites: db.check},
		100,
	)
	ts.SetLocalOnly(true)
	h := ts.Middleware(TierWrites, func(r *http.Request) string { return "k" })(okTierHandler())
	for i := 0; i < 10; i++ {
		if rec := doTierRequest(h, "POST", "/w"); rec.Code != 200 {
			t.Fatalf("request %d must pass in local-only mode, got %d", i, rec.Code)
		}
	}
	if db.calls != 0 {
		t.Fatalf("local-only mode must produce zero DB verdicts, got %d", db.calls)
	}
}

// A1 RED: local-only still sheds floods via the prefilter.
func TestTierLocalOnlyStillShedsFlood(t *testing.T) {
	ts := NewTierSet(
		map[string]TierBudget{TierWrites: {PerMin: 2, Window: time.Minute}},
		nil,
		100,
	)
	ts.SetLocalOnly(true)
	h := ts.Middleware(TierWrites, func(r *http.Request) string { return "k" })(okTierHandler())
	seen429 := false
	for i := 0; i < 10; i++ {
		if rec := doTierRequest(h, "POST", "/w"); rec.Code == 429 {
			seen429 = true
			break
		}
	}
	if !seen429 {
		t.Fatalf("local-only tier must still shed floods with 429")
	}
}

// A1: local-only is an exact single-process limiter, not the dual-mode flood
// prefilter.
func TestTierLocalOnlyUsesConfiguredBudget(t *testing.T) {
	tiers := NewTierSet(
		map[string]TierBudget{TierWrites: {PerMin: 2, Window: time.Minute}},
		nil,
		10,
	)
	tiers.SetLocalOnly(true)
	handler := tiers.Middleware(TierWrites, func(*http.Request) string {
		return "user:u1"
	})(okTierHandler())

	allowed := 0
	for i := 0; i < 5; i++ {
		if rec := doTierRequest(handler, "POST", "/writes"); rec.Code == http.StatusOK {
			allowed++
		}
	}
	if allowed != 2 {
		t.Fatalf("local mode must allow exactly PerMin requests, got %d", allowed)
	}
}

// A1 RED: DB deny is authoritative in dual (default), ignored in local-only.
func TestTierLocalOnlyIgnoresDBDeny(t *testing.T) {
	deny := &countingDBChecker{allow: false}
	dual := NewTierSet(
		map[string]TierBudget{TierPolling: {PerMin: 1000, Window: time.Minute}},
		map[string]DBChecker{TierPolling: deny.check},
		100,
	)
	if rec := doTierRequest(dual.Middleware(TierPolling, func(r *http.Request) string { return "k" })(okTierHandler()), "GET", "/p"); rec.Code != 429 {
		t.Fatalf("dual mode must honor DB deny, got %d", rec.Code)
	}
	allow := &countingDBChecker{allow: false}
	local := NewTierSet(
		map[string]TierBudget{TierPolling: {PerMin: 1000, Window: time.Minute}},
		map[string]DBChecker{TierPolling: allow.check},
		100,
	)
	local.SetLocalOnly(true)
	if rec := doTierRequest(local.Middleware(TierPolling, func(r *http.Request) string { return "k" })(okTierHandler()), "GET", "/p"); rec.Code != 200 {
		t.Fatalf("local-only must ignore DB deny (keeps local verdict), got %d", rec.Code)
	}
	if allow.calls != 0 {
		t.Fatalf("local-only must not call the DB checker, calls=%d", allow.calls)
	}
}

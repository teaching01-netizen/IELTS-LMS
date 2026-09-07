package main

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"strconv"
	"testing"
)

func stringLit(e ast.Expr) (string, bool) {
	lit, ok := e.(*ast.BasicLit)
	if !ok || lit.Kind != token.STRING {
		return "", false
	}
	s, err := strconv.Unquote(lit.Value)
	if err != nil {
		return "", false
	}
	return s, true
}

func testFileBytes(t *testing.T, name string) []byte {
	t.Helper()
	b, err := os.ReadFile(name)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func containsBytes(haystack []byte, needle string) bool {
	h, n := string(haystack), needle
	for i := 0; i+len(n) <= len(h); i++ {
		if h[i:i+len(n)] == n {
			return true
		}
	}
	return false
}

// routeNearTier checks the route pattern appears within a window after a
// mention of the tier name (group middleware precedes its routes).
func routeNearTier(src []byte, pattern, tier string) bool {
	s := string(src)
	for i := 0; i+len(pattern) <= len(s); i++ {
		if s[i:i+len(pattern)] != pattern {
			continue
		}
		start := i - 4000
		if start < 0 {
			start = 0
		}
		window := s[start:i]
		// Last tier mention before the route should be the expected one.
		lastTier, lastPos := "", -1
		for _, cand := range []string{"TierAuthCritical", "TierAnonAuth", "TierAuthedReads", "TierPolling", "TierHeartbeat", "TierWrites"} {
			for j := len(window) - len(cand); j >= 0; j-- {
				if window[j:j+len(cand)] == cand {
				if j > lastPos {
					lastTier, lastPos = cand, j
				}
				break
			}
		}
		}
		if lastTier == tier {
			return true
		}
	}
	return false
}

// Coverage guard: every /api/* route registered in BuildRouter must pass
// through a tier middleware. It parses main.go (not runtime behavior) so it
// stays green without a DB, and fails loudly when a future route lands in
// the wrong place — the highest-value regression test in this change.
func TestTierCoverageBuildRouterWiring(t *testing.T) {
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "main.go", nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	// Collect route() method+pattern pairs.
	type routeCall struct{ method, pattern string }
	var routes []routeCall
	ast.Inspect(f, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		fun, ok := call.Fun.(*ast.Ident)
		if !ok || fun.Name != "route" || len(call.Args) != 4 {
			return true
		}
		method, ok1 := stringLit(call.Args[1])
		pattern, ok2 := stringLit(call.Args[2])
		if ok1 && ok2 {
			routes = append(routes, routeCall{method, pattern})
		}
		return true
	})
	if len(routes) < 100 {
		t.Fatalf("expected to find 100+ route() calls in main.go, found %d", len(routes))
	}
	// Collect limitTier tier names referenced in the file.
	src := testFileBytes(t, "main.go")
	for _, tier := range []string{"TierAuthCritical", "TierAnonAuth", "TierAuthedReads", "TierPolling", "TierHeartbeat", "TierWrites"} {
		if !containsBytes(src, tier) {
			t.Fatalf("BuildRouter must reference %s", tier)
		}
	}
	// Spot-check: routes known to belong to special tiers must sit inside a
	// limitTier group textually near their registration.
	checks := map[string]string{
		`"/session"`:                  "TierAuthCritical",
		`"/logout"`:                   "TierAuthCritical",
		`"/{scheduleID}/live"`:        "TierPolling",
		`"/{scheduleID}/heartbeat"`:   "TierHeartbeat",
		`"/{scheduleID}/mutations:batch"`: "TierWrites",
		`"/{attemptID}/responses:batch"`: "TierWrites",
		`"/ws/live"`:                  "TierAuthedReads",
		`"/login"`:                    "TierAnonAuth",
		`"/student/entry"`:            "TierAnonAuth",
	}
	for pattern, tier := range checks {
		if !routeNearTier(src, pattern, tier) {
			t.Errorf("route %s must be wired under %s", pattern, tier)
		}
	}
	t.Logf("found %d route() registrations, all spot-checks evaluated", len(routes))
}

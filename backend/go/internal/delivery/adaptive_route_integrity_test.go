package delivery

// SAT adaptive routing integrity (route decision -> module attempt).
//
// The router records one decision per section (assessment_route_decisions:
// selected_route + selected_module_id) and then opens exactly that module. From
// there the identity must never be re-derived: the module attempt, the student
// bootstrap, the runner, the staff roster and the final result all read the same
// module id. These tests pin the last-line fence that refuses to open a module
// the decision did not select — the case no scoring or caching fix can make
// safe, because at that point the authored tree and the decision row describe
// two different Module 2s.

import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestAdaptiveRoleMatchesRoute(t *testing.T) {
	cases := []struct {
		adaptiveRole string
		route        string
		want         bool
	}{
		{"higher_branch", "higher", true},
		{"lower_branch", "lower", true},
		// The inverted pair is exactly the corruption this fence exists for.
		{"lower_branch", "higher", false},
		{"higher_branch", "lower", false},
		{"base", "higher", false},
		{"base", "lower", false},
		// A decision the authored tree cannot represent is itself a violation.
		{"higher_branch", "unexpected", false},
		{"", "higher", false},
	}
	for _, tc := range cases {
		if got := adaptiveRoleMatchesRoute(tc.adaptiveRole, tc.route); got != tc.want {
			t.Errorf("adaptiveRoleMatchesRoute(%q, %q) = %v, want %v", tc.adaptiveRole, tc.route, got, tc.want)
		}
	}
}

func TestAssertAdaptiveRouteIntegrityAcceptsMatchingRoute(t *testing.T) {
	module := &nextModuleRow{id: "HIGH-ID", moduleKey: "rw-m2-higher", adaptiveRole: "higher_branch"}
	if err := assertAdaptiveRouteIntegrity(context.Background(), "att-1", "sec-rw", "higher", "HIGH-ID", module); err != nil {
		t.Fatalf("the recorded decision must open its own module: %v", err)
	}
}

func TestAssertAdaptiveRouteIntegrityRefusesAnUnselectedModule(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	// The decision selected HIGH-ID; the tree hands back the LOWER module.
	module := &nextModuleRow{id: "LOW-ID", moduleKey: "rw-m2-lower", adaptiveRole: "lower_branch"}
	err := assertAdaptiveRouteIntegrity(context.Background(), "att-1", "sec-rw", "higher", "HIGH-ID", module)
	if err == nil {
		t.Fatal("a module that is not the recorded selection must fail closed")
	}
	typed, ok := err.(*apperrors.Error)
	if !ok {
		t.Fatalf("the refusal must be a typed app error, got %T", err)
	}
	if typed.Code != apperrors.CodeAssessmentConflict {
		t.Fatalf("code = %q, want %q", typed.Code, apperrors.CodeAssessmentConflict)
	}
	details := typed.Details
	if details == nil {
		t.Fatalf("details must be structured for operators, got %#v", typed.Details)
	}
	if details["reason"] != "SAT_ADAPTIVE_ROUTE_INTEGRITY" {
		t.Fatalf("reason = %v, want SAT_ADAPTIVE_ROUTE_INTEGRITY", details["reason"])
	}
	// Identities only — the payload must never carry a candidate answer.
	if details["selectedModuleId"] != "HIGH-ID" || details["actualModuleId"] != "LOW-ID" {
		t.Fatalf("details must name both module ids, got %#v", details)
	}
	if _, leaks := details["response"]; leaks {
		t.Fatalf("integrity details must not carry answers: %#v", details)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATAdaptiveIntegrityViolation, "reason", "route_module_mismatch"); got != 1 {
		t.Fatalf("integrity violation counter = %v, want 1", got)
	}
}

func TestAssertAdaptiveRouteIntegrityRefusesARoleRouteMismatch(t *testing.T) {
	// Same module id, wrong authored slot: the decision says higher, the module
	// the tree holds at that id is the lower branch.
	module := &nextModuleRow{id: "M2-ID", moduleKey: "rw-m2", adaptiveRole: "lower_branch"}
	if err := assertAdaptiveRouteIntegrity(context.Background(), "att-1", "sec-rw", "higher", "M2-ID", module); err == nil {
		t.Fatal("a role that contradicts the recorded route must fail closed")
	}
	// And a missing row (the selected module is not in the tree at all).
	if err := assertAdaptiveRouteIntegrity(context.Background(), "att-1", "sec-rw", "lower", "LOW-ID", nil); err == nil {
		t.Fatal("a missing selected module must fail closed")
	}
}

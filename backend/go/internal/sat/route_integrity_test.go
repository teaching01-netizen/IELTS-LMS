package sat

import (
	"context"
	"testing"
)

func TestAssertResultRouteIntegrity(t *testing.T) {
	higher := "higher"
	sections := map[string]*resultAccum{
		"reading-writing": {route: &higher, branchModuleID: "mod-higher"},
	}
	decisions := map[string]routeDecision{
		"reading-writing": {SelectedModuleID: "mod-higher", SelectedRoute: "higher"},
	}
	if err := assertResultRouteIntegrity(context.Background(), "att-1", decisions, sections); err != nil {
		t.Fatalf("matching decision must pass, got %v", err)
	}
	for _, wrong := range []map[string]routeDecision{
		{"reading-writing": {SelectedModuleID: "mod-lower", SelectedRoute: "higher"}},
		{"reading-writing": {SelectedModuleID: "mod-higher", SelectedRoute: "lower"}},
		{},
	} {
		if err := assertResultRouteIntegrity(context.Background(), "att-1", wrong, sections); err == nil {
			t.Fatal("a mismatched or missing decision must fail")
		}
	}
	if err := assertResultRouteIntegrity(context.Background(), "att-1", map[string]routeDecision{}, map[string]*resultAccum{"math": {}}); err != nil {
		t.Fatalf("branchless section must pass, got %v", err)
	}
}

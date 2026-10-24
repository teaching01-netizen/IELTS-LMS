package delivery

import (
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestSATRecoveryMetricsRecordCommittedTransitionsAndBoundedResolutionLabels(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	cutoff := time.Date(2026, 10, 21, 12, 0, 0, 0, time.UTC)
	recordSATRecoveryBoundaryTransition(satBoundaryTransition{from: "working", to: "collecting"})
	recordSATRecoveryBoundaryTransition(satBoundaryTransition{from: "collecting", to: "settled"})
	recordSATRecoveryBoundaryTransition(satBoundaryTransition{from: "collecting", to: "blocked"})
	recordSATRecoveryBoundaryTransition(satBoundaryTransition{from: "preparing", to: "blocked"})
	recordSATRecoveryBoundaryTransition(satBoundaryTransition{from: "unknown", to: "settled"})
	recordSATRecoveryRegistration("registered")
	recordSATRecoveryRegistration("replayed")
	recordSATRecoveryRegistration("expired")
	recordSATRecoveryResolution(&SATRecoveryResolutionReceipt{
		ResolutionID: "private-resolution-id", Action: "continue_confirmed", ActorType: "staff",
		ResolvedAt: cutoff.Add(17 * time.Second),
	}, &cutoff)
	recordSATRecoveryResolution(&SATRecoveryResolutionReceipt{
		ResolutionID: "private-resolution-id", Action: "continue_confirmed", ActorType: "staff",
		ResolvedAt: cutoff.Add(17 * time.Second), Replayed: true,
	}, &cutoff)

	snapshot := reg.Snapshot()
	for _, expected := range []string{
		`sat_recovery_boundary_total{event="opened"} 1`,
		`sat_recovery_boundary_total{event="settled"} 1`,
		`sat_recovery_boundary_total{event="expired"} 1`,
		`sat_recovery_boundary_total{event="entry_expired"} 1`,
		`sat_recovery_registration_total{outcome="registered"} 1`,
		`sat_recovery_registration_total{outcome="replayed"} 1`,
		`sat_recovery_registration_total{outcome="expired"} 1`,
		`sat_recovery_resolution_total{action="continue_confirmed",actor="staff",outcome="committed"} 1`,
		`sat_recovery_resolution_total{action="continue_confirmed",actor="staff",outcome="replayed"} 1`,
		`sat_recovery_exception_age_seconds_count{action="continue_confirmed",actor="staff"} 1`,
		`sat_recovery_exception_age_seconds_sum{action="continue_confirmed",actor="staff"} 17`,
	} {
		if !strings.Contains(snapshot, expected) {
			t.Fatalf("missing %q from metrics:\n%s", expected, snapshot)
		}
	}
	if strings.Contains(snapshot, "private-resolution-id") {
		t.Fatalf("resolution identifiers must not become metric labels:\n%s", snapshot)
	}
}

func TestSATRecoveryResolutionMetricsClampUntrustedLabels(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	recordSATRecoveryResolution(&SATRecoveryResolutionReceipt{
		Action: "untrusted-action", ActorType: "untrusted-actor",
		ResolvedAt: time.Now().UTC(),
	}, nil)
	snapshot := reg.Snapshot()
	if !strings.Contains(snapshot, `sat_recovery_resolution_total{action="other",actor="other",outcome="committed"} 1`) {
		t.Fatalf("unexpected resolution labels:\n%s", snapshot)
	}
}

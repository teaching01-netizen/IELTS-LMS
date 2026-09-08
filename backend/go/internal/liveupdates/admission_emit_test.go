package liveupdates

// Plan E-exam-day: the staff-WS admission slice (lease failures by cap
// reason) is the operator's soak signal. Each rejecting cap counts its
// own reason series; admits count nothing on the failure series. RED:
// Acquire emits MWSLeaseFailures exactly per rejection.
import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestAdmissionEmitsLeaseFailures(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	a := NewAdmission(AdmissionCaps{Total: 2, PerUser: 1, PerSchedule: 2, TTL: time.Minute})
	defer a.Stop()
	if _, ok, _ := a.Acquire("u1", strptr("s1")); !ok {
		t.Fatalf("first must admit")
	}
	if _, ok, reason := a.Acquire("u1", strptr("s1")); ok || reason != "user_cap" {
		t.Fatalf("must hit user_cap, got ok=%v reason=%q", ok, reason)
	}
	if _, ok, _ := a.Acquire("u2", strptr("s1")); !ok {
		t.Fatalf("u2 must admit")
	}
	if _, ok, reason := a.Acquire("u3", strptr("s2")); ok || reason != "total_cap" {
		t.Fatalf("must hit total_cap, got ok=%v reason=%q", ok, reason)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MWSLeaseFailures, "reason", "user_cap"); got != 1 {
		t.Fatalf("user_cap must count 1, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MWSLeaseFailures, "reason", "total_cap"); got != 1 {
		t.Fatalf("total_cap must count 1, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MWSLeaseFailures, "reason", "schedule_cap"); got != 0 {
		t.Fatalf("schedule_cap must be 0, got %v", got)
	}

	a2 := NewAdmission(AdmissionCaps{Total: 100, PerUser: 100, PerSchedule: 1, TTL: time.Minute})
	defer a2.Stop()
	if _, ok, _ := a2.Acquire("u1", strptr("s1")); !ok {
		t.Fatalf("a2 first must admit")
	}
	if _, ok, reason := a2.Acquire("u2", strptr("s1")); ok || reason != "schedule_cap" {
		t.Fatalf("must hit schedule_cap, got ok=%v reason=%q", ok, reason)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MWSLeaseFailures, "reason", "schedule_cap"); got != 1 {
		t.Fatalf("schedule_cap must count 1, got %v", got)
	}
}

package outbox

import (
	"testing"
)

// B4 RED: SkipEnqueue tells call sites whether to skip the INSERT under
// exec-only mode. Executable families never skip; wakeup families skip only
// when execOnly is on; unknown families never skip (fail open for future
// executable families — they must be claimed, never silently dropped).
func TestSkipEnqueueMatrix(t *testing.T) {
	if SkipEnqueue(FamilyAutoSubmitScheduleAttempts, false) {
		t.Fatalf("executable must enqueue when flag off")
	}
	if SkipEnqueue(FamilyAutoSubmitScheduleAttempts, true) {
		t.Fatalf("executable must enqueue when flag on")
	}
	for _, f := range []string{FamilyAttemptTerminalized, FamilyRuntimeChanged, FamilyRosterChanged, "attempt_changed"} {
		if SkipEnqueue(f, false) {
			t.Fatalf("wakeup %q must enqueue when flag off", f)
		}
		if !SkipEnqueue(f, true) {
			t.Fatalf("wakeup %q must skip when flag on", f)
		}
	}
	if SkipEnqueue("future_executable_family", true) {
		t.Fatalf("unknown families must not skip (fail open)")
	}
}

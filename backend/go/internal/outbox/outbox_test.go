package outbox

import (
	"testing"
	"time"
)

// Worker retry contract (plan 55-62, worker-backlog runbook): attempts
// 1..7 back off as 5s*2^(n-1) capped at 300s; attempt 8 and beyond is
// terminal. Only the auto-submit family executes application work; the
// rest are wakeup notifications the worker acks.
func TestBackoffForMatrix(t *testing.T) {
	cases := []struct {
		attempts  int
		disp      RetryDisposition
		wantDelay time.Duration
	}{
		{0, RetryAfter, 5 * time.Second},
		{1, RetryAfter, 5 * time.Second},
		{2, RetryAfter, 10 * time.Second},
		{3, RetryAfter, 20 * time.Second},
		{4, RetryAfter, 40 * time.Second},
		{5, RetryAfter, 80 * time.Second},
		{6, RetryAfter, 160 * time.Second},
		{7, RetryAfter, 300 * time.Second},
		{8, Terminal, 0},
		{9, Terminal, 0},
		{100, Terminal, 0},
	}
	for _, c := range cases {
		disp, delay := BackoffFor(c.attempts)
		if disp != c.disp || delay != c.wantDelay {
			t.Fatalf("BackoffFor(%d) = (%v, %v) want (%v, %v)", c.attempts, disp, delay, c.disp, c.wantDelay)
		}
	}
}

func TestIsExecutableMatrix(t *testing.T) {
	if !IsExecutable(FamilyAutoSubmitScheduleAttempts) {
		t.Fatal("auto-submit family must execute")
	}
	for _, f := range []string{FamilyAttemptTerminalized, FamilyRuntimeChanged, FamilyRosterChanged, "unknown"} {
		if IsExecutable(f) {
			t.Fatalf("family %q must be wakeup-only", f)
		}
	}
}

func TestWorkerTunables(t *testing.T) {
	if ClaimLimit != 100 || ClaimLeaseSecs != 60 || MaxAttempts != 8 || BaseBackoffSecs != 5 || MaxBackoffSecs != 300 || PurgeAfterHours != 72 {
		t.Fatalf("worker tunables drifted: %+v", []int{ClaimLimit, ClaimLeaseSecs, MaxAttempts, BaseBackoffSecs, MaxBackoffSecs, PurgeAfterHours})
	}
}

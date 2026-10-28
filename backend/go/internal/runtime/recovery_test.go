package runtime

import (
	"errors"
	"testing"
	"time"
)

func TestPlanRecoveryClockRetainsOriginalDeadlineExactly(t *testing.T) {
	now := time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)
	deadline := now.Add(2*time.Minute + 500*time.Millisecond)
	plan, err := PlanRecoveryClock(now, &deadline, nil)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if !plan.DeadlineAt.Equal(deadline) {
		t.Fatalf("deadline = %v, want exactly %v", plan.DeadlineAt, deadline)
	}
	if plan.AwardedSeconds != nil {
		t.Fatalf("no override must not report an award: %v", *plan.AwardedSeconds)
	}
}

func TestPlanRecoveryClockRetainsDeadlineAfterDisplayRounding(t *testing.T) {
	// A display of "2:50 remaining" is not authority. The planner must ignore
	// the caller's whole-second view and keep the stored instant.
	now := time.Date(2026, 10, 28, 9, 0, 0, 900_000_000, time.UTC)
	deadline := now.Add(170*time.Second + 100*time.Millisecond)
	plan, err := PlanRecoveryClock(now, &deadline, nil)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if !plan.DeadlineAt.Equal(deadline) {
		t.Fatalf("deadline = %v, want exactly %v", plan.DeadlineAt, deadline)
	}
}

func TestPlanRecoveryClockAwardStartsAtServerNow(t *testing.T) {
	now := time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)
	original := now.Add(-time.Minute) // already elapsed; an award reopens it
	seconds := 8 * 60
	plan, err := PlanRecoveryClock(now, &original, &seconds)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	want := now.Add(8 * time.Minute)
	if !plan.DeadlineAt.Equal(want) {
		t.Fatalf("deadline = %v, want %v", plan.DeadlineAt, want)
	}
	if plan.AwardedSeconds == nil || *plan.AwardedSeconds != seconds {
		t.Fatalf("award = %v, want %d", plan.AwardedSeconds, seconds)
	}
	// The returned pointer must not alias caller memory.
	seconds = 1
	if *plan.AwardedSeconds != 480 {
		t.Fatalf("plan award aliased caller input: %d", *plan.AwardedSeconds)
	}
}

func TestPlanRecoveryClockNormalizesToUTC(t *testing.T) {
	zone := time.FixedZone("Bangkok", 7*60*60)
	now := time.Date(2026, 10, 28, 16, 0, 0, 0, zone)
	seconds := 60
	plan, err := PlanRecoveryClock(now, nil, &seconds)
	if err != nil {
		t.Fatalf("plan: %v", err)
	}
	if plan.DeadlineAt.Location() != time.UTC {
		t.Fatalf("deadline location = %v, want UTC", plan.DeadlineAt.Location())
	}
	if want := now.UTC().Add(time.Minute); !plan.DeadlineAt.Equal(want) {
		t.Fatalf("deadline = %v, want %v", plan.DeadlineAt, want)
	}
}

func TestPlanRecoveryClockRequiresPositiveTimeWhenExpired(t *testing.T) {
	now := time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)
	past := now.Add(-time.Second)
	exact := now
	for _, deadline := range []*time.Time{&past, &exact, nil} {
		if _, err := PlanRecoveryClock(now, deadline, nil); !errors.Is(err, ErrRecoveryTimeRequired) {
			t.Fatalf("deadline %v: err = %v, want ErrRecoveryTimeRequired", deadline, err)
		}
	}
	zero := 0
	if _, err := PlanRecoveryClock(now, &past, &zero); !errors.Is(err, ErrRecoveryInvalidTime) {
		t.Fatalf("zero award err = %v, want ErrRecoveryInvalidTime", err)
	}
	if RecoveryReason(ErrRecoveryTimeRequired) != ReasonRecoveryTimeRequired {
		t.Fatal("time-required reason drifted")
	}
	if RecoveryReason(ErrRecoveryInvalidTime) != ReasonRecoveryInvalidTime {
		t.Fatal("invalid-time reason drifted")
	}
}

func TestPlanRecoveryClockAwardBounds(t *testing.T) {
	now := time.Now().UTC()
	for _, seconds := range []int{-1, 0, MaxRecoveryAwardSeconds + 1} {
		if _, err := PlanRecoveryClock(now, nil, &seconds); !errors.Is(err, ErrRecoveryInvalidTime) {
			t.Fatalf("seconds %d: err = %v, want ErrRecoveryInvalidTime", seconds, err)
		}
	}
	for _, seconds := range []int{1, MaxRecoveryAwardSeconds} {
		plan, err := PlanRecoveryClock(now, nil, &seconds)
		if err != nil {
			t.Fatalf("seconds %d: %v", seconds, err)
		}
		if want := now.Add(time.Duration(seconds) * time.Second); !plan.DeadlineAt.Equal(want) {
			t.Fatalf("seconds %d: deadline = %v, want %v", seconds, plan.DeadlineAt, want)
		}
	}
}

func TestRecoveryRemainingSecondsFloors(t *testing.T) {
	now := time.Date(2026, 10, 28, 9, 0, 0, 0, time.UTC)
	cases := []struct {
		deadline *time.Time
		want     int
	}{
		{nil, 0},
		{timePtr(now.Add(-time.Second)), 0},
		{timePtr(now), 0},
		{timePtr(now.Add(500 * time.Millisecond)), 0},
		{timePtr(now.Add(1500 * time.Millisecond)), 1},
		{timePtr(now.Add(14*time.Minute + 59*time.Second)), 899},
	}
	for _, tc := range cases {
		if got := RecoveryRemainingSeconds(now, tc.deadline); got != tc.want {
			t.Fatalf("remaining(%v) = %d, want %d", tc.deadline, got, tc.want)
		}
	}
}

func timePtr(t time.Time) *time.Time { return &t }

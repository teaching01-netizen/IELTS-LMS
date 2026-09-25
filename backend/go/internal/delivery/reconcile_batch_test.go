package delivery

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"
)

func TestReconcileTimeoutCandidateBatchContinuesAfterFailure(t *testing.T) {
	firstErr := errors.New("first attempt failed")
	var visited []string
	candidates := []timeoutCandidate{
		{attemptID: "att-bad", scheduleID: "sched-1"},
		{attemptID: "att-good", scheduleID: "sched-2"},
	}

	changed, err := reconcileTimeoutCandidateBatch(
		context.Background(), candidates, time.Now(),
		func(_ context.Context, scheduleID, attemptID string, _ time.Time) (bool, error) {
			visited = append(visited, scheduleID+":"+attemptID)
			if attemptID == "att-bad" {
				return false, firstErr
			}
			return true, nil
		},
	)
	if !errors.Is(err, firstErr) {
		t.Fatalf("batch error = %v, want first candidate error", err)
	}
	if changed != 1 {
		t.Fatalf("changed = %d, want healthy candidate counted", changed)
	}
	want := []string{"sched-1:att-bad", "sched-2:att-good"}
	if !reflect.DeepEqual(visited, want) {
		t.Fatalf("visited candidates = %v, want %v", visited, want)
	}
}

package main

// Plan E1 (round 153, TDD RED): the r152 entry rerun proved the auth-layer
// sites mapped, but 5 bare `context canceled` still mask as 500 on the
// entry path — a client gone inside CreateRegistration/CreateScheduleAttempt
// (tx begin/query, returned bare) escapes MapDBError because the entry
// handler never maps it. The handler must map client-gone to retryable
// 503 at the boundary, like every MapDBError call site.
import (
	"context"
	"errors"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func isRetryable503(err error) bool {
	appErr, ok := apperrors.As(err)
	return ok && appErr.Code == apperrors.CodeServiceUnavailable
}

func TestEntryMapsClientGoneToRetryable(t *testing.T) {
	if MapDBError(nil) != nil {
		t.Fatal("nil guard: MapDBError(nil) must stay nil")
	}
	err := MapDBError(context.Canceled)
	if err == nil || !isRetryable503(err) {
		t.Fatalf("client-gone must map to retryable 503, got: %v", err)
	}
	// Round 157: opaque driver string (identity lost, message intact —
	// the r155-r156 live shape) must map identically.
	err = MapDBError(errors.New("context canceled"))
	if err == nil || !isRetryable503(err) {
		t.Fatalf("opaque cancel string must map to retryable 503, got: %v", err)
	}
	if MapDBError(errors.New("boom")) == nil || MapDBError(errors.New("boom")).Error() != "boom" {
		t.Fatal("ordinary errors must pass through untouched")
	}
}

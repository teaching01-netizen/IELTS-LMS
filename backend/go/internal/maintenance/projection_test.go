package maintenance

// Plan E-exam-day: the grading-projection lag gauge input must be
// honest. Disabled projection reports zero work with zero lag (the
// worker skips the gauge write on disabled — no phantom lag). Enabled
// path computes lag from the checkpoint watermark. RED: disabled shape.
import (
	"context"
	"testing"
)

func TestProjectionDisabledReportsZero(t *testing.T) {
	rep, err := RunGradingProjection(context.Background(), nil, false)
	if err != nil {
		t.Fatalf("disabled projection: %v", err)
	}
	if rep.Enabled {
		t.Fatalf("disabled projection must report Enabled=false, got %+v", rep)
	}
	if rep.LagSeconds != 0 || rep.SchedulesSynced != 0 || rep.SubmissionsSynced != 0 {
		t.Fatalf("disabled projection must report zero work, got %+v", rep)
	}
}

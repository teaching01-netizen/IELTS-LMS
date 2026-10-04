package maintenance

// Plan E-exam-day: the grading-projection lag gauge input must be
// honest. Disabled projection reports zero work with zero lag (the
// worker skips the gauge write on disabled — no phantom lag). Enabled
// path computes lag from the checkpoint watermark. RED: disabled shape.
import (
	"context"
	"testing"
	"time"
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

func TestProjectionPositionUsesPerStreamCursor(t *testing.T) {
	bootstrap := time.Date(2026, time.October, 3, 0, 0, 0, 0, time.UTC)
	scheduleAt := bootstrap.Add(time.Hour)
	attemptAt := bootstrap.Add(2 * time.Hour)
	checkpointWatermark := bootstrap.Add(24 * time.Hour)

	scheduleBoundary, scheduleID := projectionPosition(
		&Cursor{UpdatedAt: scheduleAt, ID: "schedule-1"},
		checkpointWatermark,
	)
	attemptBoundary, attemptID := projectionPosition(
		&Cursor{UpdatedAt: attemptAt, ID: "attempt-1"},
		checkpointWatermark,
	)
	if !scheduleBoundary.Equal(scheduleAt) || scheduleID != "schedule-1" {
		t.Fatalf("schedule boundary = (%s, %q), want (%s, schedule-1)", scheduleBoundary, scheduleID, scheduleAt)
	}
	if !attemptBoundary.Equal(attemptAt) || attemptID != "attempt-1" {
		t.Fatalf("attempt boundary = (%s, %q), want (%s, attempt-1)", attemptBoundary, attemptID, attemptAt)
	}

	initialBoundary, initialID := projectionPosition(nil, bootstrap)
	if !initialBoundary.Equal(bootstrap) || initialID != "" {
		t.Fatalf("initial boundary = (%s, %q), want (%s, empty id)", initialBoundary, initialID, bootstrap)
	}
}

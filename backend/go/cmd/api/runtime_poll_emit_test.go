package main

// Plan C3/E-exam-day: the poll slice (delta vs 304) is the 90%-304 gate
// signal. RED: runtimePollInner emits MRuntimePollTotal{result}.
import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestRuntimePollEmitsDeltaAndNotModified(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	// Stale cursor -> delta.
	app, mock := pollTestApp(10, "live")
	req := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime?sinceRevision=9", nil)
	rec := httptest.NewRecorder()
	runtimePollHandler(app)(rec, reqWithSchedule(pollAuthed(req, mock), "sched-1"))
	if rec.Result().StatusCode != http.StatusOK {
		t.Fatalf("stale revision must 200, got %d", rec.Result().StatusCode)
	}
	// Equal cursor -> 304.
	app2, mock2 := pollTestApp(9, "live")
	req2 := httptest.NewRequest(http.MethodGet, "/api/v1/student/sessions/sched-1/runtime?sinceRevision=9", nil)
	rec2 := httptest.NewRecorder()
	runtimePollHandler(app2)(rec2, reqWithSchedule(pollAuthed(req2, mock2), "sched-1"))
	if rec2.Result().StatusCode != http.StatusNotModified {
		t.Fatalf("equal revision must 304, got %d", rec2.Result().StatusCode)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MRuntimePollTotal, "result", "delta"); got != 1 {
		t.Fatalf("one delta must count 1, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MRuntimePollTotal, "result", "not_modified"); got != 1 {
		t.Fatalf("one 304 must count 1, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if err := mock2.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

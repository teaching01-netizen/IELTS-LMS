package main

// Shell lifecycle telemetry: GET /shell answers a lifecycle question, so the
// only thing operators need from it is the answer mix. These pins keep
// NO_DRAFT on its own series (a pre-draft exam is normal traffic, never a
// fault), keep the two failure answers distinguishable from a real fault, and
// keep "the open failed unexpectedly" from being counted as a conflict.
//
// They deliberately assert the ABSENCE of fault counters for the expected
// states: an alert that fires on no_draft is the same class of bug as the
// console error this contract removed.
import (
	"net/http"
	"net/http/httptest"
	"testing"

	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func withFreshRegistry(t *testing.T) *telemetry.Registry {
	t.Helper()
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	t.Cleanup(func() { telemetry.DefaultRegistry = old })
	return reg
}

func TestShellReadEmitsLifecycleState(t *testing.T) {
	reg := withFreshRegistry(t)

	ready := &authoring.ShellResult{State: authoring.ShellStateReady, Shell: &authoring.Shell{ExamID: "exam-1"}}
	observeShellRead(ready, nil)
	noDraft := &authoring.ShellResult{State: authoring.ShellStateNoDraft}
	observeShellRead(noDraft, nil)
	observeShellRead(nil, apperrors.New(apperrors.CodeExamNotFound, "Exam not found."))
	observeShellRead(nil, apperrors.New(apperrors.CodeDraftIntegrity, "dangling"))
	observeShellRead(nil, apperrors.New(apperrors.CodeInternal, "boom"))

	for _, want := range []struct {
		state string
		count float64
	}{
		{"ready", 1},
		{"no_draft", 1},
		{telemetry.MAuthoringExamNotFound, 1},
		{telemetry.MAuthoringIntegrityFailed, 1},
		{"failed", 1},
	} {
		if got := telemetry.CounterValueForTest(reg, telemetry.MAuthoringShellReadTotal, "state", want.state); got != want.count {
			t.Errorf("authoring_shell_reads_total{state=%q} = %v, want %v", want.state, got, want.count)
		}
	}

	// An expected lifecycle answer must not look like an invariant violation.
	if got := telemetry.CounterValueForTest(reg, telemetry.MAuthoringInvariantViolationsTotal, "kind", "dangling_draft_pointer"); got != 0 {
		t.Errorf("a READY/NO_DRAFT read must not count as an invariant violation, got %v", got)
	}
}

func TestDraftOpenEmitsOutcome(t *testing.T) {
	reg := withFreshRegistry(t)

	observeDraftOpen(nil)
	observeDraftOpen(apperrors.New(apperrors.CodeConflict, "raced"))
	observeDraftOpen(apperrors.New(apperrors.CodeValidation, "no source"))
	observeDraftOpen(apperrors.New(apperrors.CodeExamNotFound, "gone"))
	observeDraftOpen(apperrors.New(apperrors.CodeServiceUnavailable, "db down"))

	for _, want := range []struct {
		outcome string
		count   float64
	}{
		{"ready", 1},
		{"conflict", 1},
		{"no_source", 1},
		{telemetry.MAuthoringExamNotFound, 1},
		{"failed", 1},
	} {
		if got := telemetry.CounterValueForTest(reg, telemetry.MAuthoringDraftOpenTotal, "outcome", want.outcome); got != want.count {
			t.Errorf("authoring_draft_open_total{outcome=%q} = %v, want %v", want.outcome, got, want.count)
		}
	}
}

// A dangling pointer is the one shell-path fault no user action can produce,
// so the response path raises it as an invariant violation. It is counted
// exactly once per failed request, alongside the lifecycle state — not in the
// classifier, which would double count a read and an open of the same broken
// row as two separate rows-worth of breakage.
func TestDraftIntegrityViolationCountedAsInvariant(t *testing.T) {
	reg := withFreshRegistry(t)

	rec := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodGet, "/v1/assessment-authoring/exams/exam-1/shell", nil)
	dangling := apperrors.New(apperrors.CodeDraftIntegrity, "dangling")
	reportDraftIntegrityViolation(rec, req, "exam-1", dangling)

	if got := telemetry.CounterValueForTest(reg, telemetry.MAuthoringInvariantViolationsTotal, "kind", "dangling_draft_pointer"); got != 1 {
		t.Fatalf("dangling draft pointer must count as invariant violation 1, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MAuthoringInvariantViolationsTotal, "kind", "other"); got != 0 {
		t.Fatalf("only the dangling-pointer kind may be emitted, got %v", got)
	}

	// A failure that is not an integrity violation must not be reported as one.
	reportDraftIntegrityViolation(rec, req, "exam-1", apperrors.New(apperrors.CodeInternal, "boom"))
	if got := telemetry.CounterValueForTest(reg, telemetry.MAuthoringInvariantViolationsTotal, "kind", "dangling_draft_pointer"); got != 1 {
		t.Fatalf("only an integrity violation counts, got %v", got)
	}
}

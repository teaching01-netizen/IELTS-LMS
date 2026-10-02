package integration

import (
	"context"
	"errors"
	"net/http"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/satpublish"
)

// The completion gate requires the sections the release declares, not always
// both: a Math-only release with no link narrowing must be submittable once
// Math is done, while a full release still refuses a missing section.
func TestSATCompletionRequiresOnlyTheReleasedSections(t *testing.T) {
	cases := []struct {
		name    string
		scope   satpublish.Scope
		dropped func(f *adaptiveExam) []string
		refused bool
	}{
		{"math-only release without reading-writing", satpublish.ScopeMath,
			func(f *adaptiveExam) []string { return []string{f.rw.baseID, f.rw.lowID} }, false},
		{"reading-writing-only release without math", satpublish.ScopeReadingWriting,
			func(f *adaptiveExam) []string { return []string{f.math.baseID, f.math.lowID} }, false},
		{"full release without reading-writing", satpublish.ScopeFull,
			func(f *adaptiveExam) []string { return []string{f.rw.baseID, f.rw.lowID} }, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			f := newAdaptiveExam(t)
			ctx := context.Background()
			attemptID := f.seedStudent(f.rw, 2, false)
			f.seedTerminalModules(attemptID)
			for _, moduleID := range tc.dropped(f) {
				if _, err := f.db.ExecContext(ctx,
					`DELETE FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`, attemptID, moduleID); err != nil {
					t.Fatalf("drop module attempt: %v", err)
				}
			}
			if _, err := f.db.ExecContext(ctx,
				`UPDATE exam_versions SET sat_publish_scope = ? WHERE id = ?`, string(tc.scope), f.versionID); err != nil {
				t.Fatalf("set release scope: %v", err)
			}

			_, err := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil).CompleteAssessment(ctx, sat.CompleteRequest{
				AttemptID: attemptID, ScheduleID: f.scheduleID, SubmissionID: attemptID, ActorKind: "student",
			})
			if !tc.refused {
				if err != nil {
					t.Fatalf("a %s run must complete: %v", tc.scope, err)
				}
				return
			}
			var appErr *apperrors.Error
			if !errors.As(err, &appErr) || appErr.HTTPStatus != http.StatusConflict {
				t.Fatalf("a full run missing a section must be refused with 409, got %v", err)
			}
		})
	}
}

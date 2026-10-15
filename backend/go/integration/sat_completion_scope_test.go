package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"reflect"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/satconvert"
	"example.com/ielts-proctoring/internal/satpublish"
	"example.com/ielts-proctoring/internal/satscoring"
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

// Finish and bootstrap must resolve the same global policy, even when no
// per-exam converter was stored with the classroom result.
func TestSATCompletionOverlaysGlobalScaledScores(t *testing.T) {
	f := newAdaptiveExam(t)
	ctx := context.Background()
	attemptID := f.seedStudent(f.rw, 2, false)
	f.seedTerminalModules(attemptID)
	for _, statement := range []struct {
		query string
		id    string
	}{
		{"UPDATE exam_entities SET sat_score_report_enabled = TRUE WHERE id = ?", f.examID},
		{"UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?", f.scheduleID},
		{"UPDATE assessment_module_attempts SET raw_correct = 2, operational_question_count = 3 WHERE attempt_id = ?", attemptID},
	} {
		if _, err := f.db.ExecContext(ctx, statement.query, statement.id); err != nil {
			t.Fatal(err)
		}
	}

	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		if _, err := f.db.ExecContext(ctx, `
			INSERT INTO assessment_route_decisions (
				id, attempt_id, section_id, base_module_attempt_id, base_module_id,
				selected_module_id, selected_route, raw_correct,
				operational_question_count, policy_key, policy_revision, policy_config
			)
			SELECT UUID(), attempt_id, ?, id, module_id, ?, 'lower', 2, 3, 'threshold', 1, '{}'
			FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`,
			branch.sectionID, branch.lowID, attemptID, branch.baseID); err != nil {
			t.Fatal(err)
		}
	}

	// Publishing is append-only; restore the singleton pointer after the test.
	var previous sql.NullString
	if err := f.db.QueryRowContext(ctx, "SELECT revision_id FROM sat_score_conversion_active WHERE id = 1").Scan(&previous); err != nil {
		t.Fatal(err)
	}
	satscoring.ResetCacheForTest()
	t.Cleanup(func() {
		if _, err := f.db.ExecContext(ctx, "UPDATE sat_score_conversion_active SET revision_id = ? WHERE id = 1", previous); err != nil {
			t.Errorf("restore active policy: %v", err)
		}
		satscoring.ResetCacheForTest()
	})
	content := satconvert.EmptyContent()
	for section, score := range map[string]int{satconvert.SectionReadingWriting: 600, satconvert.SectionMath: 500} {
		cells := make([][]*int, 4)
		for r := range cells {
			cells[r] = make([]*int, 4)
			for c := range cells[r] {
				value := score
				cells[r][c] = &value
			}
		}
		content.Sections[section].Tables["test"] = &satconvert.PolicyTable{
			Kind: satconvert.KindMatrix, M1Operational: 3, M2Operational: 3, Cells: cells,
		}
		content.Sections[section].Assign["full_lower"] = []string{"test"}
		content.Sections[section].Assign["full_higher"] = []string{"test"}
	}
	policyJSON, err := content.Canonical()
	if err != nil {
		t.Fatal(err)
	}
	policies := satscoring.NewService(f.db, tx.NewRunner(f.db))
	draft, err := policies.CreateDraft(ctx, f.owner, "completion-policy-create", nil)
	if err != nil {
		t.Fatal(err)
	}
	draft, err = policies.SaveDraft(ctx, f.owner, "completion-policy-save", draft.ID, draft.Version, policyJSON, "completion regression", "")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := policies.Publish(ctx, f.owner, "completion-policy-publish", draft.ID); err != nil {
		t.Fatal(err)
	}

	service := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil)
	req := sat.CompleteRequest{AttemptID: attemptID, ScheduleID: f.scheduleID, SubmissionID: attemptID, ActorKind: "student"}
	for _, name := range []string{"finish", "replay"} {
		t.Run(name, func(t *testing.T) {
			finished, err := service.CompleteAssessment(ctx, req)
			if err != nil {
				t.Fatal(err)
			}
			refreshed, err := sat.LoadResultForAttempt(ctx, f.db, attemptID)
			if err != nil {
				t.Fatal(err)
			}
			report := func(result *sat.AssessmentResult) map[string]any {
				t.Helper()
				if result == nil {
					t.Fatal("missing result")
				}
				raw, ok := result.ScorePayload["classroomRaw"].(map[string]any)
				if !ok {
					t.Fatalf("missing classroom report: %+v", result.ScorePayload)
				}
				// Normalize typed overlay scores to the wire representation.
				wire, err := json.Marshal(raw)
				if err != nil {
					t.Fatal(err)
				}
				var normalized map[string]any
				if err := json.Unmarshal(wire, &normalized); err != nil {
					t.Fatal(err)
				}
				return normalized
			}
			got, want := report(finished), report(refreshed)
			if !reflect.DeepEqual(got, want) {
				t.Fatalf("completion report = %+v, refresh = %+v", got, want)
			}
			assertScore := func(value any, expected int) {
				t.Helper()
				want := map[string]any{"low": float64(expected), "high": float64(expected)}
				if !reflect.DeepEqual(value, want) {
					t.Fatalf("scaled score = %+v, want %+v", value, want)
				}
			}
			assertScore(got["totalScaled"], 1100)
			sections, ok := got["sections"].([]any)
			if !ok || len(sections) != 2 {
				t.Fatalf("expected two sections, got %+v", got["sections"])
			}
			for _, item := range sections {
				section := item.(map[string]any)
				expected, ok := map[string]int{"reading-writing": 600, "math": 500}[section["sectionKey"].(string)]
				if !ok {
					t.Fatalf("unexpected section: %+v", section)
				}
				assertScore(section["scaled"], expected)
			}
		})
	}
	// Duplicate finish requests can arrive together after a lost ACK.
	start := make(chan struct{})
	type completion struct {
		result *sat.AssessmentResult
		err    error
	}
	done := make(chan completion, 2)
	concurrentCtx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	for range 2 {
		go func() {
			<-start
			result, err := service.CompleteAssessment(concurrentCtx, req)
			done <- completion{result, err}
		}()
	}
	close(start)
	for range 2 {
		select {
		case result := <-done:
			if result.err != nil || result.result == nil {
				t.Fatalf("concurrent completion: %+v, %v", result.result, result.err)
			}
			raw := result.result.ScorePayload["classroomRaw"].(map[string]any)
			if raw["totalScaled"] != (satconvert.Score{Low: 1100, High: 1100}) {
				t.Fatalf("concurrent finish lost conversion: %+v", raw)
			}
		case <-concurrentCtx.Done():
			t.Fatal(concurrentCtx.Err())
		}
	}
	var receipts int
	if err := f.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?", attemptID).Scan(&receipts); err != nil || receipts != 1 {
		t.Fatalf("receipt count = %d, err = %v", receipts, err)
	}

	var storedScaled bool
	if err := f.db.QueryRowContext(ctx, "SELECT JSON_CONTAINS_PATH(score_payload, 'one', '$.classroomRaw.totalScaled') FROM assessment_results WHERE attempt_id = ?", attemptID).Scan(&storedScaled); err != nil {
		t.Fatal(err)
	}
	if storedScaled {
		t.Fatal("read-time global conversion was persisted into the result")
	}

	// Both HTTP response paths use this projection. Disabling reporting after
	// release must hide even a replay's previously stored score report.
	if _, err := f.db.ExecContext(ctx, "UPDATE exam_entities SET sat_score_report_enabled = FALSE WHERE id = ?", f.examID); err != nil {
		t.Fatal(err)
	}
	replayed, err := service.CompleteAssessment(ctx, req)
	if err != nil {
		t.Fatal(err)
	}
	projected, err := delivery.StudentSATResult(ctx, f.db, replayed)
	if err != nil {
		t.Fatal(err)
	}
	if projected == nil || projected.ID != replayed.ID || projected.ScorePayload != nil || projected.TotalScore != nil || len(projected.Sections) != 0 {
		t.Fatalf("disabled report must expose only receipt: %+v", projected)
	}
	if replayed.ScorePayload["snapshot"] == nil {
		t.Fatal("projection mutated stored payload")
	}

}

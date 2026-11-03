package grading

import "testing"

func regradeQuestionResult(questionID string, correct bool, awarded, max float64) map[string]any {
	return map[string]any{
		"questionId": questionID, "isCorrect": correct,
		"awardedScore": awarded, "maxScore": max,
	}
}

func TestDiffQuestionResultsListsOnlyChanges(t *testing.T) {
	previous := map[string]any{"questionResults": []any{
		regradeQuestionResult("q1", false, 0, 1),
		regradeQuestionResult("q2", true, 1, 1),
	}}
	next := map[string]any{"questionResults": []any{
		regradeQuestionResult("q1", true, 1, 1),
		regradeQuestionResult("q2", true, 1, 1),
	}}
	changes := diffQuestionResults("sub-1", "student-1", "Student", "reading", false, previous, next)
	if len(changes) != 1 || changes[0].QuestionID != "q1" {
		t.Fatalf("changes = %#v, want only q1", changes)
	}
	if changes[0].OldCorrectness == nil || *changes[0].OldCorrectness {
		t.Fatalf("old correctness = %v, want false", changes[0].OldCorrectness)
	}
	if changes[0].NewCorrectness == nil || !*changes[0].NewCorrectness {
		t.Fatalf("new correctness = %v, want true", changes[0].NewCorrectness)
	}
	if changes[0].NewAwarded == nil || *changes[0].NewAwarded != 1 {
		t.Fatalf("new awarded = %v, want 1", changes[0].NewAwarded)
	}
}

func TestObjectiveRegradeTokenIgnoresVolatileFields(t *testing.T) {
	plan := objectiveRegradePlan{
		ScheduleID: "sch-1", Scope: ObjectiveRegradeScopeReleased,
		Submissions: []plannedSubmission{{
			ID: "sub-1", Released: true,
			Sections: []plannedSectionUpdate{{
				Section: "reading", Status: "verified", OldTotal: 0, NewTotal: 1, OldMax: 1, NewMax: 1,
				Results: map[string]any{
					"generatedAt":     "2026-01-01T00:00:00Z",
					"totalScore":      1,
					"maxScore":        1,
					"questionResults": []any{regradeQuestionResult("q1", true, 1, 1)},
					"integrity":       map[string]any{"integrityStatus": "verified"},
				},
			}},
			Changes: []ObjectiveRegradeChange{{SubmissionID: "sub-1", Section: "reading", QuestionID: "q1", Released: true}},
		}},
	}
	first := objectiveRegradeToken(plan)
	plan.Submissions[0].Sections[0].Results["generatedAt"] = "2026-01-02T00:00:00Z"
	if second := objectiveRegradeToken(plan); second != first {
		t.Fatalf("token changed with generatedAt: %s != %s", first, second)
	}
	plan.Submissions[0].Sections[0].Results["questionResults"] = []any{regradeQuestionResult("q1", false, 0, 1)}
	if second := objectiveRegradeToken(plan); second == first {
		t.Fatal("token did not change when the planned question results changed")
	}
}

func TestObjectiveRegradeTokenCoversIntegrityOnlyWrites(t *testing.T) {
	plan := objectiveRegradePlan{
		ScheduleID: "sch-1", Scope: ObjectiveRegradeScopeUnreleased,
		Submissions: []plannedSubmission{{
			ID: "sub-1",
			Sections: []plannedSectionUpdate{{
				Section: "reading", Status: "needs_recheck",
				Results: map[string]any{
					"totalScore":      1,
					"maxScore":        1,
					"questionResults": []any{regradeQuestionResult("q1", true, 1, 1)},
					"integrity":       map[string]any{"integrityStatus": "needs_recheck", "issueCodes": []any{"a"}},
				},
			}},
		}},
	}
	first := objectiveRegradeToken(plan)
	plan.Submissions[0].Sections[0].Results["integrity"] = map[string]any{"integrityStatus": "needs_recheck", "issueCodes": []any{"b"}}
	if second := objectiveRegradeToken(plan); second == first {
		t.Fatal("token ignored an integrity-only section write")
	}
}

func TestNormalizeRegradeScope(t *testing.T) {
	for input, want := range map[string]string{
		"":           ObjectiveRegradeScopeAll,
		"all":        ObjectiveRegradeScopeAll,
		"released":   ObjectiveRegradeScopeReleased,
		"unreleased": ObjectiveRegradeScopeUnreleased,
		" RELEASED ": ObjectiveRegradeScopeReleased,
	} {
		got, err := normalizeRegradeScope(input)
		if err != nil || got != want {
			t.Fatalf("normalizeRegradeScope(%q) = %q, %v; want %q", input, got, err, want)
		}
	}
	if _, err := normalizeRegradeScope("nope"); err == nil {
		t.Fatal("invalid scope accepted")
	}
}

func TestPreviewSummarySplitsReleasedAndUnreleased(t *testing.T) {
	plan := objectiveRegradePlan{
		ScheduleID: "sch-1", Scope: ObjectiveRegradeScopeAll,
		Submissions: []plannedSubmission{
			{ID: "s1", Released: false, OldTotal: 1, NewTotal: 2, OldMax: 2, NewMax: 2,
				Changes: []ObjectiveRegradeChange{{QuestionID: "q1"}}},
			{ID: "s2", Released: true, OldTotal: 1, NewTotal: 1, OldMax: 2, NewMax: 2,
				Changes: []ObjectiveRegradeChange{{QuestionID: "q2"}}},
		},
	}
	preview := previewFromPlan(plan)
	if preview.Summary.Released != 1 || preview.Summary.Unreleased != 1 {
		t.Fatalf("summary = %+v", preview.Summary)
	}
	if preview.Summary.QuestionChange != 2 || preview.Summary.Changed != 2 {
		t.Fatalf("summary = %+v", preview.Summary)
	}
	if preview.Summary.ScoreDelta != 1 {
		t.Fatalf("score delta = %v, want 1", preview.Summary.ScoreDelta)
	}
	if preview.PreviewToken == "" {
		t.Fatal("preview has no token")
	}
}

package grading

import "testing"

func overrideTestContent() map[string]any {
	return map[string]any{
		"reading": map[string]any{
			"passages": []any{map[string]any{
				"id": "p1",
				"blocks": []any{map[string]any{
					"id":     "blk",
					"type":   "DIAGRAM_LABELING",
					"labels": []any{map[string]any{"id": "lbl", "correctAnswer": "28 June|28th June"}},
				}},
			}},
		},
	}
}

func questionResult(t *testing.T, results map[string]any, id string) map[string]any {
	t.Helper()
	for _, raw := range results["questionResults"].([]any) {
		result := raw.(map[string]any)
		if result["questionId"] == id {
			return result
		}
	}
	t.Fatalf("question %s missing from results", id)
	return nil
}

func TestScheduleOverrideAcceptsAnswerForWholeExam(t *testing.T) {
	correct := "28 June"
	overrides := map[string]objectiveOverridePayload{"blk:lbl": {
		CorrectAnswer:   &correct,
		AcceptedAnswers: []string{"28 June", "28th June", "28 june"},
		ScoringRule:     "exact_match",
		MaxScore:        1,
	}}
	_, results := gradeProjectionObjectiveSection("reading", map[string]any{"blk": []any{"28 june"}},
		overrideTestContent(), nil, overrides, "v1")
	got := questionResult(t, results, "blk:lbl")
	if got["isCorrect"] != true || got["hasOverride"] != true {
		t.Fatalf("accepted answer not scored correct: %#v", got)
	}
	// The UI recomputes text correctness from correctAnswer case-sensitively,
	// so the case variant must survive in the joined key.
	if got["correctAnswer"] != "28 June | 28th June | 28 june" {
		t.Fatalf("correctAnswer = %#v", got["correctAnswer"])
	}
	if results["totalScore"] != 1 {
		t.Fatalf("totalScore = %#v", results["totalScore"])
	}
}

func TestScheduleOverrideKeepsAnswerIncorrect(t *testing.T) {
	overrides := map[string]objectiveOverridePayload{"blk:lbl": {
		AcceptedAnswers: []string{"28 June", "28th June"},
		ExcludedAnswers: []string{"28 june"},
		ScoringRule:     "exact_match",
		MaxScore:        1,
	}}
	answers := map[string]any{"blk": []any{"28 june"}}
	_, results := gradeProjectionObjectiveSection("reading", answers, overrideTestContent(), nil, overrides, "v1")
	if got := questionResult(t, results, "blk:lbl"); got["isCorrect"] != false {
		t.Fatalf("excluded answer scored correct: %#v", got)
	}
	// Exclusion is exact: the key's own casing stays correct.
	answers = map[string]any{"blk": []any{"28 June"}}
	_, results = gradeProjectionObjectiveSection("reading", answers, overrideTestContent(), nil, overrides, "v1")
	if got := questionResult(t, results, "blk:lbl"); got["isCorrect"] != true {
		t.Fatalf("key answer rejected by exclusion: %#v", got)
	}
}

func TestScheduleOverrideIgnoresRowsWithoutAKey(t *testing.T) {
	overrides := map[string]objectiveOverridePayload{"blk:lbl": {ScoringRule: "exact_match", MaxScore: 1}}
	_, results := gradeProjectionObjectiveSection("reading", map[string]any{"blk": []any{"28th June"}},
		overrideTestContent(), nil, overrides, "v1")
	got := questionResult(t, results, "blk:lbl")
	if got["isCorrect"] != true || got["hasOverride"] != false {
		t.Fatalf("keyless override changed the sealed key: %#v", got)
	}
}

func TestCarryTeacherOverridesAcrossRegrade(t *testing.T) {
	previous := map[string]any{
		"overrides": map[string]any{"blk:lbl": map[string]any{"points": 1}},
		"questionResults": []any{map[string]any{
			"questionId": "blk:lbl", "manualOverride": map[string]any{"isCorrect": true},
		}},
	}
	_, next := gradeProjectionObjectiveSection("reading", map[string]any{}, overrideTestContent(), nil, nil, "v1")
	carryTeacherOverrides(previous, next)
	if next["overrides"] == nil {
		t.Fatal("section overrides dropped")
	}
	if questionResult(t, next, "blk:lbl")["manualOverride"] == nil {
		t.Fatal("manual question override dropped")
	}
}

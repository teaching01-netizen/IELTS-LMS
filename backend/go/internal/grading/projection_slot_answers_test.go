package grading

import "testing"

// The student client stores a slot block's answers as ONE array under the block
// id (the same key the review traceback reads). The projection therefore has to
// declare an array->slot alias for every such block: without it the section
// filter drops the saved array and the answer is graded as unanswered.
//
// CLASSIFICATION and MATCHING_FEATURES were registered per slot without that
// alias, so their saved answers disappeared from section_submissions.answers
// while the student's typing was intact in attempt_responses_v2.
func TestProjectionSectionAnswersKeepSlotBlockArrays(t *testing.T) {
	content := map[string]any{
		"reading": map[string]any{
			"passages": []any{
				map[string]any{
					"id": "p1",
					"blocks": []any{
						map[string]any{
							"id":   "match-block",
							"type": "MATCHING_FEATURES",
							"features": []any{
								map[string]any{"id": "f1", "text": "Feature one", "correctMatch": "i"},
								map[string]any{"id": "f2", "text": "Feature two", "correctMatch": "ii"},
							},
						},
						map[string]any{
							"id":   "classify-block",
							"type": "CLASSIFICATION",
							"items": []any{
								map[string]any{"id": "c1", "text": "Item one", "correctCategory": "A"},
								map[string]any{"id": "c2", "text": "Item two", "correctCategory": "B"},
							},
						},
						map[string]any{
							"id":   "table-block",
							"type": "TABLE_COMPLETION",
							"cells": []any{
								map[string]any{"id": "t1", "correctAnswer": "1990"},
							},
						},
						map[string]any{
							"id":        "tfng-block",
							"type":      "TFNG",
							"questions": []any{map[string]any{"id": "q1", "correctAnswer": "TRUE"}},
						},
					},
				},
			},
		},
	}

	answers := map[string]any{
		"match-block":    []any{"i", "ii"},
		"classify-block": []any{"A", "wrong"},
		"table-block":    []any{"1990"},
		"q1":             "TRUE",
		"stale-key":      "noise",
	}

	model := collectProjectionSection(content, "reading")
	filtered := projectionSectionAnswers(answers, model)

	for key, want := range map[string]any{
		"match-block:f1":    "i",
		"match-block:f2":    "ii",
		"classify-block:c1": "A",
		"classify-block:c2": "wrong",
		"table-block:t1":    "1990",
		"q1":                "TRUE",
	} {
		if got := filtered[key]; got != want {
			t.Errorf("projectionSectionAnswers[%q] = %#v, want %#v", key, got, want)
		}
	}
	if _, ok := filtered["stale-key"]; ok {
		t.Errorf("a key the section does not contain must never be projected: %#v", filtered)
	}
	if _, ok := filtered["match-block"]; ok {
		t.Errorf("the raw array key must be expanded into slots, not projected as one answer")
	}

	// The same filter drives scoring: a saved slot array has to score.
	results := projectionObjectiveResults("reading", filtered, model.Specs, map[string]string{}, "version-1")
	byQuestion := questionResultsByID(t, results)
	for id, want := range map[string]string{
		"match-block:f1":    "verified_correct",
		"match-block:f2":    "verified_correct",
		"classify-block:c1": "verified_correct",
		"classify-block:c2": "verified_incorrect",
		"table-block:t1":    "verified_correct",
	} {
		if got := byQuestion[id]; got != want {
			t.Errorf("question %s status = %q, want %q", id, got, want)
		}
	}
	integrity, _ := results["integrity"].(map[string]any)
	if integrity == nil {
		t.Fatalf("expected an integrity summary, got %#v", results)
	}
	if _, ok := integrity["unknownAnswerIds"].([]string); ok {
		// The array keys are consumed by the aliases; no unknown ids remain.
		if ids := integrity["unknownAnswerIds"].([]string); len(ids) != 0 {
			t.Errorf("slot arrays must not be reported as unknown answers: %#v", ids)
		}
	}
	if integrity["unresolvedCount"] != 0 {
		t.Errorf("expected no unresolved questions, got %#v", integrity["unresolvedCount"])
	}
}

func questionResultsByID(t *testing.T, results map[string]any) map[string]string {
	t.Helper()
	raw, ok := results["questionResults"].([]any)
	if !ok {
		t.Fatalf("expected questionResults, got %#v", results)
	}
	out := make(map[string]string, len(raw))
	for _, entry := range raw {
		result, ok := entry.(map[string]any)
		if !ok {
			t.Fatalf("expected a question result object, got %#v", entry)
		}
		id, _ := result["questionId"].(string)
		status, _ := result["verificationStatus"].(string)
		out[id] = status
	}
	return out
}

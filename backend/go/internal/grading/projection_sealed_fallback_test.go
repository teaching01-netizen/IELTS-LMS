package grading

import "testing"

// projectionResultFor returns the persisted question result map for one id.
func projectionResultFor(t *testing.T, results map[string]any, questionID string) map[string]any {
	t.Helper()
	raw, ok := results["questionResults"].([]any)
	if !ok {
		t.Fatalf("questionResults missing or wrong type: %T", results["questionResults"])
	}
	for _, entry := range raw {
		result, ok := entry.(map[string]any)
		if !ok {
			continue
		}
		if result["questionId"] == questionID {
			return result
		}
	}
	t.Fatalf("question result %q not found", questionID)
	return nil
}

// A legacy content snapshot can be missing a readable key while the pinned
// version's sealed answer_definition still has it. SINGLE_MCQ option IDs are
// identity (ExactID), so the fallback must copy the sealed value verbatim:
// cleaning it ("opt-1111" -> "opt 1111") made the raw compare always fail.
func TestProjectionSealedFallbackKeepsSingleChoiceOptionIDRaw(t *testing.T) {
	content := map[string]any{
		"reading": map[string]any{
			"passages": []any{map[string]any{
				"blocks": []any{map[string]any{
					"id": "mcq-block", "type": "SINGLE_MCQ", "instruction": "",
					"options": []any{
						map[string]any{"id": "opt-1111", "text": "A"},
						map[string]any{"id": "opt-2222", "text": "B"},
					},
				}},
			}},
		},
	}
	keys := map[string]string{
		"mcq-block": `{"kind":"single_choice","correctOptionId":"opt-1111"}`,
	}

	_, results := gradeProjectionObjectiveSection(
		"reading", map[string]any{"mcq-block": "opt-1111"}, content, keys, nil, "v1",
	)
	result := projectionResultFor(t, results, "mcq-block")
	if got := result["isCorrect"]; got != true {
		t.Fatalf("raw option id should match the sealed key, got isCorrect=%v (accepted=%v)", got, result["acceptedAnswers"])
	}
	if result["awardedScore"] != 1.0 {
		t.Fatalf("expected one mark, got %v", result["awardedScore"])
	}

	// Identity means raw equality: a cleaned/case-insensitive variant must not match.
	_, wrongCase := gradeProjectionObjectiveSection(
		"reading", map[string]any{"mcq-block": "OPT-1111"}, content, keys, nil, "v1",
	)
	if got := projectionResultFor(t, wrongCase, "mcq-block")["isCorrect"]; got != false {
		t.Fatalf("option ids compare raw, expected false, got %v", got)
	}
}

// Free-text sealed fallback keeps the one cleaning rule (strict case by default,
// whitespace/invisible-character cleanup applies to the sealed value).
func TestProjectionSealedFallbackCleansFreeTextKey(t *testing.T) {
	content := map[string]any{
		"reading": map[string]any{
			"passages": []any{map[string]any{
				"blocks": []any{map[string]any{
					"id": "short-block", "type": "SHORT_ANSWER", "instruction": "",
					"questions": []any{map[string]any{
						"id": "short-1", "prompt": "Name", "answerRule": "ONE_WORD",
					}},
				}},
			}},
		},
	}
	keys := map[string]string{
		"short-1": `{"kind":"free_text","acceptedResponses":["  Urwin  "]}`,
	}

	_, results := gradeProjectionObjectiveSection(
		"reading", map[string]any{"short-1": "Urwin"}, content, keys, nil, "v1",
	)
	result := projectionResultFor(t, results, "short-1")
	if got := result["isCorrect"]; got != true {
		t.Fatalf("sealed free-text key should be cleaned and matched, got isCorrect=%v (accepted=%v)", got, result["acceptedAnswers"])
	}

	_, wrongCase := gradeProjectionObjectiveSection(
		"reading", map[string]any{"short-1": "urwin"}, content, keys, nil, "v1",
	)
	if got := projectionResultFor(t, wrongCase, "short-1")["isCorrect"]; got != false {
		t.Fatalf("typed answers require exact case by default, expected false, got %v", got)
	}
}

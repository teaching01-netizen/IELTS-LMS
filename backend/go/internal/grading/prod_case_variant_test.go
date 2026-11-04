package grading

// Regression pins for the production report: a student answer "28th june" was
// shown Correct against the answer key "28th June" (+3 other accepted answers)
// with no overrides and no explicit opt-out. The product rule
// (correct-answer.md) is exact case by default; only an explicit
// `caseSensitive: false` opts out.
//
// These tests exercise the same functions the grading writers use:
//   - projection worker / schedule regrade: gradeProjectionObjectiveSection
//   - submit-time GradeObjective:            scoreObjective + parseObjectiveKey
//
// They must stay green: if any of them fails, a *freshly graded* submission can
// be saved as Correct for a case-only variant again.

import "testing"

// prodCaseVariantContent is a legacy-shaped reading snapshot: one SHORT_ANSWER
// question whose key is stored in the builder's acceptedAnswers list, with the
// four accepted answers from the production report and no caseSensitive flag.
func prodCaseVariantContent(caseSensitive *bool) map[string]any {
	question := map[string]any{
		"id":              "prod-q28",
		"prompt":          "Date of arrival",
		"acceptedAnswers": []any{"28th June", "28 June", "June 28", "28/06"},
	}
	if caseSensitive != nil {
		question["caseSensitive"] = *caseSensitive
	}
	return map[string]any{
		"reading": map[string]any{
			"passages": []any{map[string]any{
				"id": "p1",
				"blocks": []any{map[string]any{
					"id": "prod-blk", "type": "SHORT_ANSWER",
					"questions": []any{question},
				}},
			}},
		},
	}
}

// A submission graded today through the projection/regrade path must save the
// case-only variant as Incorrect: missing caseSensitive defaults to strict.
func TestProjectionGradesProdCaseVariantIncorrectByDefault(t *testing.T) {
	_, results := gradeProjectionObjectiveSection(
		"reading",
		map[string]any{"prod-q28": "28th june"},
		prodCaseVariantContent(nil), nil, nil, "v1",
	)
	got := projectionResultFor(t, results, "prod-q28")
	if got["isCorrect"] != false {
		t.Fatalf("case-only variant scored correct by default: %#v", got)
	}
	if status := got["verificationStatus"]; status != "verified_incorrect" {
		t.Fatalf("verificationStatus = %v, want verified_incorrect", status)
	}
	if results["totalScore"] != 0 {
		t.Fatalf("totalScore = %v, want 0", results["totalScore"])
	}

	// Sanity: the same question still marks the key's own casing Correct, so the
	// failure above is the case rule and not a broken key lookup.
	_, exact := gradeProjectionObjectiveSection(
		"reading",
		map[string]any{"prod-q28": "28th June"},
		prodCaseVariantContent(nil), nil, nil, "v1",
	)
	if projectionResultFor(t, exact, "prod-q28")["isCorrect"] != true {
		t.Fatalf("exact-case key did not score correct: %#v", projectionResultFor(t, exact, "prod-q28"))
	}
}

// The explicit opt-out still works and is the only way a case-only variant
// matches; this keeps the default-strict test from passing for the wrong reason.
func TestProjectionHonorsCaseSensitiveOptOutForProdVariant(t *testing.T) {
	optOut := false
	_, results := gradeProjectionObjectiveSection(
		"reading",
		map[string]any{"prod-q28": "28th june"},
		prodCaseVariantContent(&optOut), nil, nil, "v1",
	)
	if projectionResultFor(t, results, "prod-q28")["isCorrect"] != true {
		t.Fatalf("caseSensitive:false did not opt out of exact case: %#v", projectionResultFor(t, results, "prod-q28"))
	}
}

// The sealed answer_definition fallback (legacy snapshots with no content key)
// shares the same policy: a missing flag is strict, and the AND at
// projection.go:851 means the content must also not have opted out.
func TestProjectionSealedKeyDefaultsStrictForProdVariant(t *testing.T) {
	content := prodCaseVariantContent(nil)
	// Drop the builder key so the pinned version's sealed definition is used.
	question := content["reading"].(map[string]any)["passages"].([]any)[0].(map[string]any)["blocks"].([]any)[0].(map[string]any)["questions"].([]any)[0].(map[string]any)
	delete(question, "acceptedAnswers")

	keys := map[string]string{"prod-q28": `{"kind":"free_text","acceptedResponses":["28th June"]}`}
	_, results := gradeProjectionObjectiveSection(
		"reading", map[string]any{"prod-q28": "28th june"}, content, keys, nil, "v1",
	)
	if projectionResultFor(t, results, "prod-q28")["isCorrect"] != false {
		t.Fatalf("sealed key without caseSensitive graded the case-only variant Correct: %#v", projectionResultFor(t, results, "prod-q28"))
	}

	// D5: no current producer writes caseSensitive, but if one ever emits the
	// documented opt-out, both graders honour it.
	keys["prod-q28"] = `{"kind":"free_text","acceptedResponses":["28th June"],"caseSensitive":false}`
	_, optedOut := gradeProjectionObjectiveSection(
		"reading", map[string]any{"prod-q28": "28th june"}, content, keys, nil, "v1",
	)
	if projectionResultFor(t, optedOut, "prod-q28")["isCorrect"] != true {
		t.Fatalf("sealed caseSensitive:false opt-out not honoured: %#v", projectionResultFor(t, optedOut, "prod-q28"))
	}
}

// The submit-time GradeObjective path (dead for IELTS delivery today, but it
// writes the same column if reactivated) applies the same strict default.
func TestScoreObjectiveGradesProdCaseVariantIncorrectByDefault(t *testing.T) {
	keys := map[string]string{"prod-q28": `{"kind":"free_text","acceptedResponses":["28th June"]}`}
	out := scoreObjective(map[string]any{"prod-q28": "28th june"}, nil, keys)
	if len(out) != 1 {
		t.Fatalf("scoreObjective returned %d results", len(out))
	}
	if out[0].Correct {
		t.Fatalf("scoreObjective scored the case-only variant Correct: %#v", out[0])
	}
	exact := scoreObjective(map[string]any{"prod-q28": "28th June"}, nil, keys)
	if len(exact) != 1 || !exact[0].Correct {
		t.Fatalf("scoreObjective rejected the key's own casing: %#v", exact)
	}
}

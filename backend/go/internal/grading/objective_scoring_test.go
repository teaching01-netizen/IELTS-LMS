package grading

import "testing"

func objectiveResultsByID(t *testing.T, results []ObjectiveResult) map[string]ObjectiveResult {
	t.Helper()
	byID := make(map[string]ObjectiveResult, len(results))
	for _, result := range results {
		byID[result.QuestionID] = result
	}
	return byID
}

// TestScoreObjectiveSealedCaseSensitiveOptOut pins the default strict-case
// policy for the submit-time scorer and the only way to opt out: an explicit
// caseSensitive/case_sensitive: false in the sealed answer_definition.
func TestScoreObjectiveSealedCaseSensitiveOptOut(t *testing.T) {
	keys := map[string]string{
		"strict":               `{"kind":"student_produced_response","acceptedResponses":["Urwin"]}`,
		"strict-exact":         `{"acceptedResponses":["Urwin"]}`,
		"strict-explicit-true": `{"accepted_responses":["Urwin"],"case_sensitive":true}`,
		"opt-out":              `{"kind":"student_produced_response","acceptedResponses":["Urwin"],"caseSensitive":false}`,
		"opt-out-snake":        `{"accepted_responses":["Urwin"],"case_sensitive":false}`,
		"choice":               `{"kind":"single_choice","correctOptionId":"Option-A"}`,
		"choice-opt-out":       `{"kind":"single_choice","correct_option_id":"Option-A","caseSensitive":false}`,
		"missing-key":          `{"kind":"student_produced_response"}`,
	}
	answers := map[string]any{
		"strict":               "urwin",
		"strict-exact":         "Urwin",
		"strict-explicit-true": "urwin",
		"opt-out":              "urwin",
		"opt-out-snake":        "URWIN",
		"choice":               "Option-A",
		"choice-opt-out":       "option-a",
		"missing-key":          "Urwin",
	}
	results := objectiveResultsByID(t, scoreObjective(answers, nil, keys))

	correct := map[string]bool{
		"strict":               false,
		"strict-exact":         true,
		"strict-explicit-true": false,
		"opt-out":              true,
		"opt-out-snake":        true,
		"choice":               true,
		// Option IDs are raw identity; the opt-out must not start cleaning them.
		"choice-opt-out": false,
		// No readable key: fail closed instead of guessing.
		"missing-key": false,
	}
	for questionID, want := range correct {
		result, ok := results[questionID]
		if !ok {
			t.Fatalf("missing result for %q", questionID)
		}
		if result.Correct != want {
			t.Fatalf("%s correct = %v, want %v", questionID, result.Correct, want)
		}
		if result.MaxPoints != 1 {
			t.Fatalf("%s maxPoints = %v, want 1", questionID, result.MaxPoints)
		}
		if want && result.Points != 1 {
			t.Fatalf("%s points = %v, want 1", questionID, result.Points)
		}
		if !want && result.Points != 0 {
			t.Fatalf("%s points = %v, want 0", questionID, result.Points)
		}
	}
}

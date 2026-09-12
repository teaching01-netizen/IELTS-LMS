package main

// Redaction contract: V1 snapshots carry no key material in ANY spelling,
// and single_choice options keep display fields only. Regression pins for
// the snake_case-twin bypass (scorer accepts both spellings) and the
// verbatim-options bypass (nested isCorrect).
import (
	"encoding/json"
	"testing"
)

func redactedOf(t *testing.T, raw any) map[string]any {
	t.Helper()
	out, err := redactAnswerValue(raw)
	if err != nil {
		t.Fatalf("redactAnswerValue must accept the envelope: %v", err)
	}
	encoded, _ := json.Marshal(out)
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("redacted answer must re-decode: %v", err)
	}
	return decoded
}

func TestRedactionDropsSnakeCaseKeyMaterial(t *testing.T) {
	decoded := redactedOf(t, map[string]any{
		"kind":                 "single_choice",
		"options":              []any{map[string]any{"id": "A", "content": "x"}},
		"correct_option_id":    "A",
		"accepted_responses":   []any{"A"},
		"normalize_fraction":   true,
		"rationale":            "why A",
		"is_pretest":           true,
	})
	for _, key := range []string{"correct_option_id", "correctOptionId", "accepted_responses", "acceptedResponses", "rationale", "is_pretest", "isPretest"} {
		if _, ok := decoded[key]; ok {
			t.Fatalf("key material %q must not survive redaction: %v", key, decoded)
		}
	}
	if decoded["kind"] != "single_choice" {
		t.Fatalf("kind must survive: %v", decoded)
	}
	if _, ok := decoded["normalize_fraction"]; ok {
		t.Fatalf("SPR-only field must not leak into single_choice: %v", decoded)
	}
}

func TestRedactionStripsNestedOptionCorrectness(t *testing.T) {
	decoded := redactedOf(t, map[string]any{
		"kind": "single_choice",
		"options": []any{
			map[string]any{"id": "A", "content": "x", "isCorrect": true},
			map[string]any{"id": "B", "content": "y", "is_correct": false, "explanation": "no"},
		},
		"correctOptionId": "A",
	})
	opts, ok := decoded["options"].([]any)
	if !ok || len(opts) != 2 {
		t.Fatalf("options must survive with 2 elements: %v", decoded)
	}
	for i, raw := range opts {
		opt, _ := raw.(map[string]any)
		for _, key := range []string{"isCorrect", "is_correct", "explanation", "correctOptionId"} {
			if _, ok := opt[key]; ok {
				t.Fatalf("option %d keeps key-adjacent field %q: %v", i, key, opt)
			}
		}
		if _, ok := opt["id"]; !ok {
			t.Fatalf("option %d must keep id: %v", i, opt)
		}
		if _, ok := opt["content"]; !ok {
			t.Fatalf("option %d must keep content: %v", i, opt)
		}
	}
	if _, ok := decoded["correctOptionId"]; ok {
		t.Fatalf("top-level key must not survive: %v", decoded)
	}
}

func TestRedactionAcceptsSnakeCaseNormalizationContract(t *testing.T) {
	decoded := redactedOf(t, map[string]any{
		"kind":                "student_produced_response",
		"normalize_fraction":  true,
		"normalize_decimal":   false,
		"numeric_tolerance":   "0.01",
		"accepted_responses":  []any{"7"},
	})
	if decoded["normalizeFraction"] != true {
		t.Fatalf("snake input must emit canonical normalizeFraction: %v", decoded)
	}
	if decoded["numericTolerance"] != "0.01" {
		t.Fatalf("snake input must emit canonical numericTolerance: %v", decoded)
	}
	if _, ok := decoded["accepted_responses"]; ok {
		t.Fatalf("key material must not survive: %v", decoded)
	}
	if _, ok := decoded["acceptedResponses"]; ok {
		t.Fatalf("key material must not survive: %v", decoded)
	}
}

func TestSnapshotWalkCoversSnakeCaseEnvelope(t *testing.T) {
	root := map[string]any{
		"sections": []any{map[string]any{
			"questions": []any{map[string]any{
				"answer_definition": map[string]any{
					"kind": "single_choice", "options": []any{},
					"correct_option_id": "B",
				},
				"is_pretest": true,
			}},
		}},
	}
	redactSnapshotValue(root)
	sections := root["sections"].([]any)
	questions := sections[0].(map[string]any)["questions"].([]any)
	question := questions[0].(map[string]any)
	if _, ok := question["is_pretest"]; ok {
		t.Fatalf("snake is_pretest must be stripped: %v", question)
	}
	def, _ := question["answer_definition"].(map[string]any)
	if _, ok := def["correct_option_id"]; ok {
		t.Fatalf("snake key must be stripped from envelope: %v", def)
	}
}

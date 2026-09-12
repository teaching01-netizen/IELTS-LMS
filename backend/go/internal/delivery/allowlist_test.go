package delivery

// Allowlist contract: deliveredAnswer emits display fields only, in ANY
// input spelling. Mirrors the cmd/api redaction tests; both functions must
// stay in lockstep (parity anchor in service.go).
import (
	"encoding/json"
	"testing"
)

func deliveredOf(t *testing.T, raw string) map[string]any {
	t.Helper()
	out, err := deliveredAnswer(json.RawMessage(raw))
	if err != nil {
		t.Fatalf("deliveredAnswer must accept the envelope: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(out, &decoded); err != nil {
		t.Fatalf("delivered answer must re-decode: %v", err)
	}
	return decoded
}

func TestDeliveredAnswerStripsSnakeCaseAndOptionsFlags(t *testing.T) {
	decoded := deliveredOf(t, `{"kind":"single_choice","options":[{"id":"A","content":"x","isCorrect":true},{"id":"B","content":"y","is_correct":false}],"correct_option_id":"A","rationale":"why"}`)
	opts, ok := decoded["options"].([]any)
	if !ok || len(opts) != 2 {
		t.Fatalf("options must survive with 2 elements: %v", decoded)
	}
	for i, raw := range opts {
		opt, _ := raw.(map[string]any)
		for _, key := range []string{"isCorrect", "is_correct"} {
			if _, ok := opt[key]; ok {
				t.Fatalf("option %d keeps %q: %v", i, key, opt)
			}
		}
	}
	for _, key := range []string{"correct_option_id", "correctOptionId", "rationale"} {
		if _, ok := decoded[key]; ok {
			t.Fatalf("key material %q must not survive: %v", key, decoded)
		}
	}
}

func TestDeliveredAnswerCanonicalizesSnakeContract(t *testing.T) {
	decoded := deliveredOf(t, `{"kind":"student_produced_response","normalize_fraction":true,"numeric_tolerance":"0.01","accepted_responses":["7"]}`)
	if decoded["normalizeFraction"] != true {
		t.Fatalf("must emit canonical normalizeFraction: %v", decoded)
	}
	if decoded["numericTolerance"] != "0.01" {
		t.Fatalf("must emit canonical numericTolerance: %v", decoded)
	}
	if _, ok := decoded["accepted_responses"]; ok {
		t.Fatalf("key material must not survive: %v", decoded)
	}
}

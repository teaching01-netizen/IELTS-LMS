package assessscore

import "testing"

func TestSATSingleChoiceVerdict(t *testing.T) {
	def := `{"kind":"single_choice","correctOptionId":"B"}`
	if !SATResponseCorrect(def, true, `"B"`) {
		t.Fatal("expected B to be correct")
	}
	if SATResponseCorrect(def, true, `"A"`) {
		t.Fatal("expected A to be incorrect")
	}
	// Non-string responses can never be correct.
	if SATResponseCorrect(def, true, `3`) {
		t.Fatal("expected numeric response to be incorrect")
	}
	// Missing response never correct.
	if SATResponseCorrect(def, false, "") {
		t.Fatal("expected missing response to be incorrect")
	}
}

func TestSATStudentProducedResponseVerdict(t *testing.T) {
	def := `{"kind":"student_produced_response","acceptedResponses":["7","seven"]}`
	if !SATResponseCorrect(def, true, `"seven"`) {
		t.Fatal("expected accepted response to be correct")
	}
	if SATResponseCorrect(def, true, `"8"`) {
		t.Fatal("expected unknown response to be incorrect")
	}
}

func TestSATCorrectAnswerExtraction(t *testing.T) {
	if key, ok := SATCorrectAnswer(`{"kind":"single_choice","correctOptionId":"C"}`); !ok || key != "C" {
		t.Fatalf("expected option C, got %#v %v", key, ok)
	}
	if key, ok := SATCorrectAnswer(`{"kind":"student_produced_response","acceptedResponses":["42","forty-two"]}`); !ok || key != "42" {
		t.Fatalf("expected first accepted 42, got %#v %v", key, ok)
	}
	// Missing key surfaces as not-ok so callers render a null verdict.
	if _, ok := SATCorrectAnswer(`{"kind":"single_choice"}`); ok {
		t.Fatal("expected missing key to report not-ok")
	}
	if SATHasKey(`{"kind":"mystery"}`) {
		t.Fatal("expected unknown kind to report no key")
	}
}

func TestACTAnswersEqual(t *testing.T) {
	if !ACTAnswersEqual("a", "A") {
		t.Fatal("expected case-insensitive science match")
	}
	if ACTAnswersEqual("A", "B") {
		t.Fatal("expected mismatch")
	}
	if !ACTResponsePresent(" x ", true) || ACTResponsePresent("  ", true) || ACTResponsePresent(nil, true) {
		t.Fatal("expected answered/blank/nil presence rules")
	}
}

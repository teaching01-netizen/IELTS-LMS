package attempts

import (
	"testing"
)

func TestCanonicalJSONKeyOrder(t *testing.T) {
	a := map[string]any{"b": 1, "a": 2}
	b := map[string]any{"a": 2, "b": 1}
	ha, err := HashResponse(a)
	if err != nil {
		t.Fatal(err)
	}
	hb, err := HashResponse(b)
	if err != nil {
		t.Fatal(err)
	}
	if ha != hb {
		t.Fatalf("key order affected hash: %s vs %s", ha, hb)
	}
}

func TestFinalDigestStableAndSorted(t *testing.T) {
	d1, err := FinalDigest(map[string]string{"q2": "cd", "q1": "ab"})
	if err != nil {
		t.Fatal(err)
	}
	d2, err := FinalDigest(map[string]string{"q1": "ab", "q2": "cd"})
	if err != nil {
		t.Fatal(err)
	}
	if d1 != d2 {
		t.Fatal("digest not order independent")
	}
	d3, err := FinalDigest(map[string]string{"q1": "ab", "q2": "ce"})
	if err != nil {
		t.Fatal(err)
	}
	if d1 == d3 {
		t.Fatal("digest collision on different input")
	}
}

func TestFinalDigestVector(t *testing.T) {
	// Golden vector: canonical form of [["q1","ab"],["q2","cd"]] sorted.
	d, err := FinalDigest(map[string]string{"q1": "ab", "q2": "cd"})
	if err != nil {
		t.Fatal(err)
	}
	// sha256('[["q1","ab"],["q2","cd"]]')
	const want = "b71a14e4ff9048a6ef35e274cf42f5d52c9f01c07b6ee380dcde1f35d4ab0af5"
	if d != want {
		t.Fatalf("digest vector mismatch: got %s want %s", d, want)
	}
}

func TestValidateEnvelopeRejects(t *testing.T) {
	if err := ValidateSaveEnvelope(SaveResponsesCommand{}); err == nil {
		t.Fatal("expected error for empty envelope")
	}
	cmd := SaveResponsesCommand{AttemptID: "a", LeaseEpoch: 1, ControlEpoch: 1, Commands: []ResponseCommand{{WriteID: "w", QuestionID: "q", ClientVersion: 0}}}
	if err := ValidateSaveEnvelope(cmd); err == nil {
		t.Fatal("expected error for zero client version")
	}
}

package sat

import (
	"encoding/json"
	"testing"
)

// DeterministicScorer is a pure function of (normalized, maxRaw): pin the
// clamp + scale boundaries so the completion gate cannot silently drift.
func TestDeterministicScorerBoundaries(t *testing.T) {
	policy := PolicyConfig{Raw: json.RawMessage(`{}`)}
	cases := []struct {
		name       string
		normalized int
		maxRaw     int
		want       int
	}{
		{"zero", 0, 27, 200},
		{"max", 27, 27, 800},
		{"clamp negative", -5, 27, 200},
		{"clamp above max", 99, 27, 800},
		{"nonpositive max defaults to one", 1, 0, 800},
	}
	for _, tc := range cases {
		got, err := (DeterministicScorer{}).ScoreSection(SectionReadingWriting, "lower", tc.normalized, tc.maxRaw, policy)
		if err != nil {
			t.Fatalf("%s: unexpected error %v", tc.name, err)
		}
		if got != tc.want {
			t.Fatalf("%s: score = %d, want %d", tc.name, got, tc.want)
		}
	}
	if _, err := (DeterministicScorer{}).ScoreSection(SectionMath, "lower", 1, 1, PolicyConfig{}); err == nil {
		t.Fatal("missing policy must fail closed")
	}
}

// normalizedRaw scales raw hits by operational coverage: pin zero-coverage,
// clamp, and rounding behavior shared by every terminal scoring path.
func TestNormalizedRawEdges(t *testing.T) {
	if got := normalizedRaw(10, 0, 27); got != 0 {
		t.Fatalf("zero operational coverage = %d, want 0", got)
	}
	if got := normalizedRaw(27, 27, 27); got != 27 {
		t.Fatalf("full coverage = %d, want 27", got)
	}
	if got := normalizedRaw(99, 10, 27); got != 27 {
		t.Fatalf("over-coverage clamps to max, got %d", got)
	}
	if got := normalizedRaw(1, 4, 27); got != 7 {
		t.Fatalf("rounding: (1*27+2)/4 = 7, got %d", got)
	}
	if got := normalizedRaw(5, 10, 0); got != 0 {
		t.Fatalf("nonpositive max = %d, want 0", got)
	}
}

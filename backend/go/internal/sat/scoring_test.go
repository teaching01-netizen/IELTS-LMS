package sat

import (
	"encoding/json"
	"strconv"
	"strings"
	"testing"
)

func TestPolicyScorerUsesConfiguredConversionTable(t *testing.T) {
	policy := PolicyConfig{Raw: json.RawMessage(`{
		"readingWriting": {"lower": {"0": 200, "1": 210}, "higher": {"0": 220}},
		"math": {"lower": {"0": 230}, "higher": {"0": 240}}
	}`)}

	got, err := (PolicyScorer{}).ScoreSection(SectionReadingWriting, "lower", 1, 27, policy)
	if err != nil {
		t.Fatalf("configured score rejected: %v", err)
	}
	if got != 210 {
		t.Fatalf("configured score = %d, want 210", got)
	}
}

func TestPolicyScorerFailsClosedForMissingEntries(t *testing.T) {
	_, err := (PolicyScorer{}).ScoreSection(SectionMath, "higher", 12, 20, PolicyConfig{
		Raw: json.RawMessage(`{"math":{"higher":{"0":240}}}`),
	})
	if err == nil || !strings.Contains(err.Error(), "configured score is missing") {
		t.Fatalf("expected missing conversion error, got %v", err)
	}
}

// Counterexamples from verification/lean/sat-result: null decoded to 0, and off-scale
// integers were reported as scores.
func TestPolicyScorerRejectsNullAndOffScaleEntries(t *testing.T) {
	for _, entry := range []string{`null`, `0`, `199`, `801`, `7000`, `650.5`, `"650"`} {
		_, err := (PolicyScorer{}).ScoreSection(SectionMath, "lower", 5, 20, PolicyConfig{
			Raw: json.RawMessage(`{"math":{"lower":{"5":` + entry + `}}}`),
		})
		if err == nil {
			t.Fatalf("entry %s: expected error, got a score", entry)
		}
	}
	for _, s := range []int{200, 800} {
		got, err := (PolicyScorer{}).ScoreSection(SectionMath, "lower", 5, 20, PolicyConfig{
			Raw: json.RawMessage(`{"math":{"lower":{"5":` + strconv.Itoa(s) + `}}}`),
		})
		if err != nil || got != s {
			t.Fatalf("boundary %d: got %d, %v", s, got, err)
		}
	}
}

func TestNewServiceDefaultsToPolicyScorer(t *testing.T) {
	svc := NewService(nil, nil, nil, nil)
	if _, ok := svc.scorer.(PolicyScorer); !ok {
		t.Fatalf("nil scorer default = %T, want PolicyScorer", svc.scorer)
	}
}

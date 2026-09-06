package sat

import (
	"encoding/json"
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

func TestNewServiceDefaultsToPolicyScorer(t *testing.T) {
	svc := NewService(nil, nil, nil, nil)
	if _, ok := svc.scorer.(PolicyScorer); !ok {
		t.Fatalf("nil scorer default = %T, want PolicyScorer", svc.scorer)
	}
}

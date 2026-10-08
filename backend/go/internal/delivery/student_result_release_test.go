package delivery

import (
	"encoding/json"
	"testing"

	"example.com/ielts-proctoring/internal/sat"
)

// The student release policy must fail closed: only an explicitly visible
// status ever exposes score fields, and an unknown provider/status/NULL never
// does. This is the single predicate behind every student-facing score field.
func TestStudentResultScoreVisible(t *testing.T) {
	cases := []struct {
		name     string
		provider string
		release  string
		want     bool
	}{
		{"released sat is visible", "sat", "released", true},
		{"released is case insensitive", "SAT", "Released", true},
		{"pending sat is withheld", "sat", "pending", false},
		{"ready_to_release sat is withheld until a release step exists", "sat", "ready_to_release", false},
		{"invalidated sat is withheld", "sat", "invalidated", false},
		{"empty status fails closed", "sat", "", false},
		{"whitespace status fails closed", "sat", "   ", false},
		{"released act is visible", "act", "released", true},
		{"pending act is withheld", "act", "pending", false},
		{"unknown provider only trusts released", "unknown-provider", "released", true},
		{"unknown provider withholds anything else", "unknown-provider", "pending", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := StudentResultScoreVisible(tc.provider, tc.release); got != tc.want {
				t.Fatalf("StudentResultScoreVisible(%q, %q) = %v, want %v", tc.provider, tc.release, got, tc.want)
			}
		})
	}
}

// A withheld SAT result keeps the completion receipt (the student client gates
// its complete phase on result != null and reads the outcome) but must serialise
// no score fields at all.
func TestStudentSafeBootstrapResultWithholdsSATTotals(t *testing.T) {
	total := 1380
	released := &sat.AssessmentResult{
		ID: "res-1", AttemptID: "att-1", ProviderKey: "sat",
		OutcomeStatus: "scored", ScoreKind: "practice", TotalScore: &total,
		ScorePayload: map[string]any{"raw": 39},
		ReleaseStatus: "released",
		Sections: []sat.SectionResult{{SectionKey: "reading-writing"}},
	}

	if got := studentSafeBootstrapResult("sat", released); got != released {
		t.Fatalf("released result must pass through unchanged, got %#v", got)
	}

	pending := *released
	pending.ReleaseStatus = "pending"
	projected, ok := studentSafeBootstrapResult("sat", &pending).(*sat.AssessmentResult)
	if !ok {
		t.Fatalf("expected *sat.AssessmentResult receipt projection, got %T", studentSafeBootstrapResult("sat", &pending))
	}
	if projected.ID != "res-1" || projected.OutcomeStatus != "scored" || projected.ReleaseStatus != "pending" {
		t.Fatalf("receipt must keep identity/outcome/release, got %#v", projected)
	}
	if projected.TotalScore != nil || projected.ScorePayload != nil || projected.Sections != nil || projected.ScoreKind != "" {
		t.Fatalf("withheld result must drop every score field, got %#v", projected)
	}

	raw, err := json.Marshal(projected)
	if err != nil {
		t.Fatal(err)
	}
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	if wire["totalScore"] != nil || wire["scorePayload"] != nil || wire["sections"] != nil {
		t.Fatalf("withheld wire payload leaked a score field: %s", raw)
	}
	if wire["outcomeStatus"] != "scored" || wire["releaseStatus"] != "pending" {
		t.Fatalf("withheld wire payload lost its receipt fields: %s", raw)
	}

	// A nil result stays nil: withholding must not resurrect a result for an
	// attempt that never had one.
	if got := studentSafeBootstrapResult("sat", (*sat.AssessmentResult)(nil)); got != (*sat.AssessmentResult)(nil) {
		t.Fatalf("nil SAT result must stay nil, got %#v", got)
	}
}

// The ACT bootstrap result is a free-form map; the receipt projection keeps the
// identity + outcome keys and drops the score payload.
func TestStudentSafeBootstrapResultWithholdsACTScorePayload(t *testing.T) {
	released := map[string]any{
		"id": "res-2", "attemptId": "att-2", "providerKey": "act",
		"outcomeStatus": "scored", "releaseStatus": "released",
		"totalScore": int64(30), "scorePayload": map[string]any{"percentile": 92.0},
	}
	if got := studentSafeBootstrapResult("act", released); got == nil {
		t.Fatal("released ACT result must pass through")
	}

	pending := map[string]any{
		"id": "res-2", "submissionId": "sub-2", "attemptId": "att-2", "providerKey": "act",
		"outcomeStatus": "scored", "releaseStatus": "pending",
		"totalScore": int64(30), "scorePayload": map[string]any{"percentile": 92.0},
	}
	projected, ok := studentSafeBootstrapResult("act", pending).(map[string]any)
	if !ok {
		t.Fatal("expected map receipt projection")
	}
	if _, leaked := projected["totalScore"]; leaked {
		t.Fatalf("withheld ACT receipt leaked totalScore: %#v", projected)
	}
	if _, leaked := projected["scorePayload"]; leaked {
		t.Fatalf("withheld ACT receipt leaked scorePayload: %#v", projected)
	}
	if projected["outcomeStatus"] != "scored" || projected["releaseStatus"] != "pending" || projected["submissionId"] != "sub-2" {
		t.Fatalf("withheld ACT receipt lost receipt fields: %#v", projected)
	}
}

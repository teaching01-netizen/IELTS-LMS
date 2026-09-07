package main

import (
	"encoding/json"
	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/release"
	"example.com/ielts-proctoring/internal/results"
	"example.com/ielts-proctoring/internal/sat"
	"testing"
)

func TestNullableResponseFieldsRemainPresent(t *testing.T) {
	cases := []struct {
		name  string
		value any
		keys  []string
	}{
		{"release", release.ReleaseState{}, []string{"currentPublishedVersion", "workingDraft"}},
		{"published", release.ReleasePublishedVersion{}, []string{"publishNotes"}},
		{"draft", release.ReleaseWorkingDraft{}, []string{"parentVersionId"}},
		{"access", accesslinks.AccessLink{}, []string{"audienceLabel", "opensAt", "closesAt"}},
		{"public access", accesslinks.PublicAccessLink{}, []string{"audienceLabel", "opensAt", "closesAt"}},
		{"member", accesslinks.Member{}, []string{"studentName", "studentEmail"}},
		{"result", results.ResultSummary{}, []string{"submissionId", "studentEmail", "totalScore", "submittedAt"}},
		{"section result", results.SATSection{}, []string{"route", "scaledScore"}},
		{"delivery result", sat.AssessmentResult{}, []string{"totalScore"}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw, err := json.Marshal(tc.value)
			if err != nil {
				t.Fatal(err)
			}
			var wire map[string]any
			json.Unmarshal(raw, &wire)
			for _, key := range tc.keys {
				value, ok := wire[key]
				if !ok || value != nil {
					t.Errorf("expected explicit null for %s: %s", key, raw)
				}
			}
		})
	}
}

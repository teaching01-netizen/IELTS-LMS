package grading

import "testing"

func TestObjectiveBandForTotal(t *testing.T) {
	config := map[string]any{
		"standards": map[string]any{
			"bandScoreTables": map[string]any{
				"listening":              map[string]any{"30": 7.0, "25": 6.5, "0": 0.0},
				"readingAcademic":        map[string]any{"30": 7.0, "25": 6.5, "0": 0.0},
				"readingGeneralTraining": map[string]any{"30": 8.0, "25": 7.5, "0": 0.0},
			},
		},
	}
	tests := []struct {
		name     string
		examType string
		section  string
		total    float64
		want     float64
		wantOK   bool
	}{
		{name: "listening exact threshold", examType: "Academic", section: "listening", total: 30, want: 7.0, wantOK: true},
		{name: "listening lower threshold", examType: "Academic", section: "listening", total: 27, want: 6.5, wantOK: true},
		{name: "reading academic", examType: "Academic", section: "reading", total: 30, want: 7.0, wantOK: true},
		{name: "reading general training", examType: "General Training", section: "reading", total: 30, want: 8.0, wantOK: true},
		{name: "below table", examType: "Academic", section: "listening", total: 0, want: 0, wantOK: true},
		{name: "unknown section", examType: "Academic", section: "writing", total: 7, want: 0, wantOK: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			got, ok := objectiveBandForTotal(config, test.examType, test.section, test.total)
			if ok != test.wantOK || got != test.want {
				t.Fatalf("objectiveBandForTotal() = %v, %v; want %v, %v", got, ok, test.want, test.wantOK)
			}
		})
	}
}

func TestObjectiveBandForTotalFallsBackToSectionTable(t *testing.T) {
	config := map[string]any{
		"sections": map[string]any{
			"reading": map[string]any{
				"bandScoreTable": map[string]any{"23": 6.0},
			},
		},
	}
	got, ok := objectiveBandForTotal(config, "Academic", "reading", 23)
	if !ok || got != 6.0 {
		t.Fatalf("fallback band = %v, %v; want 6, true", got, ok)
	}
}

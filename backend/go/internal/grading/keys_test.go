package grading

import (
	"reflect"
	"testing"
)

func TestKeySourceTableRows(t *testing.T) {
	tests := []struct {
		name         string
		questionType string
		question     map[string]any
		want         []string
	}{
		{
			name:         "matching reads correctHeading when acceptedAnswers is absent",
			questionType: "MATCHING",
			question:     map[string]any{"correctHeading": "H2"},
			want:         []string{"H2"},
		},
		{
			name:         "matching prefers acceptedAnswers, then correctHeading, then correctAnswer",
			questionType: "MATCHING",
			question:     map[string]any{"acceptedAnswers": []any{"H3"}, "correctHeading": "H2", "correctAnswer": "H1"},
			want:         []string{"H3"},
		},
		{
			name:         "matching prefers correctHeading over stale correctAnswer",
			questionType: "MATCHING",
			question:     map[string]any{"correctHeading": "H2", "correctAnswer": "H1"},
			want:         []string{"H2"},
		},
		{
			name:         "classification grades the union of correctCategory and acceptedAnswers",
			questionType: "CLASSIFICATION",
			question:     map[string]any{"correctCategory": "B", "acceptedAnswers": []any{"B", "C"}},
			want:         []string{"B", "C"},
		},
		{
			name:         "classification prefers correctCategory over stale correctAnswer",
			questionType: "CLASSIFICATION",
			question:     map[string]any{"correctCategory": "B", "correctAnswer": "A"},
			want:         []string{"B"},
		},
		{
			name:         "classification never grades a legacy correctAnswer",
			questionType: "CLASSIFICATION",
			question:     map[string]any{"correctAnswer": "A"},
			want:         []string{},
		},
		{
			name:         "matching features grades the union of correctMatch and acceptedAnswers",
			questionType: "MATCHING_FEATURES",
			question:     map[string]any{"correctMatch": "M2", "acceptedAnswers": []any{"M1"}, "correctAnswer": "M0"},
			want:         []string{"M2", "M1"},
		},
		{
			name:         "matching features prefers correctMatch over stale correctAnswer",
			questionType: "MATCHING_FEATURES",
			question:     map[string]any{"correctMatch": "M2", "correctAnswer": "M1"},
			want:         []string{"M2"},
		},
		{
			name:         "matching features never grades a legacy correctAnswer",
			questionType: "MATCHING_FEATURES",
			question:     map[string]any{"correctAnswer": "M1"},
			want:         []string{},
		},
		{
			name:         "tfng reads correctAnswer before acceptedAnswers",
			questionType: "TFNG",
			question:     map[string]any{"acceptedAnswers": []any{"T", "TRUE"}, "correctAnswer": "F"},
			want:         []string{"F"},
		},
		{
			name:         "tfng reads acceptedAnswers when correctAnswer is absent",
			questionType: "TFNG",
			question:     map[string]any{"acceptedAnswers": []any{"TRUE"}},
			want:         []string{"TRUE"},
		},
		{
			name:         "map reads correctAnswer when acceptedAnswers is absent",
			questionType: "MAP",
			question:     map[string]any{"correctAnswer": "north gate"},
			want:         []string{"north gate"},
		},
		{
			name:         "cloze reads acceptedAnswers before correctAnswer",
			questionType: "CLOZE",
			question:     map[string]any{"acceptedAnswers": []any{"colour", "color"}, "correctAnswer": "shade"},
			want:         []string{"colour", "color"},
		},
		{
			name:         "short answer falls back to correctAnswer",
			questionType: "SHORT_ANSWER",
			question:     map[string]any{"correctAnswer": "a | b"},
			want:         []string{"a", "b"},
		},
		{
			name:         "sentence blank reads correctAnswer",
			questionType: "SENTENCE_COMPLETION",
			question:     map[string]any{"correctAnswer": "waiter"},
			want:         []string{"waiter"},
		},
		{
			name:         "note blank reads acceptedAnswers",
			questionType: "NOTE_COMPLETION",
			question:     map[string]any{"acceptedAnswers": []any{"alpha"}, "correctAnswer": "beta"},
			want:         []string{"alpha"},
		},
		{
			name:         "diagram label reads correctAnswer",
			questionType: "DIAGRAM_LABELING",
			question:     map[string]any{"correctAnswer": "wheel"},
			want:         []string{"wheel"},
		},
		{
			name:         "diagram label keeps the primary key when alternates are present",
			questionType: "DIAGRAM_LABELING",
			question:     map[string]any{"correctAnswer": "wheel", "acceptedAnswers": []any{"tyre", "rim"}},
			want:         []string{"wheel", "tyre", "rim"},
		},
		{
			name:         "diagram label splits pipe variants in every key field",
			questionType: "DIAGRAM_LABELING",
			question:     map[string]any{"correctAnswer": "a | b", "acceptedAnswers": []any{"c|d"}},
			want:         []string{"a", "b", "c", "d"},
		},
		{
			name:         "diagram label dedupes candidates across both key fields",
			questionType: "DIAGRAM_LABELING",
			question:     map[string]any{"correctAnswer": "wheel | Wheel", "acceptedAnswers": []any{"wheel", "tyre"}},
			want:         []string{"wheel", "Wheel", "tyre"},
		},
		{
			name:         "diagram label folds dedupe on caseSensitive false",
			questionType: "DIAGRAM_LABELING",
			question:     map[string]any{"correctAnswer": "Wheel", "acceptedAnswers": []any{"wheel"}, "caseSensitive": false},
			want:         []string{"Wheel"},
		},
		{
			name:         "flow step reads correctAnswer",
			questionType: "FLOW_CHART",
			question:     map[string]any{"correctAnswer": "mix"},
			want:         []string{"mix"},
		},
		{
			name:         "flow step keeps the primary key when alternates are present",
			questionType: "FLOW_CHART",
			question:     map[string]any{"correctAnswer": "mix", "acceptedAnswers": []any{"stir", "blend"}},
			want:         []string{"mix", "stir", "blend"},
		},
		{
			name:         "flow step splits pipe variants in every key field",
			questionType: "FLOW_CHART",
			question:     map[string]any{"correctAnswer": "mix|stir", "acceptedAnswers": []any{"blend | combine"}},
			want:         []string{"mix", "stir", "blend", "combine"},
		},
		{
			name:         "map stays single-winner with correctAnswer first",
			questionType: "MAP",
			question:     map[string]any{"correctAnswer": "north gate", "acceptedAnswers": []any{"south gate"}},
			want:         []string{"north gate"},
		},
		{
			name:         "table cell reads acceptedAnswers",
			questionType: "TABLE_COMPLETION",
			question:     map[string]any{"acceptedAnswers": []any{"1999"}, "correctAnswer": "2000"},
			want:         []string{"1999"},
		},
		{
			name:         "sub-answer leaf reads acceptedAnswers",
			questionType: "SUB_ANSWER_TREE",
			question:     map[string]any{"acceptedAnswers": []any{"yes"}, "correctAnswer": "no"},
			want:         []string{"yes"},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := projectionAcceptedAnswers(test.question, test.questionType); !reflect.DeepEqual(got, test.want) {
				t.Fatalf("projectionAcceptedAnswers() = %#v, want %#v", got, test.want)
			}
		})
	}
}

func TestMatchingHeadingOnlyKeyGradesCorrectly(t *testing.T) {
	content := map[string]any{
		"reading": map[string]any{
			"passages": []any{
				map[string]any{
					"blocks": []any{
						map[string]any{
							"id":   "match-block",
							"type": "MATCHING",
							"headings": []any{
								map[string]any{"id": "H1", "text": "First"},
								map[string]any{"id": "H2", "text": "Second"},
							},
							"questions": []any{
								map[string]any{"id": "q-match", "paragraphLabel": "C", "correctHeading": "H2"},
							},
						},
					},
				},
			},
		},
	}
	result := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"q-match": "H2"},
	})
	if len(result.Questions) != 1 {
		t.Fatalf("got %d question results, want 1", len(result.Questions))
	}
	question := result.Questions[0]
	if question.Correctness == nil || !*question.Correctness {
		t.Fatalf("matching-heading-only key graded incorrectly: %#v", question)
	}
	if result.TotalScore != 1 || result.MaxScore != 1 {
		t.Fatalf("totals = %v/%v, want 1/1", result.TotalScore, result.MaxScore)
	}
}

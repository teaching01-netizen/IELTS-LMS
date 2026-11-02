package grading

import "testing"

func readingContent(blocks ...map[string]any) map[string]any {
	items := make([]any, 0, len(blocks))
	for _, block := range blocks {
		items = append(items, block)
	}
	return map[string]any{
		"reading": map[string]any{
			"passages": []any{map[string]any{"blocks": items}},
		},
	}
}

func questionByID(t *testing.T, result ParitySectionResult, id string) ParityQuestionResult {
	t.Helper()
	for _, question := range result.Questions {
		if question.QuestionID == id {
			return question
		}
	}
	t.Fatalf("question %q not found in %#v", id, result.Questions)
	return ParityQuestionResult{}
}

func assertScore(t *testing.T, question ParityQuestionResult, awarded, max float64) {
	t.Helper()
	if question.AwardedScore == nil || *question.AwardedScore != awarded {
		t.Fatalf("%s awarded = %v, want %v", question.QuestionID, question.AwardedScore, awarded)
	}
	if question.MaxScore == nil || *question.MaxScore != max {
		t.Fatalf("%s max = %v, want %v", question.QuestionID, question.MaxScore, max)
	}
}

func TestMultiSelectPartialCredit(t *testing.T) {
	content := readingContent(map[string]any{
		"id":   "multi",
		"type": "MULTI_MCQ",
		"options": []any{
			map[string]any{"id": "o1", "isCorrect": true},
			map[string]any{"id": "o2", "isCorrect": true},
			map[string]any{"id": "o3", "isCorrect": false},
		},
	})
	tests := []struct {
		name    string
		answers map[string]any
		awarded float64
		max     float64
		status  string
	}{
		{name: "all correct", answers: map[string]any{"multi": []any{"o1", "o2"}}, awarded: 2, max: 2, status: "verified_correct"},
		{name: "one of two", answers: map[string]any{"multi": []any{"o1"}}, awarded: 1, max: 2, status: "verified_incorrect"},
		{name: "none correct", answers: map[string]any{"multi": []any{"o3"}}, awarded: 0, max: 2, status: "verified_incorrect"},
		{name: "blank", answers: map[string]any{}, awarded: 0, max: 2, status: "verified_unanswered"},
		{name: "more than N selections", answers: map[string]any{"multi": []any{"o1", "o2", "o3"}}, awarded: 0, max: 2, status: "verified_incorrect"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			result := GradeContentForParity(ParityInput{Section: "reading", Content: content, Answers: test.answers})
			question := questionByID(t, result, "multi")
			assertScore(t, question, test.awarded, test.max)
			if question.Status != test.status {
				t.Fatalf("status = %q, want %q", question.Status, test.status)
			}
			if result.MaxScore != test.max {
				t.Fatalf("section max = %v, want %v (builder numbers a choose-2 block twice)", result.MaxScore, test.max)
			}
		})
	}
}

func TestMultiSelectScheduleOverrideKeepsPartialCredit(t *testing.T) {
	content := readingContent(map[string]any{
		"id":   "multi",
		"type": "MULTI_MCQ",
		"options": []any{
			map[string]any{"id": "o1", "isCorrect": true},
			map[string]any{"id": "o2", "isCorrect": false},
		},
	})
	result := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"multi": []any{"o1"}},
		Overrides: map[string]ParityOverride{
			"multi": {CorrectOptionIDs: []string{"o1", "o2"}, MaxScore: 2, ScoringRule: "MULTI_MCQ"},
		},
	})
	question := questionByID(t, result, "multi")
	assertScore(t, question, 1, 2)
	if question.Correctness == nil || *question.Correctness {
		t.Fatalf("partial override answer should not be fully correct: %#v", question)
	}
}

func TestGroupedTableCellsShareOneMark(t *testing.T) {
	block := map[string]any{
		"id":   "table",
		"type": "TABLE_COMPLETION",
		"cells": []any{
			map[string]any{"id": "c1", "correctAnswer": "x", "scoreGroupId": "g1", "requiredCorrect": 2},
			map[string]any{"id": "c2", "correctAnswer": "y", "scoreGroupId": "g1", "requiredCorrect": 2},
		},
	}
	content := readingContent(block)

	partial := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"table": []any{"x"}},
	})
	assertScore(t, questionByID(t, partial, "table:c1"), 0, 1)
	assertScore(t, questionByID(t, partial, "table:c2"), 0, 0)
	if partial.MaxScore != 1 {
		t.Fatalf("section max = %v, want 1 (one mark per group)", partial.MaxScore)
	}

	complete := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"table": []any{"x", "y"}},
	})
	assertScore(t, questionByID(t, complete, "table:c1"), 1, 1)
	if complete.TotalScore != 1 || complete.MaxScore != 1 {
		t.Fatalf("complete group totals = %v/%v, want 1/1", complete.TotalScore, complete.MaxScore)
	}
}

func TestSentenceAnswerPoolConsumesEachKeyOnce(t *testing.T) {
	content := readingContent(map[string]any{
		"id":   "sentence",
		"type": "SENTENCE_COMPLETION",
		"questions": []any{
			map[string]any{
				"id":                    "s1",
				"acceptAnyAnswerKey":    true,
				"sharedAcceptedAnswers": []any{"alpha", "beta"},
				"blanks": []any{
					map[string]any{"id": "b1", "correctAnswer": "alpha"},
					map[string]any{"id": "b2", "correctAnswer": "beta"},
				},
			},
		},
	})

	swapped := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"s1": []any{"beta", "alpha"}},
	})
	assertScore(t, questionByID(t, swapped, "s1:b1"), 1, 1)
	assertScore(t, questionByID(t, swapped, "s1:b2"), 1, 1)

	repeated := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"s1": []any{"alpha", "alpha"}},
	})
	assertScore(t, questionByID(t, repeated, "s1:b1"), 1, 1)
	assertScore(t, questionByID(t, repeated, "s1:b2"), 0, 1)
	if repeated.TotalScore != 1 {
		t.Fatalf("repeated pool answer scored %v, want 1", repeated.TotalScore)
	}
}

func TestSubAnswerTreeUnorderedMatchesRootOnce(t *testing.T) {
	content := readingContent(map[string]any{
		"id":                   "tree",
		"type":                 "SHORT_ANSWER",
		"subAnswerModeEnabled": true,
		"questions":            []any{},
		"answerTree": []any{
			map[string]any{
				"id": "r1",
				"children": []any{
					map[string]any{"id": "lf1", "acceptedAnswers": []any{"yes"}, "required": true},
					map[string]any{"id": "lf2", "acceptedAnswers": []any{"no"}, "required": true},
				},
			},
		},
	})

	swapped := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{
			"tree::tree::r1::lf1": "no",
			"tree::tree::r1::lf2": "yes",
		},
	})
	assertScore(t, questionByID(t, swapped, "tree::tree::r1::lf1"), 1, 1)
	assertScore(t, questionByID(t, swapped, "tree::tree::r1::lf2"), 0, 0)
	if swapped.TotalScore != 1 || swapped.MaxScore != 1 {
		t.Fatalf("swapped tree totals = %v/%v, want 1/1", swapped.TotalScore, swapped.MaxScore)
	}

	missing := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"tree::tree::r1::lf1": "yes"},
	})
	if missing.TotalScore != 0 {
		t.Fatalf("tree with a missing required leaf scored %v, want 0", missing.TotalScore)
	}
}

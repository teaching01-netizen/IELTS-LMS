package grading

import (
	"reflect"
	"testing"
)

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

func TestGroupedAndTreeOverridesUseOverrideMax(t *testing.T) {
	table := readingContent(map[string]any{
		"id":   "table",
		"type": "TABLE_COMPLETION",
		"cells": []any{
			map[string]any{"id": "c1", "correctAnswer": "x", "scoreGroupId": "g1", "requiredCorrect": 2},
			map[string]any{"id": "c2", "correctAnswer": "y", "scoreGroupId": "g1", "requiredCorrect": 2},
		},
	})
	grouped := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: table,
		Answers: map[string]any{"table": []any{"x", "y"}},
		Overrides: map[string]ParityOverride{
			"table:c1": {AcceptedAnswers: []string{"x"}, ScoringRule: "exact_match", MaxScore: 2},
		},
	})
	assertScore(t, questionByID(t, grouped, "table:c1"), 2, 2)
	if grouped.TotalScore != 2 || grouped.MaxScore != 2 {
		t.Fatalf("grouped override totals = %v/%v, want 2/2", grouped.TotalScore, grouped.MaxScore)
	}

	tree := readingContent(map[string]any{
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
	treeResult := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: tree,
		Answers: map[string]any{
			"tree::tree::r1::lf1": "no",
			"tree::tree::r1::lf2": "yes",
		},
		Overrides: map[string]ParityOverride{
			"tree::tree::r1::lf1": {AcceptedAnswers: []string{"yes"}, ScoringRule: "exact_match", MaxScore: 2},
		},
	})
	assertScore(t, questionByID(t, treeResult, "tree::tree::r1::lf1"), 2, 2)
	if treeResult.TotalScore != 2 || treeResult.MaxScore != 2 {
		t.Fatalf("tree override totals = %v/%v, want 2/2", treeResult.TotalScore, treeResult.MaxScore)
	}
}

func sharedPoolContent() map[string]any {
	return readingContent(map[string]any{
		"id":   "sentence",
		"type": "SENTENCE_COMPLETION",
		"questions": []any{
			map[string]any{
				"id":                    "case-pool",
				"acceptAnyAnswerKey":    true,
				"sharedAcceptedAnswers": []any{"Garden", "garden"},
				"blanks": []any{
					map[string]any{"id": "c1"},
					map[string]any{"id": "c2"},
				},
			},
			map[string]any{
				"id":                    "mixed-pool",
				"acceptAnyAnswerKey":    true,
				"sharedAcceptedAnswers": []any{"Garden", "garden"},
				"blanks": []any{
					map[string]any{"id": "m1"},
					map[string]any{"id": "m2", "caseSensitive": false},
				},
			},
		},
	})
}

// TestSharedPoolConsumesEachCaseVariantOnce pins the one-shot pool contract:
// consuming one key never consumes its case-variant sibling, so both strict
// blanks of ["Garden", "garden"] score, and a strict blank plus an opt-out
// blank can consume the two variants under their own rules.
func TestSharedPoolConsumesEachCaseVariantOnce(t *testing.T) {
	content := sharedPoolContent()

	bothStrict := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"case-pool": []any{"Garden", "garden"}},
	})
	assertScore(t, questionByID(t, bothStrict, "case-pool:c1"), 1, 1)
	assertScore(t, questionByID(t, bothStrict, "case-pool:c2"), 1, 1)
	if bothStrict.TotalScore != 2 {
		t.Fatalf("case-variant pool scored %v, want 2", bothStrict.TotalScore)
	}

	mixed := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"mixed-pool": []any{"Garden", "GARDEN"}},
	})
	assertScore(t, questionByID(t, mixed, "mixed-pool:m1"), 1, 1)
	assertScore(t, questionByID(t, mixed, "mixed-pool:m2"), 1, 1)

	// Strict blanks stay strict: the sibling "garden" is a different key, so
	// "GARDEN" must not score the second strict blank.
	caseOnlySecond := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"case-pool": []any{"Garden", "GARDEN"}},
	})
	assertScore(t, questionByID(t, caseOnlySecond, "case-pool:c1"), 1, 1)
	assertScore(t, questionByID(t, caseOnlySecond, "case-pool:c2"), 0, 1)
}

// TestNoteCompletionSharesSentenceGroupingAndPool proves note completion is
// graded by the same grouped-slot and shared-pool branch as sentence
// completion; only the block type differs.
func TestNoteCompletionSharesSentenceGroupingAndPool(t *testing.T) {
	questions := []any{
		map[string]any{
			"id":                    "shared",
			"acceptAnyAnswerKey":    true,
			"sharedAcceptedAnswers": []any{"red", "blue"},
			"blanks": []any{
				map[string]any{"id": "b1", "correctAnswer": "red"},
				map[string]any{"id": "b2", "correctAnswer": "blue"},
			},
		},
		map[string]any{
			"id": "grouped",
			"blanks": []any{
				map[string]any{"id": "g1", "correctAnswer": "one", "scoreGroupId": "grp", "requiredCorrect": 2},
				map[string]any{"id": "g2", "correctAnswer": "two", "scoreGroupId": "grp", "requiredCorrect": 2},
			},
		},
	}
	answers := map[string]any{"shared": []any{"blue", "red"}, "grouped": []any{"one"}}
	sentence := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: readingContent(map[string]any{"id": "blk", "type": "SENTENCE_COMPLETION", "questions": questions}),
		Answers: answers,
	})
	note := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: readingContent(map[string]any{"id": "blk", "type": "NOTE_COMPLETION", "questions": questions}),
		Answers: answers,
	})
	if !reflect.DeepEqual(sentence, note) {
		t.Fatalf("note completion diverged from sentence completion:\nsentence=%#v\nnote=%#v", sentence, note)
	}
	// The grouped note blanks share one mark: one of two required never scores.
	assertScore(t, questionByID(t, note, "grouped:g1"), 0, 1)
	assertScore(t, questionByID(t, note, "grouped:g2"), 0, 0)
	// The shared pool consumes blank order, not the pool's own order.
	assertScore(t, questionByID(t, note, "shared:b1"), 1, 1)
	assertScore(t, questionByID(t, note, "shared:b2"), 1, 1)
}

// TestProjectionBlankAndFailClosedInputs pins the two deliberate projection
// rules that are not answer cleaning: whitespace-only answers count as
// unanswered, and an array answer to a single-value question fails closed.
func TestProjectionBlankAndFailClosedInputs(t *testing.T) {
	content := readingContent(map[string]any{
		"id":   "cloze",
		"type": "CLOZE",
		"questions": []any{
			map[string]any{"id": "whitespace", "correctAnswer": "alpha"},
			map[string]any{"id": "array", "correctAnswer": "sole"},
		},
	})
	result := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"whitespace": "   ", "array": []any{"sole", "extra"}},
	})

	whitespace := questionByID(t, result, "whitespace")
	if whitespace.Status != "verified_unanswered" {
		t.Fatalf("whitespace-only answer status = %q, want verified_unanswered", whitespace.Status)
	}
	assertScore(t, whitespace, 0, 1)

	array := questionByID(t, result, "array")
	if array.Status != "verified_incorrect" {
		t.Fatalf("array answer status = %q, want verified_incorrect", array.Status)
	}
	assertScore(t, array, 0, 1)
}

// TestProjectionSealedKeyFallbackHonorsCaseSensitiveOptOut covers the snapshot
// answer-key fallback: when the sealed content carries no readable key the
// spec is filled from the answer_definition, and that definition's case policy
// must grade exactly like scoreObjective — strict by default, case-insensitive
// only for an explicit caseSensitive: false.
func TestProjectionSealedKeyFallbackHonorsCaseSensitiveOptOut(t *testing.T) {
	content := readingContent(map[string]any{
		"id":   "cloze",
		"type": "CLOZE",
		"questions": []any{
			map[string]any{"id": "strict"},
			map[string]any{"id": "strict-exact"},
			map[string]any{"id": "opt-out", "caseSensitive": false},
		},
	})
	keys := map[string]string{
		"strict":       `{"kind":"student_produced_response","acceptedResponses":["Urwin"]}`,
		"strict-exact": `{"kind":"student_produced_response","acceptedResponses":["Urwin"]}`,
		"opt-out":      `{"kind":"student_produced_response","acceptedResponses":["Urwin"],"caseSensitive":false}`,
	}
	result := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		Answers: map[string]any{"strict": "urwin", "strict-exact": "Urwin", "opt-out": "urwin"},
		Keys:    keys,
	})

	// Positive control: the fallback key really was filled and grades exactly.
	strictExact := questionByID(t, result, "strict-exact")
	if strictExact.Correctness == nil || !*strictExact.Correctness {
		t.Fatalf("fallback filled key did not grade an exact match: %#v", strictExact)
	}
	if len(strictExact.AcceptedAnswers) != 1 || strictExact.AcceptedAnswers[0] != "Urwin" {
		t.Fatalf("fallback accepted answers = %#v, want [Urwin]", strictExact.AcceptedAnswers)
	}

	// Default stays strict even when the key comes from the sealed definition.
	strict := questionByID(t, result, "strict")
	if strict.Correctness == nil || *strict.Correctness {
		t.Fatalf("default sealed key graded case-insensitively: %#v", strict)
	}
	if strict.Status != "verified_incorrect" {
		t.Fatalf("default sealed key status = %q, want verified_incorrect", strict.Status)
	}

	// The sealed definition's explicit opt-out is threaded into the spec.
	optOut := questionByID(t, result, "opt-out")
	if optOut.Correctness == nil || !*optOut.Correctness {
		t.Fatalf("caseSensitive:false sealed key did not match case-insensitively: %#v", optOut)
	}
	if optOut.Status != "verified_correct" {
		t.Fatalf("opt-out sealed key status = %q, want verified_correct", optOut.Status)
	}
}

// TestDiagramAndFlowKeysAreAdditive pins the additive key rule for diagram
// labels and flow-chart steps: the primary correctAnswer and the
// acceptedAnswers alternatives are all graded, so a written alternatives list
// can never shadow the selected key (MAP stays single-winner).
func TestDiagramAndFlowKeysAreAdditive(t *testing.T) {
	content := readingContent(
		map[string]any{
			"id":   "diagram",
			"type": "DIAGRAM_LABELING",
			"labels": []any{
				map[string]any{"id": "dl1", "correctAnswer": "wheel", "acceptedAnswers": []any{"tyre", "rim"}},
				map[string]any{"id": "dl2", "correctAnswer": "a | b", "acceptedAnswers": []any{"c|d"}},
			},
		},
		map[string]any{
			"id":   "flow",
			"type": "FLOW_CHART",
			"steps": []any{
				map[string]any{"id": "fs1", "correctAnswer": "mix", "acceptedAnswers": []any{"stir"}},
			},
		},
	)

	primary := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		// dl1 primary, dl2 primary pipe variant, fs1 primary.
		Answers: map[string]any{"diagram": []any{"wheel", "b"}, "flow": []any{"mix"}},
	})
	for _, id := range []string{"diagram:dl1", "diagram:dl2", "flow:fs1"} {
		question := questionByID(t, primary, id)
		if question.Correctness == nil || !*question.Correctness {
			t.Fatalf("%s: primary key lost when alternates are present: %#v", id, question)
		}
	}
	if primary.TotalScore != 3 {
		t.Fatalf("primary-key total = %v, want 3", primary.TotalScore)
	}

	alternates := GradeContentForParity(ParityInput{
		Section: "reading",
		Content: content,
		// dl1 acceptedAnswers, dl2 acceptedAnswers pipe variant, fs1 alternative.
		Answers: map[string]any{"diagram": []any{"rim", "d"}, "flow": []any{"stir"}},
	})
	for _, id := range []string{"diagram:dl1", "diagram:dl2", "flow:fs1"} {
		question := questionByID(t, alternates, id)
		if question.Correctness == nil || !*question.Correctness {
			t.Fatalf("%s: accepted alternative did not match: %#v", id, question)
		}
	}
	if alternates.TotalScore != 3 {
		t.Fatalf("alternates total = %v, want 3", alternates.TotalScore)
	}

	// Accepted keys keep primary-first order for display/publish.
	dl1 := questionByID(t, primary, "diagram:dl1")
	if !reflect.DeepEqual(dl1.AcceptedAnswers, []string{"wheel", "tyre", "rim"}) {
		t.Fatalf("diagram accepted keys = %#v, want [wheel tyre rim]", dl1.AcceptedAnswers)
	}
}

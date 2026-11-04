package grading

// This file is the Go side of the key-source table: one place that says where
// each question type stores its answer key and in what order fields are read.
// The website's getEffectiveAcceptedAnswers in src/components/admin/
// gradingAnswerUtils.ts mirrors these rows; a test per row exists on both sides.

import (
	"sort"
	"strings"
)

// keySourceFields is the shared single-winner read-order table per question
// type; the website mirrors it and keys_manifest_test checks it against the
// shared fixture. The first non-empty field is the key, so an explicit
// acceptedAnswers list can never be shadowed by a stale legacy correctAnswer.
// Types whose editors write more than one graded key field are NOT listed
// here: they are additive and live in additiveAnswerFields below (and in the
// manifest's additiveRows), so this table never certifies a field that is
// actually ignored.
var keySourceFields = map[string][]string{
	"TFNG":                {"correctAnswer", "acceptedAnswers"},
	"CLOZE":               {"acceptedAnswers", "correctAnswer"},
	"MATCHING":            {"acceptedAnswers", "correctHeading", "correctAnswer"},
	"MAP":                 {"correctAnswer", "acceptedAnswers"},
	"SHORT_ANSWER":        {"acceptedAnswers", "correctAnswer"},
	"SENTENCE_COMPLETION": {"acceptedAnswers", "correctAnswer"},
	"NOTE_COMPLETION":     {"acceptedAnswers", "correctAnswer"},
	"TABLE_COMPLETION":    {"acceptedAnswers", "correctAnswer"},
	"SUB_ANSWER_TREE":     {"acceptedAnswers", "correctAnswer"},
	"SINGLE_MCQ":          {"acceptedAnswers", "correctAnswer"},
}

// fieldsForQuestionType returns the key read order for a block/question type.
func fieldsForQuestionType(questionType string) []string {
	if fields, ok := keySourceFields[strings.ToUpper(strings.TrimSpace(questionType))]; ok {
		return fields
	}
	return keySourceDefaultFields
}

var keySourceDefaultFields = []string{"acceptedAnswers", "correctAnswer"}

// KeySourceFields is the test-facing view of one single-winner table row.
func KeySourceFields(questionType string) []string {
	return append([]string(nil), fieldsForQuestionType(questionType)...)
}

// AdditiveAnswerFields is the test-facing view of one additive row: every
// listed field contributes keys, in order.
func AdditiveAnswerFields(questionType string) []string {
	return append([]string(nil), additiveAnswerFields(questionType)...)
}

// KeySourceTypes returns every explicit row in the table.
func KeySourceTypes() []string {
	types := make([]string, 0, len(keySourceFields))
	for questionType := range keySourceFields {
		types = append(types, questionType)
	}
	sort.Strings(types)
	return types
}

// sentenceAnswerPool is the shared "accept any key" pool: explicit
// sharedAcceptedAnswers when present (even when empty), otherwise the union of
// the blanks' own accepted answers and correct answers, each key once.
// Default strict: case-distinct variants are distinct keys. Only an explicit
// question-level `caseSensitive: false` (or every blank opting out) folds case.
func sentenceAnswerPool(question map[string]any, blanks []any) []string {
	strict := true
	if flag, ok := question["caseSensitive"].(bool); ok {
		strict = flag
	} else {
		allOptOut := len(blanks) > 0
		for _, rawBlank := range blanks {
			blank, ok := rawBlank.(map[string]any)
			if !ok {
				allOptOut = false
				break
			}
			if flag, ok := blank["caseSensitive"].(bool); !ok || flag {
				allOptOut = false
				break
			}
		}
		if allOptOut {
			strict = false
		}
	}
	seen := map[string]bool{}
	pool := make([]string, 0)
	appendKey := func(value string) {
		normalized := normalizeAnswer(value)
		if normalized == "" {
			return
		}
		key := answerDedupeKey(normalized, strict)
		if seen[key] {
			return
		}
		seen[key] = true
		pool = append(pool, normalized)
	}
	if raw, ok := question["sharedAcceptedAnswers"]; ok {
		if list, ok := raw.([]any); ok {
			for _, value := range list {
				if text, ok := value.(string); ok {
					for _, variant := range strings.Split(text, "|") {
						appendKey(variant)
					}
				}
			}
			return pool
		}
	}
	for _, rawBlank := range blanks {
		blank, ok := rawBlank.(map[string]any)
		if !ok {
			continue
		}
		for _, field := range []string{"correctAnswer", "acceptedAnswers"} {
			raw, ok := blank[field]
			if !ok || raw == nil {
				continue
			}
			values := []any{raw}
			if list, ok := raw.([]any); ok {
				values = list
			}
			for _, value := range values {
				if text, ok := value.(string); ok {
					for _, variant := range strings.Split(text, "|") {
						appendKey(variant)
					}
				}
			}
		}
	}
	return pool
}

func sentenceScoreGroupKey(blockID, questionID string, blank map[string]any) string {
	groupID := stringOrEmpty(blank["scoreGroupId"])
	if groupID == "" {
		return ""
	}
	return blockID + "::sentence::" + questionID + "::group::" + groupID
}

func slotScoreGroupKey(blockID, questionType string, item map[string]any) string {
	groupID := stringOrEmpty(item["scoreGroupId"])
	if groupID == "" || questionType != "TABLE_COMPLETION" {
		return ""
	}
	return blockID + "::table::group::" + groupID
}

// requiredCorrectForSlot mirrors the website's default: a missing or invalid
// requiredCorrect means one correct slot earns the group's mark. The group's
// effective value is the maximum across its slots.
func requiredCorrectForSlot(item map[string]any) int {
	if number, ok := projectionNumber(item["requiredCorrect"]); ok && number >= 1 {
		return int(number)
	}
	return 1
}

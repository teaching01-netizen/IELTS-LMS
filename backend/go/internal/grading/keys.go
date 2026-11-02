package grading

// This file is the Go side of the key-source table: one place that says where
// each question type stores its answer key and in what order fields are read.
// The website's getEffectiveAcceptedAnswers in src/components/admin/
// gradingAnswerUtils.ts mirrors these rows; a test per row exists on both sides.

import "strings"

// keySourceFields is the read order per question type. "acceptedAnswers" is
// always the explicit list; the specific field comes before any legacy
// correctAnswer so a stale legacy value can never win.
var keySourceFields = map[string][]string{
	"TFNG":                {"correctAnswer", "acceptedAnswers"},
	"CLOZE":               {"acceptedAnswers", "correctAnswer"},
	"MATCHING":            {"acceptedAnswers", "correctHeading", "correctAnswer"},
	"MAP":                 {"correctAnswer", "acceptedAnswers"},
	"SHORT_ANSWER":        {"acceptedAnswers", "correctAnswer"},
	"SENTENCE_COMPLETION": {"acceptedAnswers", "correctAnswer"},
	"NOTE_COMPLETION":     {"acceptedAnswers", "correctAnswer"},
	"DIAGRAM_LABELING":    {"acceptedAnswers", "correctAnswer"},
	"FLOW_CHART":          {"acceptedAnswers", "correctAnswer"},
	"TABLE_COMPLETION":    {"acceptedAnswers", "correctAnswer"},
	"CLASSIFICATION":      {"acceptedAnswers", "correctCategory", "correctAnswer"},
	"MATCHING_FEATURES":   {"acceptedAnswers", "correctMatch", "correctAnswer"},
	"SUB_ANSWER_TREE":     {"acceptedAnswers", "correctAnswer"},
	"SINGLE_MCQ":          {"acceptedAnswers", "correctAnswer"},
}

// fieldsForQuestionType returns the key read order for a block/question type.
func fieldsForQuestionType(questionType string) []string {
	if fields, ok := keySourceFields[strings.ToUpper(strings.TrimSpace(questionType))]; ok {
		return fields
	}
	return keySourceFields["CLOZE"]
}

// sentenceAnswerPool is the shared "accept any key" pool: explicit
// sharedAcceptedAnswers when present (even when empty), otherwise the union of
// the blanks' own accepted answers and correct answers, each key once.
func sentenceAnswerPool(question map[string]any, blanks []any) []string {
	seen := map[string]bool{}
	pool := make([]string, 0)
	appendKey := func(value string) {
		normalized := normalizeAnswer(value)
		if normalized == "" || seen[strings.ToLower(normalized)] {
			return
		}
		seen[strings.ToLower(normalized)] = true
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

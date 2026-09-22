// Package satpublish owns the intentionally small SAT publish-content
// contract. Authoring diagnostics may be more detailed, but publishing only
// depends on the four rules in this package.
package satpublish

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

// Queryer is the smallest database boundary needed to validate a draft. It is
// implemented by both *sql.DB and tx.Tx, so the exam publish transaction can
// validate the exact locked draft immediately before sealing it.
type Queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type Question struct {
	ExamQuestionID string
	QuestionType   string
	Prompt         string
	Answer         string
}

type Module struct {
	SectionKey          string
	ModuleKey           string
	Title               string
	TargetQuestionCount int
	Questions           []Question
}

type Issue struct {
	Code     string
	Path     string
	Message  string
	Blocking bool
}

func issue(code, path, message string) Issue {
	return Issue{Code: code, Path: path, Message: message, Blocking: true}
}

// ValidateQuestion is the SAT publish validator for one question. It does
// not inspect metadata, stimulus, rationale, accessibility, rich-content
// schema, timing, routing, or pretest placement.
func ValidateQuestion(question Question) []Issue {
	issues := make([]Issue, 0)
	if !hasVisibleContent(question.Prompt) {
		issues = append(issues, issue(
			"question.prompt.required",
			"prompt",
			"Question text is required.",
		))
	}

	answer := jsonObject(question.Answer)
	switch question.QuestionType {
	case "single_choice":
		validateChoiceAnswer(answer, &issues)
	case "student_produced_response":
		validateSPRAnswer(answer, &issues)
	default:
		// SAT currently has only the two answer shapes above. Unknown shapes do
		// not acquire a new publish rule here; the contract is deliberately
		// limited to the requirements that apply to known question types.
	}
	return issues
}

// ValidateModule applies the module count rule and prefixes question findings
// with the exam-question identity used by the release deep-link.
func ValidateModule(module Module) []Issue {
	issues := make([]Issue, 0)
	if len(module.Questions) != module.TargetQuestionCount {
		label := strings.TrimSpace(module.Title)
		if label == "" {
			label = strings.TrimSpace(module.ModuleKey)
		}
		if label == "" {
			label = "Module"
		}
		issues = append(issues, issue(
			"sat.module.incomplete",
			modulePath(module),
			fmt.Sprintf("%s has %d of %d questions.", label, len(module.Questions), module.TargetQuestionCount),
		))
	}
	for _, question := range module.Questions {
		for _, questionIssue := range ValidateQuestion(question) {
			questionIssue.Path = "examQuestion:" + question.ExamQuestionID + ":" + questionIssue.Path
			issues = append(issues, questionIssue)
		}
	}
	return issues
}

func modulePath(module Module) string {
	section := strings.TrimSpace(module.SectionKey)
	key := strings.TrimSpace(module.ModuleKey)
	if section == "" {
		return key
	}
	if key == "" {
		return section
	}
	return section + "." + key
}

// ValidateDraft reads the normalized SAT authoring tables for one exact draft
// version. It is used by both the release readiness endpoint and the locked
// exam publish transaction, which prevents a stale client from bypassing the
// content gate.
func ValidateDraft(ctx context.Context, q Queryer, versionID string) ([]Issue, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT s.section_key, m.module_key, m.title, m.target_question_count, m.id
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order ASC, m.display_order ASC, m.id ASC`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	type moduleRow struct {
		sectionKey, moduleKey, title, id string
		target                           int
	}
	modules := make([]moduleRow, 0)
	for rows.Next() {
		var module moduleRow
		if err := rows.Scan(&module.sectionKey, &module.moduleKey, &module.title, &module.target, &module.id); err != nil {
			return nil, err
		}
		modules = append(modules, module)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	issues := make([]Issue, 0)
	for _, moduleRow := range modules {
		questionRows, err := q.QueryContext(ctx, `
			SELECT eq.id, r.question_type,
			       CAST(r.prompt AS CHAR), CAST(r.answer_definition AS CHAR)
			FROM assessment_exam_questions eq
			JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
			WHERE eq.module_id = ?
			ORDER BY eq.display_order ASC, eq.id ASC`, moduleRow.id)
		if err != nil {
			return nil, err
		}
		questions := make([]Question, 0)
		for questionRows.Next() {
			var question Question
			if err := questionRows.Scan(&question.ExamQuestionID, &question.QuestionType, &question.Prompt, &question.Answer); err != nil {
				questionRows.Close()
				return nil, err
			}
			questions = append(questions, question)
		}
		if err := questionRows.Err(); err != nil {
			questionRows.Close()
			return nil, err
		}
		questionRows.Close()

		issues = append(issues, ValidateModule(Module{
			SectionKey:          moduleRow.sectionKey,
			ModuleKey:           moduleRow.moduleKey,
			Title:               moduleRow.title,
			TargetQuestionCount: moduleRow.target,
			Questions:           questions,
		})...)
	}
	return issues, nil
}

func validateChoiceAnswer(answer map[string]any, issues *[]Issue) {
	options, _ := answer["options"].([]any)
	if len(options) != 4 {
		*issues = append(*issues, issue(
			"sat.choice.count",
			"answer.options",
			"SAT multiple-choice questions require four answer choices.",
		))
	}

	correct := stringField(answer, "correctOptionId", "correct_option_id")
	if strings.TrimSpace(correct) == "" {
		*issues = append(*issues, issue(
			"sat.correct_answer.required",
			"answer.correctOptionId",
			"Select the correct answer.",
		))
	} else {
		found := false
		for _, option := range options {
			if object, ok := option.(map[string]any); ok && stringField(object, "id") == correct {
				found = true
				break
			}
		}
		if !found {
			*issues = append(*issues, issue(
				"sat.correct_answer.invalid",
				"answer.correctOptionId",
				"The correct answer must reference one of the answer choices.",
			))
		}
	}

	for index, option := range options {
		object, _ := option.(map[string]any)
		content, exists := object["content"]
		if !exists {
			content = nil
		}
		if !hasVisibleContentValue(content) {
			*issues = append(*issues, issue(
				"sat.choice.content.required",
				fmt.Sprintf("answer.options[%d].content", index),
				"Answer choice content is required.",
			))
		}
	}
}

func validateSPRAnswer(answer map[string]any, issues *[]Issue) {
	values, ok := answer["acceptedResponses"].([]any)
	if !ok {
		values, _ = answer["accepted_responses"].([]any)
	}
	for _, value := range values {
		if response, ok := value.(string); ok && strings.TrimSpace(response) != "" {
			return
		}
	}
	*issues = append(*issues, issue(
		"sat.spr.answer.required",
		"answer.acceptedResponses",
		"At least one accepted response is required.",
	))
}

func jsonObject(raw string) map[string]any {
	var object map[string]any
	if json.Unmarshal([]byte(raw), &object) != nil || object == nil {
		return map[string]any{}
	}
	return object
}

func stringField(object map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := object[key].(string); ok {
			return value
		}
	}
	return ""
}

func hasVisibleContentValue(value any) bool {
	if text, ok := value.(string); ok {
		return strings.TrimSpace(text) != ""
	}
	if value == nil {
		return false
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return false
	}
	return hasVisibleContent(string(raw))
}

func hasVisibleContent(raw string) bool {
	object, ok := structuredObject(raw)
	if !ok {
		return false
	}
	if document, ok := object["document"].(map[string]any); ok && stringField(document, "type") == "doc" {
		children, _ := document["content"].([]any)
		for _, child := range children {
			if richNodeHasVisibleContent(child) {
				return true
			}
		}
	}
	if nodes, ok := object["nodes"].([]any); ok {
		for _, node := range nodes {
			if legacyNodeHasVisibleContent(node) {
				return true
			}
		}
	}
	return false
}

func structuredObject(raw string) (map[string]any, bool) {
	var object map[string]any
	if err := json.Unmarshal([]byte(raw), &object); err != nil || object == nil {
		return nil, false
	}
	return object, true
}

func legacyNodeHasVisibleContent(value any) bool {
	object, ok := value.(map[string]any)
	if !ok {
		return false
	}
	switch stringField(object, "type") {
	case "image":
		return true
	case "table":
		rows, _ := object["rows"].([]any)
		for _, row := range rows {
			cells, _ := row.([]any)
			for _, cell := range cells {
				if text, ok := cell.(string); ok && strings.TrimSpace(text) != "" {
					return true
				}
			}
		}
		return false
	case "equation":
		return strings.TrimSpace(stringField(object, "latex")) != ""
	default:
		return strings.TrimSpace(stringField(object, "text")) != ""
	}
}

func richNodeHasVisibleContent(value any) bool {
	object, ok := value.(map[string]any)
	if !ok {
		return false
	}
	switch stringField(object, "type") {
	case "image":
		return true
	case "inlineMath", "blockMath":
		attrs, _ := object["attrs"].(map[string]any)
		return strings.TrimSpace(stringField(attrs, "latex")) != ""
	case "text":
		return strings.TrimSpace(stringField(object, "text")) != ""
	}
	children, _ := object["content"].([]any)
	for _, child := range children {
		if richNodeHasVisibleContent(child) {
			return true
		}
	}
	return false
}

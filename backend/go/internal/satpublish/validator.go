// Package satpublish owns the SAT publish-content contract: question content,
// configured module counts, section question types, and
// required adaptive module presence.
package satpublish

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"example.com/ielts-proctoring/internal/assessscore"
	"example.com/ielts-proctoring/internal/satconvert"
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
// schema, timing, or routing.
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

// ValidateModule applies the question and module count rules and prefixes
// question findings with the exam-question identity used by the release deep-link.
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
		questionIssues := ValidateQuestion(question)
		// Student-produced response is Math-only on the Digital SAT; Reading &
		// Writing is multiple choice throughout.
		if strings.TrimSpace(module.SectionKey) == SectionReadingWriting && question.QuestionType != "single_choice" {
			questionIssues = append(questionIssues, issue(
				"sat.rw.question_type",
				"questionType",
				"Reading & Writing questions must be multiple choice.",
			))
		}
		for _, questionIssue := range questionIssues {
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
	return ValidateDraftForScope(ctx, q, versionID, ScopeFull)
}

// ValidateDraftForScope applies the publish contract only to the sections
// selected for this immutable SAT release.
func ValidateDraftForScope(ctx context.Context, q Queryer, versionID string, scope Scope) ([]Issue, error) {
	normalizedScope, err := NormalizeScope(scope)
	if err != nil {
		return nil, err
	}
	plan, err := LoadPlan(ctx, q, versionID)
	if err != nil {
		return nil, err
	}
	query := `
		SELECT s.section_key, m.module_key, m.title, m.target_question_count, m.id
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?`
	args := []any{versionID}
	if normalizedScope != ScopeFull {
		sectionKeys, err := normalizedScope.SectionKeys()
		if err != nil {
			return nil, err
		}
		plural := strings.Repeat("?,", len(sectionKeys))
		plural = strings.TrimSuffix(plural, ",")
		query += " AND s.section_key IN (" + plural + ")"
		for _, key := range sectionKeys {
			args = append(args, key)
		}
	}
	query += " ORDER BY s.display_order ASC, m.display_order ASC, m.id ASC"
	rows, err := q.QueryContext(ctx, query, args...)
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
	present := map[string]bool{}
	operational := map[string]int{}
	for _, moduleRow := range modules {
		role := RoleOfModuleKey(moduleRow.moduleKey)
		if role != "" && !plan.Uses(moduleRow.sectionKey, role) {
			continue // a Classroom plan that never delivers this module does not gate publish on it
		}
		present[moduleRow.sectionKey+"/"+role] = true
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
		// Every question in a new release is scored.
		operational[moduleRow.sectionKey+"/"+role] += len(questions)

		issues = append(issues, ValidateModule(Module{
			SectionKey:          moduleRow.sectionKey,
			ModuleKey:           moduleRow.moduleKey,
			Title:               moduleRow.title,
			TargetQuestionCount: moduleRow.target,
			Questions:           questions,
		})...)
	}
	sectionKeys, err := normalizedScope.SectionKeys()
	if err != nil {
		return nil, err
	}
	for _, section := range sectionKeys {
		for _, role := range plan.ShapeFor(section).Roles() {
			if !present[section+"/"+role] {
				issues = append(issues, issue("sat.module.missing", section+"."+role, fmt.Sprintf("%s is missing its %s module.", section, role)))
			}
		}
	}
	converterIssues, err := validateConverter(ctx, q, versionID, plan, sectionKeys, operational)
	if err != nil {
		return nil, err
	}
	return append(issues, converterIssues...), nil
}

// topologiesFor lists the module topologies students can receive in a section
// under its Classroom shape, with the roles each one sums.
func topologiesFor(shape Shape) map[satconvert.Topology][]string {
	switch shape {
	case ShapeM1Easy:
		return map[satconvert.Topology][]string{satconvert.FullLower: {RoleBase, RoleLower}}
	case ShapeM1Hard:
		return map[satconvert.Topology][]string{satconvert.FullHigher: {RoleBase, RoleHigher}}
	case ShapeM2Easy:
		return map[satconvert.Topology][]string{satconvert.M2LowerOnly: {RoleLower}}
	case ShapeM2Hard:
		return map[satconvert.Topology][]string{satconvert.M2HigherOnly: {RoleHigher}}
	}
	return map[satconvert.Topology][]string{satconvert.FullLower: {RoleBase, RoleLower}, satconvert.FullHigher: {RoleBase, RoleHigher}}
}

// validateConverter is the §2 release-time rule: a draft that declares a
// versioned score converter cannot publish until every route its plan can
// deliver has a valid table for exactly the operational questions students
// will see. A draft without one publishes as a raw-score report.
func validateConverter(ctx context.Context, q Queryer, versionID string, plan Plan, sectionKeys []string, operational map[string]int) ([]Issue, error) {
	rows, err := q.QueryContext(ctx, "SELECT CAST(policy_config AS CHAR) FROM assessment_scoring_policies WHERE exam_version_id = ?", versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var raw string
	found := rows.Next()
	if found {
		if err := rows.Scan(&raw); err != nil {
			return nil, err
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if !found || !satconvert.Configured([]byte(raw)) {
		return nil, nil
	}
	conv, err := satconvert.Parse([]byte(raw))
	if err != nil {
		return []Issue{issue("sat.converter.invalid", "scoringPolicy", err.Error())}, nil
	}
	var reqs []satconvert.Requirement
	for _, section := range sectionKeys {
		for topo, roles := range topologiesFor(plan.ShapeFor(section)) {
			n := 0
			for _, role := range roles {
				n += operational[section+"/"+role]
			}
			reqs = append(reqs, satconvert.Requirement{Section: section, Topology: topo, Operational: n})
		}
	}
	var out []Issue
	for _, msg := range conv.Missing(reqs) {
		out = append(out, issue("sat.converter.missing", "scoringPolicy", msg))
	}
	return out, nil
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

	// Answers, grading and the answered paper all match a choice by id, so a
	// shared id would make two choices one answer.
	seen := make(map[string]bool, len(options))
	for index, option := range options {
		object, _ := option.(map[string]any)
		if id := stringField(object, "id"); seen[id] {
			*issues = append(*issues, issue(
				"sat.choice.id.duplicate",
				fmt.Sprintf("answer.options[%d].id", index),
				"Each answer choice needs its own id.",
			))
		} else {
			seen[id] = true
		}
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
	values, _ := answer["acceptedResponses"].([]any)
	if values == nil {
		values, _ = answer["accepted_responses"].([]any)
	}
	hasResponse := false
	for _, value := range values {
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			hasResponse = true
		}
	}
	if !hasResponse {
		*issues = append(*issues, issue("sat.spr.answer.required", "answer.acceptedResponses", "At least one numeric accepted response is required."))
		return
	}
	raw, err := json.Marshal(answer)
	if err == nil {
		err = assessscore.ValidateSATSPRDefinition(string(raw))
	}
	if err != nil {
		*issues = append(*issues, issue("sat.spr.answer.invalid", "answer", err.Error()))
	}
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

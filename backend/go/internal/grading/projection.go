package grading

// This file owns the terminal-attempt -> IELTS grading read-model projection.
// The worker is deliberately allowed to replay an attempt: every write below
// is keyed by the immutable attempt/submission/section/task identity and uses
// an upsert. A terminal snapshot is the only input, so a late browser write
// cannot change what gets graded.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// ProjectionAttempt is the immutable data needed to materialize one terminal
// IELTS attempt. Snapshots are copied from the pinned exam version by the
// worker query; callers must not pass live client state here.
type ProjectionAttempt struct {
	ID                 string
	ScheduleID         string
	ExamID             string
	PublishedVersionID string
	StudentID          string
	StudentName        string
	StudentEmail       string
	CohortName         string
	SubmittedAt        time.Time
	FinalSubmission    json.RawMessage
	ContentSnapshot    json.RawMessage
	ConfigSnapshot     json.RawMessage
}

// ProjectionReport counts rows materialized for one terminal attempt.
type ProjectionReport struct {
	SubmissionSynced int64
	SectionsSynced   int64
	WritingSynced    int64
}

// ProjectIELTSAttempt materializes the terminal attempt into the legacy IELTS
// grading read model. It is idempotent and transactionally creates the parent
// submission before its section and writing-task children.
func (s *Service) ProjectIELTSAttempt(ctx context.Context, attempt ProjectionAttempt) (ProjectionReport, error) {
	if s == nil || s.runner == nil {
		return ProjectionReport{}, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service is not configured.")
	}
	if strings.TrimSpace(attempt.ID) == "" || strings.TrimSpace(attempt.ScheduleID) == "" {
		return ProjectionReport{}, fmt.Errorf("grading projection: attempt and schedule ids are required")
	}

	finalSubmission := projectionObject(attempt.FinalSubmission)
	content := projectionObject(attempt.ContentSnapshot)
	config := projectionObject(attempt.ConfigSnapshot)
	submittedAt := attempt.SubmittedAt.UTC()
	if submittedAt.IsZero() {
		submittedAt = time.Now().UTC()
	}

	var report ProjectionReport
	err := s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		objectiveContent, objectiveConfig, objectiveVersion, err := loadProjectionObjectiveSource(
			ctx, q, attempt.ScheduleID, attempt.PublishedVersionID, content, config,
		)
		if err != nil {
			return err
		}

		submissionID, err := ensureProjectionSubmission(ctx, q, attempt, submittedAt)
		if err != nil {
			return err
		}
		report.SubmissionSynced = 1

		answers := projectionObjectValue(finalSubmission["answers"])
		writingAnswers := projectionObjectValue(finalSubmission["writingAnswers"])
		publishedSections, err := buildProjectionSections(
			ctx, q, answers, writingAnswers, content, config, attempt.PublishedVersionID,
		)
		if err != nil {
			return err
		}
		for _, section := range publishedSections {
			sectionID, err := upsertProjectionSection(ctx, q, submissionID, section, submittedAt)
			if err != nil {
				return err
			}
			report.SectionsSynced++
			if section.Name != "writing" {
				continue
			}
			for _, task := range buildProjectionWritingTasks(writingAnswers, content, config) {
				if err := upsertProjectionWritingTask(ctx, q, submissionID, sectionID, task, submittedAt); err != nil {
					return err
				}
				report.WritingSynced++
			}
		}

		// A schedule may explicitly grade objective answers against a newer draft
		// while writing remains pinned to the published version. Reapply only the
		// listening/reading rows from that source so replay never erases teacher
		// overrides or writing task records.
		if objectiveVersion != attempt.PublishedVersionID {
			objectiveSections, err := buildProjectionObjectiveSections(
				ctx, q, answers, objectiveContent, objectiveConfig, objectiveVersion,
			)
			if err != nil {
				return err
			}
			for _, section := range objectiveSections {
				if _, err := upsertProjectionSection(ctx, q, submissionID, section, submittedAt); err != nil {
					return err
				}
				report.SectionsSynced++
			}
		}
		return nil
	})
	return report, err
}

type projectionSection struct {
	Name          string
	Answers       string
	AutoResults   any
	GradingStatus string
}

type projectionWritingTask struct {
	ID        string
	Label     string
	Prompt    string
	Text      string
	WordCount int
}

func ensureProjectionSubmission(ctx context.Context, q tx.Tx, attempt ProjectionAttempt, submittedAt time.Time) (string, error) {
	var submissionID string
	err := q.QueryRowContext(ctx,
		"SELECT id FROM student_submissions WHERE attempt_id = ? AND provider_key = 'ielts' FOR UPDATE",
		attempt.ID).Scan(&submissionID)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	if err == sql.ErrNoRows {
		submissionID = uuid.NewString()
	}
	var email any
	if strings.TrimSpace(attempt.StudentEmail) != "" {
		email = attempt.StudentEmail
	}
	sectionStatuses := projectionJSON(map[string]any{
		"listening": "auto_graded",
		"reading":   "auto_graded",
		"writing":   "needs_review",
		"speaking":  "pending",
	})
	_, err = q.ExecContext(ctx, `
		INSERT INTO student_submissions (
			id, attempt_id, schedule_id, exam_id, published_version_id, provider_key,
			student_id, student_name, student_email, cohort_name, submitted_at,
			grading_status, section_statuses, created_at, updated_at
		)
		VALUES (?, ?, ?, ?, ?, 'ielts', ?, ?, ?, ?, ?, 'submitted', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
		ON DUPLICATE KEY UPDATE
			schedule_id = VALUES(schedule_id),
			exam_id = VALUES(exam_id),
			published_version_id = VALUES(published_version_id),
			student_id = VALUES(student_id),
			student_name = VALUES(student_name),
			student_email = VALUES(student_email),
			cohort_name = VALUES(cohort_name),
			submitted_at = VALUES(submitted_at),
			section_statuses = VALUES(section_statuses),
			updated_at = UTC_TIMESTAMP(6)`,
		submissionID, attempt.ID, attempt.ScheduleID, attempt.ExamID, attempt.PublishedVersionID,
		attempt.StudentID, attempt.StudentName, email, attempt.CohortName, submittedAt, sectionStatuses,
	)
	return submissionID, err
}

func upsertProjectionSection(ctx context.Context, q tx.Tx, submissionID string, section projectionSection, submittedAt time.Time) (string, error) {
	var sectionID string
	err := q.QueryRowContext(ctx,
		"SELECT id FROM section_submissions WHERE submission_id = ? AND section = ? FOR UPDATE",
		submissionID, section.Name).Scan(&sectionID)
	if err != nil && err != sql.ErrNoRows {
		return "", err
	}
	if err == sql.ErrNoRows {
		sectionID = uuid.NewString()
	}
	var autoResults any
	if section.AutoResults != nil {
		// database/sql does not marshal maps for the MySQL driver; keep the
		// projection payload JSON-shaped at the persistence boundary.
		autoResults = projectionJSON(section.AutoResults)
	}
	_, err = q.ExecContext(ctx, `
		INSERT INTO section_submissions (
			id, submission_id, section, answers, auto_grading_results, grading_status, submitted_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			answers = VALUES(answers),
			auto_grading_results = VALUES(auto_grading_results),
			grading_status = CASE
				WHEN section_submissions.grading_status IN ('in_review', 'finalized', 'reopened')
					AND VALUES(grading_status) = 'needs_review'
				THEN section_submissions.grading_status
				ELSE VALUES(grading_status)
			END,
			submitted_at = VALUES(submitted_at)`,
		sectionID, submissionID, section.Name, section.Answers, autoResults, section.GradingStatus, submittedAt,
	)
	return sectionID, err
}

func upsertProjectionWritingTask(ctx context.Context, q tx.Tx, submissionID, sectionID string, task projectionWritingTask, submittedAt time.Time) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO writing_task_submissions (
			id, section_submission_id, submission_id, task_id, task_label, prompt,
			student_text, word_count, annotations, grading_status, submitted_at
		)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 'needs_review', ?)
		ON DUPLICATE KEY UPDATE
			task_label = VALUES(task_label),
			prompt = VALUES(prompt),
			student_text = VALUES(student_text),
			word_count = VALUES(word_count)`,
		uuid.NewString(), sectionID, submissionID, task.ID, task.Label, task.Prompt,
		task.Text, task.WordCount, submittedAt,
	)
	return err
}

func loadProjectionObjectiveSource(ctx context.Context, q tx.Tx, scheduleID, publishedVersionID string, content, config map[string]any) (map[string]any, map[string]any, string, error) {
	var source string
	var versionID sql.NullString
	err := q.QueryRowContext(ctx,
		"SELECT source, version_id FROM grading_schedule_objective_grading_source WHERE schedule_id = ? FOR UPDATE",
		scheduleID).Scan(&source, &versionID)
	if err == sql.ErrNoRows {
		return content, config, publishedVersionID, nil
	}
	if err != nil {
		return nil, nil, "", err
	}
	if source != "draft_version" || !versionID.Valid || strings.TrimSpace(versionID.String) == "" {
		return content, config, publishedVersionID, nil
	}
	var contentRaw, configRaw string
	if err := q.QueryRowContext(ctx,
		"SELECT CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR) FROM exam_versions WHERE id = ?",
		strings.TrimSpace(versionID.String)).Scan(&contentRaw, &configRaw); err != nil {
		return nil, nil, "", err
	}
	return projectionObject(json.RawMessage(contentRaw)), projectionObject(json.RawMessage(configRaw)), strings.TrimSpace(versionID.String), nil
}

func buildProjectionSections(ctx context.Context, q tx.Tx, answers, writingAnswers, content, config map[string]any, versionID string) ([]projectionSection, error) {
	objective, err := buildProjectionObjectiveSections(ctx, q, answers, content, config, versionID)
	if err != nil {
		return nil, err
	}
	sections := append([]projectionSection{}, objective...)
	sections = append(sections,
		projectionSection{
			Name:          "writing",
			Answers:       projectionJSON(map[string]any{"type": "writing", "tasks": projectionWritingPayload(writingAnswers, content, config)}),
			GradingStatus: "needs_review",
		},
		projectionSection{
			Name:          "speaking",
			Answers:       projectionJSON(map[string]any{"type": "speaking", "responses": []any{}}),
			GradingStatus: "pending",
		},
	)
	return sections, nil
}

func buildProjectionObjectiveSections(ctx context.Context, q tx.Tx, answers, content, config map[string]any, versionID string) ([]projectionSection, error) {
	keys, err := loadObjectiveAnswerKey(ctx, q, versionID)
	if err != nil {
		return nil, err
	}
	sections := make([]projectionSection, 0, 2)
	for _, name := range []string{"listening", "reading"} {
		model := collectProjectionSection(content, name)
		filtered := map[string]any{}
		for key, value := range projectionEffectiveAnswers(answers, model.Aliases) {
			if model.AnswerKeys[key] {
				filtered[key] = value
			}
		}
		results := projectionObjectiveResults(name, filtered, model.Specs, keys, versionID)
		sections = append(sections, projectionSection{
			Name:          name,
			Answers:       projectionJSON(map[string]any{"type": name, "answers": filtered}),
			AutoResults:   results,
			GradingStatus: projectionObjectiveStatus(results),
		})
	}
	return sections, nil
}

func projectionObjectiveStatus(results map[string]any) string {
	if integrity, ok := results["integrity"].(map[string]any); ok {
		if status, _ := integrity["integrityStatus"].(string); status == "verified" {
			return "auto_graded"
		}
	}
	return "needs_review"
}

type projectionQuestion struct {
	ID       string
	Accepted []string
	Correct  any
	Rule     string
	Multi    bool
}

type projectionSectionModel struct {
	Specs      []projectionQuestion
	AnswerKeys map[string]bool
	Aliases    []projectionAnswerAlias
}

type projectionAnswerAlias struct {
	ArrayKey string
	Index    int
	SlotKey  string
}

func collectProjectionSection(content map[string]any, section string) projectionSectionModel {
	model := projectionSectionModel{AnswerKeys: map[string]bool{}}
	root, _ := content[section].(map[string]any)
	var groups []any
	if section == "reading" {
		groups, _ = root["passages"].([]any)
	} else {
		groups, _ = root["parts"].([]any)
	}
	for _, group := range groups {
		groupMap, _ := group.(map[string]any)
		blocks, _ := groupMap["blocks"].([]any)
		for _, item := range blocks {
			if block, ok := item.(map[string]any); ok {
				collectProjectionBlock(&model, block, section)
			}
		}
	}
	return model
}

func collectProjectionBlock(model *projectionSectionModel, block map[string]any, section string) {
	if enabled, _ := block["subAnswerModeEnabled"].(bool); enabled {
		if blockID, ok := stringValue(block["id"]); ok {
			if roots, ok := block["answerTree"].([]any); ok {
				for _, root := range roots {
					rootMap, _ := root.(map[string]any)
					rootID, _ := stringValue(rootMap["id"])
					collectProjectionTree(model, rootMap, blockID, rootID, section)
				}
				return
			}
		}
	}
	blockType, _ := stringValue(block["type"])
	blockType = strings.ToUpper(blockType)
	fallbackRule, _ := stringValue(block["answerRule"])
	if fallbackRule == "" {
		fallbackRule = "exact_match"
	}
	questions, _ := block["questions"].([]any)
	blockID, _ := stringValue(block["id"])
	switch blockType {
	case "TFNG", "CLOZE", "MATCHING", "MAP", "SHORT_ANSWER":
		for _, raw := range questions {
			if question, ok := raw.(map[string]any); ok {
				addProjectionQuestion(model, question, fallbackRule, false)
			}
		}
	case "SENTENCE_COMPLETION", "NOTE_COMPLETION":
		for _, raw := range questions {
			question, ok := raw.(map[string]any)
			if !ok {
				continue
			}
			questionID, ok := stringValue(question["id"])
			if !ok {
				continue
			}
			rule, _ := stringValue(question["answerRule"])
			if rule == "" {
				rule = fallbackRule
			}
			blanks, _ := question["blanks"].([]any)
			for index, rawBlank := range blanks {
				blank, ok := rawBlank.(map[string]any)
				if !ok {
					continue
				}
				blankID, ok := stringValue(blank["id"])
				if !ok {
					continue
				}
				addProjectionQuestionWithID(model, questionID+":"+blankID, blank, rule, false)
				model.Aliases = append(model.Aliases, projectionAnswerAlias{ArrayKey: questionID, Index: index, SlotKey: questionID + ":" + blankID})
			}
			if len(blanks) == 0 {
				addProjectionQuestion(model, question, rule, false)
			}
		}
	case "MULTI_MCQ":
		if blockID != "" {
			addProjectionOptionQuestion(model, blockID, block["options"], fallbackRule, true)
		}
	case "SINGLE_MCQ":
		if len(questions) > 0 {
			for _, raw := range questions {
				if question, ok := raw.(map[string]any); ok {
					addProjectionOptionQuestion(model, stringOrEmpty(question["id"]), question["options"], fallbackRule, false)
				}
			}
		} else if blockID != "" {
			addProjectionOptionQuestion(model, blockID, block["options"], fallbackRule, false)
		}
	case "DIAGRAM_LABELING":
		collectProjectionSlots(model, blockID, block["labels"], fallbackRule)
	case "FLOW_CHART":
		collectProjectionSlots(model, blockID, block["steps"], fallbackRule)
	case "TABLE_COMPLETION":
		collectProjectionSlots(model, blockID, block["cells"], fallbackRule)
	case "CLASSIFICATION":
		items, _ := block["items"].([]any)
		for _, raw := range items {
			if item, ok := raw.(map[string]any); ok {
				id, _ := stringValue(item["id"])
				copyField(item, "correctCategory", "correctAnswer")
				addProjectionQuestionWithID(model, blockID+":"+id, item, fallbackRule, false)
			}
		}
	case "MATCHING_FEATURES":
		items, _ := block["features"].([]any)
		for _, raw := range items {
			if item, ok := raw.(map[string]any); ok {
				id, _ := stringValue(item["id"])
				copyField(item, "correctMatch", "correctAnswer")
				addProjectionQuestionWithID(model, blockID+":"+id, item, fallbackRule, false)
			}
		}
	default:
		for _, raw := range questions {
			if question, ok := raw.(map[string]any); ok {
				addProjectionQuestion(model, question, fallbackRule, false)
			}
		}
		if len(questions) == 0 && blockID != "" && (block["correctAnswer"] != nil || block["acceptedAnswers"] != nil) {
			addProjectionQuestionWithID(model, blockID, block, fallbackRule, false)
		}
	}
	_ = section
}

func collectProjectionTree(model *projectionSectionModel, node map[string]any, blockID, rootID, section string) {
	children, _ := node["children"].([]any)
	if len(children) == 0 {
		if nodeID, ok := stringValue(node["id"]); ok {
			id := blockID + "::tree::" + rootID + "::" + nodeID
			addProjectionQuestionWithID(model, id, node, "sub_answer_tree", false)
		}
		return
	}
	for _, child := range children {
		if childMap, ok := child.(map[string]any); ok {
			collectProjectionTree(model, childMap, blockID, rootID, section)
		}
	}
}

func collectProjectionSlots(model *projectionSectionModel, blockID string, raw any, rule string) {
	items, _ := raw.([]any)
	for index, itemRaw := range items {
		item, ok := itemRaw.(map[string]any)
		if !ok {
			continue
		}
		id, ok := stringValue(item["id"])
		if !ok || blockID == "" {
			continue
		}
		questionID := blockID + ":" + id
		addProjectionQuestionWithID(model, questionID, item, rule, false)
		model.Aliases = append(model.Aliases, projectionAnswerAlias{ArrayKey: blockID, Index: index, SlotKey: questionID})
	}
}

func addProjectionOptionQuestion(model *projectionSectionModel, id string, raw any, rule string, multi bool) {
	if id == "" {
		return
	}
	options, _ := raw.([]any)
	correct := make([]any, 0)
	accepted := make([]string, 0)
	for _, rawOption := range options {
		option, ok := rawOption.(map[string]any)
		if !ok {
			continue
		}
		isCorrect, _ := option["isCorrect"].(bool)
		if !isCorrect {
			continue
		}
		optionID, ok := stringValue(option["id"])
		if !ok {
			continue
		}
		correct = append(correct, optionID)
		accepted = append(accepted, optionID)
	}
	addProjectionQuestionWithValues(model, projectionQuestion{ID: id, Accepted: accepted, Correct: correct, Rule: rule, Multi: multi})
}

func addProjectionQuestion(model *projectionSectionModel, question map[string]any, fallbackRule string, multi bool) {
	id, ok := stringValue(question["id"])
	if !ok {
		return
	}
	rule, _ := stringValue(question["answerRule"])
	if rule == "" {
		rule = fallbackRule
	}
	addProjectionQuestionWithID(model, id, question, rule, multi)
}

func addProjectionQuestionWithID(model *projectionSectionModel, id string, question map[string]any, rule string, multi bool) {
	accepted := projectionAcceptedAnswers(question)
	correct := any(nil)
	if len(accepted) > 0 {
		correct = accepted[0]
		if multi {
			correct = append([]string(nil), accepted...)
		}
	}
	addProjectionQuestionWithValues(model, projectionQuestion{ID: id, Accepted: accepted, Correct: correct, Rule: rule, Multi: multi})
}

func addProjectionQuestionWithValues(model *projectionSectionModel, question projectionQuestion) {
	if strings.TrimSpace(question.ID) == "" {
		return
	}
	model.AnswerKeys[question.ID] = true
	for i := range model.Specs {
		if model.Specs[i].ID == question.ID {
			// Duplicate identities are made invalid by clearing the key; this
			// fails the release integrity gate instead of guessing a score.
			model.Specs[i].Accepted = nil
			model.Specs[i].Correct = nil
			model.Specs[i].Rule = "duplicate_question_id"
			return
		}
	}
	model.Specs = append(model.Specs, question)
}

func projectionAcceptedAnswers(question map[string]any) []string {
	seen := map[string]bool{}
	accepted := make([]string, 0)
	appendValue := func(raw any) {
		values := []any{raw}
		if list, ok := raw.([]any); ok {
			values = list
		}
		for _, value := range values {
			text, ok := value.(string)
			if !ok {
				continue
			}
			for _, variant := range strings.Split(text, "|") {
				variant = projectionNormalize(variant)
				if variant != "" && !seen[strings.ToLower(variant)] {
					seen[strings.ToLower(variant)] = true
					accepted = append(accepted, variant)
				}
			}
		}
	}
	if raw, ok := question["acceptedAnswers"]; ok {
		appendValue(raw)
	}
	if len(accepted) == 0 {
		if raw, ok := question["correctAnswer"]; ok {
			appendValue(raw)
		}
	}
	return accepted
}

func projectionEffectiveAnswers(answers map[string]any, aliases []projectionAnswerAlias) map[string]any {
	out := map[string]any{}
	for key, value := range answers {
		out[key] = value
	}
	for _, alias := range aliases {
		if _, exists := out[alias.SlotKey]; exists {
			continue
		}
		values, ok := answers[alias.ArrayKey].([]any)
		if ok && alias.Index >= 0 && alias.Index < len(values) {
			out[alias.SlotKey] = values[alias.Index]
		}
	}
	return out
}

func projectionObjectiveResults(section string, answers map[string]any, specs []projectionQuestion, keys map[string]string, versionID string) map[string]any {
	// The normalized Go assessment tables are authoritative when present; the
	// snapshot answer key remains the compatibility path for IELTS builder data.
	for index := range specs {
		if len(specs[index].Accepted) == 0 {
			if definition, ok := keys[specs[index].ID]; ok {
				if answer, ok := objectiveKeyAnswer(definition); ok {
					specs[index].Accepted = []string{projectionNormalize(answer)}
					specs[index].Correct = answer
				}
			}
		}
	}

	questionResults := make([]any, 0, len(specs))
	unknown := make([]string, 0)
	known := map[string]bool{}
	var total, max, correctCount, incorrectCount, unansweredCount, unresolvedCount, invalidCount int
	issueCodes := map[string]bool{}
	for _, spec := range specs {
		known[spec.ID] = true
		max++
		given, present := answers[spec.ID]
		blank := !present || len(projectionValueStrings(given)) == 0
		status := "verified_incorrect"
		isCorrect := any(false)
		awarded := any(float64(0))
		issueCode := any(nil)
		issueMessage := any(nil)
		if spec.Rule == "duplicate_question_id" {
			status, invalidCount = "invalid", invalidCount+1
			issueCode, issueMessage = "duplicate_question_id", "Question id appears more than once in the sealed content."
			issueCodes["duplicate_question_id"] = true
		} else if len(spec.Accepted) == 0 {
			status, invalidCount = "invalid", invalidCount+1
			issueCode, issueMessage = "missing_answer_key", "The sealed answer key is missing."
			issueCodes["invalid_answer_key"] = true
		} else if blank {
			status, unansweredCount = "verified_unanswered", unansweredCount+1
		} else if projectionAnswerMatches(given, spec.Accepted, spec.Multi) {
			status, correctCount = "verified_correct", correctCount+1
			isCorrect, awarded, total = true, float64(1), total+1
		} else {
			incorrectCount++
		}
		questionResults = append(questionResults, map[string]any{
			"questionId": spec.ID, "studentAnswer": projectionDisplayValue(given),
			"correctAnswer": spec.Correct, "acceptedAnswers": spec.Accepted,
			"verificationStatus": status, "isCorrect": isCorrect, "awardedScore": awarded,
			"maxScore": float64(1), "scoringRule": spec.Rule, "hasOverride": false,
			"issueCode": issueCode, "issueMessage": issueMessage,
		})
	}
	for key := range answers {
		if !known[key] {
			unknown = append(unknown, key)
		}
	}
	sort.Strings(unknown)
	if len(unknown) > 0 {
		issueCodes["unknown_student_answer_id"] = true
		unresolvedCount = len(unknown)
	}
	status := "verified"
	if invalidCount > 0 {
		status = "invalid"
	} else if unresolvedCount > 0 || len(issueCodes) > 0 {
		status = "needs_recheck"
	}
	codes := make([]string, 0, len(issueCodes))
	for code := range issueCodes {
		codes = append(codes, code)
	}
	sort.Strings(codes)
	questionsAudit := make([]any, 0, len(questionResults))
	for _, raw := range questionResults {
		result := raw.(map[string]any)
		questionsAudit = append(questionsAudit, map[string]any{
			"questionId": result["questionId"], "section": section,
			"status": result["verificationStatus"], "issueCode": result["issueCode"],
		})
	}
	audit := map[string]any{
		"section": section, "expectedQuestionCount": len(specs),
		"verifiedCorrectCount": correctCount, "verifiedIncorrectCount": incorrectCount,
		"verifiedUnansweredCount": unansweredCount, "unresolvedCount": unresolvedCount,
		"invalidCount": invalidCount, "unknownAnswerCount": len(unknown),
		"integrityStatus": status, "gradingSourceVersionId": versionID,
		"unknownAnswerIds": unknown, "issueCodes": codes, "questions": questionsAudit,
	}
	percentage := float64(0)
	if max > 0 {
		percentage = float64(total) / float64(max) * 100
	}
	return map[string]any{
		"generatedAt": time.Now().UTC(), "totalScore": total, "maxScore": max,
		"percentage": percentage, "integrity": audit, "questionResults": questionResults,
	}
}

func projectionAnswerMatches(given any, accepted []string, multi bool) bool {
	values := projectionValueStrings(given)
	if multi {
		if len(values) != len(accepted) {
			return false
		}
		seen := map[string]bool{}
		for _, value := range values {
			seen[value] = true
		}
		for _, value := range accepted {
			if !seen[value] {
				return false
			}
		}
		return true
	}
	if len(values) == 0 {
		return false
	}
	for _, expected := range accepted {
		if strings.EqualFold(projectionNormalize(values[0]), projectionNormalize(expected)) {
			return true
		}
	}
	return false
}

func buildProjectionWritingTasks(writingAnswers, content, config map[string]any) []projectionWritingTask {
	labels := map[string]string{}
	prompts := map[string]string{}
	if writing, ok := content["writing"].(map[string]any); ok {
		prompts["task1"] = stringOrEmpty(writing["task1Prompt"])
		prompts["task2"] = stringOrEmpty(writing["task2Prompt"])
		if tasks, ok := writing["tasks"].([]any); ok {
			for _, raw := range tasks {
				if task, ok := raw.(map[string]any); ok {
					if id, ok := stringValue(firstValue(task, "id", "taskId")); ok {
						labels[id] = stringOrEmpty(task["label"])
						if prompt := stringOrEmpty(task["prompt"]); prompt != "" {
							prompts[id] = prompt
						}
					}
				}
			}
		}
	}
	if sections, ok := config["sections"].(map[string]any); ok {
		if writing, ok := sections["writing"].(map[string]any); ok {
			if tasks, ok := writing["tasks"].([]any); ok {
				for _, raw := range tasks {
					if task, ok := raw.(map[string]any); ok {
						if id, ok := stringValue(firstValue(task, "id", "taskId")); ok {
							if label := stringOrEmpty(task["label"]); label != "" {
								labels[id] = label
							}
						}
					}
				}
			}
		}
	}
	ids := make([]string, 0)
	seen := map[string]bool{}
	appendID := func(id string) {
		if id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	if sections, ok := config["sections"].(map[string]any); ok {
		if writing, ok := sections["writing"].(map[string]any); ok {
			if tasks, ok := writing["tasks"].([]any); ok {
				for _, raw := range tasks {
					if task, ok := raw.(map[string]any); ok {
						appendID(stringOrEmpty(firstValue(task, "id", "taskId")))
					}
				}
			}
		}
	}
	if writing, ok := content["writing"].(map[string]any); ok {
		if tasks, ok := writing["tasks"].([]any); ok {
			for _, raw := range tasks {
				if task, ok := raw.(map[string]any); ok {
					appendID(stringOrEmpty(firstValue(task, "id", "taskId")))
				}
			}
		}
	}
	for id := range writingAnswers {
		appendID(id)
	}
	tasks := make([]projectionWritingTask, 0, len(ids))
	for _, id := range ids {
		value := writingAnswers[id]
		text := ""
		label := labels[id]
		prompt := prompts[id]
		if object, ok := value.(map[string]any); ok {
			if candidate := stringOrEmpty(object["text"]); candidate != "" {
				text = candidate
			}
			if candidate := stringOrEmpty(object["label"]); candidate != "" {
				label = candidate
			}
			if candidate := stringOrEmpty(object["prompt"]); candidate != "" {
				prompt = candidate
			}
		} else if candidate, ok := value.(string); ok {
			text = candidate
		}
		if label == "" {
			label = id
		}
		wordCount := len(strings.Fields(text))
		if object, ok := value.(map[string]any); ok {
			if number, ok := projectionNumber(object["wordCount"]); ok && number >= 0 {
				wordCount = int(number)
			}
		}
		if wordCount < 0 {
			wordCount = 0
		}
		tasks = append(tasks, projectionWritingTask{ID: id, Label: label, Prompt: prompt, Text: text, WordCount: wordCount})
	}
	return tasks
}

func projectionWritingPayload(writingAnswers, content, config map[string]any) []any {
	items := make([]any, 0)
	for _, task := range buildProjectionWritingTasks(writingAnswers, content, config) {
		items = append(items, map[string]any{"taskId": task.ID, "text": task.Text, "wordCount": task.WordCount})
	}
	return items
}

func projectionObject(raw json.RawMessage) map[string]any {
	var out map[string]any
	if len(raw) > 0 && string(raw) != "null" {
		_ = json.Unmarshal(raw, &out)
	}
	if out == nil {
		out = map[string]any{}
	}
	return out
}

func projectionObjectValue(value any) map[string]any {
	if out, ok := value.(map[string]any); ok && out != nil {
		return out
	}
	return map[string]any{}
}

func projectionJSON(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func projectionNormalize(value string) string {
	return strings.Join(strings.Fields(strings.TrimSpace(value)), " ")
}

func projectionValueStrings(value any) []string {
	switch typed := value.(type) {
	case string:
		if typed == "" {
			return nil
		}
		return []string{typed}
	case []any:
		out := make([]string, 0, len(typed))
		for _, item := range typed {
			out = append(out, projectionValueStrings(item)...)
		}
		return out
	case []string:
		return append([]string(nil), typed...)
	case map[string]any:
		for _, key := range []string{"answer", "value", "text"} {
			if nested, ok := typed[key]; ok {
				return projectionValueStrings(nested)
			}
		}
	}
	return nil
}

func projectionDisplayValue(value any) string {
	values := projectionValueStrings(value)
	return strings.Join(values, ", ")
}

func projectionNumber(value any) (int64, bool) {
	switch typed := value.(type) {
	case float64:
		return int64(typed), true
	case int:
		return int64(typed), true
	case int64:
		return typed, true
	case string:
		parsed, err := strconv.ParseInt(typed, 10, 64)
		return parsed, err == nil
	default:
		return 0, false
	}
}

func stringValue(value any) (string, bool) {
	text, ok := value.(string)
	return strings.TrimSpace(text), ok && strings.TrimSpace(text) != ""
}

func stringOrEmpty(value any) string {
	text, _ := stringValue(value)
	return text
}

func firstValue(object map[string]any, keys ...string) any {
	for _, key := range keys {
		if value, ok := object[key]; ok {
			return value
		}
	}
	return nil
}

func copyField(object map[string]any, source, target string) {
	if object[target] == nil {
		object[target] = object[source]
	}
}

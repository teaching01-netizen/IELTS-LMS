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
	TerminalGeneration uint64
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
		var currentID string
		if err := q.QueryRowContext(ctx, `SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? AND terminal_generation = ? AND submitted_at IS NOT NULL FOR UPDATE`, attempt.ID, attempt.ScheduleID, attempt.TerminalGeneration).Scan(&currentID); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeConflict, "The completion generation was superseded.")
			}
			return err
		}
		objectiveContent, objectiveConfig, objectiveVersion, err := loadProjectionObjectiveSource(
			ctx, q, attempt.ScheduleID, attempt.PublishedVersionID, content, config,
		)
		if err != nil {
			return err
		}
		overrides, err := loadProjectionOverrides(ctx, q, attempt.ScheduleID)
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
			ctx, q, answers, writingAnswers, content, config, attempt.PublishedVersionID, overrides,
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
				ctx, q, answers, objectiveContent, objectiveConfig, objectiveVersion, overrides,
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
	// attempt_id alone is UNIQUE. A row for this attempt may already exist
	// under another provider_key (legacy/stale labels); the attempt's exam is
	// IELTS, so the row is adopted and relabelled below. Looking it up by
	// provider would mint a second id, the upsert would update the existing
	// row instead, and the sections would reference an id that was never
	// stored (FK 1452 — the grading worker then stalls on this attempt).
	var submissionID string
	err := q.QueryRowContext(ctx,
		"SELECT id FROM student_submissions WHERE attempt_id = ? AND terminal_generation = (SELECT terminal_generation FROM student_attempts WHERE id = student_submissions.attempt_id) FOR UPDATE",
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
			grading_status, section_statuses, created_at, updated_at, terminal_generation
		)
		VALUES (?, ?, ?, ?, ?, 'ielts', ?, ?, ?, ?, ?, 'submitted', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), (SELECT terminal_generation FROM student_attempts WHERE id = ?))
		ON DUPLICATE KEY UPDATE
			schedule_id = VALUES(schedule_id),
			provider_key = 'ielts',
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
		attempt.StudentID, attempt.StudentName, email, attempt.CohortName, submittedAt, sectionStatuses, attempt.ID,
	)
	if err != nil {
		return "", err
	}
	// Return the id actually stored: a concurrent worker may have inserted
	// the row first, in which case our generated id was never written.
	err = q.QueryRowContext(ctx,
		"SELECT id FROM student_submissions WHERE attempt_id = ? AND terminal_generation = (SELECT terminal_generation FROM student_attempts WHERE id = student_submissions.attempt_id)", attempt.ID).Scan(&submissionID)
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

func buildProjectionSections(ctx context.Context, q tx.Tx, answers, writingAnswers, content, config map[string]any, versionID string, overrides map[string]objectiveOverridePayload) ([]projectionSection, error) {
	objective, err := buildProjectionObjectiveSections(ctx, q, answers, content, config, versionID, overrides)
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

func buildProjectionObjectiveSections(ctx context.Context, q tx.Tx, answers, content, config map[string]any, versionID string, overrides map[string]objectiveOverridePayload) ([]projectionSection, error) {
	keys, err := loadObjectiveAnswerKey(ctx, q, versionID)
	if err != nil {
		return nil, err
	}
	sections := make([]projectionSection, 0, 2)
	for _, name := range []string{"listening", "reading"} {
		filtered, results := gradeProjectionObjectiveSection(name, answers, content, keys, overrides, versionID)
		sections = append(sections, projectionSection{
			Name:          name,
			Answers:       projectionJSON(map[string]any{"type": name, "answers": filtered}),
			AutoResults:   results,
			GradingStatus: projectionObjectiveStatus(results),
		})
	}
	return sections, nil
}

// gradeProjectionObjectiveSection narrows answers to one objective section and
// scores them against the sealed key with the schedule's answer-key overrides
// applied. The projection and the schedule regrade share it so a replay and a
// teacher decision can never score the same answer differently.
func gradeProjectionObjectiveSection(section string, answers, content map[string]any, keys map[string]string, overrides map[string]objectiveOverridePayload, versionID string) (map[string]any, map[string]any) {
	model := collectProjectionSection(content, section)
	filtered := projectionSectionAnswers(answers, model)
	applyProjectionOverrides(model.Specs, overrides)
	return filtered, projectionObjectiveResults(section, filtered, model.Specs, keys, versionID)
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
	// CaseSensitive requires exact case. Default true (strict); explicit
	// `caseSensitive: false` opts a question back into case-insensitive grading.
	CaseSensitive bool
	// ExactID compares option IDs as raw identity (no cleaning/folding).
	// Set for SINGLE_MCQ specs; MULTI_MCQ has its own set logic.
	ExactID bool
	// Set only by a schedule answer-key override.
	HasOverride bool
	Excluded    []string
	Points      int

	// Group scoring. A group shares one question number and one mark:
	// grouped table/sentence slots (GroupKind "required"), sub-answer tree
	// roots (GroupKind "tree"), and shared sentence answer pools
	// (GroupKind "pool", where slots keep their own mark but consume keys).
	GroupKey        string
	GroupKind       string
	GroupIndex      int
	RequiredCorrect int
	TreeRequired    bool
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
				addProjectionQuestion(model, question, fallbackRule, false, blockType)
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
			acceptAny, _ := question["acceptAnyAnswerKey"].(bool)
			pool := sentenceAnswerPool(question, blanks)
			for index, rawBlank := range blanks {
				blank, ok := rawBlank.(map[string]any)
				if !ok {
					continue
				}
				blankID, ok := stringValue(blank["id"])
				if !ok {
					continue
				}
				spec := projectionQuestion{
					ID:            questionID + ":" + blankID,
					Rule:          rule,
					Accepted:      projectionAcceptedAnswers(blank, "SENTENCE_COMPLETION"),
					CaseSensitive: projectionCaseSensitive(blank),
				}
				if acceptAny {
					spec.Accepted = pool
					if len(pool) > 0 {
						spec.Correct = strings.Join(pool, " | ")
					}
					spec.GroupKey = questionID
					spec.GroupKind = "pool"
					spec.GroupIndex = index
				} else if groupKey := sentenceScoreGroupKey(blockID, questionID, blank); groupKey != "" {
					spec.GroupKey = groupKey
					spec.GroupKind = "required"
					spec.GroupIndex = index
					spec.RequiredCorrect = requiredCorrectForSlot(blank)
				}
				addProjectionQuestionWithValues(model, spec)
				model.Aliases = append(model.Aliases, projectionAnswerAlias{ArrayKey: questionID, Index: index, SlotKey: questionID + ":" + blankID})
			}
			if len(blanks) == 0 {
				addProjectionQuestion(model, question, rule, false, blockType)
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
		collectProjectionSlots(model, blockID, block["labels"], fallbackRule, blockType)
	case "FLOW_CHART":
		collectProjectionSlots(model, blockID, block["steps"], fallbackRule, blockType)
	case "TABLE_COMPLETION":
		collectProjectionSlots(model, blockID, block["cells"], fallbackRule, blockType)
	// CLASSIFICATION items and MATCHING_FEATURES features are answered by one
	// array under the block id, exactly like the slot blocks above: the stored
	// key is the block, the slot is the array index. Registering the slots
	// without the array alias (their own loops, before this shared rule) made
	// the section filter drop every saved answer of both block types, so a
	// student's selections read as unanswered in review and scoring.
	case "CLASSIFICATION":
		collectProjectionSlots(model, blockID, block["items"], fallbackRule, blockType)
	case "MATCHING_FEATURES":
		collectProjectionSlots(model, blockID, block["features"], fallbackRule, blockType)
	default:
		for _, raw := range questions {
			if question, ok := raw.(map[string]any); ok {
				addProjectionQuestion(model, question, fallbackRule, false, blockType)
			}
		}
		if len(questions) == 0 && blockID != "" && (block["correctAnswer"] != nil || block["acceptedAnswers"] != nil) {
			addProjectionQuestionWithID(model, blockID, block, fallbackRule, false, blockType)
		}
	}
	_ = section
}

func collectProjectionTree(model *projectionSectionModel, node map[string]any, blockID, rootID, section string) {
	var leaves []projectionQuestion
	var walk func(current map[string]any)
	walk = func(current map[string]any) {
		children, _ := current["children"].([]any)
		if len(children) == 0 {
			if nodeID, ok := stringValue(current["id"]); ok {
				required := true
				if value, ok := current["required"].(bool); ok {
					required = value
				}
				leaves = append(leaves, projectionQuestion{
					ID:            blockID + "::tree::" + rootID + "::" + nodeID,
					Rule:          "sub_answer_tree",
					Accepted:      projectionAcceptedAnswers(current, "SUB_ANSWER_TREE"),
					GroupKey:      blockID + "::tree::root::" + rootID,
					GroupKind:     "tree",
					GroupIndex:    len(leaves),
					TreeRequired:  required,
					CaseSensitive: projectionCaseSensitive(current),
				})
			}
			return
		}
		for _, child := range children {
			if childMap, ok := child.(map[string]any); ok {
				walk(childMap)
			}
		}
	}
	walk(node)
	requiredCount := 0
	for _, leaf := range leaves {
		if leaf.TreeRequired {
			requiredCount++
		}
	}
	for _, leaf := range leaves {
		leaf.RequiredCorrect = requiredCount
		addProjectionQuestionWithValues(model, leaf)
	}
}

// collectProjectionSlots registers one slot block whose answers the client
// stores as ONE array under the block id: labels, flow steps, table cells and
// (via answerField) classification items and matching-features entries. The
// alias is what turns the stored array back into per-slot answers; a slot
// block without it can never match a saved answer.
// questionType selects the key-source row (classification reads
// correctCategory before any legacy correctAnswer, for example).
func collectProjectionSlots(model *projectionSectionModel, blockID string, raw any, rule string, questionType string) {
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
		spec := projectionQuestion{
			ID:            questionID,
			Rule:          rule,
			Accepted:      projectionAcceptedAnswers(item, questionType),
			CaseSensitive: projectionCaseSensitive(item),
		}
		if groupKey := slotScoreGroupKey(blockID, questionType, item); groupKey != "" {
			spec.GroupKey = groupKey
			spec.GroupKind = "required"
			spec.GroupIndex = index
			spec.RequiredCorrect = requiredCorrectForSlot(item)
		}
		addProjectionQuestionWithValues(model, spec)
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
	addProjectionQuestionWithValues(model, projectionQuestion{ID: id, Accepted: accepted, Correct: correct, Rule: rule, Multi: multi, ExactID: !multi})
}

func addProjectionQuestion(model *projectionSectionModel, question map[string]any, fallbackRule string, multi bool, questionType string) {
	id, ok := stringValue(question["id"])
	if !ok {
		return
	}
	rule, _ := stringValue(question["answerRule"])
	if rule == "" {
		rule = fallbackRule
	}
	addProjectionQuestionWithID(model, id, question, rule, multi, questionType)
}

func projectionCaseSensitive(question map[string]any) bool {
	if question == nil {
		return true
	}
	if flag, ok := question["caseSensitive"].(bool); ok {
		return flag
	}
	return true
}

func addProjectionQuestionWithID(model *projectionSectionModel, id string, question map[string]any, rule string, multi bool, questionType string) {
	accepted := projectionAcceptedAnswers(question, questionType)
	correct := any(nil)
	if len(accepted) > 0 {
		correct = accepted[0]
		if multi {
			correct = append([]string(nil), accepted...)
		}
	}
	addProjectionQuestionWithValues(model, projectionQuestion{ID: id, Accepted: accepted, Correct: correct, Rule: rule, Multi: multi, CaseSensitive: projectionCaseSensitive(question)})
}

func addProjectionQuestionWithValues(model *projectionSectionModel, question projectionQuestion) {
	if strings.TrimSpace(question.ID) == "" {
		return
	}
	if question.Correct == nil && !question.Multi && len(question.Accepted) > 0 {
		question.Correct = question.Accepted[0]
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

func projectionAcceptedAnswers(question map[string]any, questionType string) []string {
	strict := projectionCaseSensitive(question)
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
				variant = normalizeAnswer(variant)
				if variant == "" {
					continue
				}
				key := answerDedupeKey(variant, strict)
				if !seen[key] {
					seen[key] = true
					accepted = append(accepted, variant)
				}
			}
		}
	}
	// Some builder editors save the selected key and the accepted alternatives
	// as separate fields, so grading must be additive rather than
	// first-non-empty:
	//   - CLASSIFICATION / MATCHING_FEATURES: selected category/match first,
	//     then acceptedAnswers; a stale legacy correctAnswer is never graded.
	//   - DIAGRAM_LABELING / FLOW_CHART: primary correctAnswer first, then
	//     acceptedAnswers, so a filled alternatives list can never shadow the
	//     primary key (pipe variants are split for every field).
	// MAP deliberately stays single-winner (correctAnswer then acceptedAnswers).
	if fields := additiveAnswerFields(questionType); len(fields) > 0 {
		for _, field := range fields {
			if raw, ok := question[field]; ok && raw != nil {
				appendValue(raw)
			}
		}
		return accepted
	}
	for _, field := range fieldsForQuestionType(questionType) {
		raw, ok := question[field]
		if !ok || raw == nil {
			continue
		}
		appendValue(raw)
		if len(accepted) > 0 {
			break
		}
	}
	return accepted
}

// additiveAnswerFields names the fields graded together, de-duped, instead of
// as an either/or key source: every listed field contributes keys, in order.
// The per-row keySourceFields entry still documents where the type stores its
// key; these types are the ones whose editors write more than one key field.
func additiveAnswerFields(questionType string) []string {
	switch strings.ToUpper(strings.TrimSpace(questionType)) {
	case "CLASSIFICATION":
		return []string{"correctCategory", "acceptedAnswers"}
	case "MATCHING_FEATURES":
		return []string{"correctMatch", "acceptedAnswers"}
	case "DIAGRAM_LABELING", "FLOW_CHART":
		return []string{"correctAnswer", "acceptedAnswers"}
	default:
		return nil
	}
}

// projectionSectionAnswers is the one place a saved answer map is narrowed to
// the questions of a section: stored keys first, then every slot alias the
// model declares. Keeping it single-owner is what makes "the answer was saved
// but the section lost it" a failing test instead of a silent read-time gap.
func projectionSectionAnswers(answers map[string]any, model projectionSectionModel) map[string]any {
	filtered := map[string]any{}
	for key, value := range projectionEffectiveAnswers(answers, model.Aliases) {
		if model.AnswerKeys[key] {
			filtered[key] = value
		}
	}
	return filtered
}

func projectionEffectiveAnswers(answers map[string]any, aliases []projectionAnswerAlias) map[string]any {
	out := map[string]any{}
	for key, value := range answers {
		out[key] = value
	}
	for _, alias := range aliases {
		// A flag-only V2 response stores {"answer":null} under the slot id
		// (e.g. "blk:feat-x": null) alongside the real array answer
		// ("blk": [...]). The null slot must not shadow the array element:
		// only a slot with a meaningful answer wins, otherwise expand the
		// array. Without this, flagging a question wipes its saved answer
		// and the slot grades as unanswered while the answer is intact.
		if existing, exists := out[alias.SlotKey]; exists && len(projectionValueStrings(existing)) > 0 {
			continue
		}
		if values, ok := answers[alias.ArrayKey].([]any); ok && alias.Index >= 0 && alias.Index < len(values) {
			out[alias.SlotKey] = values[alias.Index]
			continue
		}
		if values, ok := answers[alias.ArrayKey].([]string); ok && alias.Index >= 0 && alias.Index < len(values) {
			out[alias.SlotKey] = values[alias.Index]
		}
	}
	return out
}

type objectiveOutcome struct {
	spec           projectionQuestion
	given          any
	blank          bool
	matched        bool
	awarded        float64
	max            float64
	invalid        bool
	issueCode      string
	issueMsg       string
	status         string
	displayKeys    []string
	representative bool
}

func projectionObjectiveResults(section string, answers map[string]any, specs []projectionQuestion, keys map[string]string, versionID string) map[string]any {
	// The normalized Go assessment tables are authoritative when present; the
	// snapshot answer key remains the compatibility path for IELTS builder data.
	// A fallback-filled spec inherits the sealed definition's case policy, so
	// an explicit `caseSensitive: false` there grades exactly like the
	// submit-time scoreObjective path: strict unless either the content or the
	// sealed definition opted out.
	for index := range specs {
		if len(specs[index].Accepted) == 0 {
			if definition, ok := keys[specs[index].ID]; ok {
				if sealed, ok := parseObjectiveKey(definition); ok {
					// Option IDs are identity (ExactID compares raw), so the sealed
					// value must not be cleaned here: normalizeAnswer would turn
					// "opt-1111" into "opt 1111" and the raw compare could never
					// match. Free-text keys keep the one cleaning rule.
					answer := sealed.Answer
					if !specs[index].ExactID {
						answer = normalizeAnswer(answer)
					}
					specs[index].Accepted = []string{answer}
					specs[index].Correct = answer
					specs[index].CaseSensitive = specs[index].CaseSensitive && sealed.CaseSensitive
				}
			}
		}
	}

	outcomes := make([]objectiveOutcome, 0, len(specs))
	for _, spec := range specs {
		given, present := answers[spec.ID]
		blank := !present || projectionIsBlank(given)
		item := objectiveOutcome{spec: spec, given: given, blank: blank, displayKeys: spec.Accepted}
		switch {
		case spec.Rule == "duplicate_question_id":
			item.invalid = true
			item.max = 1
			item.issueCode = "duplicate_question_id"
			item.issueMsg = "Question id appears more than once in the sealed content."
		case len(spec.Accepted) == 0:
			item.invalid = true
			item.max = 1
			item.issueCode = "missing_answer_key"
			item.issueMsg = "The sealed answer key is missing."
		case spec.Multi:
			item.matched = false
			selected := projectionValueStrings(given)
			correct := map[string]bool{}
			for _, value := range spec.Accepted {
				correct[value] = true
			}
			if len(selected) <= len(spec.Accepted) {
				count := 0
				for _, value := range selected {
					if correct[value] {
						count++
					}
				}
				item.awarded = float64(count)
			}
			item.max = float64(len(spec.Accepted))
			if spec.HasOverride && spec.Points > 0 {
				item.max = float64(spec.Points)
			}
			item.matched = item.max > 0 && item.awarded >= item.max
		case blank:
			item.max = 1
			if spec.HasOverride {
				item.max = float64(spec.Points)
			}
		default:
			item.matched = projectionAnswerMatchesFull(given, spec.Accepted, false, spec.CaseSensitive, spec.ExactID) && !projectionAnswerExcluded(given, spec.Excluded)
			item.max = 1
			if spec.HasOverride {
				item.max = float64(spec.Points)
			}
			if item.matched {
				item.awarded = item.max
			}
		}
		outcomes = append(outcomes, item)
	}

	groups := map[string][]int{}
	groupOrder := make([]string, 0)
	for index := range outcomes {
		key := outcomes[index].spec.GroupKey
		if key == "" {
			continue
		}
		if _, ok := groups[key]; !ok {
			groupOrder = append(groupOrder, key)
		}
		groups[key] = append(groups[key], index)
	}
	for _, key := range groupOrder {
		indices := groups[key]
		sort.SliceStable(indices, func(left, right int) bool {
			return outcomes[indices[left]].spec.GroupIndex < outcomes[indices[right]].spec.GroupIndex
		})
		switch outcomes[indices[0]].spec.GroupKind {
		case "pool":
			applyPoolGroup(outcomes, indices)
		case "tree":
			applyTreeGroup(outcomes, indices)
		default:
			applyRequiredGroup(outcomes, indices)
		}
	}

	questionResults := make([]any, 0, len(outcomes))
	unknown := make([]string, 0)
	known := map[string]bool{}
	var total, max, correctCount, incorrectCount, unansweredCount, unresolvedCount, invalidCount int
	issueCodes := map[string]bool{}
	for index := range outcomes {
		item := &outcomes[index]
		known[item.spec.ID] = true
		if item.invalid {
			item.status = "invalid"
			item.awarded = 0
			invalidCount++
			issueCodes[item.issueCode] = true
		} else if item.blank {
			item.status = "verified_unanswered"
			unansweredCount++
		} else if item.matched || (item.max > 0 && item.awarded >= item.max) {
			item.status = "verified_correct"
			correctCount++
		} else {
			item.status = "verified_incorrect"
			incorrectCount++
		}
		total += int(item.awarded)
		max += int(item.max)
		isCorrect := item.status == "verified_correct"
		issueCode := any(nil)
		issueMessage := any(nil)
		if item.invalid {
			issueCode, issueMessage = item.issueCode, item.issueMsg
		}
		questionResults = append(questionResults, map[string]any{
			"questionId": item.spec.ID, "studentAnswer": projectionDisplayValue(item.given),
			"correctAnswer": item.spec.Correct, "acceptedAnswers": item.displayKeys,
			"verificationStatus": item.status, "isCorrect": isCorrect, "awardedScore": item.awarded,
			"maxScore": item.max, "scoringRule": item.spec.Rule, "hasOverride": item.spec.HasOverride,
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

// applyGroupRepresentative writes one group's final marks. Every slot keeps
// its own correctness; the first slot carries the group's mark and the rest
// carry maxScore 0 so totals cannot double-count it.
func applyGroupRepresentative(outcomes []objectiveOutcome, indices []int, individual map[int]bool, groupCorrect bool, anyAnswered bool, groupMax float64) {
	for position, index := range indices {
		outcomes[index].awarded = 0
		outcomes[index].max = 0
		outcomes[index].matched = individual[index]
		if position != 0 {
			continue
		}
		outcomes[index].representative = true
		outcomes[index].blank = !anyAnswered
		outcomes[index].max = groupMax
		if groupCorrect {
			outcomes[index].awarded = groupMax
		}
		outcomes[index].matched = groupCorrect
	}
}

// applyRequiredGroup gives a group of slots (for example two table cells that
// share one question number) a single mark.
func applyRequiredGroup(outcomes []objectiveOutcome, indices []int) {
	required := 1
	individual := map[int]bool{}
	anyAnswered := false
	for _, index := range indices {
		if outcomes[index].spec.RequiredCorrect > required {
			required = outcomes[index].spec.RequiredCorrect
		}
		individual[index] = outcomes[index].matched
		if !outcomes[index].blank {
			anyAnswered = true
		}
	}
	correct := 0
	for _, value := range individual {
		if value {
			correct++
		}
	}
	applyGroupRepresentative(outcomes, indices, individual, correct >= required, anyAnswered, groupOverrideMax(outcomes, indices))
}

// groupOverrideMax is the one rule for a group's maximum: an answer-key
// override on any slot can change the group mark, otherwise it is one mark.
func groupOverrideMax(outcomes []objectiveOutcome, indices []int) float64 {
	groupMax := 1.0
	for _, index := range indices {
		if outcomes[index].spec.HasOverride && outcomes[index].spec.Points > 0 {
			if points := float64(outcomes[index].spec.Points); points > groupMax {
				groupMax = points
			}
		}
	}
	return groupMax
}

// applyTreeGroup evaluates one sub-answer-tree root: required leaves must be
// matched to distinct student answers (unordered), and the root carries one
// mark.
func applyTreeGroup(outcomes []objectiveOutcome, indices []int) {
	requiredLeaves := make([]int, 0)
	studentLeaves := make([]int, 0)
	for _, index := range indices {
		if outcomes[index].spec.TreeRequired {
			requiredLeaves = append(requiredLeaves, index)
		}
		if !outcomes[index].blank && len(projectionValueStrings(outcomes[index].given)) > 0 {
			studentLeaves = append(studentLeaves, index)
		}
	}
	assignedStudent := map[int]bool{}
	studentToRequired := map[int]int{}
	var tryAssign func(requiredIndex int, seen map[int]bool) bool
	tryAssign = func(requiredIndex int, seen map[int]bool) bool {
		if outcomes[requiredIndex].invalid {
			return false
		}
		for _, studentIndex := range studentLeaves {
			if seen[studentIndex] {
				continue
			}
			if !projectionAnswerMatchesForEntry(outcomes[studentIndex].given, outcomes[requiredIndex].spec.Accepted, false, outcomes[requiredIndex].spec.CaseSensitive) {
				continue
			}
			if projectionAnswerExcluded(outcomes[studentIndex].given, outcomes[requiredIndex].spec.Excluded) {
				continue
			}
			seen[studentIndex] = true
			if occupied, ok := studentToRequired[studentIndex]; !ok || tryAssign(occupied, seen) {
				studentToRequired[studentIndex] = requiredIndex
				return true
			}
		}
		return false
	}
	matchedRequired := 0
	for _, requiredIndex := range requiredLeaves {
		if tryAssign(requiredIndex, map[int]bool{}) {
			matchedRequired++
		}
	}
	for studentIndex := range studentToRequired {
		assignedStudent[studentIndex] = true
	}
	individual := map[int]bool{}
	for _, index := range indices {
		individual[index] = assignedStudent[index]
	}
	groupCorrect := len(requiredLeaves) == 0 || matchedRequired == len(requiredLeaves)
	applyGroupRepresentative(outcomes, indices, individual, groupCorrect, len(studentLeaves) > 0, groupOverrideMax(outcomes, indices))
}

// applyPoolGroup matches a shared sentence answer pool: blanks consume keys in
// blank order, so repeating one pool answer in two blanks counts once. Each
// blank matches under its own strictness, and consuming one key never consumes
// a case-variant sibling (see answerPool).
func applyPoolGroup(outcomes []objectiveOutcome, indices []int) {
	pool := newAnswerPool(outcomes[indices[0]].spec.Accepted)
	for _, index := range indices {
		outcomes[index].awarded = 0
		outcomes[index].max = 1
		outcomes[index].matched = false
		if outcomes[index].blank {
			continue
		}
		values := projectionValueStrings(outcomes[index].given)
		if len(values) != 1 {
			continue
		}
		if pool.consume(values[0], outcomes[index].spec.CaseSensitive) {
			outcomes[index].matched = true
			outcomes[index].awarded = 1
		}
	}
}

// projectionIsBlank reports whether a saved answer counts as unanswered:
// absent, empty, or whitespace-only (mirrors the website's trim-based check).
func projectionIsBlank(given any) bool {
	values := projectionValueStrings(given)
	if len(values) == 0 {
		return true
	}
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return false
		}
	}
	return true
}

// projectionAnswerExcluded reports whether a typed answer was explicitly kept
// incorrect by a schedule override. Unlike the accepted-answer match it is
// case-sensitive: excluding "28 june" must not reject the key's "28 June".
func projectionAnswerExcluded(given any, excluded []string) bool {
	values := projectionValueStrings(given)
	if len(values) == 0 {
		return false
	}
	for _, value := range excluded {
		if answersMatchCaseExact(values[0], value) {
			return true
		}
	}
	return false
}

// answersMatchInsensitive is the explicit `caseSensitive: false` opt-out
// comparison. Empty student answers never match.
func answersMatchInsensitive(student, key string) bool {
	normalizedStudent := normalizeComparable(student)
	if normalizedStudent == "" {
		return false
	}
	return normalizedStudent == normalizeComparable(key)
}

func projectionAnswerMatchesForEntry(given any, accepted []string, multi bool, caseSensitive bool) bool {
	return projectionAnswerMatchesFull(given, accepted, multi, caseSensitive, false)
}

func projectionAnswerMatchesFull(given any, accepted []string, multi bool, caseSensitive, exactID bool) bool {
	values := projectionValueStrings(given)
	if exactID {
		// Option IDs are identity: raw equality, no cleaning or folding.
		// Empty never matches (blank is handled by callers as unanswered).
		if len(values) != 1 || len(accepted) != 1 {
			return false
		}
		return values[0] != "" && values[0] == accepted[0]
	}
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
	// A single-value question takes exactly one value; arrays (legacy/corrupt
	// payloads) fail closed instead of matching on the first element.
	if len(values) != 1 {
		return false
	}
	for _, expected := range accepted {
		matched := answersMatchCaseExact(values[0], expected)
		if !caseSensitive {
			matched = answersMatchInsensitive(values[0], expected)
		}
		if matched {
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
			if candidate, ok := object["text"].(string); ok {
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

package grading

// Schedule-scoped answer-key overrides for IELTS listening/reading. A grader's
// decision (for example "accept '28 june' for the whole exam") is stored once
// per schedule question and applied by the objective projection; saving or
// removing one regrades every unreleased submission of the schedule in the
// same transaction, so the stored override and the stored scores never
// disagree.

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// objectiveOverridePayload is the override_json shape the staff UI writes.
type objectiveOverridePayload struct {
	CorrectAnswer    *string  `json:"correctAnswer,omitempty"`
	AcceptedAnswers  []string `json:"acceptedAnswers,omitempty"`
	ExcludedAnswers  []string `json:"excludedAnswers,omitempty"`
	CorrectOptionIDs []string `json:"correctOptionIds,omitempty"`
	ScoringRule      string   `json:"scoringRule"`
	MaxScore         int64    `json:"maxScore"`
}

// ObjectiveOverrideRequest is one grader answer-key decision for a question.
type ObjectiveOverrideRequest struct {
	CorrectAnswer    *string  `json:"correctAnswer"`
	AcceptedAnswers  []string `json:"acceptedAnswers"`
	ExcludedAnswers  []string `json:"excludedAnswers"`
	CorrectOptionIDs []string `json:"correctOptionIds"`
	ScoringRule      string   `json:"scoringRule"`
	MaxScore         int64    `json:"maxScore"`
	Reason           string   `json:"reason"`
}

// ScheduleObjectiveOverrideRow is the persisted override as the staff UI reads it.
type ScheduleObjectiveOverrideRow struct {
	ScheduleID         string          `json:"scheduleId"`
	QuestionID         string          `json:"questionId"`
	OverrideJSON       json.RawMessage `json:"overrideJson"`
	UpdatedByActorID   string          `json:"updatedByActorId"`
	UpdatedByActorName string          `json:"updatedByActorName"`
	UpdatedAt          time.Time       `json:"updatedAt"`
}

// ObjectiveRegradeReport counts the work of one schedule regrade.
type ObjectiveRegradeReport struct {
	AttemptsScanned       int `json:"attemptsScanned"`
	SubmissionsMatched    int `json:"submissionsMatched"`
	SubmissionsMissing    int `json:"submissionsMissing"`
	SectionsChecked       int `json:"sectionsChecked"`
	SectionsNeedingUpdate int `json:"sectionsNeedingUpdate"`
	SectionsUpdated       int `json:"sectionsUpdated"`
	SubmissionsUpdated    int `json:"submissionsUpdated"`
}

// overrideAnswerVariants splits "a | b" variants, collapses whitespace and
// drops exact duplicates. Case variants are kept: "28 June" and "28 june" are
// different decisions and the staff UI compares them case-sensitively.
func overrideAnswerVariants(values []string) []string {
	seen := map[string]bool{}
	out := make([]string, 0, len(values))
	for _, value := range values {
		for _, variant := range strings.Split(value, "|") {
			variant = projectionNormalize(variant)
			if variant != "" && !seen[variant] {
				seen[variant] = true
				out = append(out, variant)
			}
		}
	}
	return out
}

func (p objectiveOverridePayload) acceptedAnswers() []string {
	if accepted := overrideAnswerVariants(p.AcceptedAnswers); len(accepted) > 0 {
		return accepted
	}
	if p.CorrectAnswer != nil {
		return overrideAnswerVariants([]string{*p.CorrectAnswer})
	}
	return nil
}

func (p objectiveOverridePayload) optionIDs() []string {
	out := make([]string, 0, len(p.CorrectOptionIDs))
	for _, id := range p.CorrectOptionIDs {
		if id = strings.TrimSpace(id); id != "" {
			out = append(out, id)
		}
	}
	return out
}

// applyProjectionOverrides replaces the sealed key of every overridden spec.
// Rows that carry no usable key (legacy {points} rows, empty lists) are
// ignored so they can never turn a valid key into a missing one.
func applyProjectionOverrides(specs []projectionQuestion, overrides map[string]objectiveOverridePayload) {
	for i := range specs {
		over, ok := overrides[specs[i].ID]
		if !ok || specs[i].Rule == "duplicate_question_id" {
			continue
		}
		if options := over.optionIDs(); len(options) > 0 {
			specs[i].Accepted = options
			if specs[i].Multi {
				specs[i].Correct = options
			} else {
				specs[i].Correct = strings.Join(options, " | ")
			}
		} else if accepted := over.acceptedAnswers(); len(accepted) > 0 {
			specs[i].Accepted = accepted
			specs[i].Correct = strings.Join(accepted, " | ")
			specs[i].Excluded = overrideAnswerVariants(over.ExcludedAnswers)
		} else {
			continue
		}
		specs[i].HasOverride = true
		specs[i].Points = int(over.MaxScore)
		if rule := strings.TrimSpace(over.ScoringRule); rule != "" {
			specs[i].Rule = rule
		}
	}
}

func loadProjectionOverrides(ctx context.Context, q tx.Tx, scheduleID string) (map[string]objectiveOverridePayload, error) {
	raw, err := loadScheduleOverrides(ctx, q, scheduleID)
	if err != nil {
		return nil, err
	}
	out := make(map[string]objectiveOverridePayload, len(raw))
	for questionID, value := range raw {
		var payload objectiveOverridePayload
		if json.Unmarshal(value, &payload) == nil {
			out[questionID] = payload
		}
	}
	return out, nil
}

// ListScheduleObjectiveOverrides returns every override of one schedule.
func (s *Service) ListScheduleObjectiveOverrides(ctx context.Context, scheduleID string) ([]ScheduleObjectiveOverrideRow, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT schedule_id, question_id, CAST(override_json AS CHAR), updated_by_actor_id, updated_by_actor_name, updated_at
		FROM grading_schedule_question_overrides WHERE schedule_id = ? ORDER BY updated_at DESC`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ScheduleObjectiveOverrideRow{}
	for rows.Next() {
		row, err := scanScheduleOverride(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

func scanScheduleOverride(scanner interface{ Scan(...any) error }) (ScheduleObjectiveOverrideRow, error) {
	var row ScheduleObjectiveOverrideRow
	var raw string
	err := scanner.Scan(&row.ScheduleID, &row.QuestionID, &raw, &row.UpdatedByActorID, &row.UpdatedByActorName, &row.UpdatedAt)
	row.OverrideJSON = json.RawMessage(raw)
	return row, err
}

// UpsertScheduleObjectiveOverride stores one answer-key decision and regrades
// the schedule. Validation mirrors the staff UI contract: a reason, a scoring
// rule, a non-negative max score and at least one usable answer are required.
func (s *Service) UpsertScheduleObjectiveOverride(ctx context.Context, scheduleID, questionID string, req ObjectiveOverrideRequest, actorID, actorName string) (ScheduleObjectiveOverrideRow, ObjectiveRegradeReport, error) {
	var row ScheduleObjectiveOverrideRow
	var report ObjectiveRegradeReport
	payload := objectiveOverridePayload{
		CorrectAnswer:    req.CorrectAnswer,
		AcceptedAnswers:  req.AcceptedAnswers,
		ExcludedAnswers:  req.ExcludedAnswers,
		CorrectOptionIDs: req.CorrectOptionIDs,
		ScoringRule:      strings.TrimSpace(req.ScoringRule),
		MaxScore:         req.MaxScore,
	}
	switch {
	case strings.TrimSpace(questionID) == "":
		return row, report, apperrors.New(apperrors.CodeValidation, "Question id is required.")
	case strings.TrimSpace(req.Reason) == "":
		return row, report, apperrors.New(apperrors.CodeValidation, "Override reason is required.")
	case payload.ScoringRule == "":
		return row, report, apperrors.New(apperrors.CodeValidation, "Override scoringRule is required.")
	case payload.MaxScore < 0 || payload.MaxScore > 100:
		return row, report, apperrors.New(apperrors.CodeValidation, "Override maxScore must be within 0..100.")
	case len(payload.optionIDs()) == 0 && len(payload.acceptedAnswers()) == 0:
		return row, report, apperrors.New(apperrors.CodeValidation, "Override must include correctAnswer, acceptedAnswers, or correctOptionIds.")
	}
	overrideJSON := string(mustJSON(payload))
	err := s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		var before sql.NullString
		if err := q.QueryRowContext(ctx,
			`SELECT CAST(override_json AS CHAR) FROM grading_schedule_question_overrides WHERE schedule_id = ? AND question_id = ? FOR UPDATE`,
			scheduleID, questionID).Scan(&before); err != nil && err != sql.ErrNoRows {
			return err
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO grading_schedule_question_overrides
				(schedule_id, question_id, override_json, updated_by_actor_id, updated_by_actor_name, updated_at)
			VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
			ON DUPLICATE KEY UPDATE
				override_json = VALUES(override_json),
				updated_by_actor_id = VALUES(updated_by_actor_id),
				updated_by_actor_name = VALUES(updated_by_actor_name),
				updated_at = CURRENT_TIMESTAMP`,
			scheduleID, questionID, overrideJSON, actorID, actorName); err != nil {
			return err
		}
		var beforeJSON any
		if before.Valid {
			beforeJSON = json.RawMessage(before.String)
		}
		if err := appendScheduleOverrideEvent(ctx, q, scheduleID, actorID, actorName, "objective_override_upserted", map[string]any{
			"questionId": questionID, "reason": req.Reason, "before": beforeJSON, "after": json.RawMessage(overrideJSON),
		}); err != nil {
			return err
		}
		var err error
		if report, err = regradeScheduleObjectives(ctx, q, scheduleID, actorID, actorName); err != nil {
			return err
		}
		row, err = scanScheduleOverride(q.QueryRowContext(ctx, `
			SELECT schedule_id, question_id, CAST(override_json AS CHAR), updated_by_actor_id, updated_by_actor_name, updated_at
			FROM grading_schedule_question_overrides WHERE schedule_id = ? AND question_id = ?`, scheduleID, questionID))
		return err
	})
	return row, report, err
}

// DeleteScheduleObjectiveOverride removes one answer-key decision and regrades
// the schedule back to the sealed key.
func (s *Service) DeleteScheduleObjectiveOverride(ctx context.Context, scheduleID, questionID, reason, actorID, actorName string) (ObjectiveRegradeReport, error) {
	var report ObjectiveRegradeReport
	err := s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		var before string
		err := q.QueryRowContext(ctx,
			`SELECT CAST(override_json AS CHAR) FROM grading_schedule_question_overrides WHERE schedule_id = ? AND question_id = ? FOR UPDATE`,
			scheduleID, questionID).Scan(&before)
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Override not found.")
		}
		if err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx,
			`DELETE FROM grading_schedule_question_overrides WHERE schedule_id = ? AND question_id = ?`,
			scheduleID, questionID); err != nil {
			return err
		}
		if err := appendScheduleOverrideEvent(ctx, q, scheduleID, actorID, actorName, "objective_override_deleted", map[string]any{
			"questionId": questionID, "reason": reason, "before": json.RawMessage(before),
		}); err != nil {
			return err
		}
		report, err = regradeScheduleObjectives(ctx, q, scheduleID, actorID, actorName)
		return err
	})
	return report, err
}

// RegradeScheduleObjectivesFromLatestDraft makes the exam's current draft
// the schedule's objective grading source and regrades stored answers
// against it in the same transaction, so release never sees a source whose
// projections are stale.
func (s *Service) RegradeScheduleObjectivesFromLatestDraft(ctx context.Context, scheduleID, reason, actorID, actorName string) (string, ObjectiveRegradeReport, error) {
	var report ObjectiveRegradeReport
	var draftVersionID string
	if strings.TrimSpace(reason) == "" {
		return "", report, apperrors.New(apperrors.CodeValidation, "Regrade reason is required.")
	}
	err := s.runner.WithTxRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		var examID string
		var draft sql.NullString
		err := q.QueryRowContext(ctx, `
			SELECT s.exam_id, CAST(e.current_draft_version_id AS CHAR)
			FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id
			WHERE s.id = ? FOR UPDATE`, scheduleID).Scan(&examID, &draft)
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		if err != nil {
			return err
		}
		draftVersionID = strings.TrimSpace(draft.String)
		if draftVersionID == "" {
			return apperrors.New(apperrors.CodeValidation, "No draft version found for this exam.")
		}
		if err := appendScheduleOverrideEvent(ctx, q, scheduleID, actorID, actorName, "objective_regrade_triggered", map[string]any{
			"reason": reason, "source": "latest_draft", "examId": examID, "draftVersionId": draftVersionID,
		}); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO grading_schedule_objective_grading_source
				(schedule_id, source, version_id, updated_by_actor_id, updated_by_actor_name)
			VALUES (?, 'draft_version', ?, ?, ?)
			ON DUPLICATE KEY UPDATE source = VALUES(source), version_id = VALUES(version_id),
				updated_by_actor_id = VALUES(updated_by_actor_id), updated_by_actor_name = VALUES(updated_by_actor_name),
				updated_at = CURRENT_TIMESTAMP`,
			scheduleID, draftVersionID, actorID, actorName); err != nil {
			return err
		}
		report, err = regradeScheduleObjectives(ctx, q, scheduleID, actorID, actorName)
		return err
	})
	return draftVersionID, report, err
}

func appendScheduleOverrideEvent(ctx context.Context, q tx.Tx, scheduleID, actorID, actorName, action string, payload any) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO grading_schedule_override_events (id, schedule_id, actor_id, actor_name, action, payload_json)
		VALUES (?, ?, ?, ?, ?, ?)`,
		uuid.NewString(), scheduleID, actorID, actorName, action, string(mustJSON(payload)))
	return err
}

type regradeSubmission struct {
	ID        string
	VersionID string
	Released  bool
}

type regradeSection struct {
	ID      string
	Name    string
	Answers string
	Results sql.NullString
}

// regradeScheduleObjectives rescores the stored listening/reading answers of
// every current IELTS submission in the schedule. Released submissions are
// left untouched: their published result is immutable. Teacher per-question
// overrides stored on the old results are carried over.
//
// offcut: one transaction locks the whole schedule's objective rows; batch per
// submission if schedules grow past a few hundred candidates.
func regradeScheduleObjectives(ctx context.Context, q tx.Tx, scheduleID, actorID, actorName string) (ObjectiveRegradeReport, error) {
	var report ObjectiveRegradeReport
	overrides, err := loadProjectionOverrides(ctx, q, scheduleID)
	if err != nil {
		return report, err
	}
	rows, err := q.QueryContext(ctx, `
		SELECT s.id, s.published_version_id, s.grading_status = ?
		FROM student_submissions s
		JOIN student_attempts a ON a.id = s.attempt_id
			AND a.terminal_generation = s.terminal_generation AND a.submitted_at IS NOT NULL
		WHERE s.schedule_id = ? AND s.provider_key = 'ielts'
		ORDER BY s.id
		FOR UPDATE`, SubmissionReleased, scheduleID)
	if err != nil {
		return report, err
	}
	var submissions []regradeSubmission
	for rows.Next() {
		var sub regradeSubmission
		if err := rows.Scan(&sub.ID, &sub.VersionID, &sub.Released); err != nil {
			rows.Close()
			return report, err
		}
		submissions = append(submissions, sub)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return report, err
	}

	type objectiveSource struct {
		content   map[string]any
		versionID string
		keys      map[string]string
	}
	sources := map[string]objectiveSource{}
	for _, sub := range submissions {
		report.AttemptsScanned++
		if sub.Released {
			continue
		}
		report.SubmissionsMatched++
		source, ok := sources[sub.VersionID]
		if !ok {
			var contentRaw, configRaw sql.NullString
			if err := q.QueryRowContext(ctx,
				"SELECT CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR) FROM exam_versions WHERE id = ?",
				sub.VersionID).Scan(&contentRaw, &configRaw); err != nil {
				return report, err
			}
			content, _, versionID, err := loadProjectionObjectiveSource(ctx, q, scheduleID, sub.VersionID,
				projectionObject(json.RawMessage(contentRaw.String)), projectionObject(json.RawMessage(configRaw.String)))
			if err != nil {
				return report, err
			}
			keys, err := loadObjectiveAnswerKey(ctx, q, versionID)
			if err != nil {
				return report, err
			}
			source = objectiveSource{content: content, versionID: versionID, keys: keys}
			sources[sub.VersionID] = source
		}

		sections, err := loadRegradeSections(ctx, q, sub.ID)
		if err != nil {
			return report, err
		}
		updated := false
		for _, section := range sections {
			report.SectionsChecked++
			stored := projectionObjectValue(projectionObject(json.RawMessage(section.Answers))["answers"])
			_, results := gradeProjectionObjectiveSection(section.Name, stored, source.content, source.keys, overrides, source.versionID)
			previous := projectionObject(json.RawMessage(section.Results.String))
			carryTeacherOverrides(previous, results)
			// integrity carries gradingSourceVersionId, which release checks.
			if projectionJSON(previous["questionResults"]) == projectionJSON(results["questionResults"]) &&
				projectionJSON(previous["integrity"]) == projectionJSON(results["integrity"]) {
				continue
			}
			report.SectionsNeedingUpdate++
			if _, err := q.ExecContext(ctx, `
				UPDATE section_submissions
				SET auto_grading_results = ?,
					grading_status = CASE WHEN grading_status IN ('auto_graded', 'needs_review') THEN ? ELSE grading_status END
				WHERE id = ?`,
				projectionJSON(results), projectionObjectiveStatus(results), section.ID); err != nil {
				return report, err
			}
			report.SectionsUpdated++
			updated = true
		}
		if updated {
			report.SubmissionsUpdated++
		}
	}
	err = appendScheduleOverrideEvent(ctx, q, scheduleID, actorID, actorName, "objective_regrade_completed", map[string]any{"report": report})
	return report, err
}

func loadRegradeSections(ctx context.Context, q tx.Tx, submissionID string) ([]regradeSection, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, section, CAST(answers AS CHAR), CAST(auto_grading_results AS CHAR)
		FROM section_submissions
		WHERE submission_id = ? AND section IN ('listening', 'reading')
		FOR UPDATE`, submissionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []regradeSection
	for rows.Next() {
		var section regradeSection
		var answers sql.NullString
		if err := rows.Scan(&section.ID, &section.Name, &answers, &section.Results); err != nil {
			return nil, err
		}
		section.Answers = answers.String
		out = append(out, section)
	}
	return out, rows.Err()
}

// carryTeacherOverrides keeps per-submission teacher decisions across a
// regrade: the section-level "overrides" map and any per-question manual
// override fields stored on the previous results.
func carryTeacherOverrides(previous, next map[string]any) {
	if over, ok := previous["overrides"]; ok {
		next["overrides"] = over
	}
	oldResults, _ := previous["questionResults"].([]any)
	if len(oldResults) == 0 {
		return
	}
	manual := map[string]map[string]any{}
	for _, raw := range oldResults {
		result, _ := raw.(map[string]any)
		id, _ := result["questionId"].(string)
		if _, ok := result["manualOverride"]; ok && id != "" {
			manual[id] = result
		}
	}
	if len(manual) == 0 {
		return
	}
	newResults, _ := next["questionResults"].([]any)
	for _, raw := range newResults {
		result, _ := raw.(map[string]any)
		id, _ := result["questionId"].(string)
		old, ok := manual[id]
		if !ok {
			continue
		}
		for _, key := range []string{"manualOverride", "overrideReason", "overriddenBy", "overriddenAt"} {
			if value, ok := old[key]; ok {
				result[key] = value
			}
		}
	}
}

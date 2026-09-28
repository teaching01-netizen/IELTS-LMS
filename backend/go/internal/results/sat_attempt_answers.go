package results

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// SATAttemptAnswers is a read-only snapshot of responses accepted by the server.
// It deliberately contains no answer keys or provisional scoring.
type SATAttemptAnswers struct {
	AttemptID        string             `json:"attemptId"`
	ExamTitle        string             `json:"examTitle"`
	VersionNumber    int                `json:"versionNumber"`
	StudentID        string             `json:"studentId"`
	StudentName      string             `json:"studentName"`
	CohortName       string             `json:"cohortName"`
	Status           string             `json:"status"`
	ProtocolVersion  int                `json:"protocolVersion"`
	ResponseRevision *uint64            `json:"responseRevision"`
	SavedAnswerCount int                `json:"savedAnswerCount"`
	LastSavedAt      *time.Time         `json:"lastSavedAt"`
	Questions        []SATAttemptAnswer `json:"questions"`
}

type SATAttemptAnswer struct {
	QuestionID      string `json:"questionId"`
	SectionKey      string `json:"sectionKey"`
	ModuleKey       string `json:"moduleKey"`
	DisplayOrder    int    `json:"displayOrder"`
	Response        any    `json:"response"`
	MarkedForReview bool   `json:"markedForReview"`
}

// GetSATAttemptAnswers scopes the attempt before reading any answer content.
// Both reads share a repeatable-read snapshot so the displayed revision and
// question values describe the same committed server state.
func (s *Service) GetSATAttemptAnswers(ctx context.Context, actor auth.ActorContext, attemptID string) (*SATAttemptAnswers, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	scope, scopeArgs := resultScope("sch", actor)
	query := `SELECT a.id, sch.exam_title, version.version_number, a.candidate_id,
		a.candidate_name, sch.cohort_name, a.delivery_status, a.protocol_version,
		a.response_revision, (SELECT ar.outcome_status FROM assessment_results ar
			WHERE ar.attempt_id = a.id AND ar.provider_key = 'sat' LIMIT 1)
		FROM student_attempts a
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		JOIN exam_entities exam ON exam.id = a.exam_id AND exam.provider_key = 'sat'
		JOIN exam_versions version ON version.id = a.published_version_id
		WHERE a.id = ?` + scope
	args := append([]any{attemptID}, scopeArgs...)
	out := &SATAttemptAnswers{Questions: []SATAttemptAnswer{}}
	var cohort, delivery, outcome sql.NullString
	var revision uint64
	err = tx.QueryRowContext(ctx, query, args...).Scan(&out.AttemptID, &out.ExamTitle,
		&out.VersionNumber, &out.StudentID, &out.StudentName, &cohort, &delivery,
		&out.ProtocolVersion, &revision, &outcome)
	if err == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeNotFound, "SAT attempt not found.")
	}
	if err != nil {
		return nil, err
	}
	out.CohortName = cohort.String
	out.Status = delivery.String
	if outcome.Valid {
		out.Status = outcome.String
	}
	if out.ProtocolVersion >= 2 {
		out.ResponseRevision = &revision
	}

	rows, err := tx.QueryContext(ctx, `SELECT s.section_key, m.module_key, eq.display_order,
		eq.id, eq.question_id, ar.response, ar.marked_for_review, ar.updated_at,
		CAST(v.response AS CHAR), v.question_id IS NOT NULL, v.updated_at
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_exam_questions eq ON eq.module_id = m.id
		LEFT JOIN assessment_question_responses ar
			ON ar.module_attempt_id = ma.id AND ar.exam_question_id = eq.id
		LEFT JOIN attempt_responses_v2 v
			ON v.attempt_id = ma.attempt_id AND v.module_id = m.id
			AND v.question_id IN (eq.id, eq.question_id)
			AND s.exam_version_id = (SELECT published_version_id FROM student_attempts WHERE id = ma.attempt_id)
		WHERE ma.attempt_id = ?
		ORDER BY s.display_order, m.display_order, eq.display_order,
			CASE WHEN (CAST(v.question_id AS CHAR) COLLATE utf8mb4_unicode_ci) = eq.id THEN 0 ELSE 1 END`, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	seen := make(map[string]struct{})
	for rows.Next() {
		var question SATAttemptAnswer
		var examQuestionID string
		var legacy, canonical sql.NullString
		var legacyMarked, v2Present sql.NullBool
		var legacySaved, v2Saved sql.NullTime
		if err := rows.Scan(&question.SectionKey, &question.ModuleKey, &question.DisplayOrder,
			&examQuestionID, &question.QuestionID, &legacy, &legacyMarked, &legacySaved,
			&canonical, &v2Present, &v2Saved); err != nil {
			return nil, err
		}
		if _, duplicate := seen[examQuestionID]; duplicate {
			continue
		}
		seen[examQuestionID] = struct{}{}
		resolved, err := resolveSATResponse(v2Present.Valid && v2Present.Bool, canonical, v2Saved, legacy, legacyMarked, legacySaved)
		if err != nil {
			return nil, err
		}
		question.MarkedForReview = resolved.MarkedForReview
		if resolved.HasAnswer {
			if err := json.Unmarshal(resolved.Answer, &question.Response); err != nil {
				return nil, err
			}
		}
		switch answer := question.Response.(type) {
		case nil:
		case string:
			if strings.TrimSpace(answer) != "" {
				out.SavedAnswerCount++
			}
		default:
			out.SavedAnswerCount++
		}
		out.LastSavedAt = latestSavedAt(out.LastSavedAt, resolved.SavedAt)
		out.Questions = append(out.Questions, question)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return out, nil
}

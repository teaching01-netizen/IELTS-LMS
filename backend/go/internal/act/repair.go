package act

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// RepairCanonicalRows projects a bounded page of submitted ACT attempts into
// the canonical grading model. It is deliberately resumable: each attempt is
// committed independently, so one malformed legacy row cannot prevent later
// rows from being repaired on the next worker cycle.
//
// The predicate includes exam_type='ACT' even when provider_key was persisted
// as 'ielts'. This repairs the identity drift produced by the migration while
// preserving the immutable attempt answers and final-submission compatibility
// projection.
func (s *Service) RepairCanonicalRows(ctx context.Context, batch int64) (int64, error) {
	if s == nil || s.db == nil || s.runner == nil {
		return 0, nil
	}
	if batch < 1 {
		batch = 1
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		WHERE a.submitted_at IS NOT NULL
		  AND (e.provider_key = 'act' OR UPPER(COALESCE(e.exam_type, '')) = 'ACT')
		  AND NOT EXISTS (
			SELECT 1
			FROM student_submissions ss
			JOIN section_submissions sec ON sec.submission_id = ss.id AND sec.section = 'science'
			WHERE ss.attempt_id = a.id AND ss.provider_key = 'act'
		  )
		ORDER BY a.updated_at ASC, a.id ASC
		LIMIT ?`, batch)
	if err != nil {
		return 0, err
	}
	var attemptIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		attemptIDs = append(attemptIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()

	var repaired int64
	var firstErr error
	for _, attemptID := range attemptIDs {
		err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
			var versionID string
			var answersRaw, finalRaw sql.NullString
			var submittedAt sql.NullTime
			if err := q.QueryRowContext(ctx, `
				SELECT published_version_id, CAST(answers AS CHAR), CAST(final_submission AS CHAR), submitted_at
				FROM student_attempts WHERE id = ? FOR UPDATE`, attemptID).
				Scan(&versionID, &answersRaw, &finalRaw, &submittedAt); err != nil {
				return err
			}
			details, err := s.ScoreAttemptDetails(ctx, q, attemptID, versionID, json.RawMessage(answersRaw.String))
			if err != nil {
				return err
			}
			when := time.Now().UTC()
			if submittedAt.Valid {
				when = submittedAt.Time
			}
			return s.projectRepairedAttempt(ctx, q, attemptID, when, answersRaw.String, finalRaw.String, details)
		})
		if err != nil {
			if firstErr == nil {
				firstErr = fmt.Errorf("attempt %s: %w", attemptID, err)
			}
			continue
		}
		repaired++
	}
	if firstErr != nil {
		return repaired, fmt.Errorf("ACT canonical repair completed with failures: %w", firstErr)
	}
	return repaired, nil
}

func (s *Service) projectRepairedAttempt(ctx context.Context, q tx.Tx, attemptID string, submittedAt time.Time, answersRaw, finalRaw string, details map[string]any) error {
	var scheduleID, examID, versionID, studentID, studentName, cohortName string
	var email sql.NullString
	if err := q.QueryRowContext(ctx, `
		SELECT a.schedule_id, a.exam_id, a.published_version_id,
			a.candidate_id, a.candidate_name, a.candidate_email, sch.cohort_name
		FROM student_attempts a
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		WHERE a.id = ? FOR UPDATE`, attemptID).Scan(
		&scheduleID, &examID, &versionID, &studentID, &studentName, &email, &cohortName); err != nil {
		return err
	}

	var submissionID, storedProvider string
	err := q.QueryRowContext(ctx,
		"SELECT id, provider_key FROM student_submissions WHERE attempt_id = ? FOR UPDATE", attemptID).
		Scan(&submissionID, &storedProvider)
	if err == sql.ErrNoRows {
		submissionID = uuid.NewString()
	} else if err != nil {
		return err
	}
	if storedProvider != "" && storedProvider != "act" {
		if _, err := q.ExecContext(ctx, "UPDATE student_submissions SET provider_key = 'act', updated_at = UTC_TIMESTAMP(6) WHERE id = ?", submissionID); err != nil {
			return err
		}
	}
	integrityStatus := scienceIntegrityStatus(details)
	sectionStatuses := jsonObject(map[string]any{SectionScience: integrityStatus})
	var emailArg any
	if email.Valid {
		emailArg = email.String
	}
	if _, err := q.ExecContext(ctx, `
		INSERT INTO student_submissions (
			id, attempt_id, schedule_id, exam_id, published_version_id, provider_key,
			student_id, student_name, student_email, cohort_name, submitted_at,
			grading_status, section_statuses, created_at, updated_at
		)
		VALUES (?, ?, ?, ?, ?, 'act', ?, ?, ?, ?, ?, 'submitted', ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))
		ON DUPLICATE KEY UPDATE
			schedule_id = VALUES(schedule_id), exam_id = VALUES(exam_id),
			published_version_id = VALUES(published_version_id), provider_key = 'act',
			student_id = VALUES(student_id), student_name = VALUES(student_name),
			student_email = VALUES(student_email), cohort_name = VALUES(cohort_name),
			submitted_at = VALUES(submitted_at), section_statuses = VALUES(section_statuses),
			updated_at = UTC_TIMESTAMP(6)`,
		submissionID, attemptID, scheduleID, examID, versionID, studentID, studentName,
		emailArg, cohortName, submittedAt, sectionStatuses); err != nil {
		return err
	}

	answers := map[string]any{}
	if strings.TrimSpace(answersRaw) != "" {
		_ = json.Unmarshal([]byte(answersRaw), &answers)
	}
	answersPayload := jsonObject(map[string]any{"type": SectionScience, "answers": answers})
	autoResults := jsonObject(details["autoGradingResults"])
	sectionID := uuid.NewString()
	var existingSectionID string
	if err := q.QueryRowContext(ctx,
		"SELECT id FROM section_submissions WHERE submission_id = ? AND section = 'science' FOR UPDATE",
		submissionID).Scan(&existingSectionID); err == nil {
		sectionID = existingSectionID
	} else if err != sql.ErrNoRows {
		return err
	}
	if _, err := q.ExecContext(ctx, `
		INSERT INTO section_submissions (
			id, submission_id, section, answers, auto_grading_results, grading_status, submitted_at
		)
		VALUES (?, ?, 'science', ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			answers = VALUES(answers), auto_grading_results = VALUES(auto_grading_results),
			grading_status = VALUES(grading_status), submitted_at = VALUES(submitted_at)`,
		sectionID, submissionID, answersPayload, autoResults, integrityStatus, submittedAt); err != nil {
		return err
	}

	merged := map[string]any{}
	if strings.TrimSpace(finalRaw) != "" {
		_ = json.Unmarshal([]byte(finalRaw), &merged)
	}
	merged["score"] = details["score"]
	merged["providerKey"] = "act"
	merged["section"] = SectionScience
	finalJSON, err := json.Marshal(merged)
	if err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, "UPDATE student_attempts SET final_submission = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?", string(finalJSON), attemptID); err != nil {
		return err
	}

	var resultID string
	resultErr := q.QueryRowContext(ctx,
		"SELECT id FROM assessment_results WHERE attempt_id = ? AND provider_key = 'act' FOR UPDATE", attemptID).Scan(&resultID)
	if resultErr == sql.ErrNoRows {
		// Older ACT rows sometimes carried the IELTS provider key. Reusing that
		// row preserves audit identity while repairing its provider contract.
		resultErr = q.QueryRowContext(ctx,
			"SELECT id FROM assessment_results WHERE attempt_id = ? AND provider_key = 'ielts' FOR UPDATE", attemptID).Scan(&resultID)
		if resultErr == nil {
			if _, err := q.ExecContext(ctx, "UPDATE assessment_results SET provider_key = 'act' WHERE id = ?", resultID); err != nil {
				return err
			}
		}
	}
	if resultErr != nil && resultErr != sql.ErrNoRows {
		return resultErr
	}
	resultPayload, err := json.Marshal(map[string]any{
		"providerKey": "act", "outcomeStatus": "scored", "score": details["score"],
		"autoGradingResults": details["autoGradingResults"], "repairedAt": time.Now().UTC(),
	})
	if err != nil {
		return err
	}
	total := mustIntFromDetails(details, "score", "totalScore")
	releaseStatus := "pending"
	if integrityStatus == "auto_graded" {
		releaseStatus = "ready_to_release"
	}
	if resultID != "" {
		_, err = q.ExecContext(ctx, `
			UPDATE assessment_results
			SET submission_id = ?, provider_key = 'act', outcome_status = 'scored',
				total_score = ?, score_payload = ?, release_status = ?,
				updated_at = UTC_TIMESTAMP(6), revision = revision + 1
			WHERE id = ?`, submissionID, total, string(resultPayload), releaseStatus, resultID)
		return err
	}
	_, err = q.ExecContext(ctx, `
		INSERT INTO assessment_results
			(id, attempt_id, submission_id, provider_key, outcome_status, total_score, score_payload, release_status)
		VALUES (?, ?, ?, 'act', 'scored', ?, ?, ?)`,
		uuid.NewString(), attemptID, submissionID, total, string(resultPayload), releaseStatus)
	return err
}

func scienceIntegrityStatus(details map[string]any) string {
	auto, ok := details["autoGradingResults"].(map[string]any)
	if !ok {
		return "needs_review"
	}
	integrity, ok := auto["integrity"].(map[string]any)
	if ok && integrity["integrityStatus"] == "verified" {
		return "auto_graded"
	}
	return "needs_review"
}

func jsonObject(value any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func mustIntFromDetails(details map[string]any, parent, key string) int64 {
	value, ok := details[parent]
	if !ok {
		return 0
	}
	if score, ok := value.(Score); ok {
		if key == "totalScore" {
			return int64(score.TotalScore)
		}
		return 0
	}
	if object, ok := value.(map[string]any); ok {
		switch number := object[key].(type) {
		case int:
			return int64(number)
		case int64:
			return number
		case float64:
			return int64(number)
		}
	}
	return 0
}

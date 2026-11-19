package delivery

import (
	"context"
	"database/sql"
	"errors"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/sat"
)

type SATCompletedAttempt struct {
	AttemptID string `json:"attemptId"`
	Ordinal   int    `json:"ordinal"`
}

// A verified completed sitting is the read-only entry point to its owner's
// submitted attempts in that room and published version. It never grants a
// writer credential or access to an in-progress attempt.
const studentSATCompletedScope = `FROM student_attempts anchor_attempt
	JOIN exam_schedules room ON room.id = anchor_attempt.schedule_id AND room.provider_key = 'sat'
	JOIN student_attempts selected ON selected.schedule_id = anchor_attempt.schedule_id
		AND selected.user_id = anchor_attempt.user_id
		AND selected.published_version_id = anchor_attempt.published_version_id
	LEFT JOIN sat_attempt_learning learning ON learning.attempt_id = selected.id
	WHERE anchor_attempt.id = ? AND anchor_attempt.schedule_id = ? AND anchor_attempt.user_id = ?
		AND anchor_attempt.delivery_status = 'submitted' AND anchor_attempt.submitted_at IS NOT NULL
		AND COALESCE(anchor_attempt.proctor_status, 'active') <> 'terminated'
		AND selected.delivery_status = 'submitted' AND selected.submitted_at IS NOT NULL
		AND COALESCE(selected.proctor_status, 'active') <> 'terminated'`

func (s *Service) StudentSATCompletedAttempts(ctx context.Context, claims crypto.AttemptClaims) ([]SATCompletedAttempt, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT selected.id, COALESCE(learning.ordinal, 1) `+studentSATCompletedScope+
		` ORDER BY COALESCE(learning.ordinal, 1) DESC, selected.submitted_at DESC, selected.id DESC`,
		claims.AttemptID, claims.ScheduleID, claims.UserID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	attempts := []SATCompletedAttempt{}
	for rows.Next() {
		var attempt SATCompletedAttempt
		if err := rows.Scan(&attempt.AttemptID, &attempt.Ordinal); err != nil {
			return nil, err
		}
		attempts = append(attempts, attempt)
	}
	return attempts, rows.Err()
}

// AuthorizeStudentSATCompletedPDF also requires the selected generation to have
// a released score. The PDF path separately re-checks the live room settings.
func (s *Service) AuthorizeStudentSATCompletedPDF(ctx context.Context, claims crypto.AttemptClaims, attemptID string) error {
	return s.authorizeStudentSATCompletedAttempt(ctx, claims, attemptID, ` AND EXISTS (
		SELECT 1 FROM assessment_results result
		WHERE result.attempt_id = selected.id AND result.terminal_generation = selected.terminal_generation
		AND result.provider_key = 'sat' AND result.outcome_status = 'scored' AND result.release_status = 'released'
	)`)
}

func (s *Service) authorizeStudentSATCompletedAttempt(ctx context.Context, claims crypto.AttemptClaims, attemptID, releaseSQL string) error {
	var id string
	err := s.db.QueryRowContext(ctx, `SELECT selected.id `+studentSATCompletedScope+` AND selected.id = ?`+releaseSQL,
		claims.AttemptID, claims.ScheduleID, claims.UserID, attemptID).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return apperrors.New(apperrors.CodeNotFound, "Submitted SAT attempt not found.")
	}
	return err
}

func (s *Service) StudentSATCompletedResult(ctx context.Context, claims crypto.AttemptClaims, attemptID string) (*sat.AssessmentResult, error) {
	if err := s.authorizeStudentSATCompletedAttempt(ctx, claims, attemptID, ""); err != nil {
		return nil, err
	}
	result, err := sat.LoadResultForAttempt(ctx, s.db, attemptID)
	if err != nil {
		return nil, err
	}
	return StudentSATResult(ctx, s.db, result)
}

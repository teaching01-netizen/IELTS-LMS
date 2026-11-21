package delivery

import (
	"context"
	"database/sql"
	"errors"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/satlearning"
)

// StudentPolicyState is the student-safe projection of one room's live
// Results and scoring policy. It carries no keys, answers, or room identities,
// so a foreground poll can refresh the controls a student is looking at
// without a full bootstrap or a PDF regeneration.
type StudentPolicyState struct {
	Revision              int64 `json:"revision"`
	ReportVisible         bool  `json:"reportVisible"`
	IncludeAnswerKeyInPdf bool  `json:"includeAnswerKeyInPdf"`
	UnlimitedRetakes      bool  `json:"unlimitedRetakes"`
	PauseOnLeave          bool  `json:"pauseOnLeave"`
}

// StudentPolicyState loads the room policy for the attempt's own schedule. It
// works for active and completed attempts: a completed screen still needs to
// observe a revocation. An unknown attempt, a foreign schedule, or a
// non-SAT attempt is NOT_FOUND, never a guessed policy.
func (s *Service) StudentPolicyState(ctx context.Context, scheduleID, attemptID string) (StudentPolicyState, error) {
	if s == nil || s.db == nil {
		return StudentPolicyState{}, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery is unavailable.")
	}
	if scheduleID == "" || attemptID == "" {
		return StudentPolicyState{}, apperrors.New(apperrors.CodeNotFound, "SAT attempt not found.")
	}
	var provider string
	err := s.db.QueryRowContext(ctx, `SELECT COALESCE(e.provider_key, '')
		FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id
		WHERE a.id = ? AND a.schedule_id = ?`, attemptID, scheduleID).Scan(&provider)
	if errors.Is(err, sql.ErrNoRows) {
		return StudentPolicyState{}, apperrors.New(apperrors.CodeNotFound, "SAT attempt not found.")
	}
	if err != nil {
		return StudentPolicyState{}, err
	}
	if provider != "sat" {
		return StudentPolicyState{}, apperrors.New(apperrors.CodeNotFound, "SAT attempt not found.")
	}
	policy, err := satlearning.LoadPolicyTx(ctx, s.db, scheduleID)
	if err != nil {
		return StudentPolicyState{}, err
	}
	return StudentPolicyState{
		Revision:              policy.Revision,
		ReportVisible:         policy.ReportVisible,
		IncludeAnswerKeyInPdf: policy.IncludeAnswerKeyInPdf,
		UnlimitedRetakes:      policy.UnlimitedRetakes,
		PauseOnLeave:          policy.PauseOnLeave,
	}, nil
}

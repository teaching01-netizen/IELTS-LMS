package delivery

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

type StudentPauseState struct {
	Allowed      bool  `json:"allowed"`
	Paused       bool  `json:"paused"`
	ControlEpoch int64 `json:"controlEpoch"`
}

const studentPauseQuery = `SELECT a.sat_student_paused_at IS NOT NULL, a.control_epoch,
	COALESCE((SELECT pause_on_leave FROM sat_activity_policies WHERE schedule_id = a.schedule_id), FALSE),
	a.submitted_at IS NOT NULL OR a.phase = 'post-exam' OR COALESCE(a.proctor_status, '') = 'terminated'
		OR COALESCE(a.delivery_status, '') IN ('submitted', 'terminated', 'locked', 'cancelled'),
	COALESCE((SELECT provider_key FROM exam_entities WHERE id = a.exam_id), ''),
	a.sat_staff_control IS NOT NULL
	FROM student_attempts a WHERE a.id = ? AND a.schedule_id = ?`

func readStudentPause(ctx context.Context, q tx.Tx, scheduleID, attemptID string, lock bool) (StudentPauseState, bool, bool, error) {
	query := studentPauseQuery
	if lock {
		query += " FOR UPDATE"
	}
	var state StudentPauseState
	var terminal, staffControlled bool
	var provider string
	err := q.QueryRowContext(ctx, query, attemptID, scheduleID).Scan(
		&state.Paused, &state.ControlEpoch, &state.Allowed, &terminal, &provider, &staffControlled)
	if errors.Is(err, sql.ErrNoRows) || err == nil && provider != "sat" {
		return StudentPauseState{}, false, false, apperrors.New(apperrors.CodeNotFound, "SAT attempt not found.")
	}
	return state, terminal, staffControlled, err
}

func (s *Service) ReadStudentPause(ctx context.Context, scheduleID, attemptID string) (StudentPauseState, error) {
	state, terminal, staffControlled, err := readStudentPause(ctx, s.db, scheduleID, attemptID, false)
	if err != nil || terminal {
		return StudentPauseState{}, err
	}
	if state.Allowed && !staffControlled {
		var mode string
		err := s.db.QueryRowContext(ctx, `SELECT COALESCE(sat_timing_model, '') FROM exam_schedules WHERE id = ?`, scheduleID).Scan(&mode)
		if err != nil {
			return StudentPauseState{}, err
		}
		state.Allowed = examruntime.IsSatPersonal(mode)
	}
	return state, nil
}

func (s *Service) SetStudentPause(ctx context.Context, scheduleID, attemptID string, pause bool, epoch uint64, writerBinding ...string) (StudentPauseState, error) {
	var out StudentPauseState
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		state, terminal, staffControlled, err := readStudentPause(ctx, q, scheduleID, attemptID, true)
		if err != nil {
			return err
		}
		if terminal {
			return assessmentConflict("ATTEMPT_TERMINAL", "This exam is already closed.")
		}
		if err := enforceWriterSessionTx(ctx, q, scheduleID, attemptID, writerBinding...); err != nil {
			return err
		}
		if state.Paused == pause {
			out = state
			return nil
		}
		if epoch == 0 {
			return apperrors.New(apperrors.CodeBadRequest, "Reload the exam before changing its pause state.")
		}
		if err := enforceControlEpochValue(attemptID, state.ControlEpoch, epoch); err != nil {
			return err
		}
		var runtimeStatus, mode string
		if err := q.QueryRowContext(ctx, `SELECT status, COALESCE(timing_model, '') FROM exam_session_runtimes
			WHERE schedule_id = ? FOR SHARE`, scheduleID).Scan(&runtimeStatus, &mode); err != nil {
			return err
		}
		if pause {
			if !state.Allowed || runtimeStatus != "live" || (!staffControlled && !examruntime.IsSatPersonal(mode)) {
				return assessmentConflict("STUDENT_PAUSE_UNAVAILABLE", "Pausing is unavailable for this exam.")
			}
			var started, now time.Time
			var paused sql.NullTime
			var allotted, extension, accumulated int
			err := q.QueryRowContext(ctx, `SELECT started_at, paused_at, allocated_seconds, extension_seconds,
				accumulated_paused_seconds, UTC_TIMESTAMP(6)
				FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('active', 'review')
				AND started_at IS NOT NULL ORDER BY started_at DESC LIMIT 1 FOR UPDATE`, attemptID).
				Scan(&started, &paused, &allotted, &extension, &accumulated, &now)
			if errors.Is(err, sql.ErrNoRows) {
				return assessmentConflict("STUDENT_PAUSE_UNAVAILABLE", "There is no running module to pause.")
			}
			if err != nil {
				return err
			}
			if paused.Valid || moduleRemainingSeconds(&started, nil, allotted, extension, accumulated, now) == 0 {
				return assessmentConflict("STUDENT_PAUSE_UNAVAILABLE", "There is no running module to pause.")
			}
		}
		if _, err := q.ExecContext(ctx, `UPDATE student_attempts
			SET sat_student_paused_at = IF(?, UTC_TIMESTAMP(6), NULL),
				control_epoch = control_epoch + 1, revision = revision + 1, updated_at = UTC_TIMESTAMP(6)
			WHERE id = ?`, pause, attemptID); err != nil {
			return err
		}
		if err := examruntime.SyncSATPauseInTx(ctx, q, scheduleID, attemptID); err != nil {
			return err
		}
		state.Paused = pause
		state.ControlEpoch++
		out = state
		return nil
	})
	return out, err
}

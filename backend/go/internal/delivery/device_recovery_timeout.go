package delivery

import (
	"context"
	"database/sql"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

type RecoveryTimeoutSealer func(context.Context, tx.Tx, string, string, string, time.Time) error

func (s *Service) SetRecoveryTimeoutSealer(seal RecoveryTimeoutSealer) *Service {
	s.recoveryTimeoutSealer = seal
	return s
}

// ReconcileRecoveryTimeout owns non-SAT continuation expiry. The attempt lock
// serializes it with staff edits, Begin, response writes and ordinary sealing.
func (s *Service) ReconcileRecoveryTimeout(ctx context.Context, scheduleID, attemptID string) (bool, error) {
	changed := false
	if s.recoveryTimeoutSealer == nil {
		return false, nil
	}
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		changed = false
		row, err := loadRecoveryAttempt(ctx, q, scheduleID, attemptID, true)
		if err != nil {
			return err
		}
		c := row.Control
		if !row.open() || c == nil || c.Phase != examdomain.RecoveryPhaseWorking || c.Target.ModuleAttemptID != "" || row.ProctorStatus == "paused" {
			return nil
		}
		var status, reason, model string
		if err := q.QueryRowContext(ctx, `SELECT status,COALESCE(completion_reason,''),timing_model FROM exam_session_runtimes WHERE schedule_id=? FOR SHARE`, scheduleID).Scan(&status, &reason, &model); err != nil {
			return err
		}
		if status != "live" && !(status == "completed" && reason == "time_expired") {
			return nil
		}
		now, err := dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		if c.FocusDeadlineAt == nil || now.Before(*c.FocusDeadlineAt) {
			return nil
		}
		deadline, controlID := *c.FocusDeadlineAt, c.ID
		whole := false
		if row.ProviderKey == examdomain.ProviderIELTS && examruntime.IsIELTSPersonal(model) {
			var out examruntime.CohortReadiness
			whole, err = examruntime.AdvanceIELTSRecoveryInTx(ctx, q, attemptID, c.Target.SectionKey, row.ProctorStatus, c, &out, &changed)
		} else {
			var out examruntime.CohortReadiness
			whole, err = examruntime.AdvanceSnapshotRecoveryInTx(ctx, q, attemptID, row.ProviderKey, c.Target.SectionKey, c, &out, &changed)
		}
		if err != nil {
			return err
		}
		if whole {
			if err := s.recoveryTimeoutSealer(ctx, q, attemptID, scheduleID, controlID, deadline); err != nil {
				return err
			}
			changed = true
		}
		return nil
	})
	return changed, err
}

func (s *Service) reconcileRecoveryTimeouts(ctx context.Context, batch int64) (int64, error) {
	if s.recoveryTimeoutSealer == nil {
		return 0, nil
	}
	if batch < 1 || batch > 250 {
		batch = 250
	}
	rows, err := s.db.QueryContext(ctx, `SELECT a.id,a.schedule_id FROM student_attempts a
JOIN exam_entities e ON e.id=a.exam_id
JOIN exam_session_runtimes r ON r.schedule_id=a.schedule_id
WHERE a.submitted_at IS NULL AND a.deadline_at<=UTC_TIMESTAMP(6)
AND COALESCE(a.proctor_status,'active')<>'paused' AND e.provider_key IN ('ielts','act')
AND JSON_UNQUOTE(JSON_EXTRACT(a.recovery_control,'$.phase'))='working'
AND (r.status='live' OR (r.status='completed' AND r.completion_reason='time_expired'))
ORDER BY a.deadline_at,a.id LIMIT ?`, batch)
	if err != nil {
		return 0, err
	}
	type candidate struct{ id, schedule string }
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.id, &c.schedule); err != nil {
			rows.Close()
			return 0, err
		}
		candidates = append(candidates, c)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return 0, err
	}
	var changed int64
	var firstErr error
	for _, c := range candidates {
		worked, err := s.ReconcileRecoveryTimeout(ctx, c.schedule, c.id)
		if err != nil && err != sql.ErrNoRows && firstErr == nil {
			firstErr = err
		}
		if worked {
			changed++
		}
	}
	return changed, firstErr
}

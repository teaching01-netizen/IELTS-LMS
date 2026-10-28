package proctor

import (
	"context"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// extendRecoveryClock runs under the caller's attempt lock. The focused
// provider clock changes; room clocks and suspended successor allocations do
// not. A pending explicit award changes at Continue, never at this update.
func extendRecoveryClock(ctx context.Context, q tx.Tx, attemptID, scheduleID, moduleID string, c *examdomain.RecoveryControl, minutes int64) error {
	if minutes > 1440 {
		return apperrors.New(apperrors.CodeValidation, "Recovery time cannot exceed 24 hours.")
	}
	if moduleID != "" && moduleID != c.Target.ModuleID {
		return recoveryControlConflict("Only the recovery focus can receive time.")
	}
	if c.Target.ModuleAttemptID != "" {
		if _, err := q.ExecContext(ctx, `UPDATE assessment_module_attempts SET extension_seconds=extension_seconds+(?*60),revision=revision+1 WHERE id=? AND attempt_id=?`, minutes, c.Target.ModuleAttemptID, attemptID); err != nil {
			return err
		}
	} else {
		if _, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines SET deadline_at=TIMESTAMPADD(MINUTE,?,deadline_at),revision=revision+1 WHERE attempt_id=? AND section_key=?`, minutes, attemptID, c.Target.SectionKey); err != nil {
			return err
		}
	}
	if c.Phase != examdomain.RecoveryPhaseWorking {
		result, err := q.ExecContext(ctx, `UPDATE attempt_device_recovery_grants SET requested_remaining_seconds=CASE WHEN requested_remaining_seconds IS NULL THEN NULL ELSE requested_remaining_seconds+(?*60) END,grant_revision=grant_revision+1,updated_at=UTC_TIMESTAMP(6) WHERE id=? AND attempt_id=? AND state IN ('issued','claimed') AND (requested_remaining_seconds IS NULL OR requested_remaining_seconds+(?*60)<=86400)`, minutes, c.ActiveGrantID, attemptID, minutes)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return recoveryControlConflict("The recovery award is no longer editable or would exceed 24 hours.")
		}
	}
	if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET deadline_at=TIMESTAMPADD(MINUTE,?,deadline_at),closing_grace_until=NULL,control_epoch=control_epoch+1,revision=revision+1,updated_at=UTC_TIMESTAMP(6) WHERE id=?`, minutes, attemptID); err != nil {
		return err
	}
	if err := examruntime.RealignSATRecoveryBoundariesInTx(ctx, q, scheduleID, attemptID); err != nil {
		return err
	}
	return examruntime.SyncRecoveryClockInTx(ctx, q, scheduleID, attemptID)
}

func recoveryControlConflict(message string) error {
	return &apperrors.Error{Code: apperrors.CodeConflict, HTTPStatus: 409, Message: message, Details: map[string]any{"reason": "RECOVERY_FOCUS"}}
}

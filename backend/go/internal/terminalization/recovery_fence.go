package terminalization

import (
	"context"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// The caller owns the attempt lock. A queued room timeout cannot acquire
// authority over an individual continuation merely by running later.
func guardRecoverySeal(ctx context.Context, q tx.Tx, attemptID, scheduleID string, cmd SealCommand) error {
	var generation uint64
	var raw string
	var newerContinuation bool
	var now time.Time
	if err := q.QueryRowContext(ctx, `SELECT terminal_generation,COALESCE(recovery_control,''),UTC_TIMESTAMP(6),
EXISTS(SELECT 1 FROM session_audit_logs audit WHERE audit.schedule_id=student_attempts.schedule_id AND audit.target_student_id=student_attempts.id
AND audit.action_type IN ('DEVICE_RECOVERY_CONTINUED','DEVICE_RECOVERY_REOPENED') AND audit.created_at>?)
FROM student_attempts WHERE id=? AND schedule_id=?`, cmd.OriginRecordedAt, attemptID, scheduleID).Scan(&generation, &raw, &now, &newerContinuation); err != nil {
		return err
	}
	if (cmd.ExpectedTerminalGeneration != nil && *cmd.ExpectedTerminalGeneration != generation) || newerContinuation {
		return supersededSeal("RECOVERY_SUPERSEDED")
	}
	c, err := examdomain.ParseRecoveryControl([]byte(raw))
	if err != nil {
		return err
	}
	if c != nil && c.Phase == examdomain.RecoveryPhaseWorking && cmd.ActorKind == ActorSystem && (cmd.Reason == ReasonTimeExpired || cmd.Reason == ReasonAutoStop) {
		// Only the continuation owner can close this run after its own deadline;
		// suspended successors must first pass through provider progression.
		if cmd.RecoveryControlID != c.ID || len(c.Suspended) > 0 || c.FocusDeadlineAt == nil || now.Before(*c.FocusDeadlineAt) {
			return supersededSeal("RECOVERY_FOCUS")
		}
	}
	return nil
}

func supersededSeal(reason string) error {
	return &apperrors.Error{Code: apperrors.CodeTerminalConflict, HTTPStatus: 409, Message: "This completion command was superseded by exam recovery.", Details: map[string]any{"reason": reason}}
}

package terminalization

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// ReopenTimedOutInTx appends a new completion generation without changing
// immutable history. Callers hold the same attempt lock through clock/owner
// activation and credential insertion; any later failure rolls this back.
func (s *Service) ReopenTimedOutInTx(ctx context.Context, q tx.Tx, attemptID, scheduleID, actorID, recoveryID string, target examdomain.RecoveryTarget) (uint64, error) {
	var generation uint64
	var submitted sql.NullTime
	var status, phase, proctor, provider, examType, rawControl string
	err := q.QueryRowContext(ctx, `SELECT a.terminal_generation, a.submitted_at, a.delivery_status, a.phase, CASE WHEN a.proctor_status = 'terminated' AND a.proctor_updated_by IS NULL AND EXISTS (SELECT 1 FROM attempt_terminalizations terminal WHERE terminal.attempt_id = a.id AND terminal.terminal_generation = a.terminal_generation AND terminal.reason = 'time_expired' AND terminal.actor_kind = 'system') THEN 'active' ELSE COALESCE(a.proctor_status, 'active') END, COALESCE(e.provider_key,''), COALESCE(e.exam_type,''), COALESCE(a.recovery_control,'') FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id WHERE a.id = ? AND a.schedule_id = ? FOR UPDATE`, attemptID, scheduleID).Scan(&generation, &submitted, &status, &phase, &proctor, &provider, &examType, &rawControl)
	if err != nil {
		return 0, err
	}
	control, err := examdomain.ParseRecoveryControl([]byte(rawControl))
	if err != nil {
		return 0, err
	}
	if control == nil || control.ID != recoveryID || !control.Target.Equal(target) || control.Phase != examdomain.RecoveryPhaseHeld {
		return 0, reopenConflict("RECOVERY_SUPERSEDED")
	}
	receipt, err := s.repo.FindByAttemptID(ctx, q, attemptID)
	if err != nil {
		return 0, err
	}
	if receipt == nil && !submitted.Valid && phase != "post-exam" && status != "submitted" && status != "terminated" && status != "cancelled" {
		return generation, nil
	}
	facts := examdomain.ClosureFacts{Provider: examdomain.EffectiveProviderKey(provider, examType), Cancelled: status == "cancelled", ProctorEnded: proctor == "terminated"}
	if receipt != nil {
		facts.ReceiptReason = receipt.Reason
	} else {
		facts.UnknownClosure = true
	}
	if target.ModuleAttemptID != "" {
		err = q.QueryRowContext(ctx, `SELECT COALESCE(completion_reason,'') FROM assessment_module_attempts WHERE id = ? AND attempt_id = ? AND module_id = ? FOR UPDATE`, target.ModuleAttemptID, attemptID, target.ModuleID).Scan(&facts.TargetReason)
	} else if facts.Provider == examdomain.ProviderIELTS {
		err = q.QueryRowContext(ctx, `SELECT COALESCE(completion_reason,'') FROM ielts_attempt_section_timelines WHERE attempt_id = ? AND section_key = ? FOR UPDATE`, attemptID, target.SectionKey).Scan(&facts.TargetReason)
		// Cohort providers use trusted runtime section provenance, never elapsed time.
		if err == sql.ErrNoRows {
			err = q.QueryRowContext(ctx, `SELECT COALESCE(s.completion_reason,'') FROM exam_session_runtime_sections s JOIN exam_session_runtimes r ON r.id = s.runtime_id WHERE r.schedule_id = ? AND s.section_key = ?`, scheduleID, target.SectionKey).Scan(&facts.TargetReason)
		}
	} else if facts.Provider == examdomain.ProviderACT {
		facts.TargetReason = facts.ReceiptReason
	}
	if err != nil {
		return 0, err
	}
	if strings.TrimSpace(facts.TargetReason) != "time_expired" {
		facts.TargetUnknown = true
	}
	eligible := examdomain.ClassifyRecoveryClosure(facts)
	if !eligible.Eligible {
		return 0, reopenConflict(eligible.Reason)
	}
	if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET terminal_generation = terminal_generation + 1, submitted_at = NULL, final_submission = NULL, final_response_digest = NULL, delivery_status = 'running', phase = 'exam', proctor_status = 'active', revision = revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND terminal_generation = ?`, attemptID, generation); err != nil {
		return 0, err
	}
	// The old result stays historically addressable through its immutable
	// receipt/submission, but cannot remain the current released projection.
	if _, err := q.ExecContext(ctx, `UPDATE assessment_results SET release_status = 'pending', revision = revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE attempt_id = ?`, attemptID); err != nil {
		return 0, err
	}
	raw, err := json.Marshal(map[string]any{"recoveryId": recoveryID, "target": target, "previousGeneration": generation, "terminalGeneration": generation + 1})
	if err != nil {
		return 0, err
	}
	_, err = q.ExecContext(ctx, `INSERT INTO session_audit_logs (id,schedule_id,actor,action_type,target_student_id,payload,created_at) VALUES (?,?,?,'DEVICE_RECOVERY_REOPENED',?,?,UTC_TIMESTAMP(6))`, uuid.NewString(), scheduleID, actorID, attemptID, string(raw))
	return generation + 1, err
}

func reopenConflict(reason string) error {
	return &apperrors.Error{Code: apperrors.CodeConflict, HTTPStatus: 409, Message: "This completion cannot be reopened by staff recovery.", Details: map[string]any{"reason": reason}}
}

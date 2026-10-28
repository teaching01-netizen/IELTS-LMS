package runtime

// Recovery clock arithmetic.
//
// A recovery never invents a countdown. Without a staff override the target
// keeps its original deadline byte-for-byte: displaying "2:50 remaining" and
// turning that display back into a deadline silently awards or removes time.
// With an explicit award the deadline is server-transaction-now + award, not
// the moment staff typed the value, so preparation time is never subtracted
// from the award and the award is never anchored to a stale form value.
//
// The effective deadline always belongs to the provider-owned clock. These
// helpers only plan and measure; persistence is per provider (SAT module
// attempt, IELTS timeline, or the attempt-owned recovery focus deadline).

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"time"
)

// MaxRecoveryAwardSeconds bounds an explicit award accepted from staff. It is
// a validation guard, not a recommendation: the maximum a candidate can be
// awarded in one continuation is 24 hours.
const MaxRecoveryAwardSeconds = 86400

// Stable reasons exposed to the API edge.
const (
	ReasonRecoveryTimeRequired = "RECOVERY_TIME_REQUIRED"
	ReasonRecoveryInvalidTime  = "RECOVERY_INVALID_TIME"
)

var (
	// ErrRecoveryTimeRequired means the original clock has already elapsed and
	// no positive award exists. The student stays on the ready screen until
	// staff issues a new grant with an explicit remaining time.
	ErrRecoveryTimeRequired = errors.New("recovery: the original clock has elapsed; a positive remaining-time award is required")
	// ErrRecoveryInvalidTime means an award was supplied outside 1..86400
	// seconds (including a zero-second award).
	ErrRecoveryInvalidTime = errors.New("recovery: remaining seconds must be an integer between 1 and 86400")
)

// RecoveryClockPlan is the exact deadline the focused stage starts with.
type RecoveryClockPlan struct {
	DeadlineAt time.Time
	// AwardedSeconds is nil when the original deadline is retained, so audit
	// can distinguish "no time was awarded" from "an award happened to equal
	// the remaining time".
	AwardedSeconds *int
}

// PlanRecoveryClock computes the target deadline.
//
// requestedSeconds nil retains originalDeadline exactly. A non-nil request is
// validated as an integer 1..86400 and converted to now + seconds. A nil or
// elapsed original deadline without an award is a TIME_REQUIRED refusal.
func PlanRecoveryClock(now time.Time, originalDeadline *time.Time, requestedSeconds *int) (RecoveryClockPlan, error) {
	now = now.UTC()
	if requestedSeconds != nil {
		seconds := *requestedSeconds
		if seconds < 1 || seconds > MaxRecoveryAwardSeconds {
			return RecoveryClockPlan{}, ErrRecoveryInvalidTime
		}
		award := seconds
		return RecoveryClockPlan{
			DeadlineAt:     now.Add(time.Duration(seconds) * time.Second),
			AwardedSeconds: &award,
		}, nil
	}
	if originalDeadline == nil {
		return RecoveryClockPlan{}, ErrRecoveryTimeRequired
	}
	deadline := originalDeadline.UTC()
	if !now.Before(deadline) {
		return RecoveryClockPlan{}, ErrRecoveryTimeRequired
	}
	return RecoveryClockPlan{DeadlineAt: deadline}, nil
}

// RecoveryRemainingSeconds is the continuation value for a deadline: whole
// seconds still available, floored, never negative. Flooring means a frozen
// successor can never resume with more time than remained when it was
// suspended.
func RecoveryRemainingSeconds(now time.Time, deadline *time.Time) int {
	if deadline == nil {
		return 0
	}
	remaining := deadline.UTC().Sub(now.UTC())
	if remaining <= 0 {
		return 0
	}
	seconds := int(remaining / time.Second)
	if seconds < 0 {
		return 0
	}
	return seconds
}

// RecoveryReason maps a planning error to its stable API detail reason. Any
// other error is reported as the generic ineligible reason by the caller.
func RecoveryReason(err error) string {
	switch {
	case errors.Is(err, ErrRecoveryTimeRequired):
		return ReasonRecoveryTimeRequired
	case errors.Is(err, ErrRecoveryInvalidTime):
		return ReasonRecoveryInvalidTime
	default:
		return ""
	}
}

// SyncRecoveryClockInTx refreshes the shared focused deadline after an
// authoritative pause/resume/extension. Suspended clocks never feed this
// projection; malformed/missing targets leave their fail-closed control intact.
func SyncRecoveryClockInTx(ctx context.Context, q tx.Tx, scheduleID, attemptID string) error {
	if scheduleID == "" && attemptID == "" {
		return errors.New("recovery clock sync requires a scope")
	}
	scope := ""
	args := []any{}
	if scheduleID != "" {
		scope += " AND sa.schedule_id=?"
		args = append(args, scheduleID)
	}
	if attemptID != "" {
		scope += " AND sa.id=?"
		args = append(args, attemptID)
	}
	const format = "'%Y-%m-%dT%H:%i:%s.%fZ'"
	const paused = "(r.status='paused' OR COALESCE(sa.proctor_status,'active')='paused')"
	const pausedAt = "STR_TO_DATE(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.focusPausedAt')),'null')," + format + ")"
	const focusedAt = "STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.focusDeadlineAt'))," + format + ")"
	// Snapshot sections have no native pause row. Store the beginning of the
	// union of room/individual pauses once and shift the clock on its final
	// resume. Updating JSON and then its common projection avoids relying on
	// assignment order in a multi-table UPDATE.
	pauseQuery := `UPDATE student_attempts sa JOIN exam_session_runtimes r ON r.schedule_id=sa.schedule_id
 LEFT JOIN assessment_module_attempts ma ON ma.attempt_id=sa.id AND ma.id=JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.target.moduleAttemptId'))
 LEFT JOIN ielts_attempt_section_timelines t ON t.attempt_id=sa.id AND t.section_key=JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.target.sectionKey'))
 SET sa.recovery_control=JSON_SET(sa.recovery_control,
 '$.focusDeadlineAt',CASE WHEN NOT ` + paused + ` AND ` + pausedAt + ` IS NOT NULL THEN DATE_FORMAT(TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,` + pausedAt + `,UTC_TIMESTAMP(6)),0),` + focusedAt + `),` + format + `) ELSE JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.focusDeadlineAt')) END,
 '$.focusPausedAt',CASE WHEN ` + paused + ` THEN DATE_FORMAT(COALESCE(` + pausedAt + `,UTC_TIMESTAMP(6)),` + format + `) ELSE NULL END)
 WHERE JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.phase'))='working' AND ma.id IS NULL AND t.id IS NULL` + scope
	if _, err := q.ExecContext(ctx, pauseQuery, args...); err != nil {
		return err
	}
	const deadline = "CASE WHEN ma.started_at IS NOT NULL THEN TIMESTAMPADD(SECOND,ma.allocated_seconds+ma.extension_seconds+ma.accumulated_paused_seconds,ma.started_at) WHEN t.deadline_at IS NOT NULL THEN t.deadline_at ELSE " + focusedAt + " END"
	query := `UPDATE student_attempts sa
 LEFT JOIN assessment_module_attempts ma ON ma.attempt_id=sa.id AND ma.id=JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.target.moduleAttemptId'))
 LEFT JOIN ielts_attempt_section_timelines t ON t.attempt_id=sa.id AND t.section_key=JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.target.sectionKey'))
 SET sa.recovery_control=JSON_SET(sa.recovery_control,'$.focusDeadlineAt',DATE_FORMAT(` + deadline + `,` + format + `)),sa.deadline_at=` + deadline + `
 WHERE JSON_UNQUOTE(JSON_EXTRACT(sa.recovery_control,'$.phase'))='working'` + scope
	_, err := q.ExecContext(ctx, query, args...)
	return err
}

// readyFocusedIELTSRecovery bypasses the shared room cursor for the one
// staff-authorized section. Its caller already holds the attempt lock.
func readyFocusedIELTSRecovery(ctx context.Context, q tx.Tx, attemptID, sectionKey, proctorStatus string, c *examdomain.RecoveryControl, out *CohortReadiness, changed *bool) error {
	if c.Phase != examdomain.RecoveryPhaseWorking {
		return recoveryRuntimeConflict("RECOVERY_HELD", "Staff recovery has stopped this browser.")
	}
	if c.Target.SectionKey != sectionKey {
		return recoveryRuntimeConflict("RECOVERY_FOCUS", "Only the recovery section is available.")
	}
	var state string
	var start, deadline, paused sql.NullTime
	var generation uint64
	if err := q.QueryRowContext(ctx, `SELECT state,started_at,deadline_at,paused_at,run_generation FROM ielts_attempt_section_timelines WHERE attempt_id=? AND section_key=? FOR UPDATE`, attemptID, sectionKey).Scan(&state, &start, &deadline, &paused, &generation); err != nil {
		return err
	}
	if generation != c.FocusRunGeneration || !start.Valid || !deadline.Valid {
		return recoveryRuntimeConflict("RECOVERY_STALE", "The recovery section changed. Reload the exam.")
	}
	if err := q.QueryRowContext(ctx, `SELECT UTC_TIMESTAMP(6)`).Scan(&out.ServerNow); err != nil {
		return err
	}
	v, d := start.Time.UTC(), deadline.Time.UTC()
	out.StartedAt = &v
	out.DeadlineAt = &d
	if state == "active" && (paused.Valid || proctorStatus == "paused" || out.ServerNow.Before(d)) {
		out.Status = "active"
		return nil
	}
	if state != "active" && state != "completed" {
		return recoveryRuntimeConflict("RECOVERY_STALE", "The recovery section is unavailable.")
	}
	if _, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines SET state='completed',completion_reason='time_expired',finished_at=COALESCE(finished_at,deadline_at),revision=revision+1 WHERE attempt_id=? AND section_key=? AND run_generation=? AND state='active'`, attemptID, sectionKey, generation); err != nil {
		return err
	}
	out.Status = "completed"
	*changed = true
	if len(c.Suspended) == 0 {
		// Keep the expired focus until the worker seals the whole sitting or
		// hands a later unprepared section back to ordinary readiness.
		return nil
	}
	stage := c.Suspended[0]
	c.Suspended = c.Suspended[1:]
	c.Target = stage.Target
	c.FocusRunGeneration = stage.RunGeneration
	if stage.Target.ModuleAttemptID != "" {
		return recoveryRuntimeConflict("RECOVERY_STALE", "The suspended section has an invalid provider identity.")
	}
	nextDeadline := out.ServerNow.Add(time.Duration(stage.RemainingSeconds) * time.Second)
	if stage.State == "active" {
		result, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines SET state='active',started_at=?,deadline_at=?,paused_at=NULL,revision=revision+1 WHERE attempt_id=? AND section_key=? AND run_generation=?`, out.ServerNow, nextDeadline, attemptID, stage.Target.SectionKey, stage.RunGeneration)
		if err != nil {
			return err
		}
		n, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return recoveryRuntimeConflict("RECOVERY_STALE", "The saved successor changed.")
		}
		c.FocusDeadlineAt = &nextDeadline
		c.FocusStartedAt = &out.ServerNow
	} else {
		if _, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines SET expected_start_at=TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,paused_at,UTC_TIMESTAMP(6)),0),expected_start_at),preparation_deadline_at=TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,paused_at,UTC_TIMESTAMP(6)),0),preparation_deadline_at),paused_at=NULL,revision=revision+1 WHERE attempt_id=? AND section_key=? AND run_generation=? AND paused_at IS NOT NULL`, attemptID, stage.Target.SectionKey, stage.RunGeneration); err != nil {
			return err
		}
		// Existing preparation retains its allowance; the normal readiness owner
		// starts its clock. It must not receive an invented zero-second work run.
		if len(c.Suspended) == 0 {
			_, err := q.ExecContext(ctx, `UPDATE student_attempts SET recovery_control=NULL,deadline_at=NULL,closing_grace_until=NULL,control_epoch=control_epoch+1,revision=revision+1 WHERE id=?`, attemptID)
			return err
		}
		return recoveryRuntimeConflict("RECOVERY_TIME_REQUIRED", "The successor must be prepared with staff before continuing.")
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx, `UPDATE student_attempts SET recovery_control=?,deadline_at=?,current_module=?,control_epoch=control_epoch+1,revision=revision+1 WHERE id=?`, string(raw), nextDeadline, c.Target.SectionKey, attemptID)
	return err
}

func recoveryRuntimeConflict(reason, message string) error {
	return &apperrors.Error{Code: apperrors.CodeConflict, HTTPStatus: 409, Message: message, Details: map[string]any{"reason": reason}}
}

// AdvanceIELTSRecoveryInTx shares the readiness progression with the worker.
// The last timeline may finish before any ordinary later section has prepared;
// that is a handoff back to readiness, rather than a whole-exam submission.
func AdvanceIELTSRecoveryInTx(ctx context.Context, q tx.Tx, attemptID, sectionKey, proctorStatus string, c *examdomain.RecoveryControl, out *CohortReadiness, changed *bool) (bool, error) {
	hadSuccessor := len(c.Suspended) > 0
	if err := readyFocusedIELTSRecovery(ctx, q, attemptID, sectionKey, proctorStatus, c, out, changed); err != nil {
		return false, err
	}
	if out.Status != "completed" || hadSuccessor {
		return false, nil
	}
	var future bool
	err := q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM exam_session_runtime_sections s
JOIN ielts_attempt_section_timelines focus ON focus.runtime_id=s.runtime_id AND focus.attempt_id=? AND focus.section_key=?
LEFT JOIN ielts_attempt_section_timelines later ON later.attempt_id=focus.attempt_id AND later.section_key=s.section_key
WHERE s.section_order>focus.section_order AND COALESCE(later.state,'')<>'completed')`, attemptID, sectionKey).Scan(&future)
	if err != nil {
		return false, err
	}
	if future {
		_, err = q.ExecContext(ctx, `UPDATE student_attempts SET recovery_control=NULL,deadline_at=NULL,closing_grace_until=NULL,control_epoch=control_epoch+1,revision=revision+1 WHERE id=?`, attemptID)
		return false, err
	}
	return true, nil
}

// AdvanceSnapshotRecoveryInTx uses only the attempt-owned clock. No shared
// room row is rewritten when a recovered legacy section expires.
func AdvanceSnapshotRecoveryInTx(ctx context.Context, q tx.Tx, attemptID, provider, sectionKey string, c *examdomain.RecoveryControl, out *CohortReadiness, changed *bool) (bool, error) {
	if c.Phase != examdomain.RecoveryPhaseWorking {
		return false, recoveryRuntimeConflict("RECOVERY_HELD", "Staff recovery has stopped this browser.")
	}
	if c.Target.SectionKey != sectionKey {
		return false, recoveryRuntimeConflict("RECOVERY_FOCUS", "Only the recovery section is available.")
	}
	if c.FocusDeadlineAt == nil {
		return false, recoveryRuntimeConflict("RECOVERY_TIME_REQUIRED", "This recovery has no working deadline.")
	}
	if err := q.QueryRowContext(ctx, `SELECT UTC_TIMESTAMP(6)`).Scan(&out.ServerNow); err != nil {
		return false, err
	}
	out.Status = "active"
	out.DeadlineAt = c.FocusDeadlineAt
	out.StartedAt = c.FocusStartedAt
	if out.ServerNow.Before(*c.FocusDeadlineAt) {
		return false, nil
	}
	out.Status = "completed"
	if len(c.Suspended) > 0 {
		stage := c.Suspended[0]
		if stage.Target.ModuleAttemptID != "" {
			return false, recoveryRuntimeConflict("RECOVERY_STALE", "The saved section belongs to another provider.")
		}
		c.Target = stage.Target
		c.Suspended = c.Suspended[1:]
		c.FocusRunGeneration++
		deadline := out.ServerNow.Add(time.Duration(stage.RemainingSeconds) * time.Second)
		c.FocusDeadlineAt = &deadline
		c.FocusStartedAt = &out.ServerNow
		raw, err := json.Marshal(c)
		if err != nil {
			return false, err
		}
		_, err = q.ExecContext(ctx, `UPDATE student_attempts SET recovery_control=?,current_module=?,deadline_at=?,control_epoch=control_epoch+1,revision=revision+1 WHERE id=?`, string(raw), c.Target.SectionKey, deadline, attemptID)
		*changed = err == nil
		return false, err
	}
	if provider == examdomain.ProviderIELTS {
		var future bool
		if err := q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM student_attempts a
JOIN exam_session_runtimes r ON r.schedule_id=a.schedule_id
JOIN exam_session_runtime_sections focus ON focus.runtime_id=r.id AND focus.section_key=?
JOIN exam_session_runtime_sections later ON later.runtime_id=r.id AND later.section_order>focus.section_order
WHERE a.id=? AND later.status<>'completed')`, sectionKey, attemptID).Scan(&future); err != nil {
			return false, err
		}
		if future {
			_, err := q.ExecContext(ctx, `UPDATE student_attempts SET recovery_control=NULL,deadline_at=NULL,closing_grace_until=NULL,control_epoch=control_epoch+1,revision=revision+1 WHERE id=?`, attemptID)
			*changed = err == nil
			return false, err
		}
	}
	return true, nil
}

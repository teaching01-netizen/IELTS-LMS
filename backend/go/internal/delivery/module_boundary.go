package delivery

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

type satModuleBoundary struct {
	moduleAttemptID  string
	attemptID        string
	phase            string
	policyVersion    string
	workDeadline     *time.Time
	entryDeadline    *time.Time
	recoveryDeadline *time.Time
	revision         uint64
}

func satRecoveryPolicyTx(ctx context.Context, q tx.Tx, attemptID string) (*attempts.SATDeliveryPolicy, error) {
	var raw sql.NullString
	var timingModel sql.NullString
	err := q.QueryRowContext(ctx, `
		SELECT CAST(s.sat_delivery_policy AS CHAR), COALESCE(s.sat_timing_model, r.timing_model, '')
		FROM student_attempts a
		JOIN exam_schedules s ON s.id = a.schedule_id
		LEFT JOIN exam_session_runtimes r ON r.schedule_id = s.id
		WHERE a.id = ?`, attemptID).Scan(&raw, &timingModel)
	if err != nil {
		return nil, err
	}
	return attempts.ParseSATDeliveryPolicy([]byte(raw.String), timingModel.String)
}

func satRecoveryPolicyByScheduleTx(ctx context.Context, q tx.Tx, scheduleID string) (*attempts.SATDeliveryPolicy, error) {
	var raw sql.NullString
	var timingModel sql.NullString
	err := q.QueryRowContext(ctx, `
		SELECT CAST(s.sat_delivery_policy AS CHAR), COALESCE(s.sat_timing_model, r.timing_model, '')
		FROM exam_schedules s
		LEFT JOIN exam_session_runtimes r ON r.schedule_id = s.id
		WHERE s.id = ?`, scheduleID).Scan(&raw, &timingModel)
	if err != nil {
		return nil, err
	}
	return attempts.ParseSATDeliveryPolicy([]byte(raw.String), timingModel.String)
}

func ensureSatModuleBoundaryTx(ctx context.Context, q tx.Tx, attemptID, moduleAttemptID string) (bool, error) {
	policy, err := satRecoveryPolicyTx(ctx, q, attemptID)
	if err != nil || policy == nil {
		return false, err
	}
	return ensureSatModuleBoundaryWithPolicyTx(ctx, q, attemptID, moduleAttemptID, policy)
}

func ensureSatModuleBoundaryWithPolicyTx(ctx context.Context, q tx.Tx, attemptID, moduleAttemptID string, policy *attempts.SATDeliveryPolicy) (bool, error) {
	if policy == nil {
		return false, nil
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO assessment_module_boundaries
			(module_attempt_id, attempt_id, phase, policy_version, work_deadline_at,
			 entry_deadline_at, recovery_deadline_at, next_action_at)
		SELECT ma.id, ma.attempt_id,
			CASE WHEN ma.state = 'active' AND ma.started_at IS NOT NULL THEN 'working' ELSE 'preparing' END,
			?,
			CASE WHEN ma.state = 'active' AND ma.started_at IS NOT NULL
			THEN TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at) END,
			CASE WHEN ma.state = 'not_started' AND ma.available_at IS NOT NULL`+sectionEntryActivationSQL("ma")+`
				THEN TIMESTAMPADD(SECOND, ?, ma.available_at) END,
			CASE WHEN ma.state = 'active' AND ma.started_at IS NOT NULL
			THEN TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds + ?, ma.started_at) END,
			CASE WHEN ma.state = 'active' AND ma.started_at IS NOT NULL
			THEN TIMESTAMPADD(SECOND, ma.allocated_seconds + ma.extension_seconds + ma.accumulated_paused_seconds, ma.started_at)
				WHEN ma.state = 'not_started' AND ma.available_at IS NOT NULL`+sectionEntryActivationSQL("ma")+`
				THEN TIMESTAMPADD(SECOND, ?, ma.available_at) END
		FROM assessment_module_attempts ma
		WHERE ma.id = ? AND ma.attempt_id = ?
		ON DUPLICATE KEY UPDATE module_attempt_id = module_attempt_id`,
		policy.Version, policy.EntryRecoverySeconds, policy.RecoverySeconds,
		policy.EntryRecoverySeconds, moduleAttemptID, attemptID)
	if err != nil {
		return false, err
	}
	return true, nil
}

func ensureSatModuleBoundaryAndLockTx(ctx context.Context, q tx.Tx, attemptID, moduleAttemptID string, policy *attempts.SATDeliveryPolicy) (*satModuleBoundary, error) {
	if policy == nil {
		return nil, nil
	}
	boundary, err := lockSatModuleBoundaryTx(ctx, q, moduleAttemptID)
	if err != nil || boundary != nil {
		return boundary, err
	}
	if _, err := ensureSatModuleBoundaryWithPolicyTx(ctx, q, attemptID, moduleAttemptID, policy); err != nil {
		return nil, err
	}
	return lockSatModuleBoundaryTx(ctx, q, moduleAttemptID)
}

// enforceEntryWindow applies only to a normal module-entry request. Initial
// start-code admission has its own schedule/code cutoff and does not consume
// this separate next-module allowance.
func beginSatModuleBoundaryTx(ctx context.Context, q tx.Tx, attemptID, moduleAttemptID string, policy *attempts.SATDeliveryPolicy, allocatedSeconds int, now time.Time, enforceEntryWindow bool) (bool, satBoundaryTransition, error) {
	if policy == nil {
		return false, satBoundaryTransition{}, nil
	}
	var err error
	res, err := q.ExecContext(ctx, `
		UPDATE assessment_module_boundaries b
		JOIN assessment_module_attempts ma ON ma.id = b.module_attempt_id
		SET b.phase = 'working',
		    b.work_deadline_at = TIMESTAMPADD(SECOND, ? + ma.extension_seconds + ma.accumulated_paused_seconds, ?),
		    b.entry_deadline_at = NULL,
		    b.recovery_deadline_at = TIMESTAMPADD(SECOND, ? + ma.extension_seconds + ma.accumulated_paused_seconds + ?, ?),
		    b.next_action_at = TIMESTAMPADD(SECOND, ? + ma.extension_seconds + ma.accumulated_paused_seconds, ?),
		    b.revision = b.revision + 1
		WHERE b.module_attempt_id = ? AND b.attempt_id = ?
		  AND b.policy_version = ? AND b.phase IN ('preparing', 'working')
		  AND (? = 0 OR b.phase <> 'preparing' OR b.entry_deadline_at IS NULL OR b.entry_deadline_at > UTC_TIMESTAMP(6))`,
		allocatedSeconds, now, allocatedSeconds, policy.RecoverySeconds, now,
		allocatedSeconds, now, moduleAttemptID, attemptID, policy.Version, enforceEntryWindow)
	if err != nil {
		return false, satBoundaryTransition{}, err
	}
	changed, err := res.RowsAffected()
	if err != nil {
		return false, satBoundaryTransition{}, err
	}
	if changed == 0 {
		var phase string
		var version string
		var entryDeadline sql.NullTime
		if err := q.QueryRowContext(ctx,
			"SELECT phase, policy_version, entry_deadline_at FROM assessment_module_boundaries WHERE module_attempt_id = ? AND attempt_id = ? FOR UPDATE",
			moduleAttemptID, attemptID).Scan(&phase, &version, &entryDeadline); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return false, satBoundaryTransition{}, apperrors.New(apperrors.CodeConflict, "SAT module recovery boundary is missing.")
			}
			return false, satBoundaryTransition{}, err
		}
		if version != policy.Version {
			return false, satBoundaryTransition{}, apperrors.New(apperrors.CodeAssessmentConflict, "SAT module recovery boundary cannot be reopened.")
		}
		if enforceEntryWindow && phase == "preparing" && entryDeadline.Valid {
			blocked, err := q.ExecContext(ctx, `
				UPDATE assessment_module_boundaries
				SET phase = 'blocked', next_action_at = NULL, revision = revision + 1
				WHERE module_attempt_id = ? AND attempt_id = ? AND phase = 'preparing'
				  AND entry_deadline_at <= UTC_TIMESTAMP(6)`, moduleAttemptID, attemptID)
			if err != nil {
				return false, satBoundaryTransition{}, err
			}
			blockedRows, err := blocked.RowsAffected()
			if err != nil {
				return false, satBoundaryTransition{}, err
			}
			if blockedRows == 1 {
				return true, satBoundaryTransition{from: "preparing", to: "blocked"}, nil
			}
		}
		if enforceEntryWindow && phase == "blocked" && entryDeadline.Valid {
			var expired bool
			if err := q.QueryRowContext(ctx, `SELECT entry_deadline_at <= UTC_TIMESTAMP(6)
				FROM assessment_module_boundaries WHERE module_attempt_id = ? AND attempt_id = ?`,
				moduleAttemptID, attemptID).Scan(&expired); err != nil {
				return false, satBoundaryTransition{}, err
			}
			if expired {
				return true, satBoundaryTransition{}, nil
			}
		}
		if phase != "working" {
			return false, satBoundaryTransition{}, apperrors.New(apperrors.CodeAssessmentConflict, "SAT module recovery boundary cannot be reopened.")
		}
	}
	return false, satBoundaryTransition{}, nil
}

func lockSatModuleBoundaryTx(ctx context.Context, q tx.Tx, moduleAttemptID string) (*satModuleBoundary, error) {
	var out satModuleBoundary
	var workDeadline, entryDeadline, recoveryDeadline sql.NullTime
	err := q.QueryRowContext(ctx, `
		SELECT module_attempt_id, attempt_id, phase, policy_version, work_deadline_at,
		       entry_deadline_at, recovery_deadline_at, revision
		FROM assessment_module_boundaries WHERE module_attempt_id = ? FOR UPDATE`, moduleAttemptID).
		Scan(&out.moduleAttemptID, &out.attemptID, &out.phase, &out.policyVersion,
			&workDeadline, &entryDeadline, &recoveryDeadline, &out.revision)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if workDeadline.Valid {
		value := workDeadline.Time.UTC()
		out.workDeadline = &value
	}
	if entryDeadline.Valid {
		value := entryDeadline.Time.UTC()
		out.entryDeadline = &value
	}
	if recoveryDeadline.Valid {
		value := recoveryDeadline.Time.UTC()
		out.recoveryDeadline = &value
	}
	return &out, nil
}

func setSatBoundaryPhaseTx(ctx context.Context, q tx.Tx, moduleAttemptID string, from, to string, nextAction *time.Time) error {
	var next any
	if nextAction != nil {
		next = *nextAction
	}
	res, err := q.ExecContext(ctx, `
		UPDATE assessment_module_boundaries
		SET phase = ?, next_action_at = ?, revision = revision + 1
		WHERE module_attempt_id = ? AND phase = ?`, to, next, moduleAttemptID, from)
	if err != nil {
		return err
	}
	if changed, err := res.RowsAffected(); err != nil {
		return err
	} else if changed > 1 {
		return fmt.Errorf("SAT module boundary transition affected %d rows", changed)
	}
	return nil
}

// reconcileSatRecoveryBoundaryTx applies the opted-in SAT state machine before
// the legacy timeout finalizer can seal or route the module. It returns
// handled=true for every policy-owned boundary, including blocked/settled
// records, so a stale module state can never fall through to legacy behavior.
func reconcileSatRecoveryBoundaryTx(ctx context.Context, q tx.Tx, attemptID string, module *reconcileRow) (handled, changed bool, transition satBoundaryTransition, err error) {
	policy, err := satRecoveryPolicyTx(ctx, q, attemptID)
	if err != nil || policy == nil {
		return false, false, satBoundaryTransition{}, err
	}
	boundary, err := ensureSatModuleBoundaryAndLockTx(ctx, q, attemptID, module.id, policy)
	if err != nil {
		return true, false, satBoundaryTransition{}, err
	}
	if boundary == nil || boundary.policyVersion != policy.Version {
		return true, false, satBoundaryTransition{}, apperrors.New(apperrors.CodeConflict, "SAT recovery boundary is unavailable.")
	}
	if module.pausedAt != nil {
		return true, false, satBoundaryTransition{}, nil
	}
	now, err := dbTimeTx(ctx, q)
	if err != nil {
		return true, false, satBoundaryTransition{}, err
	}
	switch boundary.phase {
	case "working":
		if boundary.recoveryDeadline != nil && !now.Before(*boundary.recoveryDeadline) {
			err = setSatBoundaryPhaseTx(ctx, q, module.id, "working", "blocked", nil)
			return true, err == nil, satBoundaryTransition{from: "working", to: "blocked"}, err
		}
		if boundary.workDeadline != nil && !now.Before(*boundary.workDeadline) {
			nextAction := boundary.recoveryDeadline
			err = setSatBoundaryPhaseTx(ctx, q, module.id, "working", "collecting", nextAction)
			return true, err == nil, satBoundaryTransition{from: "working", to: "collecting"}, err
		}
		return true, false, satBoundaryTransition{}, nil
	case "preparing":
		if boundary.entryDeadline != nil && !now.Before(*boundary.entryDeadline) {
			err = setSatBoundaryPhaseTx(ctx, q, module.id, "preparing", "blocked", nil)
			return true, err == nil, satBoundaryTransition{from: "preparing", to: "blocked"}, err
		}
		return true, false, satBoundaryTransition{}, nil
	case "collecting":
		if boundary.recoveryDeadline != nil && !now.Before(*boundary.recoveryDeadline) {
			err = setSatBoundaryPhaseTx(ctx, q, module.id, "collecting", "blocked", nil)
			return true, err == nil, satBoundaryTransition{from: "collecting", to: "blocked"}, err
		}
		return true, false, satBoundaryTransition{}, nil
	case "blocked", "settled", "ended":
		return true, false, satBoundaryTransition{}, nil
	default:
		return true, false, satBoundaryTransition{}, fmt.Errorf("unknown SAT recovery boundary phase %q", boundary.phase)
	}
}

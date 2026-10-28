package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/lifecycle"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

type SATRecoveryResolutionRequest struct {
	ResolutionID             string `json:"resolutionId"`
	ModuleAttemptID          string `json:"moduleAttemptId"`
	ExpectedBoundaryRevision uint64 `json:"expectedBoundaryRevision"`
	Action                   string `json:"action"`
	Reason                   string `json:"reason,omitempty"`
}

type SATRecoveryResolutionReceipt struct {
	ReceiptID       string    `json:"receiptId"`
	ResolutionID    string    `json:"resolutionId"`
	ScheduleID      string    `json:"scheduleId"`
	AttemptID       string    `json:"attemptId"`
	ModuleAttemptID string    `json:"moduleAttemptId"`
	ModuleID        string    `json:"moduleId"`
	Action          string    `json:"action"`
	ActorType       string    `json:"actorType"`
	ResolvedAt      time.Time `json:"resolvedAt"`
	ExcludedAnswers string    `json:"excludedAnswers"`
	Replayed        bool      `json:"replayed,omitempty"`
}

// ResolveSATRecovery is the sole exception path for a frozen SAT boundary.
// The caller supplies a trusted actor derived from its authenticated edge;
// this transaction independently verifies the session mode and student owner.
func (s *Service) ResolveSATRecovery(
	ctx context.Context,
	scheduleID, attemptID string,
	req SATRecoveryResolutionRequest,
	actorType, actorID string,
	claims *crypto.AttemptClaims,
	writerBinding ...string,
) (*SATRecoveryResolutionReceipt, error) {
	req.ResolutionID = strings.TrimSpace(req.ResolutionID)
	req.ModuleAttemptID = strings.TrimSpace(req.ModuleAttemptID)
	req.Action = strings.TrimSpace(req.Action)
	req.Reason = strings.TrimSpace(req.Reason)
	if req.ResolutionID == "" || len(req.ResolutionID) > 64 || req.ModuleAttemptID == "" ||
		(req.Action != "continue_confirmed" && req.Action != "activate_entry") || req.ExpectedBoundaryRevision == 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "A resolution ID, module attempt, current boundary revision, and supported action are required.")
	}
	if actorID == "" || (actorType != "student" && actorType != "staff") {
		return nil, apperrors.New(apperrors.CodeForbidden, "The recovery resolution actor is not authorized.")
	}
	if actorType == "staff" && (req.Reason == "" || len(req.Reason) > 500) {
		return nil, apperrors.New(apperrors.CodeValidation, "A reason of at most 500 characters is required.")
	}
	if actorType == "student" && (claims == nil || claims.ScheduleID != scheduleID || claims.AttemptID != attemptID || claims.UserID != actorID) {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the recovery request.")
	}
	requestHash, err := lifecycle.Hash("sat_recovery_resolution", req)
	if err != nil {
		return nil, err
	}
	boundSchedule, examID, provider, _, err := s.startScheduleBinding(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	if provider != "sat" || boundSchedule != scheduleID {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}
	if err := s.saveAttemptBinding(ctx, scheduleID, attemptID, examID); err != nil {
		return nil, err
	}

	var receipt *SATRecoveryResolutionReceipt
	var hubEvents []liveupdates.Event
	var needsComplete bool
	var recoveryTransitions []satBoundaryTransition
	var exceptionDeadline *time.Time
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		receipt, hubEvents = nil, nil
		needsComplete = false
		recoveryTransitions = nil
		exceptionDeadline = nil
		var userID sql.NullString
		var proctorStatus, deliveryStatus, phase, mode string
		var submittedAt sql.NullTime
		if err := t.QueryRowContext(ctx, `
			SELECT user_id, COALESCE(proctor_status, 'active'), COALESCE(delivery_status, 'running'),
			       phase, submitted_at
			FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE`,
			attemptID, scheduleID).Scan(&userID, &proctorStatus, &deliveryStatus, &phase, &submittedAt); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		if err := t.QueryRowContext(ctx,
			"SELECT COALESCE(sat_session_mode, 'practice') FROM exam_schedules WHERE id = ?",
			scheduleID).Scan(&mode); err != nil {
			return err
		}
		if (actorType == "student" && (mode != "practice" || !userID.Valid || userID.String != actorID)) ||
			(actorType == "staff" && mode != "classroom") {
			return apperrors.New(apperrors.CodeForbidden, "The recovery action is not available in this SAT session.")
		}
		if actorType == "student" {
			if err := enforceWriterSessionTx(ctx, t, scheduleID, attemptID, writerBinding...); err != nil {
				return err
			}
		}
		var runtimeStatus string
		if err := t.QueryRowContext(ctx,
			"SELECT status FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE", scheduleID).Scan(&runtimeStatus); err != nil {
			return err
		}
		var moduleID string
		if err := t.QueryRowContext(ctx,
			"SELECT module_id FROM assessment_module_attempts WHERE id = ? AND attempt_id = ?",
			req.ModuleAttemptID, attemptID).Scan(&moduleID); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Module attempt not found.")
			}
			return err
		}
		module, err := lockModuleAttemptTx(ctx, t, attemptID, moduleID)
		if err != nil {
			return err
		}
		if module.id != req.ModuleAttemptID {
			return assessmentConflict("MODULE_ATTEMPT_MISMATCH", "The module attempt does not match this recovery boundary.")
		}
		boundary, err := lockSatModuleBoundaryTx(ctx, t, module.id)
		if err != nil {
			return err
		}
		if boundary == nil || boundary.attemptID != attemptID {
			return assessmentConflict("RECOVERY_BOUNDARY_UNAVAILABLE", "The SAT recovery boundary is unavailable.")
		}
		var storedHash, storedReceipt sql.NullString
		if err := t.QueryRowContext(ctx, `
			SELECT request_hash, CAST(receipt AS CHAR)
			FROM assessment_module_boundary_resolutions
			WHERE module_attempt_id = ? AND run_generation = (SELECT ma_run.run_generation FROM assessment_module_attempts ma_run WHERE ma_run.id = assessment_module_boundary_resolutions.module_attempt_id) AND resolution_id = ? FOR UPDATE`, module.id, req.ResolutionID).
			Scan(&storedHash, &storedReceipt); err != nil && err != sql.ErrNoRows {
			return err
		}
		if storedHash.Valid {
			if storedHash.String != requestHash || !storedReceipt.Valid {
				return assessmentConflict("RECOVERY_RESOLUTION_ID_CONFLICT", "This recovery decision ID was already used with different details.")
			}
			var replay SATRecoveryResolutionReceipt
			if err := json.Unmarshal([]byte(storedReceipt.String), &replay); err != nil {
				return err
			}
			replay.Replayed = true
			receipt = &replay
			return nil
		}
		now, err := dbTimeTx(ctx, t)
		if err != nil {
			return err
		}
		if boundary.revision != req.ExpectedBoundaryRevision {
			return assessmentConflict("RECOVERY_BOUNDARY_STALE", "The recovery state changed. Refresh before resolving it.")
		}
		if proctorStatus == "paused" || proctorStatus == "terminated" || submittedAt.Valid || phase == "post-exam" ||
			deliveryStatus == "submitted" || deliveryStatus == "terminated" || deliveryStatus == "locked" || deliveryStatus == "cancelled" {
			return assessmentConflict("ATTEMPT_TERMINAL", "The SAT attempt cannot be resolved in its current state.")
		}
		if runtimeStatus != "live" {
			return assessmentConflict("RUNTIME_NOT_LIVE", "The SAT session must be live to resolve recovery.")
		}
		policy, err := satRecoveryPolicyTx(ctx, t, attemptID)
		if err != nil {
			return err
		}
		if policy == nil || policy.Version != boundary.policyVersion {
			return assessmentConflict("RECOVERY_POLICY_MISMATCH", "The SAT recovery policy does not match this boundary.")
		}
		if req.Action == "activate_entry" {
			exceptionDeadline = boundary.entryDeadline
		} else {
			exceptionDeadline = boundary.recoveryDeadline
		}
		receipt = &SATRecoveryResolutionReceipt{
			ReceiptID: uuid.NewString(), ResolutionID: req.ResolutionID,
			ScheduleID: scheduleID, AttemptID: attemptID,
			ModuleAttemptID: module.id, ModuleID: module.moduleID,
			Action: req.Action, ActorType: actorType, ResolvedAt: now.UTC(),
			ExcludedAnswers: "unknown; only server-confirmed answers were scored",
		}
		if req.Action == "activate_entry" {
			receipt.ExcludedAnswers = "not applicable; this module had not started"
		}
		receiptJSON, err := json.Marshal(receipt)
		if err != nil {
			return err
		}
		var auditAction string
		var previousState string
		switch req.Action {
		case "activate_entry":
			if module.state != "not_started" || module.startedAt != nil || boundary.phase != "blocked" || boundary.entryDeadline == nil {
				return assessmentConflict("RECOVERY_ENTRY_NOT_READY", "This module is not waiting on an expired entry recovery.")
			}
			if now.Before(*boundary.entryDeadline) {
				return assessmentConflict("RECOVERY_ENTRY_NOT_EXPIRED", "The module entry recovery period has not ended.")
			}
			var pendingBreak bool
			if err := t.QueryRowContext(ctx,
				"SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')",
				attemptID).Scan(&pendingBreak); err != nil {
				return err
			}
			if pendingBreak || (module.availableAt != nil && now.Before(*module.availableAt)) {
				return assessmentConflict("RECOVERY_ENTRY_PREREQUISITE", "The module is not ready to start yet.")
			}
			if err := activateSATRecoveryEntryTx(ctx, t, attemptID, module, boundary, policy, now); err != nil {
				return err
			}
			recoveryTransitions = append(recoveryTransitions, satBoundaryTransition{from: "blocked", to: "working"})
			rev, err := s.appendModuleEventsTx(ctx, t, scheduleID, attemptID, liveEventModuleStarted)
			if err != nil {
				return err
			}
			hubEvents = dualModuleEvents(scheduleID, attemptID, rev, liveEventModuleStarted)
			previousState = "blocked_entry"
			auditAction = "SAT_RECOVERY_ENTRY_ACTIVATED"
		case "continue_confirmed":
			if module.state != "active" && module.state != "review" {
				return assessmentConflict("RECOVERY_MODULE_NOT_ACTIVE", "This module is not waiting on an expired answer recovery.")
			}
			if module.startedAt == nil || module.pausedAt != nil || boundary.recoveryDeadline == nil {
				return assessmentConflict("RECOVERY_NOT_EXPIRED", "This module is not waiting on an expired answer recovery.")
			}
			if now.Before(*boundary.recoveryDeadline) {
				return assessmentConflict("RECOVERY_NOT_EXPIRED", "The connection recovery period has not ended.")
			}
			if boundary.phase == "collecting" {
				if err := setSatBoundaryPhaseTx(ctx, t, module.id, "collecting", "blocked", nil); err != nil {
					return err
				}
				recoveryTransitions = append(recoveryTransitions, satBoundaryTransition{from: "collecting", to: "blocked"})
				boundary.phase = "blocked"
				boundary.revision++
			}
			if boundary.phase != "blocked" {
				return assessmentConflict("RECOVERY_NOT_BLOCKED", "This SAT recovery boundary is not ready for resolution.")
			}
			res, err := t.ExecContext(ctx, `
				UPDATE assessment_module_boundaries
				SET phase = 'settled', next_action_at = NULL, resolution = 'continue_confirmed',
				    resolution_id = ?, resolution_hash = ?, resolution_reason = ?, resolution_receipt = ?,
				    resolved_by = ?, resolved_at = ?, revision = revision + 1
				WHERE module_attempt_id = ? AND run_generation = (SELECT ma_run.run_generation FROM assessment_module_attempts ma_run WHERE ma_run.id = assessment_module_boundaries.module_attempt_id) AND attempt_id = ? AND phase = 'blocked'
				  AND resolution IS NULL AND revision = ?`,
				req.ResolutionID, requestHash, nullableResolutionReason(req.Reason), string(receiptJSON), actorID, now.UTC(),
				module.id, attemptID, boundary.revision)
			if err != nil {
				return err
			}
			if changed, err := res.RowsAffected(); err != nil {
				return err
			} else if changed != 1 {
				return assessmentConflict("RECOVERY_ALREADY_RESOLVED", "This recovery boundary already has a recorded decision.")
			}
			recoveryTransitions = append(recoveryTransitions, satBoundaryTransition{from: "blocked", to: "settled"})
			next, err := s.finalizeModuleWithBasisTx(ctx, t, attemptID, module, "time_expired", routeBasisWindowClosed, nil)
			if err != nil {
				return err
			}
			if next == nil {
				if s.satTerminalizerInTx != nil {
					_, err := s.satTerminalizerInTx(ctx, t, scheduleID, attemptID)
					if err != nil {
						return err
					}
				} else {
					needsComplete = true
				}
			}
			previousState = "blocked_work"
			auditAction = "SAT_RECOVERY_RESOLVED"
		default:
			return apperrors.New(apperrors.CodeValidation, "Unsupported SAT recovery action.")
		}
		if _, err := t.ExecContext(ctx, `
			INSERT INTO assessment_module_boundary_resolutions
			    (module_attempt_id, attempt_id, resolution_id, request_hash, action, actor_type, actor_id, reason, receipt, created_at, run_generation)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, (SELECT run_generation FROM assessment_module_attempts WHERE id = ?))`,
			module.id, attemptID, req.ResolutionID, requestHash, req.Action, actorType,
			actorID, nullableResolutionReason(req.Reason), string(receiptJSON), now.UTC(), module.id); err != nil {
			return err
		}
		newState := "settled"
		if req.Action == "activate_entry" {
			newState = "working"
		}
		payload, _ := json.Marshal(map[string]any{
			"resolutionId": req.ResolutionID, "receiptId": receipt.ReceiptID,
			"moduleAttemptId": module.id, "moduleId": module.moduleID,
			"policyVersion": boundary.policyVersion, "action": req.Action,
			"previousState": previousState, "newState": newState,
			"reason": req.Reason, "excludedAnswers": receipt.ExcludedAnswers,
		})
		if _, err := t.ExecContext(ctx, `
			INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at)
			VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
			uuid.NewString(), scheduleID, actorID, auditAction, attemptID, string(payload)); err != nil {
			return err
		}
		if req.Action == "continue_confirmed" {
			rev, err := s.appendModuleEventsTx(ctx, t, scheduleID, attemptID, liveEventModuleSubmitted)
			if err != nil {
				return err
			}
			hubEvents = dualModuleEvents(scheduleID, attemptID, rev, liveEventModuleSubmitted)
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, transition := range recoveryTransitions {
		recordSATRecoveryBoundaryTransition(transition)
	}
	recordSATRecoveryResolution(receipt, exceptionDeadline)
	s.publishHubEvents(hubEvents)
	if needsComplete && s.completer != nil {
		if err := s.completer(ctx, scheduleID, attemptID); err != nil {
			return nil, apperrors.New(apperrors.CodeRecoveryFailed, "Assessment completion needs a retry.")
		}
	}
	return receipt, nil
}

func activateSATRecoveryEntryTx(
	ctx context.Context,
	q tx.Tx,
	attemptID string,
	module saveActiveModule,
	boundary *satModuleBoundary,
	policy *attempts.SATDeliveryPolicy,
	now time.Time,
) error {
	if boundary == nil || policy == nil || boundary.phase != "blocked" || boundary.entryDeadline == nil {
		return assessmentConflict("RECOVERY_ENTRY_NOT_READY", "This module is not waiting on an expired entry recovery.")
	}
	res, err := q.ExecContext(ctx, `
		UPDATE assessment_module_boundaries
		SET phase = 'working', work_deadline_at = TIMESTAMPADD(SECOND, ? + ?, ?),
		    entry_deadline_at = NULL, recovery_deadline_at = TIMESTAMPADD(SECOND, ? + ? + ? + ?, ?),
		    next_action_at = TIMESTAMPADD(SECOND, ? + ?, ?), revision = revision + 1
		WHERE module_attempt_id = ? AND run_generation = (SELECT ma_run.run_generation FROM assessment_module_attempts ma_run WHERE ma_run.id = assessment_module_boundaries.module_attempt_id) AND attempt_id = ? AND phase = 'blocked' AND revision = ?
		  AND policy_version = ?`,
		module.allocatedSeconds, module.extensionSeconds+module.accumulatedPausedSeconds, now,
		module.allocatedSeconds, module.extensionSeconds, module.accumulatedPausedSeconds, policy.RecoverySeconds, now,
		module.allocatedSeconds, module.extensionSeconds+module.accumulatedPausedSeconds, now,
		module.id, attemptID, boundary.revision, policy.Version)
	if err != nil {
		return err
	}
	if changed, err := res.RowsAffected(); err != nil {
		return err
	} else if changed != 1 {
		return assessmentConflict("RECOVERY_BOUNDARY_STALE", "The recovery state changed. Refresh before resolving it.")
	}
	res, err = q.ExecContext(ctx, `
		UPDATE assessment_module_attempts
		SET state = 'active', allocated_seconds = ?, available_at = COALESCE(available_at, ?),
		    started_at = ?, paused_at = NULL, revision = revision + 1
		WHERE id = ? AND attempt_id = ? AND state = 'not_started' AND started_at IS NULL`+sectionEntryActivationSQL("assessment_module_attempts"),
		module.allocatedSeconds, now, now, module.id, attemptID)
	if err != nil {
		return err
	}
	if changed, err := res.RowsAffected(); err != nil {
		return err
	} else if changed != 1 {
		return assessmentConflict("RECOVERY_ENTRY_NOT_READY", "This module has already started or changed state.")
	}
	return markProviderAttemptExamPhaseInTx(ctx, q, attemptID)
}

func nullableResolutionReason(reason string) any {
	if strings.TrimSpace(reason) == "" {
		return nil
	}
	return reason
}

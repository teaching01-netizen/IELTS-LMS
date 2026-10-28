package delivery

import (
	"context"
	"encoding/json"
	"net/url"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"github.com/google/uuid"
)

// SetRecoveryContinuation supplies transaction-compatible composition-root
// dependencies. There is no credential issuance outside the Begin transaction.
func (s *Service) SetRecoveryContinuation(issuer RecoveryCredentialIssuer, reopen RecoveryReopenFunc) *Service {
	s.recoveryCredentialIssuer, s.recoveryReopen = issuer, reopen
	return s
}

// BeginDeviceRecovery is the explicit student Continue action. Every authority,
// clock, generation, credential, and audit change commits as one unit.
func (s *Service) BeginDeviceRecovery(ctx context.Context, grantID string, req BeginDeviceRecoveryRequest, userAgentHash, ipMetadata *string) (*RecoveryBeginResult, RecoveryCredentialIdentity, error) {
	var identity RecoveryCredentialIdentity
	grantID, req.OperationID, req.BrowserProof = strings.TrimSpace(grantID), strings.TrimSpace(req.OperationID), strings.TrimSpace(req.BrowserProof)
	if grantID == "" || !recoveryOperationIDPattern.MatchString(req.OperationID) || len(req.BrowserProof) < 16 || len(req.BrowserProof) > 512 {
		return nil, identity, apperrors.New(apperrors.CodeValidation, "A browser proof and stable operation ID are required.")
	}
	if s.recoveryCredentialIssuer == nil || !s.recoverySecretsReady() {
		return nil, identity, recoveryUnavailable("RECOVERY_UNAVAILABLE", "Exam continuation is unavailable.")
	}
	var out *RecoveryBeginResult
	var finalErr error
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		identity, out, finalErr = RecoveryCredentialIdentity{}, nil, nil
		head, err := loadRecoveryGrantByID(ctx, q, grantID, false)
		if err != nil {
			return err
		}
		if head == nil {
			return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
		}
		row, err := loadRecoveryAttempt(ctx, q, head.ScheduleID, head.AttemptID, true)
		if err != nil {
			return err
		}
		grant, err := loadRecoveryGrantByID(ctx, q, grantID, true)
		if err != nil {
			return err
		}
		now, err := dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		// Authenticate the browser before revealing any sitting state.
		if !s.claimProofMatches(grant, req.BrowserProof) {
			return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
		}
		if row.ProctorStatus == "paused" {
			return recoveryConflict("RECOVERY_PAUSED", "The proctor paused this sitting. Wait for the proctor to resume it.", nil)
		}
		if row.Control == nil || row.Control.ActiveGrantID != grant.ID || !row.Control.Target.Equal(grant.Target) {
			return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery is no longer active.", nil)
		}
		replay := grant.State == recoveryGrantStarted
		var receipt RecoveryBeginReceipt
		if replay {
			if err := json.Unmarshal(grant.BeginReceipt, &receipt); err != nil {
				return err
			}
			if grant.BeginOperationID != req.OperationID {
				return recoveryConflict("OPERATION_ID_CONFLICT", "Continue was already committed with a different operation.", nil)
			}
			if row.Control.Phase != examdomain.RecoveryPhaseWorking || row.ActiveSession.String != grant.TargetClientSessionID || row.LeaseEpoch != receipt.LeaseEpoch || row.ControlEpoch != receipt.ControlEpoch || row.TerminalGeneration != receipt.TerminalGeneration || row.Control.FocusRunGeneration != receipt.RunGeneration {
				return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery browser no longer owns the sitting.", nil)
			}
		} else {
			if req.ExpectedGrantRevision != 0 && req.ExpectedGrantRevision != grant.GrantRevision {
				return recoveryConflict("RECOVERY_STALE", "The recovery time changed. Refresh the ready screen before continuing.", nil)
			}
			if grant.State != recoveryGrantClaimed || row.Control.Phase != examdomain.RecoveryPhaseHeld {
				return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery is no longer active.", nil)
			}
			if grant.ClaimExpiresAt == nil || !now.Before(*grant.ClaimExpiresAt) {
				if err := expireRecoveryGrant(ctx, q, grant.ID); err != nil {
					return err
				}
				finalErr = recoveryConflict("RECOVERY_EXPIRED", "The preparation window expired. Ask staff for a new code.", nil)
				return nil
			}
			facts, err := s.loadRecoveryTargetFacts(ctx, q, row, now)
			if err != nil {
				return err
			}
			fact, ok := matchRecoveryTarget(facts, row.ProviderKey, grant.Target)
			if !ok {
				return recoveryConflict("RECOVERY_SUPERSEDED", "The selected stage is unavailable.", nil)
			}
			reason, err := loadRecoveryReceiptReason(ctx, q, row.ID, row.TerminalGeneration)
			if err != nil {
				return err
			}
			if e := classifyRecoveryTarget(row, reason, fact); !e.Eligible {
				return recoveryConflict(e.Reason, recoveryIneligibleMessage(e.Reason), nil)
			}
			clock, err := examruntime.PlanRecoveryClock(now, fact.Deadline, grant.RequestedRemainingSeconds)
			if err != nil {
				return recoveryConflict(examruntime.RecoveryReason(err), recoveryTimeMessage(examruntime.RecoveryReason(err)), nil)
			}
			control := *row.Control
			control.Suspended, err = s.suspendRecoverySuccessors(ctx, q, row, facts, grant.Target, now)
			if err != nil {
				return err
			}
			if grant.Target.ModuleAttemptID != "" && len(control.Suspended) > 0 {
				control.SuspendedBreakIDs, err = suspendRecoveryBreaks(ctx, q, row.ID, now)
				if err != nil {
					return err
				}
			}
			if !row.open() || reason != "" {
				if s.recoveryReopen == nil {
					return recoveryUnavailable("RECOVERY_UNAVAILABLE", "Completion recovery is unavailable.")
				}
				row.TerminalGeneration, err = s.recoveryReopen(ctx, q, row.ID, now)
				if err != nil {
					return err
				}
			}
			control.Phase = examdomain.RecoveryPhaseWorking
			control.FocusDeadlineAt = &clock.DeadlineAt
			control.FocusStartedAt = &now
			control.FocusRunGeneration, err = applyRecoveryTargetClock(ctx, q, row, grant.Target, clock, now)
			if err != nil {
				return err
			}
			lease, epoch, err := attempts.ActivateRecoveryInTx(ctx, q, row.ID, grant.TargetClientSessionID, control)
			if err != nil {
				return err
			}
			// The attempt-owned deadline is the common gate for cohort/snapshot
			// providers; it never changes the shared room clock.
			if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET deadline_at = ?, closing_grace_until = NULL, current_module = CASE WHEN ? = 'sat' THEN current_module ELSE ? END, phase = 'exam', delivery_status = 'running' WHERE id = ?`, clock.DeadlineAt, row.ProviderKey, grant.Target.SectionKey, row.ID); err != nil {
				return err
			}
			receipt = RecoveryBeginReceipt{OperationID: req.OperationID, GrantRevision: grant.GrantRevision + 1, ClientSessionID: grant.TargetClientSessionID, LeaseEpoch: lease, ControlEpoch: epoch, RunGeneration: control.FocusRunGeneration, TerminalGeneration: row.TerminalGeneration, TimeMode: "original_deadline", AwardedSeconds: clock.AwardedSeconds, EffectiveDeadlineAt: &clock.DeadlineAt}
			if clock.AwardedSeconds != nil {
				receipt.TimeMode = "awarded"
			}
		}
		if !row.UserID.Valid || strings.TrimSpace(row.UserID.String) == "" {
			return recoveryConflict(RecoveryReasonIneligible, "The sitting has no verified student principal.", nil)
		}
		var org *string
		if row.OrganizationID.Valid {
			v := row.OrganizationID.String
			org = &v
		}
		identity, err = s.recoveryCredentialIssuer(ctx, q, RecoveryCredentialRequest{GrantID: grant.ID, UserID: row.UserID.String, ScheduleID: row.ScheduleID, AttemptID: row.ID, ClientSessionID: grant.TargetClientSessionID, OrganizationID: org, LeaseEpoch: receipt.LeaseEpoch, UserAgentHash: userAgentHash, IPMetadata: ipMetadata, Now: now})
		if err != nil {
			return err
		}
		if !replay {
			receipt.SessionID = identity.SessionID
			raw, err := json.Marshal(receipt)
			if err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, `UPDATE attempt_device_recovery_grants SET state = 'started', started_at = ?, resulting_lease_epoch = ?, begin_operation_id = ?, begin_receipt = ?, grant_revision = grant_revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND state = 'claimed'`, now, receipt.LeaseEpoch, req.OperationID, string(raw), grant.ID); err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, `INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, ?, 'DEVICE_RECOVERY_CONTINUED', ?, ?, UTC_TIMESTAMP(6))`, uuid.NewString(), row.ScheduleID, row.UserID.String, row.ID, string(raw)); err != nil {
				return err
			}
		}
		var candidateID string
		if err := q.QueryRowContext(ctx, `SELECT candidate_id FROM student_attempts WHERE id = ?`, row.ID).Scan(&candidateID); err != nil {
			return err
		}
		out = &RecoveryBeginResult{AttemptID: row.ID, ScheduleID: row.ScheduleID, CandidateID: candidateID, GrantID: grant.ID, State: recoveryGrantStarted, GrantRevision: receipt.GrantRevision, RoutePath: "/student/" + url.PathEscape(row.ScheduleID) + "/" + url.PathEscape(candidateID), AttemptExpiresAt: identity.AttemptExpiresAt, EffectiveDeadlineAt: receipt.EffectiveDeadlineAt, ServerNow: now, Replayed: replay}
		return nil
	})
	if err != nil {
		return nil, RecoveryCredentialIdentity{}, err
	}
	if finalErr != nil {
		return nil, RecoveryCredentialIdentity{}, finalErr
	}
	return out, identity, nil
}

func applyRecoveryTargetClock(ctx context.Context, q tx.Tx, row recoveryAttemptRow, target examdomain.RecoveryTarget, clock examruntime.RecoveryClockPlan, now time.Time) (uint64, error) {
	var generation uint64
	if target.ModuleAttemptID != "" {
		// Preserve the exact deadline, including fractional seconds: start at the
		// awarded deadline minus whole allocation seconds, rather than round time.
		seconds := examruntime.RecoveryRemainingSeconds(now, &clock.DeadlineAt)
		if seconds < 1 {
			seconds = 1
		}
		started := clock.DeadlineAt.Add(-time.Duration(seconds) * time.Second)
		_, err := q.ExecContext(ctx, `UPDATE assessment_module_attempts SET state = 'active', started_at = ?, allocated_seconds = ?, extension_seconds = 0, accumulated_paused_seconds = 0, paused_at = NULL, submitted_at = NULL, locked_at = NULL, completion_reason = NULL, raw_correct = NULL, run_generation = run_generation + 1 WHERE id = ? AND attempt_id = ? AND module_id = ?`, started, seconds, target.ModuleAttemptID, row.ID, target.ModuleID)
		if err != nil {
			return 0, err
		}
		err = q.QueryRowContext(ctx, `SELECT run_generation FROM assessment_module_attempts WHERE id = ? AND attempt_id = ?`, target.ModuleAttemptID, row.ID).Scan(&generation)
		if err != nil {
			return 0, err
		}
		if _, err := ensureSatModuleBoundaryTx(ctx, q, row.ID, target.ModuleAttemptID); err != nil {
			return 0, err
		}
		return generation, nil
	}
	model, err := recoveryTimingModel(ctx, q, row.ScheduleID)
	if err != nil {
		return 0, err
	}
	if examruntime.IsIELTSPersonal(model) {
		_, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines SET state = 'active', started_at = ?, deadline_at = ?, paused_at = NULL, accumulated_paused_seconds = 0, finished_at = NULL, completion_reason = NULL, failure_reason = NULL, run_generation = run_generation + 1, revision = revision + 1 WHERE attempt_id = ? AND section_key = ?`, now, clock.DeadlineAt, row.ID, target.SectionKey)
		if err != nil {
			return 0, err
		}
		err = q.QueryRowContext(ctx, `SELECT run_generation FROM ielts_attempt_section_timelines WHERE attempt_id = ? AND section_key = ?`, row.ID, target.SectionKey).Scan(&generation)
		return generation, err
	}
	if row.Control != nil {
		generation = row.Control.FocusRunGeneration + 1
	}
	return generation, nil
}

func (s *Service) suspendRecoverySuccessors(ctx context.Context, q tx.Tx, row recoveryAttemptRow, facts []recoveryTargetFact, target examdomain.RecoveryTarget, now time.Time) ([]examdomain.SuspendedRecoveryStage, error) {
	var saved []examdomain.SuspendedRecoveryStage
	if row.Control != nil {
		for _, stage := range row.Control.Suspended {
			if !stage.Target.Equal(target) {
				saved = append(saved, stage)
			}
		}
	}
	selected := false
	for _, f := range facts {
		if f.Target.Equal(target) {
			selected = true
			continue
		}
		if !selected {
			continue
		}
		if f.State == "completed" || f.State == "locked" || f.State == "unable" {
			continue
		}
		stage := examdomain.SuspendedRecoveryStage{Target: f.Target, State: f.State, RemainingSeconds: examruntime.RecoveryRemainingSeconds(now, f.Deadline)}
		if f.Target.ModuleAttemptID != "" {
			if err := q.QueryRowContext(ctx, `SELECT run_generation FROM assessment_module_attempts WHERE id = ? AND attempt_id = ? FOR UPDATE`, f.Target.ModuleAttemptID, row.ID).Scan(&stage.RunGeneration); err != nil {
				return nil, err
			}
			if _, err := q.ExecContext(ctx, `UPDATE assessment_module_attempts SET paused_at = COALESCE(paused_at, ?) WHERE id = ? AND attempt_id = ?`, now, f.Target.ModuleAttemptID, row.ID); err != nil {
				return nil, err
			}
		} else {
			// Cohort snapshot providers have no timeline row; only personal IELTS
			// successors carry one and require its persisted generation.
			model, err := recoveryTimingModel(ctx, q, row.ScheduleID)
			if err != nil {
				return nil, err
			}
			if examruntime.IsIELTSPersonal(model) {
				if err := q.QueryRowContext(ctx, `SELECT run_generation FROM ielts_attempt_section_timelines WHERE attempt_id=? AND section_key=? FOR UPDATE`, row.ID, f.Target.SectionKey).Scan(&stage.RunGeneration); err != nil {
					return nil, err
				}
			}
			if _, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines SET paused_at = COALESCE(paused_at, ?), revision = revision + 1 WHERE attempt_id = ? AND section_key = ? AND state IN ('preparing','active')`, now, row.ID, f.Target.SectionKey); err != nil {
				return nil, err
			}
		}
		saved = examdomain.MergeSuspendedStages(saved, []examdomain.SuspendedRecoveryStage{stage})
	}
	return saved, nil
}

func focusedRecoverySections(sections []DeliverySection, target examdomain.RecoveryTarget) []DeliverySection {
	out := make([]DeliverySection, 0, 1)
	for _, section := range sections {
		if section.SectionKey != target.SectionKey {
			continue
		}
		copy := section
		if target.ModuleID != "" {
			copy.Modules = nil
			for _, module := range section.Modules {
				if module.ID == target.ModuleID {
					copy.Modules = append(copy.Modules, module)
				}
			}
		}
		out = append(out, copy)
	}
	return out
}

// resumeRecoverySuccessor consumes the continuation captured at Begin. It
// reuses the administered module, answers, route, and run; ordinary routing
// and break creation are deliberately not replayed over a saved successor.
func (s *Service) resumeRecoverySuccessor(ctx context.Context, q tx.Tx, attemptID string, c *examdomain.RecoveryControl) (*nextModuleRow, error) {
	now, err := dbTimeTx(ctx, q)
	if err != nil {
		return nil, err
	}
	stage := c.Suspended[0]
	if stage.Target.ModuleAttemptID == "" {
		return nil, recoveryConflict("RECOVERY_INELIGIBLE", "The saved successor is not a SAT module.", nil)
	}
	next, err := scanNextModuleRowTx(ctx, q, stage.Target.ModuleID)
	if err != nil {
		return nil, err
	}
	deadline := now.Add(time.Duration(stage.RemainingSeconds) * time.Second)
	if stage.State == "active" || stage.State == "review" {
		if _, err := q.ExecContext(ctx, `UPDATE assessment_module_attempts SET state=?,started_at=?,allocated_seconds=?,extension_seconds=0,accumulated_paused_seconds=0,paused_at=NULL,revision=revision+1 WHERE id=? AND attempt_id=? AND run_generation=?`, stage.State, now, stage.RemainingSeconds, stage.Target.ModuleAttemptID, attemptID, stage.RunGeneration); err != nil {
			return nil, err
		}
	} else {
		if _, err := q.ExecContext(ctx, `UPDATE assessment_module_attempts SET available_at=CASE WHEN paused_at IS NULL THEN available_at ELSE TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,paused_at,UTC_TIMESTAMP(6)),0),available_at) END,auto_start_at=CASE WHEN paused_at IS NULL THEN auto_start_at ELSE TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,paused_at,UTC_TIMESTAMP(6)),0),auto_start_at) END,entry_starts_at=CASE WHEN paused_at IS NULL THEN entry_starts_at ELSE TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,paused_at,UTC_TIMESTAMP(6)),0),entry_starts_at) END,paused_at=NULL,revision=revision+1 WHERE id=? AND attempt_id=? AND run_generation=?`, stage.Target.ModuleAttemptID, attemptID, stage.RunGeneration); err != nil {
			return nil, err
		}
	}
	if err := examruntime.RealignSATRecoveryBoundariesInTx(ctx, q, "", attemptID); err != nil {
		return nil, err
	}
	if len(c.SuspendedBreakIDs) > 0 {
		if err := resumeRecoveryBreaks(ctx, q, attemptID, c.SuspendedBreakIDs); err != nil {
			return nil, err
		}
		c.SuspendedBreakIDs = nil
	}
	c.Target = stage.Target
	c.Suspended = c.Suspended[1:]
	c.FocusRunGeneration = stage.RunGeneration
	c.FocusDeadlineAt = &deadline
	c.FocusStartedAt = &now
	// A never-started successor remains on its existing offer. Its ordinary
	// entry owns starting the clock and must not inherit a zero work deadline.
	if stage.State == "not_started" && len(c.Suspended) == 0 {
		_, err = q.ExecContext(ctx, `UPDATE student_attempts SET recovery_control=NULL,deadline_at=NULL,closing_grace_until=NULL,control_epoch=control_epoch+1,revision=revision+1 WHERE id=?`, attemptID)
		return next, err
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return nil, err
	}
	_, err = q.ExecContext(ctx, `UPDATE student_attempts SET recovery_control=?,deadline_at=?,control_epoch=control_epoch+1,revision=revision+1 WHERE id=?`, string(raw), deadline, attemptID)
	return next, err
}

func suspendRecoveryBreaks(ctx context.Context, q tx.Tx, attemptID string, now time.Time) ([]string, error) {
	rows, err := q.QueryContext(ctx, `SELECT id FROM assessment_attempt_breaks WHERE attempt_id=? AND state<>'completed' ORDER BY id FOR UPDATE`, attemptID)
	if err != nil {
		return nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		ids = append(ids, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if len(ids) > 0 {
		_, err = q.ExecContext(ctx, `UPDATE assessment_attempt_breaks SET paused_at=COALESCE(paused_at,?),revision=revision+1 WHERE attempt_id=? AND state<>'completed'`, now, attemptID)
	}
	return ids, err
}

func resumeRecoveryBreaks(ctx context.Context, q tx.Tx, attemptID string, ids []string) error {
	args := []any{attemptID}
	for _, id := range ids {
		args = append(args, id)
	}
	// Shift the original offer/countdown; retain consumed generations, form
	// responses and entry acknowledgements. Room/individual pauses still win.
	_, err := q.ExecContext(ctx, `UPDATE assessment_attempt_breaks b
JOIN student_attempts a ON a.id=b.attempt_id JOIN exam_session_runtimes r ON r.schedule_id=a.schedule_id
SET b.entry_starts_at=CASE WHEN b.starts_at IS NULL OR b.starts_at>b.paused_at THEN TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,b.paused_at,UTC_TIMESTAMP(6)),0),b.entry_starts_at) ELSE b.entry_starts_at END,
b.starts_at=CASE WHEN b.starts_at>b.paused_at THEN TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,b.paused_at,UTC_TIMESTAMP(6)),0),b.starts_at) ELSE b.starts_at END,
b.deadline_at=TIMESTAMPADD(MICROSECOND,GREATEST(TIMESTAMPDIFF(MICROSECOND,b.paused_at,UTC_TIMESTAMP(6)),0),b.deadline_at),
b.accumulated_paused_seconds=b.accumulated_paused_seconds+GREATEST(TIMESTAMPDIFF(SECOND,b.paused_at,UTC_TIMESTAMP(6)),0),
b.paused_at=NULL,b.revision=b.revision+1
WHERE b.attempt_id=? AND b.id IN (`+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+`) AND b.state<>'completed' AND b.paused_at IS NOT NULL
AND r.status<>'paused' AND COALESCE(a.proctor_status,'active')<>'paused'`, args...)
	return err
}

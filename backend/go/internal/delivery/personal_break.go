package delivery

import (
	"context"
	"database/sql"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

type BreakEntryRequest struct {
	BreakID    string `json:"breakId"`
	Generation int    `json:"generation"`
	// ControlEpoch fences a break confirmation/visibility ack that crossed a
	// pause/resume boundary, mirroring the module entry fence.
	ControlEpoch *int `json:"controlEpoch,omitempty"`
}

// BreakStartRequest is the optional StartBreak body. LeadSeconds lets a
// replacement offer carry a longer future start when the browser measured a
// slow round trip; omitted keeps the default personalOfferLeadSeconds.
type BreakStartRequest struct {
	ControlEpoch *int `json:"controlEpoch,omitempty"`
	LeadSeconds  *int `json:"leadSeconds,omitempty"`
}

const (
	minBreakOfferLeadSeconds = personalOfferLeadSeconds
	maxBreakOfferLeadSeconds = 12
)

// StartBreak arms (or re-arms) the attempt-owned scheduled break at database
// time plus the lead. controlEpoch fences a command that crossed a
// pause/resume boundary exactly as it does for module entry. A nil request
// keeps the default lead and no fence.
func (s *Service) StartBreak(ctx context.Context, scheduleID, attemptID, urlScheduleID, breakID string, req *BreakStartRequest, writerBinding ...string) (*Bootstrap, error) {
	if scheduleID != urlScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	var controlEpoch *int
	lead := personalOfferLeadSeconds
	if req != nil {
		controlEpoch = req.ControlEpoch
		if req.LeadSeconds != nil {
			if *req.LeadSeconds < minBreakOfferLeadSeconds || *req.LeadSeconds > maxBreakOfferLeadSeconds {
				return nil, apperrors.New(apperrors.CodeValidation, "leadSeconds must be between 3 and 12.")
			}
			lead = *req.LeadSeconds
		}
	}
	bound, examID, provider, versionID, err := s.startScheduleBinding(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	if err := s.saveAttemptBinding(ctx, bound, attemptID, examID); err != nil {
		return nil, err
	}
	if err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var authority attemptAuthoritySnapshot
		if err := s.ensureAttemptCanWorkWithAuthorityTx(ctx, t, bound, attemptID, nil, &authority); err != nil {
			return err
		}
		if err := enforceWriterSessionWithAuthorityTx(ctx, t, bound, attemptID, writerBinding, &authority); err != nil {
			return err
		}
		if authority.recoveryControl != nil {
			return assessmentConflict("RECOVERY_FOCUS", "Finish the recovery module before entering a break.")
		}
		if err := enforceControlEpochSnapshot(attemptID, &authority, controlEpoch); err != nil {
			return err
		}
		now, err := personalRuntimeNowTx(ctx, t, bound)
		if err != nil {
			return err
		}
		var state string
		var generation int
		var offerStartsAt, startsAt, enteredAt, proctorRearmAt sql.NullTime
		if err := t.QueryRowContext(ctx, `
			SELECT state, entry_generation, entry_starts_at, starts_at, entry_entered_at, entry_proctor_rearm_at
			FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE`,
			breakID, attemptID).Scan(&state, &generation, &offerStartsAt, &startsAt, &enteredAt, &proctorRearmAt); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Scheduled break not found.")
			}
			return err
		}
		if state == "completed" || enteredAt.Valid {
			return assessmentConflict("BREAK_ALREADY_ENTERED", "This scheduled break has already been entered.")
		}
		if state == "active" && startsAt.Valid && startsAt.Time.After(now) {
			return nil // Idempotent replay returns the original active break.
		}
		if offerStartsAt.Valid && offerStartsAt.Time.After(now) {
			return nil
		}
		rearming := offerStartsAt.Valid
		if offerStartsAt.Valid {
			// Rearming only (an existing offer whose start was missed): bound it by
			// schedule admission closure, mirroring armPersonalModuleOfferTx. The
			// first arm of a pending break is not gated here.
			var endTime sql.NullTime
			if err := t.QueryRowContext(ctx,
				"SELECT s.end_time FROM exam_schedules s JOIN student_attempts sa ON sa.schedule_id = s.id WHERE sa.id = ?",
				attemptID).Scan(&endTime); err != nil {
				return err
			}
			if endTime.Valid && !now.Before(endTime.Time) && !proctorRearmAt.Valid {
				return assessmentConflict("ADMISSION_CLOSED", "Admission for this SAT session has closed; ask the proctor to re-arm the break.")
			}
		}
		// A proctor grant (entry_proctor_rearm_at) lifts both bounds until the
		// candidate enters the break — same remedy the two refusals above name.
		if generation >= 4 && !proctorRearmAt.Valid {
			recordPersonalOffer(personalStageBreak, "exhausted")
			return assessmentConflict("BREAK_RETRY_EXHAUSTED", "The scheduled break could not be prepared. Ask the proctor to re-arm it.")
		}
		res, err := t.ExecContext(ctx, `
			UPDATE assessment_attempt_breaks
			SET state = 'armed', starts_at = NULL, deadline_at = NULL,
			    entry_starts_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND),
			    entry_confirmed_at = NULL, entry_entered_at = NULL,
			    entry_generation = entry_generation + 1, revision = revision + 1
			WHERE id = ? AND attempt_id = ? AND state IN ('pending', 'armed') AND entry_entered_at IS NULL`,
			lead, breakID, attemptID)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil {
			return err
		} else if n != 1 {
			return assessmentConflict("STALE_ENTRY_GENERATION", "This scheduled break offer is no longer current. Refresh and continue.")
		}
		if rearming {
			recordPersonalOffer(personalStageBreak, "rearmed")
		} else {
			recordPersonalOffer(personalStageBreak, "armed")
		}
		return nil
	}); err != nil {
		return nil, err
	}
	return s.assembleBootstrap(ctx, bound, examID, provider, versionID, attemptID)
}

func (s *Service) EnterBreak(ctx context.Context, scheduleID, attemptID, urlScheduleID string, req BreakEntryRequest, writerBinding ...string) (*Bootstrap, error) {
	if scheduleID != urlScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	bound, examID, provider, versionID, err := s.startScheduleBinding(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	if err := s.saveAttemptBinding(ctx, bound, attemptID, examID); err != nil {
		return nil, err
	}
	if err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var authority attemptAuthoritySnapshot
		if err := s.ensureAttemptCanWorkWithAuthorityTx(ctx, t, bound, attemptID, nil, &authority); err != nil {
			return err
		}
		if err := enforceWriterSessionWithAuthorityTx(ctx, t, bound, attemptID, writerBinding, &authority); err != nil {
			return err
		}
		if authority.recoveryControl != nil {
			return assessmentConflict("RECOVERY_FOCUS", "Finish the recovery module before entering a break.")
		}
		if err := enforceControlEpochSnapshot(attemptID, &authority, req.ControlEpoch); err != nil {
			return err
		}
		now, err := personalRuntimeNowTx(ctx, t, bound)
		if err != nil {
			return err
		}
		var duration, generation int
		var state string
		var entryStartsAt, confirmedAt, enteredAt, startsAt sql.NullTime
		if err := t.QueryRowContext(ctx, `
			SELECT duration_seconds, state, entry_generation, entry_starts_at,
			       entry_confirmed_at, entry_entered_at, starts_at
			FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE`,
			req.BreakID, attemptID).Scan(&duration, &state, &generation, &entryStartsAt, &confirmedAt, &enteredAt, &startsAt); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Scheduled break not found.")
			}
			return err
		}
		if generation != req.Generation || !entryStartsAt.Valid {
			return assessmentConflict("STALE_ENTRY_GENERATION", "This scheduled break offer is no longer current.")
		}
		if confirmedAt.Valid && startsAt.Valid && state == "active" {
			return nil
		}
		if state != "armed" || confirmedAt.Valid || enteredAt.Valid {
			return assessmentConflict("BREAK_NOT_ARMED", "The scheduled break is not ready to enter.")
		}
		if !now.Before(entryStartsAt.Time) {
			recordPersonalEntry(personalStageBreak, "missed")
			return assessmentConflict("ENTRY_OFFER_MISSED", "The scheduled break offer started before the surface was ready. Request a new offer.")
		}
		res, err := t.ExecContext(ctx, `
			UPDATE assessment_attempt_breaks
			SET state = 'active', starts_at = entry_starts_at,
			    deadline_at = DATE_ADD(entry_starts_at, INTERVAL duration_seconds SECOND),
			    entry_confirmed_at = UTC_TIMESTAMP(6), revision = revision + 1
			WHERE id = ? AND attempt_id = ? AND state = 'armed' AND entry_generation = ?
			  AND entry_confirmed_at IS NULL AND entry_entered_at IS NULL`,
			req.BreakID, attemptID, generation)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil {
			return err
		} else if n != 1 {
			return assessmentConflict("STALE_ENTRY_GENERATION", "This scheduled break offer is no longer current.")
		}
		recordPersonalEntry(personalStageBreak, "confirmed")
		return nil
	}); err != nil {
		return nil, err
	}
	return s.assembleBootstrap(ctx, bound, examID, provider, versionID, attemptID)
}

func (s *Service) MarkBreakVisible(ctx context.Context, scheduleID, attemptID, urlScheduleID string, req BreakEntryRequest, writerBinding ...string) (*Bootstrap, error) {
	if scheduleID != urlScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	bound, examID, provider, versionID, err := s.startScheduleBinding(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	if err := s.saveAttemptBinding(ctx, bound, attemptID, examID); err != nil {
		return nil, err
	}
	if err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var authority attemptAuthoritySnapshot
		if err := s.ensureAttemptCanWorkWithAuthorityTx(ctx, t, bound, attemptID, nil, &authority); err != nil {
			return err
		}
		if err := enforceWriterSessionWithAuthorityTx(ctx, t, bound, attemptID, writerBinding, &authority); err != nil {
			return err
		}
		if authority.recoveryControl != nil {
			return assessmentConflict("RECOVERY_FOCUS", "Finish the recovery module before entering a break.")
		}
		if err := enforceControlEpochSnapshot(attemptID, &authority, req.ControlEpoch); err != nil {
			return err
		}
		now, err := personalRuntimeNowTx(ctx, t, bound)
		if err != nil {
			return err
		}
		var generation int
		var startsAt, confirmedAt, enteredAt sql.NullTime
		if err := t.QueryRowContext(ctx, `
			SELECT entry_generation, starts_at, entry_confirmed_at, entry_entered_at
			FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE`,
			req.BreakID, attemptID).Scan(&generation, &startsAt, &confirmedAt, &enteredAt); err != nil {
			return err
		}
		if generation != req.Generation || !startsAt.Valid || !confirmedAt.Valid {
			return assessmentConflict("BREAK_NOT_CONFIRMED", "The scheduled break entry was not confirmed.")
		}
		if now.Before(startsAt.Time) {
			return assessmentConflict("ENTRY_NOT_STARTED", "The scheduled break has not started yet.")
		}
		if enteredAt.Valid {
			return nil
		}
		if _, err = t.ExecContext(ctx, `UPDATE assessment_attempt_breaks SET entry_entered_at = UTC_TIMESTAMP(6), entered_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND attempt_id = ? AND entry_generation = ? AND entry_entered_at IS NULL`, req.BreakID, attemptID, generation); err != nil {
			return err
		}
		recordPersonalFrameLead(personalStageBreak, startsAt.Time, now)
		return nil
	}); err != nil {
		return nil, err
	}
	return s.assembleBootstrap(ctx, bound, examID, provider, versionID, attemptID)
}

// completeDuePersonalBreaksTx completes the attempt's due breaks at their own
// deadline and, in the same transaction, makes the following section's
// waiting Module 1 eligible from that actual deadline (it was inserted with
// available_at unset because the break's start was not yet known). Its
// recovery entry allowance starts there too, only when the section-form gate
// permits entry. A form-gated module keeps available_at unset: it is still
// started explicitly after its form, never by the timeout worker.
func completeDuePersonalBreaksTx(ctx context.Context, t tx.Tx, attemptID string, policy *attempts.SATDeliveryPolicy) (bool, error) {
	res, err := t.ExecContext(ctx, `
		UPDATE assessment_attempt_breaks
		SET state = 'completed', revision = revision + 1
		WHERE attempt_id = ? AND state = 'active' AND paused_at IS NULL
		  AND NOT EXISTS (SELECT 1 FROM student_attempts sa WHERE sa.id = assessment_attempt_breaks.attempt_id AND sa.proctor_status = 'paused')
		  AND deadline_at IS NOT NULL AND deadline_at <= UTC_TIMESTAMP(6)`, attemptID)
	if err != nil {
		return false, err
	}
	if n, err := res.RowsAffected(); err != nil || n == 0 {
		return false, err
	}
	var moduleAttemptID, sectionKey string
	var deadline time.Time
	err = t.QueryRowContext(ctx, `
		SELECT ma.id, s.section_key, b.deadline_at
		FROM assessment_attempt_breaks b
		JOIN assessment_module_attempts ma ON ma.attempt_id = b.attempt_id
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE b.attempt_id = ? AND b.state = 'completed' AND b.deadline_at IS NOT NULL
		  AND s.id <> b.after_section_id
		  AND ma.state = 'not_started' AND ma.available_at IS NULL
		ORDER BY b.deadline_at DESC, ma.created_at, ma.id
		LIMIT 1 FOR UPDATE`, attemptID).Scan(&moduleAttemptID, &sectionKey, &deadline)
	if err == sql.ErrNoRows {
		return true, nil
	}
	if err != nil {
		return false, err
	}
	gated, err := hasSectionEntryFormTx(ctx, t, attemptID, sectionKey)
	if err != nil || gated {
		return err == nil, err
	}
	if _, err := t.ExecContext(ctx,
		"UPDATE assessment_module_attempts SET available_at = ?, revision = revision + 1 WHERE id = ? AND state = 'not_started' AND available_at IS NULL",
		deadline, moduleAttemptID); err != nil {
		return false, err
	}
	if policy != nil {
		if _, err := t.ExecContext(ctx, `
			UPDATE assessment_module_boundaries b
			JOIN assessment_module_attempts ma ON ma.id = b.module_attempt_id AND ma.run_generation = b.run_generation
			SET b.entry_deadline_at = TIMESTAMPADD(SECOND, ?, ma.available_at),
			    b.next_action_at = TIMESTAMPADD(SECOND, ?, ma.available_at),
			    b.revision = b.revision + 1
			WHERE b.module_attempt_id = ? AND b.phase = 'preparing' AND b.entry_deadline_at IS NULL
			  AND ma.state = 'not_started' AND ma.available_at IS NOT NULL`+sectionEntryActivationSQL("ma"),
			policy.EntryRecoverySeconds, policy.EntryRecoverySeconds, moduleAttemptID); err != nil {
			return false, err
		}
	}
	return true, nil
}

func personalRuntimeNowTx(ctx context.Context, t tx.Tx, scheduleID string) (time.Time, error) {
	var model, status string
	if err := t.QueryRowContext(ctx, "SELECT timing_model, status FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE", scheduleID).Scan(&model, &status); err != nil {
		if err == sql.ErrNoRows {
			return time.Time{}, assessmentConflict("RUNTIME_NOT_LIVE", "The SAT runtime is not live.")
		}
		return time.Time{}, err
	}
	if model != examruntime.TimingModelPersonal || status != "live" {
		return time.Time{}, assessmentConflict("RUNTIME_NOT_LIVE", "The SAT runtime is not live.")
	}
	return dbTimeTx(ctx, t)
}

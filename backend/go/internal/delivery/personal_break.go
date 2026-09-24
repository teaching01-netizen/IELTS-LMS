package delivery

import (
	"context"
	"database/sql"
	"time"

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

// StartBreak arms (or re-arms) the attempt-owned scheduled break at database
// time plus the short lead. controlEpoch fences a command that crossed a
// pause/resume boundary exactly as it does for module entry.
func (s *Service) StartBreak(ctx context.Context, scheduleID, attemptID, urlScheduleID, breakID string, controlEpoch *int, writerBinding ...string) (*Bootstrap, error) {
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
		if err := s.ensureAttemptCanWorkTx(ctx, t, bound, attemptID); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, bound, attemptID, writerBinding...); err != nil {
			return err
		}
		if err := enforceControlEpochTx(ctx, t, attemptID, controlEpoch); err != nil {
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
			personalOfferLeadSeconds, breakID, attemptID)
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
		if err := s.ensureAttemptCanWorkTx(ctx, t, bound, attemptID); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, bound, attemptID, writerBinding...); err != nil {
			return err
		}
		if err := enforceControlEpochTx(ctx, t, attemptID, req.ControlEpoch); err != nil {
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
		if _, err = t.ExecContext(ctx, `
			UPDATE assessment_attempt_breaks
			SET state = 'active', starts_at = entry_starts_at,
			    deadline_at = DATE_ADD(entry_starts_at, INTERVAL duration_seconds SECOND),
			    entry_confirmed_at = UTC_TIMESTAMP(6), revision = revision + 1
			WHERE id = ? AND attempt_id = ? AND state = 'armed' AND entry_generation = ?
			  AND entry_confirmed_at IS NULL AND entry_entered_at IS NULL`,
			req.BreakID, attemptID, generation); err != nil {
			return err
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
		if err := s.ensureAttemptCanWorkTx(ctx, t, bound, attemptID); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, bound, attemptID, writerBinding...); err != nil {
			return err
		}
		if err := enforceControlEpochTx(ctx, t, attemptID, req.ControlEpoch); err != nil {
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

func personalRuntimeNowTx(ctx context.Context, t tx.Tx, scheduleID string) (time.Time, error) {
	var model, status string
	if err := t.QueryRowContext(ctx, "SELECT timing_model, status FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE", scheduleID).Scan(&model, &status); err != nil {
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

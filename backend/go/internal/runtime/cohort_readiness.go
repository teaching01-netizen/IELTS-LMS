package runtime

import (
	"context"
	"database/sql"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

type CohortReadiness struct {
	StartedAt         *time.Time `json:"startedAt"`
	ServerNow         time.Time  `json:"serverNow"`
	RemainingStudents int        `json:"remainingStudents"`
	Status            string     `json:"status,omitempty"`
	DeadlineAt        *time.Time `json:"deadlineAt,omitempty"`
	ExpectedStartAt   *time.Time `json:"expectedStartAt,omitempty"`
	PreparationEndsAt *time.Time `json:"preparationEndsAt,omitempty"`
	Message           string     `json:"message,omitempty"`
	// activationDelay is this request's committed start minus the previous
	// section's personal deadline; observed only after commit.
	activationDelay time.Duration
}

type IELTSReadinessSignals struct {
	ContentReady      *bool `json:"contentReady"`
	LocalStorageReady *bool `json:"localStorageReady"`
	AudioReady        *bool `json:"audioReady"`
	// OfflinePackageReady is set only after the device verified its full
	// offline package (content, media, shell, answer storage). In the shared
	// model it is the only signal that records a roster-visible preparation
	// row: there is no readiness barrier, so a partial probe must not read as
	// "prepared" to the proctor.
	OfflinePackageReady *bool `json:"offlinePackageReady"`
}

// cohortStartLead covers readiness polling and delivery of the armed clock.
// It follows measured transport latency while keeping the fixed handoff buffer short.
func cohortStartLead(roundTripMS int) time.Duration {
	if roundTripMS < 0 {
		roundTripMS = 0
	}
	if roundTripMS > 10000 {
		roundTripMS = 10000
	}
	return time.Duration(600+2*roundTripMS) * time.Millisecond
}

// ReadyCohortSection is idempotent and serializes with admission, proctor
// commands, and response writes through the existing global lock order. It
// uses READ COMMITTED with bounded deadlock retries for concurrent readiness
// writes that may otherwise contend on missing per-attempt timeline keys.
func (s *Service) ReadyCohortSection(ctx context.Context, scheduleID, sectionKey, attemptID, actorUserID string, roundTripMS *int, signals ...IELTSReadinessSignals) (CohortReadiness, error) {
	var out CohortReadiness
	changed := false
	err := s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		out = CohortReadiness{}
		changed = false
		// Read the immutable timing choice before taking cohort locks. New IELTS
		// sessions then lock only the requesting attempt, so hundreds of students
		// can independently report readiness without serializing on every row.
		var timingModel string
		if err := q.QueryRowContext(ctx, `SELECT COALESCE(timing_model, '') FROM exam_session_runtimes WHERE schedule_id = ?`, scheduleID).Scan(&timingModel); err != nil {
			return err
		}
		if IsIELTSSharedSchedule(timingModel) {
			var readiness IELTSReadinessSignals
			if len(signals) > 0 {
				readiness = signals[0]
			}
			return readyIELTSSharedSectionInTx(ctx, q, scheduleID, sectionKey, attemptID, actorUserID, roundTripMS, readiness, &out)
		}
		if IsIELTSPersonal(timingModel) {
			var readiness IELTSReadinessSignals
			if len(signals) > 0 {
				readiness = signals[0]
			}
			return readyIELTSPersonalSectionInTx(ctx, q, scheduleID, sectionKey, attemptID, actorUserID, readiness, &out, &changed)
		}
		sch, err := LockScheduleRow(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if sch.ProviderKey != "ielts" {
			return apperrors.New(apperrors.CodeConflict, "Cohort readiness is only available for IELTS.")
		}
		if err := LockScheduleAttemptsInTx(ctx, q, scheduleID); err != nil {
			return err
		}
		rt, err := lockRuntime(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		var rawRecovery, proctorStatus string
		if err := q.QueryRowContext(ctx, `SELECT COALESCE(recovery_control,''),COALESCE(proctor_status,'active') FROM student_attempts WHERE id = ? AND schedule_id = ? AND COALESCE(user_id, '') = ? AND submitted_at IS NULL AND COALESCE(delivery_status, 'running') NOT IN ('submitted','terminated','locked','cancelled')`, attemptID, scheduleID, actorUserID).Scan(&rawRecovery, &proctorStatus); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Active student attempt not found.")
			}
			return err
		}
		recovery, err := examdomain.ParseRecoveryControl([]byte(rawRecovery))
		if err != nil {
			return err
		}
		if recovery != nil {
			if recovery.Phase != examdomain.RecoveryPhaseWorking {
				return recoveryRuntimeConflict("RECOVERY_HELD", "Staff recovery has stopped this browser.")
			}
			if rt.Status == StatusPaused || proctorStatus == "paused" {
				return recoveryRuntimeConflict("RECOVERY_PAUSED", "The exam is paused.")
			}
			if rt.Status != StatusLive {
				var reason string
				if err := q.QueryRowContext(ctx, `SELECT COALESCE(completion_reason,'') FROM exam_session_runtimes WHERE id=?`, rt.ID).Scan(&reason); err != nil {
					return err
				}
				if rt.Status != StatusCompleted || reason != "time_expired" {
					return recoveryRuntimeConflict("RECOVERY_CONTROLLED_END", "The exam was ended by staff.")
				}
			}
			_, err := AdvanceSnapshotRecoveryInTx(ctx, q, attemptID, examdomain.ProviderIELTS, sectionKey, recovery, &out, &changed)
			return err
		}
		if rt.ActiveSectionKey == nil || *rt.ActiveSectionKey != sectionKey || (rt.Status != StatusLive && rt.Status != StatusPaused) {
			return apperrors.New(apperrors.CodeConflict, "The exam section has changed. Refresh the exam.")
		}
		var status string
		var start sql.NullTime
		if err := q.QueryRowContext(ctx, `SELECT status, actual_start_at FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE`, rt.ID, sectionKey).Scan(&status, &start); err != nil {
			return err
		}
		if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&out.ServerNow); err != nil {
			return err
		}
		if start.Valid {
			out.StartedAt = &start.Time
			return nil
		}
		if status != SectionLocked && status != SectionLive && status != SectionPaused {
			return apperrors.New(apperrors.CodeConflict, "Section is no longer preparing.")
		}
		// Older clients omit preparation signals. Explicit failures from newer
		// clients must not start the room before even this device is usable.
		prepared := true
		if len(signals) > 0 {
			ready := signals[0]
			prepared = (ready.ContentReady == nil || *ready.ContentReady) &&
				(ready.LocalStorageReady == nil || *ready.LocalStorageReady) &&
				(sectionKey != "listening" || ready.AudioReady == nil || *ready.AudioReady)
		}
		if roundTripMS != nil {
			ms := *roundTripMS
			if ms < 0 || ms > 10000 {
				return apperrors.New(apperrors.CodeValidation, "roundTripMs must be between 0 and 10000.")
			}
			if prepared {
				if _, err := q.ExecContext(ctx, `INSERT INTO ielts_section_readiness (runtime_id, section_key, attempt_id, round_trip_ms) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE round_trip_ms = GREATEST(round_trip_ms, VALUES(round_trip_ms))`, rt.ID, sectionKey, attemptID, ms); err != nil {
					return err
				}
			}
		}
		var maxRTT int
		if err := q.QueryRowContext(ctx, `SELECT COALESCE(SUM(r.attempt_id IS NULL), 0), COALESCE(MAX(r.round_trip_ms), 0)
   FROM student_attempts a LEFT JOIN ielts_section_readiness r ON r.attempt_id = a.id AND r.runtime_id = ? AND r.section_key = ?
   WHERE a.schedule_id = ? AND a.submitted_at IS NULL AND COALESCE(a.delivery_status, 'running') NOT IN ('submitted','terminated','locked','cancelled')`, rt.ID, sectionKey, scheduleID).Scan(&out.RemainingStudents, &maxRTT); err != nil {
			return err
		}
		// Readiness is diagnostic, not an all-student barrier. The first ready
		// device starts the released section's shared clock; reconnecting devices
		// read the same persisted start above without restarting it.
		if roundTripMS == nil || !prepared || rt.Status != StatusLive || status == SectionPaused || proctorStatus == "paused" {
			return nil
		}
		startAt := out.ServerNow.Add(cohortStartLead(maxRTT))
		if _, err := q.ExecContext(ctx, `UPDATE exam_session_runtime_sections SET status = 'live', actual_start_at = ?, paused_at = NULL WHERE runtime_id = ? AND section_key = ? AND actual_start_at IS NULL`, startAt, rt.ID, sectionKey); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `UPDATE exam_session_runtimes SET waiting_for_next_section = false, revision = revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`, rt.ID); err != nil {
			return err
		}
		if err := SyncV2TimingInTx(ctx, q, scheduleID, rt.ID, sectionKey, strptr("running")); err != nil {
			return err
		}
		if err := s.emitRuntimeChanged(ctx, q, scheduleID, rt.Revision+1, "cohort_section_ready"); err != nil {
			return err
		}
		changed = true
		out.StartedAt = &startAt
		return nil
	})
	if err == nil && changed {
		s.invalidated(scheduleID)
	}
	if err == nil && out.activationDelay > 0 {
		telemetry.ObserveSeconds(telemetry.MIELTSSectionActivationDelay, out.activationDelay.Seconds(), "section", sectionKey)
	}
	return out, err
}

// readyIELTSSharedSectionInTx records this device's preparation and returns
// the committed window. It never allocates, re-arms or extends a clock and
// takes no room-wide lock: one device's readiness cannot affect another's.
func readyIELTSSharedSectionInTx(ctx context.Context, q tx.Tx, scheduleID, sectionKey, attemptID, actorUserID string, roundTripMS *int, ready IELTSReadinessSignals, out *CohortReadiness) error {
	var one int
	if err := q.QueryRowContext(ctx, `SELECT 1 FROM student_attempts WHERE id = ? AND schedule_id = ? AND COALESCE(user_id, '') = ? AND submitted_at IS NULL AND COALESCE(delivery_status, 'running') NOT IN ('submitted','terminated','locked','cancelled')`, attemptID, scheduleID, actorUserID).Scan(&one); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Active student attempt not found.")
		}
		return err
	}
	var runtimeID string
	if err := q.QueryRowContext(ctx, `SELECT id FROM exam_session_runtimes WHERE schedule_id = ?`, scheduleID).Scan(&runtimeID); err != nil {
		return err
	}
	schedule, ok, err := LoadIELTSSharedScheduleInTx(ctx, q, runtimeID, "")
	if err != nil {
		return err
	}
	if !ok {
		return apperrors.New(apperrors.CodeConflict, "The IELTS room schedule is missing.")
	}
	window, ok := schedule.WindowFor(sectionKey)
	if !ok {
		return apperrors.New(apperrors.CodeConflict, "The exam section has changed. Refresh the exam.")
	}
	if out.ServerNow, err = dbNowInTx(ctx, q); err != nil {
		return err
	}
	pos, err := ResolveIELTSSharedWindow(schedule, out.ServerNow)
	if err != nil {
		return err
	}
	prepared := readinessSignal(ready.ContentReady) && readinessSignal(ready.LocalStorageReady) &&
		(sectionKey != "listening" || readinessSignal(ready.AudioReady))
	// The shared model has no readiness barrier. A row here means this device
	// proved a usable offline package for the section, which is what the
	// proctor roster reports; ordinary probes do not create rows.
	if readinessSignal(ready.OfflinePackageReady) && prepared {
		ms := 0
		if roundTripMS != nil {
			ms = *roundTripMS
			if ms < 0 || ms > 10000 {
				return apperrors.New(apperrors.CodeValidation, "roundTripMs must be between 0 and 10000.")
			}
		}
		if _, err := q.ExecContext(ctx, `INSERT INTO ielts_section_readiness (runtime_id, section_key, attempt_id, round_trip_ms) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE round_trip_ms = GREATEST(round_trip_ms, VALUES(round_trip_ms)), ready_at = CURRENT_TIMESTAMP(6)`, runtimeID, sectionKey, attemptID, ms); err != nil {
			return err
		}
	}
	start, deadline := window.StartAt, window.DeadlineAt
	out.StartedAt, out.ExpectedStartAt, out.DeadlineAt = &start, &start, &deadline
	out.Status = pos.Kind
	return nil
}

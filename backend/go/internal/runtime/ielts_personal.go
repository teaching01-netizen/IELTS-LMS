package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"github.com/google/uuid"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func readyIELTSPersonalSectionInTx(
	ctx context.Context,
	q tx.Tx,
	scheduleID, sectionKey, attemptID, actorUserID string,
	signals IELTSReadinessSignals,
	out *CohortReadiness,
	changed *bool,
) error {
	sch, err := ShareScheduleRow(ctx, q, scheduleID)
	if err != nil {
		return err
	}
	if sch.ProviderKey != "ielts" {
		return apperrors.New(apperrors.CodeConflict, "Individual section readiness is only available for IELTS.")
	}
	var extraTime int
	var deliveryStatus, proctorStatus, rawRecovery string
	var submitted sql.NullTime
	err = q.QueryRowContext(ctx, `
		SELECT COALESCE(a.delivery_status, 'running'), a.submitted_at,
		       COALESCE(a.proctor_status, 'active'),
		       COALESCE(reg.extra_time_minutes, 0), COALESCE(a.recovery_control,'')
		FROM student_attempts a
		LEFT JOIN schedule_registrations reg ON reg.id = a.registration_id
		WHERE a.id = ? AND a.schedule_id = ? AND COALESCE(a.user_id, '') = ?
		FOR UPDATE`, attemptID, scheduleID, actorUserID).Scan(&deliveryStatus, &submitted, &proctorStatus, &extraTime, &rawRecovery)
	if err == sql.ErrNoRows || (err == nil && (submitted.Valid || deliveryStatus == "submitted" || deliveryStatus == "terminated" || deliveryStatus == "locked" || deliveryStatus == "cancelled")) {
		return apperrors.New(apperrors.CodeNotFound, "Active student attempt not found.")
	}
	if err != nil {
		return err
	}

	var runtimeID, runtimeStatus, timingModel string
	var roomStart sql.NullTime
	var completionReason sql.NullString
	var prepSeconds int
	if err := q.QueryRowContext(ctx, `
		SELECT id, status, COALESCE(timing_model, ''), actual_start_at,
		       completion_reason, ielts_preparation_seconds
		FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE`, scheduleID).
		Scan(&runtimeID, &runtimeStatus, &timingModel, &roomStart, &completionReason, &prepSeconds); err != nil {
		return err
	}
	if !IsIELTSPersonal(timingModel) || !roomStart.Valid {
		return apperrors.New(apperrors.CodeConflict, "The IELTS timing policy is unavailable.")
	}
	if runtimeStatus == StatusCancelled || (runtimeStatus == StatusCompleted && completionReason.String != "time_expired") {
		return apperrors.New(apperrors.CodeConflict, "The exam was ended by an authorised control.")
	}

	recovery, err := examdomain.ParseRecoveryControl([]byte(rawRecovery))
	if err != nil {
		return err
	}
	if recovery != nil {
		_, err := AdvanceIELTSRecoveryInTx(ctx, q, attemptID, sectionKey, proctorStatus, recovery, out, changed)
		return err
	}
	var order, minutes, gapAfter, sectionExtension int
	var actualStart, actualEnd, sectionPausedAt sql.NullTime
	var sectionStatus string
	var accumulatedPaused int
	if err := q.QueryRowContext(ctx, `
		SELECT section_order, planned_duration_minutes, gap_after_minutes, extension_minutes,
		       status, actual_start_at, actual_end_at, paused_at, accumulated_paused_seconds
		FROM exam_session_runtime_sections
		WHERE runtime_id = ? AND section_key = ?`, runtimeID, sectionKey).
		Scan(&order, &minutes, &gapAfter, &sectionExtension, &sectionStatus, &actualStart, &actualEnd, &sectionPausedAt, &accumulatedPaused); err != nil {
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeBadRequest, "This section is not enabled for the exam.")
		}
		return err
	}
	if sectionKey != "listening" && sectionKey != "reading" && sectionKey != "writing" {
		return apperrors.New(apperrors.CodeBadRequest, "This IELTS timing policy supports Listening, Reading, and Writing.")
	}
	if order < 0 || minutes < 0 || sectionExtension < 0 || extraTime < 0 {
		return apperrors.New(apperrors.CodeConflict, "The IELTS section timing is invalid.")
	}
	if prepSeconds < 0 || prepSeconds > 3600 {
		prepSeconds = 120
	}
	if out.ServerNow.IsZero() {
		if err := q.QueryRowContext(ctx, `SELECT UTC_TIMESTAMP(6)`).Scan(&out.ServerNow); err != nil {
			return err
		}
	}
	now := out.ServerNow.UTC()

	expected := time.Time{}
	if order == 0 {
		if !actualStart.Valid {
			return apperrors.New(apperrors.CodeConflict, "The first IELTS section has not opened.")
		}
		expected = actualStart.Time.UTC().Add(time.Duration(accumulatedPaused) * time.Second)
	} else {
		var previousKey, previousState string
		var previousDeadline, previousPausedAt sql.NullTime
		var previousGap int
		if err := q.QueryRowContext(ctx, `
			SELECT prev.section_key, COALESCE(t.state, ''), t.deadline_at, t.paused_at,
			       prev.gap_after_minutes
			FROM exam_session_runtime_sections prev
			LEFT JOIN ielts_attempt_section_timelines t
			  ON t.attempt_id = ? AND t.section_key = prev.section_key
			WHERE prev.runtime_id = ? AND prev.section_order < ?
			ORDER BY prev.section_order DESC LIMIT 1`, attemptID, runtimeID, order).
			Scan(&previousKey, &previousState, &previousDeadline, &previousPausedAt, &previousGap); err != nil {
			return err
		}
		if previousState == "unable" {
			out.Status = "unable"
			out.Message = "Could not start this section because an earlier section could not start. Your saved work is preserved. Contact the proctor for help."
			return nil
		}
		if runtimeStatus == StatusPaused || previousPausedAt.Valid {
			out.Status = "preparing"
			out.Message = "The exam is paused. Preparation time will resume with the exam."
			return nil
		}
		if !previousDeadline.Valid || (previousState != "completed" && previousState != "active") {
			out.Status = "preparing"
			out.Message = "This section will open after the previous section is complete."
			return nil
		}
		expected = previousDeadline.Time.UTC().Add(time.Duration(previousGap) * time.Minute)
		if IsIELTSCohortPersonal(timingModel) && actualStart.Valid && actualStart.Time.UTC().After(expected) {
			expected = actualStart.Time.UTC()
		}
		out.ExpectedStartAt = &expected
		if previousState == "active" {
			if now.Before(previousDeadline.Time.UTC()) {
				out.Status = "preparing"
				out.Message = "This section will open after the previous section is complete."
				return nil
			}
			if _, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines
				SET state = 'completed', finished_at = COALESCE(finished_at, deadline_at),
				    completion_reason = COALESCE(completion_reason, 'time_expired'), revision = revision + 1
				WHERE attempt_id = ? AND section_key = ? AND state = 'active' AND deadline_at <= ?`,
				attemptID, previousKey, now); err != nil {
				return err
			}
		}
		if IsIELTSCohortPersonal(timingModel) && !actualStart.Valid {
			out.Status = "preparing"
			out.Message = "This section will open when the room moves to it. Your previous section time is preserved."
			return nil
		}
	}
	prepDeadline := expected.Add(time.Duration(prepSeconds) * time.Second)
	durationSeconds := (minutes + sectionExtension + extraTime) * 60

	recordDelayedStart := func(startedAt, deadlineAt time.Time) error {
		if !now.After(expected) {
			return nil
		}
		payload, _ := json.Marshal(map[string]any{"sectionKey": sectionKey, "expectedStartAt": expected, "startedAt": startedAt, "deadlineAt": deadlineAt})
		_, err := q.ExecContext(ctx, `INSERT INTO session_audit_logs
			(id, schedule_id, actor, action_type, target_student_id, payload, created_at)
			VALUES (?, ?, 'system:ielts-recovery', 'IELTS_DELAYED_START', ?, ?, UTC_TIMESTAMP(6))`,
			uuid.NewString(), scheduleID, attemptID, string(payload))
		return err
	}

	var state string
	var assignedStart, deadline, storedExpected, storedPreparationDeadline, timelinePausedAt sql.NullTime
	var failure sql.NullString
	createdActive := false
	readTimeline := func() error {
		return q.QueryRowContext(ctx, `
			SELECT state, started_at, deadline_at, expected_start_at,
			       preparation_deadline_at, failure_reason, paused_at
			FROM ielts_attempt_section_timelines
			WHERE attempt_id = ? AND section_key = ? FOR UPDATE`, attemptID, sectionKey).
			Scan(&state, &assignedStart, &deadline, &storedExpected, &storedPreparationDeadline, &failure, &timelinePausedAt)
	}
	// Retries of an existing timeline take the read; only a missing one is
	// inserted. The attempt row is already locked, so a first eligible request
	// can create its final active row directly instead of staging and rewriting
	// a preparing row during a synchronized IELTS readiness wave.
	err = readTimeline()
	if err == sql.ErrNoRows {
		canStartImmediately := durationSeconds > 0 &&
			!now.Before(expected) && now.Before(prepDeadline) &&
			runtimeStatus != StatusPaused && proctorStatus != "paused" &&
			readinessSignal(signals.ContentReady) && readinessSignal(signals.LocalStorageReady) &&
			(sectionKey != "listening" || readinessSignal(signals.AudioReady))
		if canStartImmediately {
			_, err = q.ExecContext(ctx, `
				INSERT INTO ielts_attempt_section_timelines
				(id, attempt_id, runtime_id, section_key, section_order, state, expected_start_at, preparation_deadline_at, started_at, deadline_at, paused_at, revision)
				VALUES (?, ?, ?, ?, ?, 'active', ?, ?, UTC_TIMESTAMP(6), DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND), NULL, 1)`,
				uuid.NewString(), attemptID, runtimeID, sectionKey, order, expected, prepDeadline, durationSeconds)
			if err != nil {
				return err
			}
			createdActive = true
		} else {
			if _, err := q.ExecContext(ctx, `
				INSERT INTO ielts_attempt_section_timelines
				(id, attempt_id, runtime_id, section_key, section_order, state, expected_start_at, preparation_deadline_at, paused_at)
				VALUES (?, ?, ?, ?, ?, 'preparing', ?, ?, CASE WHEN ? = 'paused' OR ? = 'paused' THEN UTC_TIMESTAMP(6) ELSE NULL END)
				ON DUPLICATE KEY UPDATE id = id`,
				uuid.NewString(), attemptID, runtimeID, sectionKey, order, expected, prepDeadline, runtimeStatus, proctorStatus); err != nil {
				return err
			}
		}
		err = readTimeline()
	}
	if err != nil {
		return err
	}
	if storedExpected.Valid {
		v := storedExpected.Time.UTC()
		out.ExpectedStartAt = &v
	}
	if storedPreparationDeadline.Valid {
		v := storedPreparationDeadline.Time.UTC()
		out.PreparationEndsAt = &v
	}
	if state == "completed" {
		out.Status = "completed"
		return nil
	}
	if state == "unable" {
		out.Status = "unable"
		out.Message = "Could not start this section. Your completed work and saved answers are preserved. Contact the proctor for help."
		return nil
	}
	if timelinePausedAt.Valid || proctorStatus == "paused" {
		if state == "active" && assignedStart.Valid && deadline.Valid {
			v, d := assignedStart.Time.UTC(), deadline.Time.UTC()
			out.StartedAt, out.DeadlineAt, out.Status = &v, &d, "active"
		} else {
			out.Status = "preparing"
			out.Message = "The exam is paused. Preparation time will resume with the exam."
		}
		return nil
	}
	if runtimeStatus == StatusPaused {
		if state == "active" && assignedStart.Valid && deadline.Valid {
			v, d := assignedStart.Time.UTC(), deadline.Time.UTC()
			out.StartedAt, out.DeadlineAt, out.Status = &v, &d, "active"
		} else {
			out.Status = "preparing"
			out.Message = "The exam is paused. Preparation time will resume with the exam."
		}
		return nil
	}
	if state == "active" && assignedStart.Valid && deadline.Valid && now.Before(deadline.Time.UTC()) {
		v, d := assignedStart.Time.UTC(), deadline.Time.UTC()
		out.StartedAt, out.DeadlineAt, out.Status = &v, &d, "active"
		if createdActive {
			if err := recordDelayedStart(v, d); err != nil {
				return err
			}
			*changed = true
		}
		return nil
	}
	if state == "active" && deadline.Valid && !now.Before(deadline.Time.UTC()) {
		if _, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines
			SET state = 'completed', finished_at = COALESCE(finished_at, deadline_at),
			    completion_reason = COALESCE(completion_reason, 'time_expired'), revision = revision + 1
			WHERE attempt_id = ? AND section_key = ? AND state = 'active' AND deadline_at <= ?`, attemptID, sectionKey, now); err != nil {
			return err
		}
		out.Status = "completed"
		return nil
	}
	if now.Before(storedExpected.Time.UTC()) {
		out.Status = "preparing"
		out.Message = "This section is not available yet."
		return nil
	}
	if !now.Before(storedPreparationDeadline.Time.UTC()) {
		if _, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines
			SET state = 'unable', failure_reason = 'preparation_expired', revision = revision + 1
			WHERE attempt_id = ? AND section_key = ? AND state = 'preparing'`, attemptID, sectionKey); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{"sectionKey": sectionKey, "reason": "preparation_expired"})
		if _, err := q.ExecContext(ctx, `INSERT INTO session_audit_logs
			(id, schedule_id, actor, action_type, target_student_id, payload, created_at)
			VALUES (?, ?, 'system:ielts-recovery', 'IELTS_PREPARATION_UNABLE', ?, ?, UTC_TIMESTAMP(6))`,
			uuid.NewString(), scheduleID, attemptID, string(payload)); err != nil {
			return err
		}
		out.Status = "unable"
		out.Message = "Could not start this section. Your completed work and saved answers are preserved. Contact the proctor for help."
		*changed = true
		return nil
	}
	if !readinessSignal(signals.ContentReady) || !readinessSignal(signals.LocalStorageReady) || (sectionKey == "listening" && !readinessSignal(signals.AudioReady)) {
		out.Status = "preparing"
		out.Message = "Preparing your section. Keep this page open while it checks your content and answer storage."
		return nil
	}

	if durationSeconds <= 0 {
		return apperrors.New(apperrors.CodeConflict, "The IELTS section has no working time configured.")
	}
	res, err := q.ExecContext(ctx, `UPDATE ielts_attempt_section_timelines
		SET state = 'active', started_at = UTC_TIMESTAMP(6),
		    deadline_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND),
		    revision = revision + 1
		WHERE attempt_id = ? AND section_key = ? AND state = 'preparing' AND paused_at IS NULL`,
		durationSeconds, attemptID, sectionKey)
	if err != nil {
		return err
	}
	activated, err := res.RowsAffected()
	if err != nil {
		return err
	}
	// Both this activation and an already-committed one answer with the
	// persisted database times; a retry never allocates a second duration.
	if err := q.QueryRowContext(ctx, `SELECT started_at, deadline_at FROM ielts_attempt_section_timelines
		WHERE attempt_id = ? AND section_key = ?`, attemptID, sectionKey).Scan(&assignedStart, &deadline); err != nil {
		return err
	}
	if !assignedStart.Valid || !deadline.Valid {
		out.Status = "preparing"
		out.Message = "Preparing your section. Keep this page open while it checks your content and answer storage."
		return nil
	}
	v, d := assignedStart.Time.UTC(), deadline.Time.UTC()
	out.StartedAt, out.DeadlineAt, out.Status = &v, &d, "active"
	if activated == 1 {
		if err := recordDelayedStart(v, d); err != nil {
			return err
		}
		*changed = true
	}
	return nil
}

func readinessSignal(value *bool) bool {
	return value != nil && *value
}

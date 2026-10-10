package proctor

import (
	"context"
	"database/sql"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/satstartcode"
	"example.com/ielts-proctoring/internal/terminalization"
)

// inTxTerminalizer seals on the caller's transaction, so the never-started
// predicate re-checked under the policy and attempt locks is the one sealed.
type inTxTerminalizer interface {
	TerminalizeInTx(ctx context.Context, q tx.Tx, cmd terminalization.SealCommand) (*terminalization.SealResult, error)
}

// expireUnstartedCodeAttempts seals SAT code-start candidates who never
// redeemed the code once their effective start window (schedule ∩ access
// link) has closed or the schedule was cancelled/completed. It runs before the
// drained-personal-runtime selection, and it also covers schedules that never
// had a runtime, so waiting candidates cannot keep a closed room alive.
//
// A temporary pause is not expiry. If a first start commits first the attempt
// is no longer unstarted and this is a no-op; if this commits first, the start
// sees a terminal attempt.
func (s *Service) expireUnstartedCodeAttempts(ctx context.Context, asOf time.Time, limit int64) (int64, error) {
	rows, err := s.selectIDPairs(ctx, `
		SELECT a.id, a.schedule_id
		FROM student_attempts a
		JOIN exam_schedules sch ON sch.id = a.schedule_id
		LEFT JOIN assessment_access_links l ON l.schedule_id = sch.id
		WHERE a.sat_start_code_required = 1
		  AND a.sat_start_code_accepted_at IS NULL
		  AND a.submitted_at IS NULL
		  AND COALESCE(a.delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')
		  AND (sch.status IN ('completed', 'cancelled')
		       OR sch.end_time <= ?
		       OR (l.closes_at IS NOT NULL AND l.closes_at <= ?))
		ORDER BY sch.end_time, a.id
		LIMIT ?`, asOf, asOf, limit)
	if err != nil {
		return 0, err
	}
	var sealed int64
	for _, row := range rows {
		ok, err := s.expireOneUnstartedCodeAttempt(ctx, row[0], row[1])
		if err != nil {
			return sealed, err
		}
		if ok {
			sealed++
		}
	}
	for range sealed {
		telemetry.IncCounter(telemetry.MSATStartCodeExpired)
	}
	return sealed, nil
}

func (s *Service) expireOneUnstartedCodeAttempt(ctx context.Context, attemptID, scheduleID string) (bool, error) {
	sealer, ok := s.seal.(inTxTerminalizer)
	if !ok {
		return false, apperrors.New(apperrors.CodeServiceUnavailable, "Terminalization is unavailable.")
	}
	sealed := false
	err := s.tx.WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
		sealed = false
		// Lock order shared with the first-start transaction:
		// link (S) -> schedule (S) -> attempt (X).
		var linkCloses sql.NullTime
		if err := q.QueryRowContext(ctx, "SELECT closes_at FROM assessment_access_links WHERE schedule_id = ? FOR SHARE", scheduleID).Scan(&linkCloses); err != nil && err != sql.ErrNoRows {
			return err
		}
		sch, err := examruntime.ShareScheduleRow(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		var endTime time.Time
		if err := q.QueryRowContext(ctx, "SELECT end_time FROM exam_schedules WHERE id = ?", scheduleID).Scan(&endTime); err != nil {
			return err
		}
		var required bool
		var acceptedAt, submittedAt sql.NullTime
		var deliveryStatus string
		if err := q.QueryRowContext(ctx,
			"SELECT sat_start_code_required, sat_start_code_accepted_at, submitted_at, COALESCE(delivery_status, 'running') FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
			attemptID, scheduleID).Scan(&required, &acceptedAt, &submittedAt, &deliveryStatus); err != nil {
			if err == sql.ErrNoRows {
				return nil
			}
			return err
		}
		if !required || acceptedAt.Valid || submittedAt.Valid {
			return nil
		}
		switch deliveryStatus {
		case "submitted", "terminated", "locked", "cancelled":
			return nil
		}
		now, err := dbNowTx(ctx, q)
		if err != nil {
			return err
		}
		closes := endTime.UTC()
		if linkCloses.Valid && linkCloses.Time.UTC().Before(closes) {
			closes = linkCloses.Time.UTC()
		}
		closedByLifecycle := sch.Status == "completed" || sch.Status == "cancelled"
		if !closedByLifecycle && now.Before(closes) {
			return nil
		}
		// No module may have started without acceptance; if one did, that is
		// evidence to preserve, not a never-started candidate to erase.
		var started bool
		if err := q.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM assessment_module_attempts WHERE attempt_id = ? AND started_at IS NOT NULL)", attemptID).Scan(&started); err != nil {
			return err
		}
		if started {
			return apperrors.New(apperrors.CodeTerminalInvariant, "A SAT code-start attempt has a started module without acceptance.")
		}
		actor := systemActor
		if _, err := sealer.TerminalizeInTx(ctx, q, terminalization.SealCommand{
			AttemptID:  attemptID,
			ScheduleID: scheduleID,
			Outcome:    terminalization.OutcomeTerminated,
			Reason:     terminalization.ReasonStartWindowClosed,
			ActorKind:  terminalization.ActorSystem,
			ActorID:    &actor,
			RequestID:  uuid.NewString(),
		}); err != nil {
			return err
		}
		if err := satstartcode.AuditTx(ctx, q, scheduleID, systemActor, satstartcode.AuditStartExpired, &attemptID, map[string]any{
			"closesAt": closes, "effectiveAt": now, "scheduleStatus": sch.Status,
		}); err != nil {
			return err
		}
		sealed = true
		return nil
	})
	return sealed, err
}

// closeExpiredCodeSchedulesWithoutRuntime completes a code-start schedule
// whose window closed with no runtime ever opened and no open attempt left.
// It never fabricates a live runtime just to complete it.
func (s *Service) closeExpiredCodeSchedulesWithoutRuntime(ctx context.Context, asOf time.Time, limit int64) error {
	rows, err := s.selectIDPairs(ctx, `
		SELECT sch.id, ''
		FROM exam_schedules sch
		WHERE sch.sat_start_mode = 'access_code'
		  AND sch.status = 'scheduled'
		  AND sch.end_time <= ?
		  AND NOT EXISTS (SELECT 1 FROM exam_session_runtimes r WHERE r.schedule_id = sch.id)
		ORDER BY sch.end_time, sch.id
		LIMIT ?`, asOf, limit)
	if err != nil {
		return err
	}
	for _, row := range rows {
		scheduleID := row[0]
		if err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
			sch, err := examruntime.LockScheduleRow(ctx, q, scheduleID)
			if err != nil {
				return err
			}
			if sch.Status != "scheduled" || sch.SatStartMode != examruntime.SatStartModeAccessCode {
				return nil
			}
			var endTime time.Time
			var open, hasRuntime bool
			if err := q.QueryRowContext(ctx, "SELECT end_time FROM exam_schedules WHERE id = ?", scheduleID).Scan(&endTime); err != nil {
				return err
			}
			now, err := dbNowTx(ctx, q)
			if err != nil {
				return err
			}
			if now.Before(endTime.UTC()) {
				return nil
			}
			if err := q.QueryRowContext(ctx, `SELECT
				EXISTS(SELECT 1 FROM student_attempts WHERE schedule_id = ? AND submitted_at IS NULL
				       AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')),
				EXISTS(SELECT 1 FROM exam_session_runtimes WHERE schedule_id = ?)`, scheduleID, scheduleID).Scan(&open, &hasRuntime); err != nil {
				return err
			}
			if open || hasRuntime {
				return nil
			}
			if _, err := q.ExecContext(ctx, "UPDATE exam_schedules SET status = 'completed', updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND status = 'scheduled'", scheduleID); err != nil {
				return err
			}
			return insertAuditLog(ctx, q, scheduleID, systemActor, "SESSION_END", nil, map[string]any{
				"reason": "start_window_closed_never_opened", "effectiveAt": now,
			})
		}); err != nil {
			return err
		}
	}
	return nil
}

func dbNowTx(ctx context.Context, q tx.Tx) (time.Time, error) {
	var now time.Time
	if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return time.Time{}, err
	}
	return now.UTC(), nil
}

// selectIDPairs runs a candidate scan in its own short read transaction and
// returns the first two string columns of each row.
func (s *Service) selectIDPairs(ctx context.Context, query string, args ...any) ([][2]string, error) {
	var out [][2]string
	err := s.tx.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		out = out[:0]
		rows, err := q.QueryContext(ctx, query, args...)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var pair [2]string
			if err := rows.Scan(&pair[0], &pair[1]); err != nil {
				return err
			}
			out = append(out, pair)
		}
		return rows.Err()
	})
	return out, err
}

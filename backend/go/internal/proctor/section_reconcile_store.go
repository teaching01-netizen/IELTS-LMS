package proctor

// Section-reconcile store: the locked reads and the handover enqueue the
// reconciler drives. Keeping the SQL here (instead of inside the state machine
// file) is what lets planSectionAdvance stay a pure function over the rows;
// the effects and the planner live in reconcile.go.

import (
	"context"
	"database/sql"
	"encoding/json"

	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// enqueueSectionAttemptReconcile hands the finished section's open module
// attempts to the delivery reconciler through the durable outbox (see
// applySectionAdvance for why the boundary is the outbox).
func (s *Service) enqueueSectionAttemptReconcile(ctx context.Context, q tx.Tx, scheduleID, sectionKey string, revision int64, origin string) error {
	rows, err := q.QueryContext(ctx, `
		SELECT ma.attempt_id
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN student_attempts a ON a.id = ma.attempt_id
		WHERE a.schedule_id = ?
		  AND s.section_key = ?
		  AND ma.state IN ('not_started', 'active', 'review')
		GROUP BY ma.attempt_id
		ORDER BY ma.attempt_id`, scheduleID, sectionKey)
	if err != nil {
		return err
	}
	attemptIDs, err := collectIDs(rows)
	if err != nil {
		return err
	}
	if len(attemptIDs) == 0 {
		return nil
	}
	payload, err := json.Marshal(map[string]any{
		"scheduleId": scheduleID,
		"sectionKey": sectionKey,
		"attemptIds": attemptIDs,
		"reason":     "section_ended",
		"origin":     origin,
	})
	if err != nil {
		return err
	}
	return s.outbx.EnqueueInTx(ctx, q, "schedule", scheduleID, revision, outbox.FamilySectionAttemptsReconcile, payload)
}

// currentRuntimeRevision reads the runtime row's revision as it stands inside
// the caller's transaction. Every outbox or wakeup enqueue that names a
// runtime revision reads it here, after the write, instead of predicting how
// many bumps the executor will make — so adding a write cannot silently
// desynchronize the revision the worker reports.
func currentRuntimeRevision(ctx context.Context, q tx.Tx, runtimeID string) (int64, error) {
	var revision int64
	err := q.QueryRowContext(ctx, "SELECT revision FROM exam_session_runtimes WHERE id = ?", runtimeID).Scan(&revision)
	return revision, err
}

// openSectionModuleAttempts counts the module attempts of one section that are
// still non-terminal, i.e. whose adaptive routing decision may not have been
// made yet. It gates the proctor's short-cut of the between-sections break
// (plan §5.1): the successor may only open once nothing from the finished
// section is still in flight.
func openSectionModuleAttempts(ctx context.Context, q tx.Tx, scheduleID, sectionKey string) (int64, error) {
	var open int64
	err := q.QueryRowContext(ctx, `
		SELECT COUNT(DISTINCT ma.attempt_id)
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN student_attempts a ON a.id = ma.attempt_id
		WHERE a.schedule_id = ?
		  AND s.section_key = ?
		  AND ma.state IN ('not_started', 'active', 'review')`, scheduleID, sectionKey).Scan(&open)
	return open, err
}

// lockReconcileRuntime locks the schedule's runtime row after the attempt rows
// (lock order: attempts -> runtime -> sections, matching manual proctor
// commands and terminalization).
func lockReconcileRuntime(ctx context.Context, q tx.Tx, scheduleID string) (*reconcileRuntime, error) {
	const sel = "SELECT id, status, active_section_key, waiting_for_next_section, is_overrun, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE"
	var runtime reconcileRuntime
	var active sql.NullString
	var waiting, overrun sql.NullBool
	if err := q.QueryRowContext(ctx, sel, scheduleID).Scan(&runtime.id, &runtime.status, &active, &waiting, &overrun, &runtime.revision); err != nil {
		if err == sql.ErrNoRows {
			return nil, &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Runtime not found.", HTTPStatus: 404}
		}
		return nil, err
	}
	if active.Valid {
		value := active.String
		runtime.activeSectionKey = &value
	}
	runtime.waiting = waiting.Valid && waiting.Bool
	runtime.overrun = overrun.Valid && overrun.Bool
	return &runtime, nil
}

// lockAllScheduleAttempts locks every attempt of the schedule so the
// reconciler's per-attempt finalization (via the outbox, later) cannot race a
// submit that is mid-transaction.
func lockAllScheduleAttempts(ctx context.Context, q tx.Tx, scheduleID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT id FROM student_attempts WHERE schedule_id = ? ORDER BY id FOR UPDATE", scheduleID)
	if err != nil {
		return nil, err
	}
	return collectIDs(rows)
}

// pendingScheduleAttemptIDs lists the attempts that still need auto-submit,
// locked in the same transaction as the runtime completion.
func pendingScheduleAttemptIDs(ctx context.Context, q tx.Tx, scheduleID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id FROM student_attempts
		WHERE schedule_id = ? AND submitted_at IS NULL
		ORDER BY id FOR UPDATE`, scheduleID)
	if err != nil {
		return nil, err
	}
	return collectIDs(rows)
}

// lockRuntimeSections locks every section row of one runtime, in display
// order, so the planner sees a stable timeline.
func lockRuntimeSections(ctx context.Context, q tx.Tx, runtimeID string) ([]runtimeSection, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT section_key, section_order, planned_duration_minutes, gap_after_minutes, status,
			actual_start_at, actual_end_at, paused_at, extension_minutes, accumulated_paused_seconds
		FROM exam_session_runtime_sections
		WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE`, runtimeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []runtimeSection
	for rows.Next() {
		var section runtimeSection
		var startedAt, endedAt, pausedAt sql.NullTime
		if err := rows.Scan(&section.key, &section.order, &section.planned, &section.gap, &section.status, &startedAt, &endedAt, &pausedAt, &section.extension, &section.pausedSeconds); err != nil {
			return nil, err
		}
		if startedAt.Valid {
			v := startedAt.Time.UTC()
			section.startedAt = &v
		}
		if endedAt.Valid {
			v := endedAt.Time.UTC()
			section.endedAt = &v
		}
		if pausedAt.Valid {
			v := pausedAt.Time.UTC()
			section.pausedAt = &v
		}
		out = append(out, section)
	}
	return out, rows.Err()
}

// nextLockedSection finds the first locked successor of the active section.
func nextLockedSection(sections []runtimeSection, activeIndex int) int {
	for i := activeIndex + 1; i < len(sections); i++ {
		if sections[i].status == "locked" {
			return i
		}
	}
	return -1
}

// collectIDs drains a single-column id result set (always closing it).
func collectIDs(rows *sql.Rows) ([]string, error) {
	defer rows.Close()
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

package proctor

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// AutoAdvanceOutcome identifies one schedule whose authoritative runtime
// moved because its active section passed the server-side closing grace.
type AutoAdvanceOutcome struct {
	ScheduleID      string
	RuntimeRevision int64
}

type runtimeSection struct {
	key           string
	order         int64
	planned       int64
	status        string
	startedAt     *time.Time
	pausedAt      *time.Time
	extension     int64
	pausedSeconds int64
}

type reconcileRuntime struct {
	id               string
	status           string
	activeSectionKey *string
	revision         int64
}

// ReconcileExpiredSections advances live runtime sections whose database-clock
// deadline plus the 30-second closing grace has elapsed. Each schedule is
// reconciled in its own transaction so one slow or contended cohort does not
// hold the candidate scan open. The lock order remains attempts -> runtime ->
// sections, matching manual proctor commands and terminalization.
func (s *Service) ReconcileExpiredSections(ctx context.Context, asOf time.Time, limit int64, origin string) ([]AutoAdvanceOutcome, error) {
	if limit < 1 {
		limit = 250
	}
	asOf = asOf.UTC()
	if origin == "" {
		origin = "runtime-reconciler"
	}

	candidates := make([]string, 0)
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		rows, err := q.QueryContext(ctx, `
			SELECT r.schedule_id
			FROM exam_session_runtimes r
			JOIN exam_session_runtime_sections rs
			  ON rs.runtime_id = r.id
			 AND rs.section_key = r.active_section_key
			JOIN exam_schedules sch ON sch.id = r.schedule_id
			JOIN exam_versions v ON v.id = sch.published_version_id
			WHERE r.status = 'live'
			  AND r.active_section_key IS NOT NULL
			  AND rs.status = 'live'
			  AND rs.actual_start_at IS NOT NULL
			  AND rs.paused_at IS NULL
			  AND COALESCE(
					JSON_UNQUOTE(JSON_EXTRACT(v.config_snapshot, '$.progression.autoSubmit')),
					'true'
				  ) = 'true'
			  AND ? >= DATE_ADD(
					rs.actual_start_at,
					INTERVAL ((rs.planned_duration_minutes + rs.extension_minutes) * 60 + rs.accumulated_paused_seconds + 30) SECOND
				  )
			ORDER BY rs.actual_start_at ASC
			LIMIT ?`, asOf, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var scheduleID string
			if err := rows.Scan(&scheduleID); err != nil {
				return err
			}
			candidates = append(candidates, scheduleID)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	outcomes := make([]AutoAdvanceOutcome, 0, len(candidates))
	for _, scheduleID := range candidates {
		revision, err := s.reconcileExpiredSchedule(ctx, scheduleID, asOf, origin)
		if err != nil {
			return outcomes, err
		}
		if revision != nil {
			outcomes = append(outcomes, AutoAdvanceOutcome{ScheduleID: scheduleID, RuntimeRevision: *revision})
		}
	}
	return outcomes, nil
}

func (s *Service) reconcileExpiredSchedule(ctx context.Context, scheduleID string, asOf time.Time, origin string) (*int64, error) {
	var runtimeRevision *int64
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if _, err := lockAllScheduleAttempts(ctx, q, scheduleID); err != nil {
			return err
		}
		runtime, err := lockReconcileRuntime(ctx, q, scheduleID)
		if err != nil {
			if e, ok := apperrors.As(err); ok && e.Code == apperrors.CodeNotFound {
				return nil
			}
			return err
		}
		if runtime.status != "live" || runtime.activeSectionKey == nil || *runtime.activeSectionKey == "" {
			return nil
		}

		sections, err := lockRuntimeSections(ctx, q, runtime.id)
		if err != nil {
			return err
		}
		activeIndex := -1
		for i := range sections {
			if sections[i].key == *runtime.activeSectionKey {
				activeIndex = i
				break
			}
		}
		if activeIndex < 0 {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Active section row is missing.", HTTPStatus: 409}
		}

		transitionCount := int64(0)
		activeKey := *runtime.activeSectionKey
		for {
			active := &sections[activeIndex]
			if active.status != "live" || active.pausedAt != nil || active.startedAt == nil {
				break
			}
			deadline := active.startedAt.Add(time.Duration(active.planned+active.extension) * time.Minute).Add(time.Duration(active.pausedSeconds) * time.Second)
			if asOf.Before(deadline.Add(30 * time.Second)) {
				break
			}

			effectiveAt := deadline
			if _, err := q.ExecContext(ctx, `
				UPDATE exam_session_runtime_sections
				SET status = 'completed', actual_end_at = ?, completion_reason = 'time_expired', paused_at = NULL
				WHERE runtime_id = ? AND section_key = ?`, effectiveAt, runtime.id, activeKey); err != nil {
				return err
			}
			if err := insertAuditLog(ctx, q, scheduleID, "system", "SECTION_END", nil, map[string]any{
				"sectionKey": activeKey, "reason": "time_expired", "effectiveAt": effectiveAt,
			}); err != nil {
				return err
			}

			transitionCount++
			nextIndex := nextLockedSection(sections, activeIndex)
			if nextIndex < 0 {
				if _, err := q.ExecContext(ctx, `
					UPDATE exam_session_runtimes
					SET status = 'completed', actual_end_at = ?, active_section_key = NULL,
						current_section_key = NULL, current_section_remaining_seconds = 0,
						waiting_for_next_section = false, updated_at = UTC_TIMESTAMP(6), revision = revision + 1
					WHERE id = ?`, effectiveAt, runtime.id); err != nil {
					return err
				}
				if _, err := q.ExecContext(ctx, `
					UPDATE exam_schedules
					SET status = 'completed', updated_at = UTC_TIMESTAMP(6), revision = revision + 1
					WHERE id = ?`, scheduleID); err != nil {
					return err
				}
				attemptIDs, err := pendingScheduleAttemptIDs(ctx, q, scheduleID)
				if err != nil {
					return err
				}
				payload, err := json.Marshal(map[string]any{
					"scheduleId": scheduleID,
					"attemptIds": attemptIDs,
					"reason":     "time_expired",
					"origin":     origin,
				})
				if err != nil {
					return err
				}
				if err := s.outbx.EnqueueInTx(ctx, q, "schedule", scheduleID, runtime.revision+transitionCount, outbox.FamilyAutoSubmitScheduleAttempts, payload); err != nil {
					return err
				}
				if err := insertAuditLog(ctx, q, scheduleID, "system", "SESSION_END", nil, map[string]any{
					"reason": "time_expired", "effectiveAt": effectiveAt,
				}); err != nil {
					return err
				}
				payload, _ = json.Marshal(map[string]any{
					"scheduleId": scheduleID, "event": "auto_advance_section", "origin": origin,
				})
				if err := s.outbx.EnqueueInTx(ctx, q, "schedule_runtime", scheduleID, runtime.revision+transitionCount, outbox.FamilyRuntimeChanged, payload); err != nil {
					return err
				}
				break
			}

			next := &sections[nextIndex]
			nextDuration := next.planned + next.extension
			if _, err := q.ExecContext(ctx, `
				UPDATE exam_session_runtime_sections
				SET status = 'live', available_at = COALESCE(available_at, ?), actual_start_at = COALESCE(actual_start_at, ?)
				WHERE runtime_id = ? AND section_key = ?`, effectiveAt, effectiveAt, runtime.id, next.key); err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, `
				UPDATE exam_session_runtimes
				SET active_section_key = ?, current_section_key = ?, current_section_remaining_seconds = ?,
					waiting_for_next_section = false, updated_at = UTC_TIMESTAMP(6), revision = revision + 1
					WHERE id = ?`, next.key, next.key, nextDuration*60, runtime.id); err != nil {
				return err
			}
			if err := syncV2(ctx, q, scheduleID, runtime.id, next.key, strptr("running")); err != nil {
				return err
			}
			if err := insertAuditLog(ctx, q, scheduleID, "system", "SECTION_START", nil, map[string]any{
				"sectionKey": next.key, "effectiveAt": effectiveAt,
			}); err != nil {
				return err
			}
			payload, _ := json.Marshal(map[string]any{
				"scheduleId": scheduleID, "event": "auto_advance_section", "origin": origin,
			})
			if err := s.outbx.EnqueueInTx(ctx, q, "schedule_runtime", scheduleID, runtime.revision+transitionCount, outbox.FamilyRuntimeChanged, payload); err != nil {
				return err
			}

			active.status = "completed"
			next.status = "live"
			next.startedAt = &effectiveAt
			activeIndex = nextIndex
			activeKey = next.key
		}
		if transitionCount > 0 {
			v := runtime.revision + transitionCount
			runtimeRevision = &v
		}
		return nil
	})
	return runtimeRevision, err
}

func lockReconcileRuntime(ctx context.Context, q tx.Tx, scheduleID string) (*reconcileRuntime, error) {
	const sel = "SELECT id, status, active_section_key, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE"
	var runtime reconcileRuntime
	var active sql.NullString
	if err := q.QueryRowContext(ctx, sel, scheduleID).Scan(&runtime.id, &runtime.status, &active, &runtime.revision); err != nil {
		if err == sql.ErrNoRows {
			return nil, &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Runtime not found.", HTTPStatus: 404}
		}
		return nil, err
	}
	if active.Valid {
		value := active.String
		runtime.activeSectionKey = &value
	}
	return &runtime, nil
}

func lockAllScheduleAttempts(ctx context.Context, q tx.Tx, scheduleID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, "SELECT id FROM student_attempts WHERE schedule_id = ? ORDER BY id FOR UPDATE", scheduleID)
	if err != nil {
		return nil, err
	}
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

func pendingScheduleAttemptIDs(ctx context.Context, q tx.Tx, scheduleID string) ([]string, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id FROM student_attempts
		WHERE schedule_id = ? AND submitted_at IS NULL
		ORDER BY id FOR UPDATE`, scheduleID)
	if err != nil {
		return nil, err
	}
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

func lockRuntimeSections(ctx context.Context, q tx.Tx, runtimeID string) ([]runtimeSection, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT section_key, section_order, planned_duration_minutes, status,
			actual_start_at, paused_at, extension_minutes, accumulated_paused_seconds
		FROM exam_session_runtime_sections
		WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE`, runtimeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []runtimeSection
	for rows.Next() {
		var section runtimeSection
		var startedAt, pausedAt sql.NullTime
		if err := rows.Scan(&section.key, &section.order, &section.planned, &section.status, &startedAt, &pausedAt, &section.extension, &section.pausedSeconds); err != nil {
			return nil, err
		}
		if startedAt.Valid {
			v := startedAt.Time.UTC()
			section.startedAt = &v
		}
		if pausedAt.Valid {
			v := pausedAt.Time.UTC()
			section.pausedAt = &v
		}
		out = append(out, section)
	}
	return out, rows.Err()
}

func nextLockedSection(sections []runtimeSection, activeIndex int) int {
	for i := activeIndex + 1; i < len(sections); i++ {
		if sections[i].status == "locked" {
			return i
		}
	}
	return -1
}

package maintenance

import (
	"context"
	"database/sql"
	"time"
)

// Each projection stream resumes at its own cursor. The shared watermark is
// telemetry, and must not skip a schedule backlog when attempts advance first.
func projectionPosition(cursor *Cursor, since time.Time) (time.Time, string) {
	if cursor != nil {
		return cursor.UpdatedAt, cursor.ID
	}
	return since, ""
}

// HasPendingGradingProjection checks eligible source rows rather than clock
// lag or the human grading queue, which can remain pending while the app sleeps.
func HasPendingGradingProjection(ctx context.Context, db *sql.DB) (bool, error) {
	state, _, err := loadProjectionState(ctx, db)
	if err != nil {
		return false, err
	}
	since := time.Now().UTC().Add(-ProjectionBootstrapHours * time.Hour)
	if state.Watermark != nil {
		since = *state.Watermark
	}
	scheduleAt, scheduleID := projectionPosition(state.ScheduleCursor, since)
	attemptAt, attemptID := projectionPosition(state.AttemptCursor, since)
	var pending bool
	err = db.QueryRowContext(ctx, `SELECT
		EXISTS(SELECT 1 FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id
			WHERE e.provider_key = 'ielts' AND (s.updated_at > ? OR (s.updated_at = ? AND s.id > ?)))
		OR EXISTS(SELECT 1 FROM student_attempts a
			JOIN exam_schedules s ON s.id = a.schedule_id
			JOIN exam_entities e ON e.id = a.exam_id
			JOIN exam_versions v ON v.id = a.published_version_id
			WHERE a.submitted_at IS NOT NULL AND e.provider_key = 'ielts'
			AND (a.updated_at > ? OR (a.updated_at = ? AND a.id > ?)))`,
		scheduleAt, scheduleAt, scheduleID, attemptAt, attemptAt, attemptID).Scan(&pending)
	return pending, err
}

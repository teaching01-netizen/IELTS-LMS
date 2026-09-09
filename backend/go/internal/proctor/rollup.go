package proctor

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// RollupKey prefixes the shared-cache row holding one schedule's proctor
// rollup (plan D4: reuse shared_cache_entries, no migration).
func RollupKey(scheduleID string) string { return "proctor-rollup:" + scheduleID }

// ProctorRollup is the dashboard header projection: per-status attempt
// counts + freshness. Staleness is bounded by the worker refresh cadence
// and displayed as UpdatedAgoSecs ("updated Xs ago").
type ProctorRollup struct {
	ScheduleID   string         `json:"scheduleId"`
	ByStatus     map[string]int64 `json:"byStatus"`
	Total        int64          `json:"total"`
	Revision     int64          `json:"revision"`
	UpdatedAt    time.Time      `json:"updatedAt"`
	UpdatedAgoSecs int64        `json:"updatedAgoSecs"`
}

// LiveScheduleIDs lists live-schedule ids for the D4 worker refresh (one
// indexed status scan; schedules table is tiny).
func (s *Service) LiveScheduleIDs(ctx context.Context) ([]string, error) {
	q, err := s.sessionDB()
	if err != nil {
		return nil, err
	}
	rows, err := q.QueryContext(ctx, `SELECT id FROM exam_schedules WHERE status = 'live'`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// rollupWriter is the write half RefreshRollup needs (sessionQuerier is
// read-only by design; *sql.DB satisfies both).
type rollupWriter interface {
	sessionQuerier
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// RefreshRollup recomputes one schedule's rollup from a single GROUP BY and
// upserts the shared-cache row (revision+1). The worker runs this every 5s
// per live schedule under ROLLUP=on. Counts key on delivery_status
// (COALESCE running) so terminal/running split matches the roster view.
func (s *Service) RefreshRollup(ctx context.Context, scheduleID string) (ProctorRollup, error) {
	q, err := s.sessionDB()
	if err != nil {
		return ProctorRollup{}, err
	}
	w, ok := q.(rollupWriter)
	if !ok {
		return ProctorRollup{}, apperrors.New(apperrors.CodeServiceUnavailable, "Proctor rollup writes are unavailable.")
	}
	rows, err := q.QueryContext(ctx,
		`SELECT COALESCE(delivery_status,'running'), COUNT(*) FROM student_attempts WHERE schedule_id = ? GROUP BY COALESCE(delivery_status,'running')`,
		scheduleID)
	if err != nil {
		return ProctorRollup{}, err
	}
	defer rows.Close()
	byStatus := map[string]int64{}
	var total int64
	for rows.Next() {
		var status string
		var n int64
		if err := rows.Scan(&status, &n); err != nil {
			rows.Close()
			return ProctorRollup{}, err
		}
		byStatus[status] = n
		total += n
	}
	if err := rows.Err(); err != nil {
		return ProctorRollup{}, err
	}
	payload, err := json.Marshal(byStatus)
	if err != nil {
		return ProctorRollup{}, err
	}
	var rev int64
	if err := q.QueryRowContext(ctx,
		`SELECT revision FROM shared_cache_entries WHERE cache_key = ?`, RollupKey(scheduleID)).Scan(&rev); err != nil && err != sql.ErrNoRows {
		return ProctorRollup{}, err
	}
	if _, err := w.ExecContext(ctx,
		`INSERT INTO shared_cache_entries (cache_key, payload, revision, updated_at) VALUES (?, ?, ?, UTC_TIMESTAMP(6)) ON DUPLICATE KEY UPDATE payload = VALUES(payload), revision = revision + 1, updated_at = UTC_TIMESTAMP(6)`,
		RollupKey(scheduleID), string(payload), rev+1); err != nil {
		return ProctorRollup{}, err
	}
	now := time.Now().UTC()
	telemetry.IncCounter(telemetry.MRollupRefresh)
	telemetry.SetGauge(telemetry.MRollupLag, 0)
	return ProctorRollup{ScheduleID: scheduleID, ByStatus: byStatus, Total: total, Revision: rev + 1, UpdatedAt: now}, nil
}

// LoadRollup reads the 1-row dashboard header (dashboard poll fast path).
// Misses surface sql.ErrNoRows so callers fall back to the full roster.
func (s *Service) LoadRollup(ctx context.Context, scheduleID string) (ProctorRollup, error) {
	q, err := s.sessionDB()
	if err != nil {
		return ProctorRollup{}, err
	}
	var payload string
	var rev int64
	var updatedAt sql.NullTime
	if err := q.QueryRowContext(ctx,
		`SELECT CAST(payload AS CHAR), revision, updated_at FROM shared_cache_entries WHERE cache_key = ?`,
		RollupKey(scheduleID)).Scan(&payload, &rev, &updatedAt); err != nil {
		return ProctorRollup{}, err
	}
	byStatus := map[string]int64{}
	if strings.TrimSpace(payload) != "" {
		if err := json.Unmarshal([]byte(payload), &byStatus); err != nil {
			return ProctorRollup{}, err
		}
	}
	var total int64
	for _, n := range byStatus {
		total += n
	}
	now := time.Now().UTC()
	var updated time.Time
	if updatedAt.Valid {
		updated = updatedAt.Time.UTC()
	}
	ago := int64(now.Sub(updated).Seconds())
	if ago < 0 {
		ago = 0
	}
	telemetry.SetGauge(telemetry.MRollupLag, float64(ago))
	return ProctorRollup{ScheduleID: scheduleID, ByStatus: byStatus, Total: total, Revision: rev, UpdatedAt: updated, UpdatedAgoSecs: ago}, nil
}

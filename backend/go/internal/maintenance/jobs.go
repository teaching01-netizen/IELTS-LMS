// Package maintenance owns worker background jobs for the Go backend.
//
// Cycle (mirrors backend/crates/worker/src/main.rs + jobs/*):
// tick 1s; the outbox/projection cycle runs every
// min(worker fallback interval default 10s, grading projection interval
// default 5s); each pass drains the outbox until empty (<= 20 claim batches
// of 100), then repairs SAT provisional completions (250) and runs the
// grading projection. Maintenance runs every 300s (floored at 60s):
// retention + media + invariant audit, with the grading projection
// checkpoint shared separately.
//
// Retention (batch 1000): shared cache entries past grace (24h, tightened by
// storage budget), idempotency rows (usable 72h / submit 30d / violation 180d
// plus 24h grace), user sessions (30d revoked-or-expired), heartbeats (7d on
// non-live schedules), mutations (30d on terminal schedules), published
// outbox rows (72h), distributed rate counters, live events (72h).
//
// Media: pending uploads older than 24h become orphaned; rows with
// delete_after_at < NOW() are deleted; both bounded to batch 1000.
// Finalized download URLs are normalized in a separate resumable pass so old
// Rust rows remain readable while the migration drains.
//
// Grading projection: gated by GradingProjectionEnabled; idempotent sync of
// schedule/submission/section/writing rows with a durable checkpoint in
// shared_cache_entries under key grading_projection_state_v1 via revision
// compare-and-swap; bootstrap looks back 24h when no watermark exists;
// batch 500.
package maintenance

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"

	"example.com/ielts-proctoring/internal/grading"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Tunables mirror the Rust worker defaults.
const (
	TickInterval              = 1 * time.Second
	FallbackInterval          = 10 * time.Second
	ProjectionInterval        = 5 * time.Second
	MaintenanceInterval       = 300 * time.Second
	MaintenanceIntervalFloor  = 60 * time.Second
	OutboxDrainMaxRounds      = 20
	OutboxClaimLimit          = 100
	OutboxClaimLeaseSecs      = 60
	SATRepairBatch            = 250
	ACTRepairBatch            = 250
	RetentionBatch            = 1000
	MediaBatch                = 1000
	ProjectionBatch           = 500
	ProjectionCheckpointKey   = "grading_projection_state_v1"
	ProjectionBootstrapHours  = 24
	CacheGraceHours           = 24
	IdempotencyUsableHours    = 72
	IdempotencySubmitHours    = 24 * 30
	IdempotencyViolationHours = 24 * 180
	IdempotencyGraceHours     = 24
	UserSessionRetentionDays  = 30
	HeartbeatRetentionDays    = 7
	MutationRetentionDays     = 30
	OutboxRetentionHours      = 72
	LiveEventRetentionHours   = 72
)

// StorageBudget tightens retention under disk pressure (mirrors the Rust
// StorageBudgetLevel): higher pressure raises batch sizes and drops the
// shared-cache grace to zero.
type StorageBudget int

const (
	BudgetNormal StorageBudget = iota
	BudgetWarning
	BudgetHighWater
	BudgetCritical
)

// RetentionBatchSize scales the batch limit with budget pressure.
func RetentionBatchSize(base int64, b StorageBudget) int64 {
	if base < 1 {
		base = RetentionBatch
	}
	switch b {
	case BudgetHighWater:
		return base * 2
	case BudgetCritical:
		return base * 5
	default:
		return base
	}
}

// CacheGraceForBudget tightens the shared-cache grace under pressure.
func CacheGraceForBudget(b StorageBudget) int64 {
	switch b {
	case BudgetNormal:
		return CacheGraceHours
	case BudgetWarning:
		return 1
	default:
		return 0
	}
}

// RetentionReport counts one maintenance retention pass.
type RetentionReport struct {
	CacheRows          int64 `json:"cacheRows"`
	IdempotencyRows    int64 `json:"idempotencyRows"`
	AuthoringOpKeyRows int64 `json:"authoringOpKeyRows"`
	UserSessionRows    int64 `json:"userSessionRows"`
	HeartbeatRows      int64 `json:"heartbeatRows"`
	MutationRows       int64 `json:"mutationRows"`
	OutboxRows         int64 `json:"outboxRows"`
	RateLimitRows      int64 `json:"rateLimitRows"`
	LiveUpdateRows     int64 `json:"liveUpdateRows"`
	// LeaseRows counts purged leftover websocket leases (plan C2: memory
	// mode stops writing per-conn rows; retention reaps the leftovers).
	LeaseRows int64 `json:"leaseRows"`
}

// Total sums a retention pass.
func (r RetentionReport) Total() int64 {
	return r.CacheRows + r.IdempotencyRows + r.AuthoringOpKeyRows + r.UserSessionRows + r.HeartbeatRows +
		r.MutationRows + r.OutboxRows + r.RateLimitRows + r.LiveUpdateRows + r.LeaseRows
}

// RunRetention executes the retention pass, bounded per table.
func RunRetention(ctx context.Context, db *sql.DB, budget StorageBudget) (RetentionReport, error) {
	var rep RetentionReport
	batch := RetentionBatchSize(RetentionBatch, budget)
	grace := CacheGraceForBudget(budget)
	exec := func(query string, args ...any) (int64, error) {
		res, err := db.ExecContext(ctx, query, args...)
		if err != nil {
			if isMissingTable(err) {
				return 0, nil
			}
			return 0, err
		}
		n, _ := res.RowsAffected()
		return n, nil
	}
	var err error
	// Shared cache: invalidated or expired past grace, oldest first.
	rep.CacheRows, err = exec(`
		DELETE FROM shared_cache_entries
		WHERE cache_key IN (
			SELECT cache_key FROM (
				SELECT cache_key FROM shared_cache_entries
				WHERE (invalidated_at IS NOT NULL AND invalidated_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
				   OR (expires_at IS NOT NULL AND expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR))
				ORDER BY COALESCE(invalidated_at, expires_at) ASC
				LIMIT ?
			) AS doomed
		)`, grace, grace, batch)
	if err != nil {
		return rep, err
	}
	// Idempotency: usable windows (72h default / 30d submit / 180d violation)
	// are encoded in each row's expires_at at write time, so one grace-bound
	// sweep (24h past expiry) covers all routes, bounded to one batch.
	rep.IdempotencyRows, err = exec(`
		DELETE FROM idempotency_keys
		WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
		ORDER BY expires_at ASC
		LIMIT ?`, IdempotencyGraceHours, batch)
	if err != nil {
		return rep, err
	}
	// Authoring operation keys: 7d TTL rows (create/duplicate/batch/bulk/
	// workbook-commit/publish) swept 24h past expiry, same grace batch.
	rep.AuthoringOpKeyRows, err = exec(`
		DELETE FROM authoring_operation_keys
		WHERE expires_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
		ORDER BY expires_at ASC
		LIMIT ?`, IdempotencyGraceHours, batch)
	if err != nil {
		return rep, err
	}
	// User sessions: stale 30d revoked-or-expired rows.
	rep.UserSessionRows, err = exec(`
		DELETE FROM user_sessions
		WHERE last_seen_at < DATE_SUB(NOW(), INTERVAL ? DAY)
		  AND (revoked_at IS NOT NULL OR expires_at < NOW() OR idle_timeout_at < NOW())
		ORDER BY last_seen_at ASC
		LIMIT ?`, UserSessionRetentionDays, batch)
	if err != nil {
		return rep, err
	}
	// Heartbeats: 7d rows on non-live schedules only.
	rep.HeartbeatRows, err = exec(`
		DELETE FROM student_heartbeat_events
		WHERE server_received_at < DATE_SUB(NOW(), INTERVAL ? DAY)
		  AND schedule_id IN (SELECT id FROM exam_schedules WHERE status <> 'live')
		ORDER BY server_received_at ASC
		LIMIT ?`, HeartbeatRetentionDays, batch)
	if err != nil {
		return rep, err
	}
	// Mutations: 30d applied rows on terminal attempts/schedules.
	rep.MutationRows, err = exec(`
		DELETE FROM student_attempt_mutations
		WHERE server_received_at < DATE_SUB(NOW(), INTERVAL ? DAY)
		  AND (applied_at IS NULL OR applied_at < DATE_SUB(NOW(), INTERVAL ? DAY))
		  AND (
			EXISTS (SELECT 1 FROM student_attempts WHERE id = student_attempt_mutations.attempt_id AND submitted_at IS NOT NULL)
			OR EXISTS (SELECT 1 FROM exam_schedules WHERE id = student_attempt_mutations.schedule_id AND status IN ('completed', 'cancelled'))
		  )
		LIMIT ?`, MutationRetentionDays, MutationRetentionDays, batch)
	if err != nil {
		if !isTransientLock(err) {
			return rep, err
		}
		rep.MutationRows = 0
	}
	// Published outbox rows older than 72h.
	rep.OutboxRows, err = exec(`
		DELETE FROM outbox_events
		WHERE published_at < DATE_SUB(NOW(), INTERVAL 72 HOUR)
		ORDER BY published_at ASC
		LIMIT ?`, batch)
	if err != nil {
		return rep, err
	}
	// Distributed rate counters.
	rep.RateLimitRows, err = exec(`
		DELETE FROM distributed_rate_limit_counters
		WHERE expires_at < NOW()
		ORDER BY expires_at ASC
		LIMIT ?`, batch)
	if err != nil {
		return rep, err
	}
	// Live bus events older than 72h.
	rep.LiveUpdateRows, err = exec(`
		DELETE FROM live_update_events
		WHERE created_at < DATE_SUB(NOW(), INTERVAL 72 HOUR)
		ORDER BY sequence_id ASC
		LIMIT ?`, batch)
	if err != nil {
		return rep, err
	}
	// Leftover websocket leases (plan C2: memory mode stops per-conn
	// writes; expired rows are reaped here instead of inline in Acquire).
	rep.LeaseRows, err = exec(`
		DELETE FROM websocket_connection_leases
		WHERE expires_at < NOW()
		ORDER BY expires_at ASC
		LIMIT ?`, batch)
	if err != nil {
		return rep, err
	}
	return rep, nil
}

// MediaReport counts one media janitor pass.
type MediaReport struct {
	OrphanedRows      int64 `json:"orphanedRows"`
	DeletedRows       int64 `json:"deletedRows"`
	NormalizedURLRows int64 `json:"normalizedURLRows"`
	LegacyRouteRows   int64 `json:"legacyRouteRows"`
}

// Total sums a media pass.
func (r MediaReport) Total() int64 {
	return r.OrphanedRows + r.DeletedRows + r.NormalizedURLRows
}

// NormalizeMediaDownloadURLs repairs one bounded page of finalized media
// rows. It is idempotent and intentionally reports the legacy /assets route
// count before updating, allowing operators to watch the compatibility debt
// drain without requiring a destructive rewrite.
func NormalizeMediaDownloadURLs(ctx context.Context, db *sql.DB, batch int64) (MediaReport, error) {
	if batch <= 0 {
		batch = MediaBatch
	}
	var report MediaReport
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM media_assets
		WHERE upload_status = 'finalized'
		  AND download_url LIKE '/api/v1/media/assets/%'`).Scan(&report.LegacyRouteRows); err != nil {
		if isMissingTable(err) {
			return report, nil
		}
		return report, err
	}
	result, err := db.ExecContext(ctx, `
		UPDATE media_assets
		SET download_url = CONCAT('/api/v1/media/', id, '/content'), updated_at = NOW()
		WHERE upload_status = 'finalized'
		  AND (download_url IS NULL OR download_url NOT LIKE '/api/v1/media/%/content')
		ORDER BY updated_at ASC, id ASC
		LIMIT ?`, batch)
	if err != nil {
		if isMissingTable(err) {
			return report, nil
		}
		return report, err
	}
	report.NormalizedURLRows, _ = result.RowsAffected()
	return report, nil
}

// RunMedia marks pending uploads older than 24h orphaned, then deletes rows
// whose delete_after_at elapsed. Both bounded to batch 1000.
func RunMedia(ctx context.Context, db *sql.DB) (MediaReport, error) {
	var rep MediaReport
	res, err := db.ExecContext(ctx, `
		UPDATE media_assets
		SET upload_status = 'orphaned', updated_at = NOW()
		WHERE upload_status = 'pending'
		  AND created_at < NOW() - INTERVAL 24 HOUR
		ORDER BY created_at ASC
		LIMIT ?`, MediaBatch)
	if err != nil {
		return rep, err
	}
	rep.OrphanedRows, _ = res.RowsAffected()
	res, err = db.ExecContext(ctx, `
		DELETE FROM media_assets
		WHERE delete_after_at IS NOT NULL
		  AND delete_after_at < NOW()
		ORDER BY delete_after_at ASC
		LIMIT ?`, MediaBatch)
	if err != nil {
		return rep, err
	}
	rep.DeletedRows, _ = res.RowsAffected()
	return rep, nil
}

// InvariantIssue is one audit finding that needs operator attention.
type InvariantIssue struct {
	Name   string `json:"name"`
	Detail string `json:"detail"`
	Count  int64  `json:"count"`
}

// AuditInvariants checks cross-table terminal-state invariants without
// mutating: terminal attempts must own a terminalization receipt, and scored
// SAT results must not sit on proctor-terminated attempts.
func AuditInvariants(ctx context.Context, db *sql.DB) ([]InvariantIssue, error) {
	checks := []struct {
		name  string
		query string
	}{
		{"terminal_attempt_without_receipt", `
			SELECT COUNT(*) FROM student_attempts a
			WHERE a.submitted_at IS NOT NULL
			  AND NOT EXISTS (SELECT 1 FROM attempt_terminalizations t WHERE t.attempt_id = a.id)`},
		{"scored_sat_on_terminated_attempt", `
			SELECT COUNT(*) FROM assessment_results ar
			JOIN student_attempts a ON a.id = ar.attempt_id
			WHERE ar.provider_key = 'sat' AND ar.outcome_status = 'scored'
			  AND COALESCE(a.proctor_status, 'active') = 'terminated'`},
		{"submission_without_result_or_receipt", `
			SELECT COUNT(*) FROM student_submissions ss
			LEFT JOIN assessment_results ar ON ar.submission_id = ss.id
			LEFT JOIN attempt_submissions_v2 v2 ON v2.attempt_id = ss.attempt_id
			WHERE ss.provider_key <> 'ielts'
			  AND ar.id IS NULL AND v2.attempt_id IS NULL`},
	}
	var out []InvariantIssue
	for _, c := range checks {
		var n int64
		if err := db.QueryRowContext(ctx, c.query).Scan(&n); err != nil {
			if isMissingTable(err) {
				continue
			}
			return out, err
		}
		if n > 0 {
			out = append(out, InvariantIssue{Name: c.name, Count: n,
				Detail: "invariant violated; see maintenance audit"})
		}
	}
	return out, nil
}

// ProjectionState is the durable grading-projection checkpoint stored as JSON
// in shared_cache_entries under ProjectionCheckpointKey.
type ProjectionState struct {
	Watermark         *time.Time `json:"watermark,omitempty"`
	ScheduleCursor    *Cursor    `json:"scheduleCursor,omitempty"`
	AttemptCursor     *Cursor    `json:"attemptCursor,omitempty"`
	SchedulesSynced   int64      `json:"scheduleRowsSynced"`
	SubmissionsSynced int64      `json:"submissionRowsSynced"`
	SectionsSynced    int64      `json:"sectionRowsSynced"`
	WritingSynced     int64      `json:"writingTaskRowsSynced"`
	Failures          int64      `json:"failuresTotal"`
}

// Cursor is a keyset pagination position.
type Cursor struct {
	UpdatedAt time.Time `json:"updatedAt"`
	ID        string    `json:"id"`
}

// ProjectionReport counts one idempotent grading-projection pass.
type ProjectionReport struct {
	Enabled           bool  `json:"enabled"`
	SchedulesSynced   int64 `json:"scheduleRowsSynced"`
	SubmissionsSynced int64 `json:"submissionRowsSynced"`
	SectionsSynced    int64 `json:"sectionRowsSynced"`
	WritingSynced     int64 `json:"writingTaskRowsSynced"`
	LagSeconds        int64 `json:"lagSeconds"`
}

// RunGradingProjection syncs grading read-model rows idempotently and
// advances the checkpoint with a revision compare-and-swap: concurrent
// workers may replay a batch, but only the holder of the observed revision
// advances the cursor. Disabled via enabled=false returns zero work.
func RunGradingProjection(ctx context.Context, db *sql.DB, enabled bool) (ProjectionReport, error) {
	if !enabled {
		return ProjectionReport{Enabled: false}, nil
	}
	state, revision, err := loadProjectionState(ctx, db)
	if err != nil {
		return ProjectionReport{}, err
	}
	now := time.Now().UTC()
	bootstrapAfter := now.Add(-ProjectionBootstrapHours * time.Hour)
	if state.Watermark != nil {
		bootstrapAfter = *state.Watermark
	}
	rep, nextSchedule, nextAttempt, watermark, err := syncProjectionBatch(ctx, db, state.ScheduleCursor, state.AttemptCursor, bootstrapAfter)
	if err != nil {
		return ProjectionReport{}, err
	}
	rep.Enabled = true
	if nextSchedule != nil {
		state.ScheduleCursor = nextSchedule
	}
	if nextAttempt != nil {
		state.AttemptCursor = nextAttempt
	}
	if watermark != nil {
		state.Watermark = watermark
	}
	state.SchedulesSynced += rep.SchedulesSynced
	state.SubmissionsSynced += rep.SubmissionsSynced
	state.SectionsSynced += rep.SectionsSynced
	state.WritingSynced += rep.WritingSynced
	if state.Watermark != nil {
		lag := now.Sub(*state.Watermark)
		if lag > 0 {
			rep.LagSeconds = int64(lag / time.Second)
		}
	}
	if err := saveProjectionState(ctx, db, state, revision); err != nil {
		return ProjectionReport{}, err
	}
	return rep, nil
}

// RecordProjectionFailure bumps the checkpoint failure counter under CAS,
// retrying up to 3 times against concurrent writers.
func RecordProjectionFailure(ctx context.Context, db *sql.DB) (int64, error) {
	for i := 0; i < 3; i++ {
		state, revision, err := loadProjectionState(ctx, db)
		if err != nil {
			return 0, err
		}
		state.Failures++
		if err := saveProjectionState(ctx, db, state, revision); err != nil {
			if isCheckpointConflict(err) {
				continue
			}
			return 0, err
		}
		return state.Failures, nil
	}
	return 0, errCheckpointConflict()
}

func loadProjectionState(ctx context.Context, db *sql.DB) (ProjectionState, int64, error) {
	var (
		raw      sql.NullString
		revision int64
	)
	err := db.QueryRowContext(ctx,
		"SELECT payload, revision FROM shared_cache_entries WHERE cache_key = ?", ProjectionCheckpointKey).
		Scan(&raw, &revision)
	if err == sql.ErrNoRows {
		return ProjectionState{}, 0, nil
	}
	if err != nil {
		return ProjectionState{}, 0, err
	}
	var state ProjectionState
	if raw.Valid {
		_ = json.Unmarshal([]byte(raw.String), &state)
	}
	return state, revision, nil
}

func saveProjectionState(ctx context.Context, db *sql.DB, state ProjectionState, expectedRevision int64) error {
	raw, _ := json.Marshal(state)
	var res sql.Result
	var err error
	if expectedRevision == 0 {
		res, err = db.ExecContext(ctx, `
			INSERT INTO shared_cache_entries (cache_key, payload, revision, created_at, updated_at)
			VALUES (?, ?, 1, NOW(), NOW())
			ON DUPLICATE KEY UPDATE payload = IF(revision = 0, VALUES(payload), payload),
				revision = IF(revision = 0, 1, revision)`,
			ProjectionCheckpointKey, string(raw))
	} else {
		res, err = db.ExecContext(ctx, `
			UPDATE shared_cache_entries SET payload = ?, revision = revision + 1, updated_at = NOW()
			WHERE cache_key = ? AND revision = ?`,
			string(raw), ProjectionCheckpointKey, expectedRevision)
	}
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n != 1 {
		return errCheckpointConflict()
	}
	return nil
}

// syncProjectionBatch upserts grading read-model rows idempotently using
// INSERT ... ON DUPLICATE KEY UPDATE, then returns the next cursors.
func syncProjectionBatch(ctx context.Context, db *sql.DB, scheduleCursor, attemptCursor *Cursor, since time.Time) (ProjectionReport, *Cursor, *Cursor, *time.Time, error) {
	var rep ProjectionReport
	// Schedules are the parent read model. The IELTS provider filter is
	// important: SAT/ACT attempts use their own result projections and must not
	// appear in the IELTS grading queue.
	schedRows, err := db.QueryContext(ctx, `
		SELECT id, exam_id, updated_at FROM exam_schedules
		WHERE (updated_at > ? OR (updated_at = ? AND id > ?))
		  AND exam_id IN (SELECT id FROM exam_entities WHERE provider_key = 'ielts')
		ORDER BY updated_at ASC, id ASC
		LIMIT ?`,
		since, since, cursorID(scheduleCursor), ProjectionBatch)
	if err != nil {
		return rep, nil, nil, nil, err
	}
	var lastSched *Cursor
	affectedScheduleIDs := map[string]bool{}
	for schedRows.Next() {
		var id, examID string
		var updated time.Time
		if err := schedRows.Scan(&id, &examID, &updated); err != nil {
			schedRows.Close()
			return rep, nil, nil, nil, err
		}
		// The schedule id is the stable read-model identity used by the Rust
		// implementation and makes a replay independent of generated UUIDs.
		if _, err := db.ExecContext(ctx, `
			INSERT INTO grading_sessions
				(id, schedule_id, exam_id, exam_title, published_version_id, cohort_name,
				 institution, start_time, end_time, status, assigned_teachers, created_by,
				 updated_at)
			SELECT s.id, s.id, s.exam_id, COALESCE(s.grading_display_name, e.title),
				COALESCE(s.published_version_id, ''), s.cohort_name, s.institution,
				s.start_time, s.end_time,
				CASE s.status
					WHEN 'live' THEN 'live'
					WHEN 'completed' THEN 'completed'
					WHEN 'cancelled' THEN 'cancelled'
					ELSE 'scheduled'
				END,
				JSON_ARRAY(), COALESCE(s.created_by, 'worker'), s.updated_at
			FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id
			WHERE s.id = ?
			ON DUPLICATE KEY UPDATE
				exam_id = VALUES(exam_id), exam_title = VALUES(exam_title),
				published_version_id = VALUES(published_version_id), cohort_name = VALUES(cohort_name),
				institution = VALUES(institution), start_time = VALUES(start_time),
				end_time = VALUES(end_time), status = VALUES(status), updated_at = VALUES(updated_at)`, id); err != nil && !isMissingTable(err) && !isDuplicateKey(err) {
			return rep, nil, nil, nil, err
		}
		rep.SchedulesSynced++
		affectedScheduleIDs[id] = true
		lastSched = &Cursor{UpdatedAt: updated, ID: id}
	}
	if err := schedRows.Err(); err != nil {
		schedRows.Close()
		return rep, nil, nil, nil, err
	}
	schedRows.Close()
	// Attempts drive submission/section sync; bounded to the same batch.
	attRows, err := db.QueryContext(ctx, `
		SELECT a.id, a.schedule_id, a.exam_id, a.published_version_id,
			a.candidate_id, a.candidate_name, COALESCE(a.candidate_email, ''),
			s.cohort_name, a.submitted_at, CAST(a.final_submission AS CHAR),
			CAST(v.content_snapshot AS CHAR), CAST(v.config_snapshot AS CHAR), a.updated_at
		FROM student_attempts a
		JOIN exam_schedules s ON s.id = a.schedule_id
		JOIN exam_entities e ON e.id = a.exam_id
		JOIN exam_versions v ON v.id = a.published_version_id
		WHERE a.submitted_at IS NOT NULL
		  AND e.provider_key = 'ielts'
		  AND (a.updated_at > ? OR (a.updated_at = ? AND a.id > ?))
		ORDER BY a.updated_at ASC, a.id ASC
		LIMIT ?`,
		since, since, cursorID(attemptCursor), ProjectionBatch)
	if err != nil {
		return rep, nil, nil, nil, err
	}
	var lastAttempt *Cursor
	var watermark *time.Time
	grader := grading.NewService(db, tx.NewRunner(db))
	for attRows.Next() {
		var attempt grading.ProjectionAttempt
		var submittedAt sql.NullTime
		var finalSubmission, contentSnapshot, configSnapshot sql.NullString
		var updated time.Time
		if err := attRows.Scan(
			&attempt.ID, &attempt.ScheduleID, &attempt.ExamID, &attempt.PublishedVersionID,
			&attempt.StudentID, &attempt.StudentName, &attempt.StudentEmail, &attempt.CohortName,
			&submittedAt, &finalSubmission, &contentSnapshot, &configSnapshot, &updated,
		); err != nil {
			attRows.Close()
			return rep, nil, nil, nil, err
		}
		if submittedAt.Valid {
			attempt.SubmittedAt = submittedAt.Time
		}
		if finalSubmission.Valid {
			attempt.FinalSubmission = json.RawMessage(finalSubmission.String)
		}
		if contentSnapshot.Valid {
			attempt.ContentSnapshot = json.RawMessage(contentSnapshot.String)
		}
		if configSnapshot.Valid {
			attempt.ConfigSnapshot = json.RawMessage(configSnapshot.String)
		}
		projected, err := grader.ProjectIELTSAttempt(ctx, attempt)
		if err != nil && !isMissingTable(err) {
			attRows.Close()
			return rep, nil, nil, nil, err
		}
		rep.SubmissionsSynced += projected.SubmissionSynced
		rep.SectionsSynced += projected.SectionsSynced
		rep.WritingSynced += projected.WritingSynced
		affectedScheduleIDs[attempt.ScheduleID] = true
		lastAttempt = &Cursor{UpdatedAt: updated, ID: attempt.ID}
		w := updated
		watermark = &w
	}
	attRows.Close()
	if err := attRows.Err(); err != nil {
		return rep, nil, nil, nil, err
	}
	for scheduleID := range affectedScheduleIDs {
		if err := refreshProjectionCounters(ctx, db, scheduleID); err != nil && !isMissingTable(err) {
			return rep, nil, nil, nil, err
		}
	}
	if watermark == nil {
		w := time.Now().UTC()
		watermark = &w
	}
	return rep, lastSched, lastAttempt, watermark, nil
}

func refreshProjectionCounters(ctx context.Context, db *sql.DB, scheduleID string) error {
	var total, submitted, pending, inProgress, finalized, overdue int64
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*),
			COALESCE(SUM(CASE WHEN grading_status IN ('submitted', 'reopened') THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN grading_status IN ('submitted', 'reopened') THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN grading_status = 'in_progress' THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN grading_status IN ('grading_complete', 'ready_to_release', 'released') THEN 1 ELSE 0 END), 0),
			COALESCE(SUM(CASE WHEN is_overdue THEN 1 ELSE 0 END), 0)
		FROM student_submissions
		WHERE schedule_id = ? AND provider_key = 'ielts'`, scheduleID).
		Scan(&total, &submitted, &pending, &inProgress, &finalized, &overdue); err != nil {
		return err
	}
	_, err := db.ExecContext(ctx, `
		UPDATE grading_sessions
		SET total_students = ?, submitted_count = ?, pending_manual_reviews = ?,
			in_progress_reviews = ?, finalized_reviews = ?, overdue_reviews = ?, updated_at = NOW()
		WHERE schedule_id = ?`, total, submitted, pending, inProgress, finalized, overdue, scheduleID)
	return err
}

func cursorID(c *Cursor) string {
	if c == nil {
		return ""
	}
	return c.ID
}

func isMissingTable(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return containsFold(s, "1146") || containsFold(s, "doesn't exist") || containsFold(s, "does not exist")
}

func isTransientLock(err error) bool {
	if err == nil {
		return false
	}
	s := err.Error()
	return containsFold(s, "deadlock") || containsFold(s, "lock wait timeout") || containsFold(s, "try restarting transaction")
}

func isDuplicateKey(err error) bool {
	if err == nil {
		return false
	}
	return containsFold(err.Error(), "duplicate")
}

func isCheckpointConflict(err error) bool {
	if err == nil {
		return false
	}
	return err.Error() == "projection checkpoint changed"
}

func errCheckpointConflict() error {
	return &checkpointError{"projection checkpoint changed"}
}

type checkpointError struct{ s string }

func (e *checkpointError) Error() string { return e.s }

func containsFold(haystack, needle string) bool {
	if len(needle) == 0 {
		return true
	}
	if len(haystack) < len(needle) {
		return false
	}
	for i := 0; i+len(needle) <= len(haystack); i++ {
		match := true
		for j := 0; j < len(needle); j++ {
			a, b := haystack[i+j], needle[j]
			if 'A' <= a && a <= 'Z' {
				a += 'a' - 'A'
			}
			if 'A' <= b && b <= 'Z' {
				b += 'a' - 'A'
			}
			if a != b {
				match = false
				break
			}
		}
		if match {
			return true
		}
	}
	return false
}

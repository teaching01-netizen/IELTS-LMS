package delivery

import (
	"context"
	"database/sql"
	"log/slog"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// AssessmentCompleter is the terminal CompleteAssessment hook invoked when the
// reconcile loop finalizes the last open module (Rust complete_assessment
// with submission_id=attempt_id, actor student/attempt_id). It is a func type
// (not an interface) so package sat can supply it as a bare method value
// without importing delivery. Delivery calls it outside the reconcile tx so
// scoring never nests inside the lock-order tx.
type AssessmentCompleter func(ctx context.Context, scheduleID, attemptID string) error

// reconcileCap bounds the finalize loop per Rust (0..32).
const reconcileCap = 32

// reconcileRow is one open module attempt row locked for expiry evaluation.
type reconcileRow struct {
	id                       string
	moduleID                 string
	state                    string
	allocatedSeconds         int
	availableAt              *time.Time
	startedAt                *time.Time
	pausedAt                 *time.Time
	accumulatedPausedSeconds int
	extensionSeconds         int
	completionReason         *string
}

// reconcileStage is one authoritative runtime-section row locked FOR UPDATE.
type reconcileStage struct {
	order            int
	status           string
	startedAt        *time.Time
	pausedAt         *time.Time
	plannedMinutes   int64
	extensionMinutes int64
	pausedSeconds    int64
}

// ReconcileAttemptTimeout finalizes modules whose authoritative window elapsed
// while still open (Rust reconcile_attempt_timeout). Lock order:
// student_attempts -> exam_session_runtimes -> module attempts -> runtime
// sections, matching the schedule-wide proctor command order. Missing attempt
// or runtime commits a no-op (false); each expired module is finalized via
// finalizeModuleTx("time_expired"); when the last open module is finalized,
// the completer runs CompleteAssessment outside the tx.
func (s *Service) ReconcileAttemptTimeout(ctx context.Context, scheduleID, attemptID string, asOf time.Time) (bool, error) {
	var shouldComplete bool
	changed := false
	if err := s.runner.WithTx(ctx, func(ctx context.Context, t tx.Tx) error {
		var attemptRow string
		if err := t.QueryRowContext(ctx,
			"SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
			attemptID, scheduleID).Scan(&attemptRow); err != nil {
			if err == sql.ErrNoRows {
				return nil
			}
			return err
		}
		var runtimeID, runtimeStatus, timingModel string
		var currentStageKey sql.NullString
		if err := t.QueryRowContext(ctx,
			"SELECT id, status, timing_model, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE",
			scheduleID).Scan(&runtimeID, &runtimeStatus, &timingModel, &currentStageKey); err != nil {
			if err == sql.ErrNoRows {
				return nil
			}
			return err
		}
		cohortTimed := timingModel == "cohort_stage_v2" || timingModel == "cohort_section_v3"
		var currentStageOrder *int
		if cohortTimed && currentStageKey.Valid {
			var order int
			if err := t.QueryRowContext(ctx,
				"SELECT section_order FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ?",
				runtimeID, currentStageKey.String).Scan(&order); err != nil {
				if err != sql.ErrNoRows {
					return err
				}
			} else {
				currentStageOrder = &order
			}
		}
		for i := 0; i < reconcileCap; i++ {
			mod, err := lockReconcileRowTx(ctx, t, attemptID)
			if err != nil {
				return err
			}
			if mod == nil {
				break
			}
			expired, err := reconcileModuleExpiredTx(ctx, t, runtimeID, runtimeStatus, timingModel, currentStageKey, currentStageOrder, mod, asOf)
			if err != nil {
				return err
			}
			if !expired {
				break
			}
			next, err := s.finalizeModuleTx(ctx, t, attemptID, saveActiveModule{
				id: mod.id, moduleID: mod.moduleID, state: mod.state,
				allocatedSeconds: mod.allocatedSeconds, availableAt: mod.availableAt,
				startedAt: mod.startedAt, pausedAt: mod.pausedAt,
				accumulatedPausedSeconds: mod.accumulatedPausedSeconds,
				extensionSeconds:         mod.extensionSeconds, completionReason: mod.completionReason,
			}, "time_expired")
			if err != nil {
				return err
			}
			changed = true
			if next == nil {
				shouldComplete = true
				break
			}
		}
		return nil
	}); err != nil {
		return false, err
	}
	if shouldComplete && s.completer != nil {
		if err := s.completer(ctx, scheduleID, attemptID); err != nil {
			telemetry.IncCounter(telemetry.MJobFailures, "job", "reconcile_complete_assessment")
			// The finalize tx already committed: report the modules as
			// changed and ask the caller to retry completion. Never
			// silently drop the terminal assessment.
			slog.ErrorContext(ctx, "reconcile complete_assessment failed; retry required",
				slog.String("schedule_id", scheduleID), slog.String("attempt_id", attemptID), slog.Any("error", err))
			return true, apperrors.New(apperrors.CodeRecoveryFailed, "Assessment completion needs a retry.")
		}
	}
	return changed, nil
}

// ReconcileTimeouts is the worker-facing bounded sweep. Request paths still
// reconcile the specific attempt they touch, but a disconnected candidate
// must not wait for another HTTP request: every open SAT attempt is revisited
// through the same lock-ordered reconciliation routine. SAT and ACT both use
// the assessment module timing tables; ACT terminalization is selected by the
// provider-aware completer wired by the composition root.
func (s *Service) ReconcileTimeouts(ctx context.Context, asOf time.Time, batchSize int64) (int64, error) {
	if s.db == nil {
		return 0, nil
	}
	if batchSize < 1 {
		batchSize = 250
	}
	rows, err := s.db.QueryContext(ctx, `
		SELECT a.id, a.schedule_id
		FROM student_attempts a
		JOIN exam_entities e ON e.id = a.exam_id
		JOIN exam_session_runtimes r ON r.schedule_id = a.schedule_id
		WHERE e.provider_key IN ('sat', 'act')
		  AND a.submitted_at IS NULL
		  AND COALESCE(a.delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')
		  AND r.status IN ('live', 'paused', 'completed', 'cancelled')
		ORDER BY a.updated_at ASC, a.id ASC
		LIMIT ?`, batchSize)
	if err != nil {
		return 0, err
	}
	type candidate struct{ attemptID, scheduleID string }
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if err := rows.Scan(&c.attemptID, &c.scheduleID); err != nil {
			rows.Close()
			return 0, err
		}
		candidates = append(candidates, c)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return 0, err
	}
	rows.Close()
	var changed int64
	for _, c := range candidates {
		ok, err := s.ReconcileAttemptTimeout(ctx, c.scheduleID, c.attemptID, asOf.UTC())
		if err != nil {
			return changed, err
		}
		if ok {
			changed++
		}
	}
	return changed, nil
}

// lockReconcileRowTx locks the oldest open module attempt (Rust ORDER BY
// created_at, id LIMIT 1 FOR UPDATE); nil means the loop is drained.
func lockReconcileRowTx(ctx context.Context, t tx.Tx, attemptID string) (*reconcileRow, error) {
	var m reconcileRow
	var availableAt, startedAt, pausedAt sql.NullTime
	var completionReason sql.NullString
	const q = `SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('not_started', 'active', 'review') ORDER BY created_at, id LIMIT 1 FOR UPDATE`
	if err := t.QueryRowContext(ctx, q, attemptID).Scan(&m.id, &m.moduleID, &m.state, &m.allocatedSeconds, &availableAt, &startedAt, &pausedAt, &m.accumulatedPausedSeconds, &m.extensionSeconds, &completionReason); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	m.availableAt = nullTime(availableAt)
	m.startedAt = nullTime(startedAt)
	m.pausedAt = nullTime(pausedAt)
	m.completionReason = nullString(completionReason)
	return &m, nil
}

// reconcileModuleExpiredTx mirrors the Rust per-model expiry branches.
func reconcileModuleExpiredTx(ctx context.Context, t tx.Tx, runtimeID, runtimeStatus, timingModel string, currentStageKey sql.NullString, currentStageOrder *int, mod *reconcileRow, asOf time.Time) (bool, error) {
	switch timingModel {
	case "cohort_stage_v2":
		return reconcileCohortStageExpiredTx(ctx, t, runtimeID, runtimeStatus, currentStageKey, currentStageOrder, mod, asOf)
	case "cohort_section_v3":
		return reconcileCohortSectionExpiredTx(ctx, t, runtimeID, runtimeStatus, currentStageKey, currentStageOrder, mod, asOf)
	default:
		if runtimeStatus == "completed" || runtimeStatus == "cancelled" {
			return true, nil
		}
		return mod.state == "active" && mod.pausedAt == nil && moduleRemainingSeconds(mod.startedAt, mod.pausedAt, mod.allocatedSeconds, mod.extensionSeconds, mod.accumulatedPausedSeconds, asOf) <= 0, nil
	}
}

// reconcileCohortStageExpiredTx mirrors the cohort_stage_v2 branch: terminal
// runtime expires everything; an earlier stage expires the row; the current
// stage expires on completed status or an elapsed live clock (paused clocks
// never expire).
func reconcileCohortStageExpiredTx(ctx context.Context, t tx.Tx, runtimeID, runtimeStatus string, currentStageKey sql.NullString, currentStageOrder *int, mod *reconcileRow, asOf time.Time) (bool, error) {
	if runtimeStatus == "completed" || runtimeStatus == "cancelled" {
		return true, nil
	}
	var sectionKey, adaptiveRole string
	if err := t.QueryRowContext(ctx,
		"SELECT s.section_key, m.adaptive_role FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
		mod.moduleID).Scan(&sectionKey, &adaptiveRole); err != nil {
		if err == sql.ErrNoRows {
			return false, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return false, err
	}
	expectedSuffix, err := saveStageSuffix(adaptiveRole)
	if err != nil {
		return false, err
	}
	expectedStageKey := sectionKey + ":" + expectedSuffix
	stage, err := lockReconcileStageTx(ctx, t, runtimeID, expectedStageKey)
	if err != nil {
		return false, err
	}
	if stage == nil {
		return false, assessmentConflict("MODULE_MISMATCH", "SAT runtime stage `"+expectedStageKey+"` is missing.")
	}
	if currentStageKey.Valid && currentStageOrder != nil {
		if stage.order < *currentStageOrder {
			return true, nil
		}
		if currentStageKey.String == expectedStageKey {
			if runtimeStatus == "paused" || stage.pausedAt != nil {
				return false, nil
			}
			switch {
			case stage.status == "completed":
				return true, nil
			case stage.status == "live" && stage.startedAt != nil:
				return stageRemainingSeconds(*stage.startedAt, stage.pausedAt, stage.plannedMinutes, stage.extensionMinutes, stage.pausedSeconds, asOf) <= 0, nil
			default:
				return false, nil
			}
		}
	}
	return false, nil
}

// reconcileCohortSectionExpiredTx mirrors the cohort_section_v3 branch: same
// stage-identity skeleton against the plain section key, plus the personal
// active-module clock as an OR condition on the current stage.
func reconcileCohortSectionExpiredTx(ctx context.Context, t tx.Tx, runtimeID, runtimeStatus string, currentStageKey sql.NullString, currentStageOrder *int, mod *reconcileRow, asOf time.Time) (bool, error) {
	if runtimeStatus == "completed" || runtimeStatus == "cancelled" {
		return true, nil
	}
	var sectionKey string
	if err := t.QueryRowContext(ctx,
		"SELECT s.section_key FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
		mod.moduleID).Scan(&sectionKey); err != nil {
		if err == sql.ErrNoRows {
			return false, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return false, err
	}
	stage, err := lockReconcileStageTx(ctx, t, runtimeID, sectionKey)
	if err != nil {
		return false, err
	}
	if stage == nil {
		return false, assessmentConflict("MODULE_MISMATCH", "SAT section clock `"+sectionKey+"` is missing.")
	}
	if currentStageKey.Valid && currentStageOrder != nil {
		if stage.order < *currentStageOrder {
			return true, nil
		}
		if currentStageKey.String == sectionKey {
			if runtimeStatus == "paused" || stage.pausedAt != nil {
				return false, nil
			}
			sectionExpired := false
			switch {
			case stage.status == "completed":
				sectionExpired = true
			case stage.status == "live" && stage.startedAt != nil:
				sectionExpired = stageRemainingSeconds(*stage.startedAt, stage.pausedAt, stage.plannedMinutes, stage.extensionMinutes, stage.pausedSeconds, asOf) <= 0
			}
			personalExpired := mod.state == "active" && mod.pausedAt == nil &&
				moduleRemainingSeconds(mod.startedAt, mod.pausedAt, mod.allocatedSeconds, mod.extensionSeconds, mod.accumulatedPausedSeconds, asOf) <= 0
			return sectionExpired || personalExpired, nil
		}
	}
	return false, nil
}

// lockReconcileStageTx locks one authoritative runtime-section row; nil means
// the stage row is missing (Rust fetch_optional -> Conflict at the call site).
func lockReconcileStageTx(ctx context.Context, t tx.Tx, runtimeID, sectionKey string) (*reconcileStage, error) {
	var st reconcileStage
	var startedAt, pausedAt sql.NullTime
	var plannedMinutes, extensionMinutes, pausedSeconds sql.NullInt64
	if err := t.QueryRowContext(ctx,
		"SELECT section_order, status, actual_start_at, paused_at, planned_duration_minutes, extension_minutes, accumulated_paused_seconds FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE",
		runtimeID, sectionKey).Scan(&st.order, &st.status, &startedAt, &pausedAt, &plannedMinutes, &extensionMinutes, &pausedSeconds); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	st.startedAt = nullTime(startedAt)
	st.pausedAt = nullTime(pausedAt)
	st.plannedMinutes = pausedInt(plannedMinutes)
	st.extensionMinutes = pausedInt(extensionMinutes)
	st.pausedSeconds = pausedInt(pausedSeconds)
	return &st, nil
}

// moduleRemainingSeconds mirrors module_remaining_seconds: a never-started
// module keeps its full allocation; elapsed runs from started_at (frozen at
// paused_at when paused) minus accumulated paused seconds, clamped to
// [0, total].
func moduleRemainingSeconds(startedAt, pausedAt *time.Time, allocatedSeconds, extensionSeconds, accumulatedPausedSeconds int, asOf time.Time) int64 {
	total := int64(allocatedSeconds + extensionSeconds)
	if total < 0 {
		total = 0
	}
	if startedAt == nil {
		return total
	}
	base := asOf
	if pausedAt != nil {
		base = *pausedAt
	}
	elapsed := int64(base.Sub(*startedAt) / time.Second)
	if elapsed < 0 {
		elapsed = 0
	}
	paused := int64(accumulatedPausedSeconds)
	if paused < 0 {
		paused = 0
	}
	elapsed -= paused
	remaining := total - elapsed
	if remaining < 0 {
		return 0
	}
	if remaining > total {
		return total
	}
	return remaining
}

// stageRemainingSeconds mirrors compute_stage_remaining_seconds: the stage
// clock always has a start; paused wall time freezes at paused_at.
func stageRemainingSeconds(startedAt time.Time, pausedAt *time.Time, plannedMinutes, extensionMinutes, pausedSeconds int64, asOf time.Time) int64 {
	total := (plannedMinutes + extensionMinutes) * 60
	if total < 0 {
		total = 0
	}
	base := asOf
	if pausedAt != nil {
		base = *pausedAt
	}
	elapsed := int64(base.Sub(startedAt) / time.Second)
	if elapsed < 0 {
		elapsed = 0
	}
	if pausedSeconds < 0 {
		pausedSeconds = 0
	}
	elapsed -= pausedSeconds
	remaining := total - elapsed
	if remaining < 0 {
		return 0
	}
	if remaining > total {
		return total
	}
	return remaining
}

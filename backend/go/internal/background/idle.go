package background

import (
	"context"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/maintenance"
)

// FlushPresence persists the embedded API map and retains failed batches.
func (w *Runner) FlushPresence(ctx context.Context) error {
	if !w.cfg.PresenceMemory() || w.student == nil || w.student.PresenceMap() == nil {
		return nil
	}
	p := w.student.PresenceMap()
	batch := p.DrainDirty()
	if err := w.student.FlushPresence(ctx, batch); err != nil {
		p.RestoreDirty(batch)
		return err
	}
	return nil
}

// Drain runs after all recurring jobs have joined, with no new application
// work admitted. Bounded backlogs remain durable and block idling below.
func (w *Runner) Drain(ctx context.Context) error {
	if err := w.FlushPresence(ctx); err != nil {
		return fmt.Errorf("presence flush: %w", err)
	}
	if w.delivery != nil {
		if err := w.runTimeoutReconcileCycle(ctx, time.Now().UTC()); err != nil {
			return err
		}
		if _, err := w.delivery.ReconcilePersonalTimeouts(ctx, time.Now().UTC(), maintenance.SATRepairBatch); err != nil {
			return err
		}
	}
	if err := w.runHotCycle(ctx, time.Now().UTC()); err != nil {
		return err
	}
	if w.sat != nil {
		if _, err := w.sat.ReconcileProvisional(ctx); err != nil {
			return err
		}
	}
	reason, err := w.PendingReason(ctx)
	if err != nil {
		return err
	}
	if reason != "" {
		return fmt.Errorf("pending work: %s", reason)
	}
	return nil
}

// PendingReason uses durable work state, including not-yet-due outbox retries.
// An SQL error is unknown work and must never be treated as permission to sleep.
func (w *Runner) PendingReason(ctx context.Context) (string, error) {
	checks := []struct{ reason, query string }{
		{"live_or_paused_exam", `SELECT EXISTS(SELECT 1 FROM exam_session_runtimes WHERE status IN ('live', 'paused'))`},
		{"unfinished_attempt", `SELECT EXISTS(
			SELECT 1 FROM student_attempts a JOIN exam_session_runtimes r ON r.schedule_id = a.schedule_id
			WHERE r.status IN ('live', 'paused', 'completed', 'cancelled') AND a.submitted_at IS NULL
			AND COALESCE(a.delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled'))`},
		{"outbox", `SELECT EXISTS(SELECT 1 FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL)`},
	}
	for _, check := range checks {
		var pending bool
		if err := w.db.QueryRowContext(ctx, check.query).Scan(&pending); err != nil {
			return "", fmt.Errorf("check %s: %w", check.reason, err)
		}
		if pending {
			return check.reason, nil
		}
	}
	if w.sat != nil {
		pending, err := w.sat.HasPendingProvisionalCompletion(ctx)
		if err != nil {
			return "", fmt.Errorf("SAT provisional completion: %w", err)
		}
		if pending {
			return "sat_provisional_completion", nil
		}
	}
	if w.cfg.GradingProjectionEnabled {
		pending, err := maintenance.HasPendingGradingProjection(ctx, w.db)
		if err != nil {
			return "", fmt.Errorf("grading projection: %w", err)
		}
		if pending {
			return "grading_projection", nil
		}
	}
	return "", nil
}

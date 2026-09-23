package proctor

import (
	"context"
	"encoding/json"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// sectionClosingGrace is the existing overrun threshold when auto-advance is
// disabled. SAT auto-advance separately waits SATSaveGrace before leaving the
// active section, so its final response writes keep the same runtime epoch.
const sectionClosingGrace = 30 * time.Second

// autoSubmitExpr is the authored auto-submit flag. It is written once and
// interpolated into the candidate scan so the three predicates cannot drift.
const autoSubmitExpr = "COALESCE(JSON_UNQUOTE(JSON_EXTRACT(v.config_snapshot, '$.progression.autoSubmit')), 'true')"

// AutoAdvanceOutcome identifies one schedule whose authoritative runtime
// moved because its active section reached the server-side deadline.
type AutoAdvanceOutcome struct {
	ScheduleID      string
	RuntimeRevision int64
}

type runtimeSection struct {
	key           string
	order         int64
	planned       int64
	gap           int64
	status        string
	startedAt     *time.Time
	endedAt       *time.Time
	pausedAt      *time.Time
	extension     int64
	pausedSeconds int64
}

// deadline is the planned end of the section: start + (planned + extension)
// minutes + every accumulated paused second, matching sectionDeadline and the
// V2 closing_grace_until anchor.
func (s runtimeSection) deadline() time.Time {
	return s.startedAt.Add(time.Duration((s.planned+s.extension)*60+s.pausedSeconds) * time.Second)
}

type reconcileRuntime struct {
	id               string
	status           string
	activeSectionKey *string
	waiting          bool
	overrun          bool
	revision         int64
}

// sectionReconcileCandidate is one schedule selected by the candidate scan.
type sectionReconcileCandidate struct {
	scheduleID  string
	autoSubmit  bool
	providerKey string
}

// ReconcileExpiredSections advances live runtime sections at their database-clock
// deadline, honours the authored between-section gap, and flags sections that ran
// past their window without
// being advanced (auto-submit disabled, or paused). Each schedule is
// reconciled in its own transaction so one slow or contended cohort does not
// hold the candidate scan open. The lock order remains
// attempts -> runtime -> sections, matching manual proctor commands and
// terminalization.
func (s *Service) ReconcileExpiredSections(ctx context.Context, asOf time.Time, limit int64, origin string) ([]AutoAdvanceOutcome, error) {
	if limit < 1 {
		limit = 250
	}
	asOf = asOf.UTC()
	if origin == "" {
		origin = "runtime-reconciler"
	}

	candidates := make([]sectionReconcileCandidate, 0)
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		rows, err := q.QueryContext(ctx, `
		SELECT r.schedule_id, `+autoSubmitExpr+` = 'true', COALESCE(r.provider_key, '')
			FROM exam_session_runtimes r
			JOIN exam_session_runtime_sections rs
			  ON rs.runtime_id = r.id
			 AND rs.section_key = r.active_section_key
			JOIN exam_schedules sch ON sch.id = r.schedule_id
			JOIN exam_versions v ON v.id = sch.published_version_id
			WHERE r.status = 'live'
			  AND r.active_section_key IS NOT NULL
			  AND (
					-- The planner applies SATSaveGrace before advancing SAT; this
					-- candidate scan may revisit it during the short save window.
					(
					  rs.status = 'live'
					  AND rs.actual_start_at IS NOT NULL
					  AND `+autoSubmitExpr+` = 'true'
					  AND ? >= DATE_ADD(
							rs.actual_start_at,
							INTERVAL ((rs.planned_duration_minutes + rs.extension_minutes) * 60 + rs.accumulated_paused_seconds) SECOND
						  )
					)
					-- Between sections: the authored gap has elapsed, start the next.
					OR (
					  rs.status = 'completed'
					  AND r.waiting_for_next_section = true
					  AND rs.actual_end_at IS NOT NULL
					  AND ? >= DATE_ADD(rs.actual_end_at, INTERVAL rs.gap_after_minutes MINUTE)
					)
					-- Past the grace but not advanced (paused, or auto-submit
					-- disabled): record the overrun signal for the proctor.
					OR (
					  rs.status = 'live'
					  AND r.is_overrun = false
					  AND rs.actual_start_at IS NOT NULL
					  AND ? >= DATE_ADD(
							rs.actual_start_at,
							INTERVAL ((rs.planned_duration_minutes + rs.extension_minutes) * 60 + rs.accumulated_paused_seconds + 30) SECOND
						  )
					)
				  )
			ORDER BY rs.actual_start_at ASC
			LIMIT ?`, asOf, asOf, asOf, limit)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var candidate sectionReconcileCandidate
			if err := rows.Scan(&candidate.scheduleID, &candidate.autoSubmit, &candidate.providerKey); err != nil {
				return err
			}
			candidates = append(candidates, candidate)
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}

	outcomes := make([]AutoAdvanceOutcome, 0, len(candidates))
	for _, candidate := range candidates {
		revision, err := s.reconcileExpiredSchedule(ctx, candidate.scheduleID, candidate.autoSubmit, candidate.providerKey, asOf, origin)
		if err != nil {
			return outcomes, err
		}
		if revision != nil {
			outcomes = append(outcomes, AutoAdvanceOutcome{ScheduleID: candidate.scheduleID, RuntimeRevision: *revision})
		}
	}
	return outcomes, nil
}

func (s *Service) reconcileExpiredSchedule(ctx context.Context, scheduleID string, autoSubmit bool, providerKey string, asOf time.Time, origin string) (*int64, error) {
	var runtimeRevision *int64
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// Global lock order: schedule -> attempts -> runtime -> sections. The
		// reconciler writes exam_schedules when it completes a runtime, so it
		// takes the schedule row before the attempt/runtime rows; otherwise it
		// forms a cycle with check-in (schedule -> runtime) and with the
		// proctor's CompleteExam (schedule -> attempts/runtime), and InnoDB
		// would kill one side exactly when the session is ending.
		if _, err := examruntime.LockScheduleRow(ctx, q, scheduleID); err != nil {
			if e, ok := apperrors.As(err); ok && e.Code == apperrors.CodeNotFound {
				return nil
			}
			return err
		}
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
		var saveGrace time.Duration
		decisionAt := asOf
		if providerKey == "sat" {
			saveGrace = attempts.SATSaveGrace
			if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&decisionAt); err != nil {
				return err
			}
		}
		plan := planSectionAdvance(*runtime, sections, autoSubmit, decisionAt, saveGrace)
		if plan.activeSectionMissing {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Active section row is missing.", HTTPStatus: 409}
		}
		wrote, err := s.applyAdvancePlan(ctx, q, scheduleID, origin, runtime.id, plan)
		if err != nil {
			return err
		}
		if wrote {
			// Re-read rather than add: the reported revision is then the row's
			// real post-commit value, whatever the executor wrote.
			v, err := currentRuntimeRevision(ctx, q, runtime.id)
			if err != nil {
				return err
			}
			runtimeRevision = &v
		}
		return nil
	})
	return runtimeRevision, err
}

// advanceStepKind enumerates the runtime-visible effects of one advance.
type advanceStepKind int

const (
	// stepCompleteSection closes a section whose clock expired.
	stepCompleteSection advanceStepKind = iota
	// stepEnterWaiting opens the between-sections window: the section stays
	// active (so the write gates stay closed) and the next start is announced.
	stepEnterWaiting
	// stepStartSection makes the next locked section live.
	stepStartSection
	// stepCompleteRuntime ends the schedule: there is no successor section.
	stepCompleteRuntime
	// stepFlagOverrun records a section past its window that the worker will
	// not advance (paused clock, or auto-submit disabled for the schedule).
	stepFlagOverrun
)

type advanceStep struct {
	kind advanceStepKind
	// sectionKey is the section the step closes (complete) or opens (start).
	sectionKey string
	// nextKey is the section the waiting window is for.
	nextKey string
	// effectiveAt is the section end (complete) or the runtime end.
	effectiveAt time.Time
	// startAt is when the next section goes live.
	startAt time.Time
	// remaining is the next section's allotted seconds.
	remaining int64
}

// advancePlan is the ordered effect list for one schedule. It is produced by a
// pure state machine over the locked rows and applied by the executor, so the
// section-advance rules can be tested without a database.
type advancePlan struct {
	steps                []advanceStep
	activeSectionMissing bool
}

// planSectionAdvance is the cohort section state machine:
//
//	live(N) --deadline(N)--> completed(N), waiting = true
//	        --end(N)+gap(N->N+1)--> live(N+1), waiting = false
//
// One plan may catch up through several expired sections after a worker
// outage, preserving the timeline (each section starts at its predecessor's
// end plus the authored gap) instead of compressing it against "now". Gap 0
// therefore reproduces the immediate advance exactly.
//
// The runtime keeps pointing at the completed section during the window so the
// "section not live" write gate stays closed; `waiting` is the explicit second
// signal for the student and proctor projections.
func planSectionAdvance(runtime reconcileRuntime, locked []runtimeSection, autoSubmit bool, asOf time.Time, saveGrace ...time.Duration) advancePlan {
	var closingDelay time.Duration
	if len(saveGrace) > 0 {
		closingDelay = saveGrace[0]
	}
	var plan advancePlan
	if runtime.activeSectionKey == nil || *runtime.activeSectionKey == "" {
		return plan
	}
	// The planner advances its own copy: callers keep the rows they locked.
	sections := make([]runtimeSection, len(locked))
	copy(sections, locked)

	activeIndex := -1
	for i := range sections {
		if sections[i].key == *runtime.activeSectionKey {
			activeIndex = i
			break
		}
	}
	if activeIndex < 0 {
		plan.activeSectionMissing = true
		return plan
	}

	activeKey := *runtime.activeSectionKey
	waiting := runtime.waiting
	overrun := runtime.overrun

	for {
		active := &sections[activeIndex]
		switch active.status {
		case "completed":
			// Between sections: the previous section is over and the next one
			// starts once the authored gap has elapsed (below).
		case "live":
			if active.startedAt == nil {
				return plan
			}
			deadline := active.deadline()
			if !autoSubmit || active.pausedAt != nil {
				// Auto-advance is disabled, or the clock is frozen: the section
				// stays live past its window. Preserve the response grace before
				// flagging the overrun so proctors still see the same durability
				// window.
				if asOf.Before(deadline.Add(sectionClosingGrace)) {
					return plan
				}
				if !overrun {
					plan.steps = append(plan.steps, advanceStep{kind: stepFlagOverrun})
				}
				return plan
			}
			if asOf.Before(deadline.Add(closingDelay)) {
				return plan
			}
			effectiveAt := deadline.Add(closingDelay)
			plan.steps = append(plan.steps, advanceStep{
				kind: stepCompleteSection, sectionKey: activeKey, effectiveAt: effectiveAt,
			})
			active.status = "completed"
			active.endedAt = &effectiveAt
			overrun = false
		default:
			return plan
		}

		nextIndex := nextLockedSection(sections, activeIndex)
		if nextIndex < 0 {
			plan.steps = append(plan.steps, advanceStep{kind: stepCompleteRuntime, effectiveAt: asOf})
			return plan
		}
		next := &sections[nextIndex]
		endAt := active.endedAt
		if endAt == nil {
			// A completed section always has an end; refusing to guess keeps
			// the next section from starting at an invented time.
			return plan
		}
		startAt := endAt.Add(time.Duration(active.gap) * time.Minute)
		if asOf.Before(startAt) {
			if !waiting {
				plan.steps = append(plan.steps, advanceStep{
					kind: stepEnterWaiting, sectionKey: activeKey, nextKey: next.key, startAt: startAt,
				})
			}
			return plan
		}

		plan.steps = append(plan.steps, advanceStep{
			kind: stepStartSection, sectionKey: next.key, startAt: startAt,
			remaining: (next.planned + next.extension) * 60,
		})
		next.status = "live"
		next.startedAt = &startAt
		activeIndex = nextIndex
		activeKey = next.key
		waiting = false
		overrun = false
	}
}

// sectionEventAutoAdvance / sectionEventProctor label the runtime wakeup so an
// operator can tell an automatic transition from a proctor override.
const (
	sectionEventAutoAdvance = "auto_advance_section"
	sectionEventProctor     = "end_section_now"
)

// sectionReasonExpired is the completion reason the reconciler records; a
// proctor override records proctor_end instead.
const sectionReasonExpired = "time_expired"

// autoSubmitStyle selects how the runtime-end auto-submit payload names the
// attempts to seal.
type autoSubmitStyle int

const (
	// submitByScan omits the attempt ids: the worker discovers the open
	// attempts in bounded batches. Used at cohort scale (proctor end) so the
	// payload cannot grow with the roster.
	submitByScan autoSubmitStyle = iota
	// submitWithExplicitAttempts materialises the open attempt ids in the
	// payload. Used by the reconciler, which already holds the schedule lock.
	submitWithExplicitAttempts
)

// sectionAdvance is the shared description of one section transition. Both the
// automatic reconciler and the proctor override build it and hand it to
// applySectionAdvance, so the two paths cannot drift. They previously carried
// separate SQL, and the proctor copy omitted the delivery handover, leaving a
// proctor-ended section's modules open until the maintenance sweep.
type sectionAdvance struct {
	// sectionKey / endAt / reason describe the outgoing section.
	sectionKey string
	endAt      time.Time
	// reason is written as the row's completion_reason; auditReason (when set)
	// is recorded on the SECTION_END audit instead.
	reason      string
	auditReason string
	// completeRow rewrites the row to completed. False in the between-sections
	// window, where the section is already completed and only the advance and
	// the audit remain.
	completeRow bool
	// handover enqueues the finished section's open modules for delivery.
	handover bool
	// actor is the audit actor (system for the reconciler, the proctor id
	// otherwise).
	actor string
	// origin labels the wakeup and handover payloads.
	origin string
	// event names the runtime wakeup.
	event string
	// auditExtra merges caller-specific keys into the SECTION_END payload.
	auditExtra map[string]any
	// nextKey is the successor section. When neither nextKey nor endRuntime is
	// set, the transition stops after the outgoing section (the waiting
	// window); the advance arrives on a later sweep.
	nextKey       string
	nextRemaining int64
	startAt       time.Time
	// endRuntime completes the schedule (no successor exists or one must not
	// be started).
	endRuntime bool
	// submitStyle / submitActorID describe the runtime-end auto-submit.
	submitStyle   autoSubmitStyle
	submitActorID string
}

// applySectionAdvance performs one section transition inside the caller's
// transaction: complete the outgoing section (and hand its open modules to
// delivery), then either start the successor or end the runtime.
//
// The handover exists so an offline student's module closes with their section
// instead of waiting for the slower per-attempt maintenance sweep. Delivery
// owns finalization (adaptive routing + the follow-up module row), so the work
// crosses the package boundary through the durable outbox rather than a direct
// call.
// Every revision it reports — the module handover here, the wakeup the effects
// enqueue — is read back from the locked row through [currentRuntimeRevision]
// rather than predicted from a count, so a write added here can never silently
// desynchronize a revision the outbox or the worker reports.
func (s *Service) applySectionAdvance(ctx context.Context, q tx.Tx, scheduleID, runtimeID string, adv sectionAdvance) error {
	if adv.completeRow {
		if _, err := q.ExecContext(ctx, `
			UPDATE exam_session_runtime_sections
			SET status = 'completed', actual_end_at = ?, completion_reason = ?, paused_at = NULL
			WHERE runtime_id = ? AND section_key = ?`, adv.endAt, adv.reason, runtimeID, adv.sectionKey); err != nil {
			return err
		}
	}
	if adv.sectionKey != "" {
		reason := adv.auditReason
		if reason == "" {
			reason = adv.reason
		}
		audit := map[string]any{
			"sectionKey": adv.sectionKey, "reason": reason, "effectiveAt": adv.endAt,
		}
		for k, v := range adv.auditExtra {
			audit[k] = v
		}
		if err := insertAuditLog(ctx, q, scheduleID, adv.actor, "SECTION_END", nil, audit); err != nil {
			return err
		}
		if adv.handover {
			revision, err := currentRuntimeRevision(ctx, q, runtimeID)
			if err != nil {
				return err
			}
			if err := s.enqueueSectionAttemptReconcile(ctx, q, scheduleID, adv.sectionKey, revision, adv.origin); err != nil {
				return err
			}
		}
	}
	if adv.nextKey != "" {
		return s.startSectionEffect(ctx, q, scheduleID, runtimeID, adv)
	}
	if adv.endRuntime {
		return s.completeRuntimeEffect(ctx, q, scheduleID, runtimeID, adv)
	}
	return nil
}

// applyAdvancePlan executes a plan in order. Every section effect goes through
// applySectionAdvance, so the reconciler and the proctor override share one
// implementation; only the waiting window and the overrun flag are specific to
// the automatic path. It reports whether it moved the runtime, so the caller
// knows whether the row's revision is worth re-reading.
func (s *Service) applyAdvancePlan(ctx context.Context, q tx.Tx, scheduleID, origin, runtimeID string, plan advancePlan) (bool, error) {
	wrote := false
	for _, step := range plan.steps {
		switch step.kind {
		case stepCompleteSection:
			if err := s.applySectionAdvance(ctx, q, scheduleID, runtimeID, sectionAdvance{
				completeRow: true,
				handover:    true,
				sectionKey:  step.sectionKey,
				endAt:       step.effectiveAt,
				reason:      sectionReasonExpired,
				actor:       systemActor,
				origin:      origin,
				event:       sectionEventAutoAdvance,
			}); err != nil {
				return wrote, err
			}
			wrote = true
		case stepEnterWaiting:
			if err := s.enterWaitingStep(ctx, q, scheduleID, origin, step, runtimeID); err != nil {
				return wrote, err
			}
			wrote = true
		case stepStartSection:
			if err := s.applySectionAdvance(ctx, q, scheduleID, runtimeID, sectionAdvance{
				actor:         systemActor,
				origin:        origin,
				event:         sectionEventAutoAdvance,
				nextKey:       step.sectionKey,
				nextRemaining: step.remaining,
				startAt:       step.startAt,
			}); err != nil {
				return wrote, err
			}
			wrote = true
		case stepCompleteRuntime:
			if err := s.applySectionAdvance(ctx, q, scheduleID, runtimeID, sectionAdvance{
				actor:       systemActor,
				origin:      origin,
				event:       sectionEventAutoAdvance,
				endAt:       step.effectiveAt,
				reason:      sectionReasonExpired,
				endRuntime:  true,
				submitStyle: submitWithExplicitAttempts,
			}); err != nil {
				return wrote, err
			}
			wrote = true
		case stepFlagOverrun:
			if err := markRuntimeOverrun(ctx, q, runtimeID); err != nil {
				return wrote, err
			}
			wrote = true
		}
	}
	return wrote, nil
}

// systemActor is the audit actor for reconciler-driven transitions.
const systemActor = "system"

// startSectionEffect opens the successor section, re-projects the V2 clocks,
// and clears the between-sections window.
func (s *Service) startSectionEffect(ctx context.Context, q tx.Tx, scheduleID, runtimeID string, adv sectionAdvance) error {
	if _, err := q.ExecContext(ctx, `
		UPDATE exam_session_runtime_sections
		SET status = 'live', available_at = COALESCE(available_at, ?), actual_start_at = COALESCE(actual_start_at, ?)
		WHERE runtime_id = ? AND section_key = ?`, adv.startAt, adv.startAt, runtimeID, adv.nextKey); err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE exam_session_runtimes
		SET active_section_key = ?, current_section_key = ?, current_section_remaining_seconds = ?,
			waiting_for_next_section = false, is_overrun = false,
			updated_at = UTC_TIMESTAMP(6), revision = revision + 1
			WHERE id = ?`, adv.nextKey, adv.nextKey, adv.nextRemaining, runtimeID); err != nil {
		return err
	}
	// Read the revision the bump above produced rather than predicting it, so
	// the wakeup the worker sees is always the row's real value.
	revision, err := currentRuntimeRevision(ctx, q, runtimeID)
	if err != nil {
		return err
	}
	if err := examruntime.SyncV2TimingInTx(ctx, q, scheduleID, runtimeID, adv.nextKey, strptr("running")); err != nil {
		return err
	}
	if err := insertAuditLog(ctx, q, scheduleID, adv.actor, "SECTION_START", nil, map[string]any{
		"sectionKey": adv.nextKey, "effectiveAt": adv.startAt,
	}); err != nil {
		return err
	}
	return s.enqueueRuntimeWakeup(ctx, q, scheduleID, adv.event, adv.origin, revision)
}

// completeRuntimeEffect ends the schedule, queues auto-submit for every attempt
// still open, and clears any between-sections window.
func (s *Service) completeRuntimeEffect(ctx context.Context, q tx.Tx, scheduleID, runtimeID string, adv sectionAdvance) error {
	if _, err := q.ExecContext(ctx, `
		UPDATE exam_session_runtimes
		SET status = 'completed', actual_end_at = ?, active_section_key = NULL,
			current_section_key = NULL, current_section_remaining_seconds = 0,
			waiting_for_next_section = false, is_overrun = false,
			updated_at = UTC_TIMESTAMP(6), revision = revision + 1			WHERE id = ?`, adv.endAt, runtimeID); err != nil {
		return err
	}
	revision, err := currentRuntimeRevision(ctx, q, runtimeID)
	if err != nil {
		return err
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE exam_schedules
		SET status = 'completed', updated_at = UTC_TIMESTAMP(6), revision = revision + 1
		WHERE id = ?`, scheduleID); err != nil {
		return err
	}
	if err := s.enqueueAutoSubmit(ctx, q, scheduleID, adv, revision); err != nil {
		return err
	}
	if err := insertAuditLog(ctx, q, scheduleID, adv.actor, "SESSION_END", nil, map[string]any{
		"reason": adv.reason, "effectiveAt": adv.endAt,
	}); err != nil {
		return err
	}
	return s.enqueueRuntimeWakeup(ctx, q, scheduleID, adv.event, adv.origin, revision)
}

// enqueueAutoSubmit queues the runtime-end auto-submit in the style the caller
// asked for: explicit attempt ids, or a bounded worker scan.
func (s *Service) enqueueAutoSubmit(ctx context.Context, q tx.Tx, scheduleID string, adv sectionAdvance, runtimeRevision int64) error {
	if adv.submitStyle == submitByScan {
		return s.enqueueAutoSubmitForSchedule(ctx, q, scheduleID, runtimeRevision, adv.submitActorID, adv.reason)
	}
	attemptIDs, err := pendingScheduleAttemptIDs(ctx, q, scheduleID)
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]any{
		"scheduleId": scheduleID,
		"attemptIds": attemptIDs,
		"reason":     adv.reason,
		"origin":     adv.origin,
	})
	if err != nil {
		return err
	}
	return s.outbx.EnqueueInTx(ctx, q, "schedule", scheduleID, runtimeRevision, outbox.FamilyAutoSubmitScheduleAttempts, payload)
}

// enqueueRuntimeWakeup relays a runtime transition on the durable live bus.
func (s *Service) enqueueRuntimeWakeup(ctx context.Context, q tx.Tx, scheduleID, event, origin string, runtimeRevision int64) error {
	payload, _ := json.Marshal(map[string]any{
		"scheduleId": scheduleID, "event": event, "origin": origin,
	})
	return s.enqueueWakeup(ctx, q, "schedule_runtime", scheduleID, runtimeRevision, outbox.FamilyRuntimeChanged, payload)
}

// enterWaitingStep opens the between-sections window: the runtime keeps pointing
// at the completed section, so the write gates stay closed by the "section not
// live" rule, and `waiting_for_next_section` becomes the explicit signal the
// student screen, the API gate, and the proctor projection all read.
func (s *Service) enterWaitingStep(ctx context.Context, q tx.Tx, scheduleID, origin string, step advanceStep, runtimeID string) error {
	if _, err := q.ExecContext(ctx, `
		UPDATE exam_session_runtimes
		SET waiting_for_next_section = true, is_overrun = false,
			current_section_remaining_seconds = 0,
			updated_at = UTC_TIMESTAMP(6), revision = revision + 1
		WHERE id = ?`, runtimeID); err != nil {
		return err
	}
	revision, err := currentRuntimeRevision(ctx, q, runtimeID)
	if err != nil {
		return err
	}
	if err := insertAuditLog(ctx, q, scheduleID, systemActor, "SECTION_WAIT", nil, map[string]any{
		"sectionKey": step.sectionKey, "nextSectionKey": step.nextKey,
		"nextSectionStartAt": step.startAt,
	}); err != nil {
		return err
	}
	payload, _ := json.Marshal(map[string]any{
		"scheduleId": scheduleID, "event": "waiting_for_next_section", "origin": origin,
	})
	return s.enqueueWakeup(ctx, q, "schedule_runtime", scheduleID, revision, outbox.FamilyRuntimeChanged, payload)
}

// markRuntimeOverrun records that a section ran past its window without being
// advanced.
func markRuntimeOverrun(ctx context.Context, q tx.Tx, runtimeID string) error {
	_, err := q.ExecContext(ctx, `
		UPDATE exam_session_runtimes
		SET is_overrun = true, updated_at = UTC_TIMESTAMP(6), revision = revision + 1
		WHERE id = ?`, runtimeID)
	return err
}

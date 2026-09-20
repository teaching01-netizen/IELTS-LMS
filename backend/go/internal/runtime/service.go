// Package runtime owns the cohort session clock: exam_session_runtimes plus
// exam_session_runtime_sections, and the V2 per-attempt deadline projection.
//
// State machines:
//
//	runtime status: not_started|live|paused|completed|cancelled
//	section status: locked|live|paused|completed
//	attempt phase: pre-check|lobby|exam|post-exam
//	attempt delivery: running|paused|submitted|terminated|locked|cancelled
//	attempt proctor: active|warned|paused|terminated
//
// Concurrency:
//
//	expected_runtime_revision + expected_active_section_key fences reject stale
//	proctor consoles with 409 "Runtime changed; refresh before retrying."
//	V2 lease/control epochs fence student response batches (see attempts).
//	pause/resume/extend/sync bump control_epoch+1 so in-flight writers fence.
//	Grace is server-side: server_now <= closing_grace_until is inclusive.
//	sync_v2 re-projects deadline=actual_start+(planned+extension)*60+paused and
//	 grace=+5s, only for protocol 2 non-terminal attempts.
//
// Lock order everywhere: attempt -> runtime -> section.
// Every mutating method locks schedule attempt rows BEFORE the runtime row
// and the runtime row BEFORE its section rows, matching terminalization and
// proctor lock discipline so student/proctor/worker writers cannot deadlock.
package runtime

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Runtime statuses.
const (
	StatusNotStarted = "not_started"
	StatusLive       = "live"
	StatusPaused     = "paused"
	StatusCompleted  = "completed"
	StatusCancelled  = "cancelled"
)

// SectionClosingGrace is the bounded window after the authored section
// deadline in which in-flight student writes may still arrive. The worker's
// section reconciler and the V2 write projection both use this value so a
// section cannot close before the write gate closes, or remain open for an
// unexpectedly long time after the timer reaches zero.
const SectionClosingGrace = 5 * time.Second

// Section statuses.
const (
	SectionLocked    = "locked"
	SectionLive      = "live"
	SectionPaused    = "paused"
	SectionCompleted = "completed"
)

// Attempt lifecycle vocabularies mirrored here for transition guards.
const (
	PhasePreCheck = "pre-check"
	PhaseLobby    = "lobby"
	PhaseExam     = "exam"
	PhasePostExam = "post-exam"
)

const (
	DeliveryRunning    = "running"
	DeliveryPaused     = "paused"
	DeliverySubmitted  = "submitted"
	DeliveryTerminated = "terminated"
	DeliveryLocked     = "locked"
	DeliveryCancelled  = "cancelled"
)

const (
	ProctorActive     = "active"
	ProctorWarned     = "warned"
	ProctorPaused     = "paused"
	ProctorTerminated = "terminated"
)

const (
	controlStartAction    = "start_runtime"
	controlPauseAction    = "pause_runtime"
	controlResumeAction   = "resume_runtime"
	controlCompleteAction = "complete_runtime"
)

// RevisionFence carries optimistic-concurrency expectations from the console.
// Either field may be nil (no expectation); a mismatch is a 409 with the
// stable message "Runtime changed; refresh before retrying."
type RevisionFence struct {
	ExpectedRuntimeRevision  *int64
	ExpectedActiveSectionKey *string
}

// StaleRuntimeError builds the 409 fence error.
func StaleRuntimeError() *apperrors.Error {
	return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime changed; refresh before retrying.", HTTPStatus: 409}
}

// CheckFence enforces expected_runtime_revision + expected_active_section_key.
func CheckFence(actualRevision int64, actualSectionKey *string, fence RevisionFence) error {
	if fence.ExpectedRuntimeRevision != nil && actualRevision != *fence.ExpectedRuntimeRevision {
		return StaleRuntimeError()
	}
	if fence.ExpectedActiveSectionKey != nil {
		want := *fence.ExpectedActiveSectionKey
		got := ""
		if actualSectionKey != nil {
			got = *actualSectionKey
		}
		if got != want {
			return StaleRuntimeError()
		}
	}
	return nil
}

// RuntimeRow is the locked runtime header.
type RuntimeRow struct {
	ID               string
	ScheduleID       string
	ExamID           string
	Status           string
	ActiveSectionKey *string
	Revision         int64
	TimingModel      string
}

// OutboxEnqueuer is the minimal in-tx outbox hook (runtime_changed).
type OutboxEnqueuer interface {
	EnqueueInTx(ctx context.Context, q tx.Tx, aggregateKind, aggregateID string, revision int64, eventFamily string, payload json.RawMessage) error
}

// SQLOutboxEnqueuer writes durable outbox rows in-tx.
type SQLOutboxEnqueuer struct{}

// EnqueueInTx inserts one outbox row in the caller's transaction.
func (SQLOutboxEnqueuer) EnqueueInTx(ctx context.Context, q tx.Tx, aggregateKind, aggregateID string, revision int64, eventFamily string, payload json.RawMessage) error {
	const ins = "INSERT INTO outbox_events (id, aggregate_kind, aggregate_id, revision, event_family, payload, created_at, publish_attempts) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), 0)"
	_, err := q.ExecContext(ctx, ins, uuid.NewString(), aggregateKind, aggregateID, revision, eventFamily, string(payload))
	return err
}

// Service owns the cohort clock transitions with constructor injection.
type Service struct {
	tx    *tx.Runner
	outbx OutboxEnqueuer
	// onCommitted fires after a runtime-mutating command commits (B2
	// snapshot invalidation). Nil disables (tests leave it unset).
	onCommitted func(scheduleID string)
	// outboxExecOnly skips wakeup-family INSERTs (B4.1 OUTBOX_EXEC_ONLY).
	outboxExecOnly bool
	// snapshots is the shared B2 cache backing the C3 poll view (nil = no
	// cache; every poll loads committed-read).
	snapshots *SnapshotCache
}

// SetOutboxExecOnly toggles B4.1 executable-only enqueueing (chainable).
func (s *Service) SetOutboxExecOnly(on bool) *Service {
	s.outboxExecOnly = on
	return s
}

// SetSnapshotInvalidator wires post-commit snapshot invalidation (B2).
// Callers (BuildApp) pass the shared SnapshotCache.Invalidate; nil clears.
func (s *Service) SetSnapshotInvalidator(fn func(scheduleID string)) *Service {
	s.onCommitted = fn
	return s
}

// SetSnapshotCache wires the shared B2 snapshot cache for the C3 poll view
// (chainable). Nil disables cache use (tests leave it unset: every poll
// loads committed-read, exactly one indexed row on the runtime header).
func (s *Service) SetSnapshotCache(c *SnapshotCache) *Service {
	s.snapshots = c
	return s
}

// invalidated runs the post-commit hook when set.
func (s *Service) invalidated(scheduleID string) {
	if s != nil && s.onCommitted != nil {
		s.onCommitted(scheduleID)
	}
}

// NewService builds the runtime service.
func NewService(runner *tx.Runner, outbx OutboxEnqueuer) *Service {
	if outbx == nil {
		outbx = SQLOutboxEnqueuer{}
	}
	return &Service{tx: runner, outbx: outbx}
}

// lockAttemptsFirst acquires schedule attempt rows BEFORE any runtime lock.
// Lock order: attempt -> runtime -> section.
func lockAttemptsFirst(ctx context.Context, q tx.Tx, scheduleID string) error {
	const sel = "SELECT id FROM student_attempts WHERE schedule_id = ? ORDER BY id FOR UPDATE"
	rows, err := q.QueryContext(ctx, sel, scheduleID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return err
		}
	}
	return rows.Err()
}

// lockRuntime loads the runtime row FOR UPDATE (after attempt locks).
func lockRuntime(ctx context.Context, q tx.Tx, scheduleID string) (*RuntimeRow, error) {
	const sel = "SELECT id, schedule_id, exam_id, status, active_section_key, revision, COALESCE(timing_model,'" + TimingModelLegacy + "') FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE"
	var r RuntimeRow
	var active sql.NullString
	if err := q.QueryRowContext(ctx, sel, scheduleID).Scan(&r.ID, &r.ScheduleID, &r.ExamID, &r.Status, &active, &r.Revision, &r.TimingModel); err != nil {
		if err == sql.ErrNoRows {
			return nil, &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Runtime not found.", HTTPStatus: 404}
		}
		return nil, err
	}
	if active.Valid {
		v := active.String
		r.ActiveSectionKey = &v
	}
	return &r, nil
}

// Start creates a live runtime with section rows (attempt locks first). It
// is idempotent for a live runtime: when the schedule already owns a
// live/paused runtime the existing id is returned; any other existing row
// (or a raced concurrent INSERT on UNIQUE schedule_id) is a stable 409.
func (s *Service) Start(ctx context.Context, scheduleID, examID string, plan []PlanEntry, timingModel, actorID string) (string, error) {
	if timingModel == "" {
		timingModel = TimingModelLegacy
	}
	runtimeID := uuid.NewString()
	existingID := ""
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := lockAttemptsFirst(ctx, q, scheduleID); err != nil {
			return err
		}
		var id, status string
		err := q.QueryRowContext(ctx, "SELECT id, status FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE", scheduleID).Scan(&id, &status)
		switch {
		case err == nil:
			if status == StatusLive || status == StatusPaused {
				existingID = id
				return nil
			}
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime already exists for this schedule.", HTTPStatus: 409}
		case err != sql.ErrNoRows:
			return err
		}
		var firstKey *string
		var firstSecs int64
		if len(plan) > 0 {
			firstKey = &plan[0].SectionKey
			firstSecs = int64(plan[0].DurationMinutes) * 60
		}
		var providerKey string
		if err := q.QueryRowContext(ctx, "SELECT provider_key FROM exam_entities WHERE id = ? FOR UPDATE", examID).Scan(&providerKey); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Exam not found.", HTTPStatus: 404}
			}
			return err
		}
		planJSON, _ := json.Marshal(plan)
		const ins = "INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model, actual_start_at, actual_end_at, active_section_key, current_section_key, current_section_remaining_seconds, waiting_for_next_section, is_overrun, total_paused_seconds, created_at, updated_at, revision) VALUES (?, ?, ?, ?, 'live', ?, ?, UTC_TIMESTAMP(6), NULL, ?, ?, ?, false, false, 0, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), 1)"
		if _, err := q.ExecContext(ctx, ins, runtimeID, scheduleID, examID, providerKey, string(planJSON), timingModel, firstKey, firstKey, firstSecs); err != nil {
			if isDupKey(err) {
				return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime already exists for this schedule.", HTTPStatus: 409}
			}
			return err
		}
		for i, entry := range plan {
			status := SectionLocked
			var availExpr, startExpr string
			if i == 0 {
				status = SectionLive
				availExpr = "UTC_TIMESTAMP(6)"
				startExpr = "UTC_TIMESTAMP(6)"
			} else {
				availExpr = "NULL"
				startExpr = "NULL"
			}
			stmt := "INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, label, section_order, planned_duration_minutes, gap_after_minutes, status, available_at, actual_start_at, actual_end_at, paused_at, accumulated_paused_seconds, extension_minutes, completion_reason, projected_start_at, projected_end_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, " + availExpr + ", " + startExpr + ", NULL, NULL, 0, 0, NULL, NULL, NULL)"
			if _, err := q.ExecContext(ctx, stmt, uuid.NewString(), runtimeID, entry.SectionKey, entry.Label, entry.Order, entry.DurationMinutes, entry.GapAfterMinutes, status); err != nil {
				return err
			}
		}
		const schedLive = "UPDATE exam_schedules SET status = 'live', updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
		if _, err := q.ExecContext(ctx, schedLive, scheduleID); err != nil {
			return err
		}
		if len(plan) > 0 {
			if err := SyncV2TimingInTx(ctx, q, scheduleID, runtimeID, plan[0].SectionKey, strptr("running")); err != nil {
				return err
			}
		}
		if err := insertControlEvent(ctx, q, runtimeID, scheduleID, actorID, controlStartAction, nil, nil, nil); err != nil {
			return err
		}
		return s.emitRuntimeChanged(ctx, q, scheduleID, 1, "start_runtime")
	})
	if err != nil {
		return "", err
	}
	// B2: post-commit snapshot invalidation (nil-safe when hook unset).
	s.invalidated(scheduleID)
	if existingID != "" {
		return existingID, nil
	}
	return runtimeID, nil
}

func isDupKey(err error) bool {
	if err == nil {
		return false
	}
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "duplicate") || strings.Contains(s, "1062")
}

// PlanEntry is one authored section used at Start.
type PlanEntry struct {
	SectionKey      string `json:"sectionKey"`
	Label           string `json:"label"`
	Order           int    `json:"order"`
	DurationMinutes int    `json:"durationMinutes"`
	GapAfterMinutes int    `json:"gapAfterMinutes"`
}

// Pause transitions live->paused with control_epoch bump + V2 sync.
func (s *Service) Pause(ctx context.Context, scheduleID string, fence RevisionFence, reason *string, actorID string) error {
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := lockAttemptsFirst(ctx, q, scheduleID); err != nil {
			return err
		}
		rt, err := lockRuntime(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if rt.Status != StatusLive {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime is not live.", HTTPStatus: 409}
		}
		if err := CheckFence(rt.Revision, rt.ActiveSectionKey, fence); err != nil {
			return err
		}
		if rt.ActiveSectionKey == nil || *rt.ActiveSectionKey == "" {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime has no active section.", HTTPStatus: 409}
		}
		active := *rt.ActiveSectionKey
		const setPaused = "UPDATE exam_session_runtimes SET status = 'paused', updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
		if _, err := q.ExecContext(ctx, setPaused, rt.ID); err != nil {
			return err
		}
		const secPaused = "UPDATE exam_session_runtime_sections SET status = 'paused', paused_at = UTC_TIMESTAMP(6) WHERE runtime_id = ? AND section_key = ?"
		if _, err := q.ExecContext(ctx, secPaused, rt.ID, active); err != nil {
			return err
		}
		if err := pauseSATModules(ctx, q, scheduleID); err != nil {
			return err
		}
		if err := SyncV2TimingInTx(ctx, q, scheduleID, rt.ID, active, strptr("paused")); err != nil {
			return err
		}
		if err := insertControlEvent(ctx, q, rt.ID, scheduleID, actorID, controlPauseAction, &active, nil, reason); err != nil {
			return err
		}
		return s.emitRuntimeChanged(ctx, q, scheduleID, rt.Revision+1, eventWithReason("pause_runtime", reason))
	})
	if err != nil {
		return err
	}
	// B2: post-commit snapshot invalidation (nil-safe when hook unset).
	s.invalidated(scheduleID)
	return nil
}

// Resume transitions paused->live, accumulating paused seconds + V2 sync.
func (s *Service) Resume(ctx context.Context, scheduleID string, fence RevisionFence, actorID string) error {
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := lockAttemptsFirst(ctx, q, scheduleID); err != nil {
			return err
		}
		rt, err := lockRuntime(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if rt.Status != StatusPaused {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime is not paused.", HTTPStatus: 409}
		}
		if err := CheckFence(rt.Revision, rt.ActiveSectionKey, fence); err != nil {
			return err
		}
		if rt.ActiveSectionKey == nil || *rt.ActiveSectionKey == "" {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime has no active section.", HTTPStatus: 409}
		}
		active := *rt.ActiveSectionKey
		var pausedAny any
		if err := q.QueryRowContext(ctx, "SELECT paused_at FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE", rt.ID, active).Scan(&pausedAny); err != nil {
			return err
		}
		var serverAny any
		if err := q.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&serverAny); err != nil {
			return err
		}
		serverNow, ok := asTime(serverAny)
		if !ok {
			return fmt.Errorf("runtime: invalid UTC_TIMESTAMP(6)")
		}
		pausedSecs := int64(0)
		if pausedAt, ok := asTime(pausedAny); ok {
			if d := serverNow.Sub(pausedAt); d > 0 {
				pausedSecs = int64(d / time.Second)
			}
		}
		const setLive = "UPDATE exam_session_runtimes SET status = 'live', total_paused_seconds = total_paused_seconds + ?, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
		if _, err := q.ExecContext(ctx, setLive, pausedSecs, rt.ID); err != nil {
			return err
		}
		const secLive = "UPDATE exam_session_runtime_sections SET status = 'live', paused_at = NULL, accumulated_paused_seconds = accumulated_paused_seconds + ? WHERE runtime_id = ? AND section_key = ?"
		if _, err := q.ExecContext(ctx, secLive, pausedSecs, rt.ID, active); err != nil {
			return err
		}
		if err := resumeSATModules(ctx, q, scheduleID); err != nil {
			return err
		}
		if err := SyncV2TimingInTx(ctx, q, scheduleID, rt.ID, active, strptr("running")); err != nil {
			return err
		}
		if err := insertControlEvent(ctx, q, rt.ID, scheduleID, actorID, controlResumeAction, &active, nil, nil); err != nil {
			return err
		}
		return s.emitRuntimeChanged(ctx, q, scheduleID, rt.Revision+1, "resume_runtime")
	})
	if err != nil {
		return err
	}
	// B2: post-commit snapshot invalidation (nil-safe when hook unset).
	s.invalidated(scheduleID)
	return nil
}

// Extend adds minutes to the active section + cohort clocks with V2 sync.
func (s *Service) Extend(ctx context.Context, scheduleID string, fence RevisionFence, minutes int64, reason *string) error {
	if minutes <= 0 {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Extension minutes must be greater than zero.", HTTPStatus: 400}
	}
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := lockAttemptsFirst(ctx, q, scheduleID); err != nil {
			return err
		}
		rt, err := lockRuntime(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if rt.Status != StatusLive && rt.Status != StatusPaused {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime is not extendable.", HTTPStatus: 409}
		}
		if err := CheckFence(rt.Revision, rt.ActiveSectionKey, fence); err != nil {
			return err
		}
		if rt.ActiveSectionKey == nil || *rt.ActiveSectionKey == "" {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime has no active section.", HTTPStatus: 409}
		}
		active := *rt.ActiveSectionKey
		const extSec = "UPDATE exam_session_runtime_sections SET extension_minutes = extension_minutes + ?, projected_end_at = DATE_ADD(COALESCE(projected_end_at, UTC_TIMESTAMP(6)), INTERVAL ? MINUTE) WHERE runtime_id = ? AND section_key = ?"
		if _, err := q.ExecContext(ctx, extSec, minutes, minutes, rt.ID, active); err != nil {
			return err
		}
		const bumpRt = "UPDATE exam_session_runtimes SET current_section_remaining_seconds = current_section_remaining_seconds + (? * 60), updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
		if _, err := q.ExecContext(ctx, bumpRt, minutes, rt.ID); err != nil {
			return err
		}
		if err := extendSATModules(ctx, q, scheduleID, minutes); err != nil {
			return err
		}
		if err := SyncV2TimingInTx(ctx, q, scheduleID, rt.ID, active, nil); err != nil {
			return err
		}
		return s.emitRuntimeChanged(ctx, q, scheduleID, rt.Revision+1, eventWithReason("extend_section", reason))
	})
	if err != nil {
		return err
	}
	// B2: post-commit snapshot invalidation (nil-safe when hook unset).
	s.invalidated(scheduleID)
	return nil
}

// Complete finishes the runtime and every section (attempt locks first).
func (s *Service) Complete(ctx context.Context, scheduleID, completionReason, actorID string) error {
	if completionReason == "" {
		completionReason = "proctor_complete"
	}
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := lockAttemptsFirst(ctx, q, scheduleID); err != nil {
			return err
		}
		rt, err := lockRuntime(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if rt.Status == StatusCompleted || rt.Status == StatusCancelled {
			return nil
		}
		if err := CompleteInTx(ctx, q, scheduleID, rt.ID, completionReason); err != nil {
			return err
		}
		if err := InsertControlEvent(ctx, q, rt.ID, scheduleID, actorID, controlCompleteAction, nil, nil, strptr(completionReason)); err != nil {
			return err
		}
		return s.emitRuntimeChanged(ctx, q, scheduleID, rt.Revision+1, completionReason)
	})
	if err != nil {
		return err
	}
	// B2: post-commit snapshot invalidation (nil-safe when hook unset).
	s.invalidated(scheduleID)
	return nil
}

// SyncV2Timing re-projects protocol-2 attempt deadlines from the locked section.
func (s *Service) SyncV2Timing(ctx context.Context, scheduleID, runtimeID, sectionKey string, lifecycle *string) error {
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		return SyncV2TimingInTx(ctx, q, scheduleID, runtimeID, sectionKey, lifecycle)
	})
}

// SyncV2TimingInTx re-projects deadline=actual_start+(planned+extension)*60+paused,
// grace=+5s, only for protocol 2 non-terminal attempts. control_epoch+1 fences
// in-flight V2 writers. lifecycle nil leaves delivery/phase untouched.
func SyncV2TimingInTx(ctx context.Context, q tx.Tx, scheduleID, runtimeID, sectionKey string, lifecycle *string) error {
	lifecycleAssign := ""
	switch s := strval(lifecycle); s {
	case "paused":
		lifecycleAssign = "delivery_status = CASE WHEN COALESCE(sa.delivery_status, 'running') IN ('submitted', 'terminated', 'locked', 'cancelled') THEN sa.delivery_status ELSE 'paused' END, phase = CASE WHEN sa.phase IN ('pre-check', 'post-exam') THEN sa.phase ELSE 'exam' END,"
	case "running":
		lifecycleAssign = "delivery_status = CASE WHEN COALESCE(sa.proctor_status, 'active') = 'paused' OR COALESCE(sa.delivery_status, 'running') IN ('submitted', 'terminated', 'locked', 'cancelled') THEN sa.delivery_status ELSE 'running' END, phase = CASE WHEN sa.phase IN ('pre-check', 'post-exam') THEN sa.phase ELSE 'exam' END,"
	case "":
		lifecycleAssign = ""
	default:
		lifecycleAssign = ""
	}
	graceSeconds := int(SectionClosingGrace / time.Second)
	stmt := fmt.Sprintf("UPDATE student_attempts sa "+
		"JOIN exam_session_runtime_sections rs ON rs.runtime_id = ? AND rs.section_key = ? "+
		"SET "+lifecycleAssign+
		" deadline_at = CASE WHEN rs.actual_start_at IS NULL THEN sa.deadline_at ELSE DATE_ADD(rs.actual_start_at, INTERVAL (((rs.planned_duration_minutes + rs.extension_minutes) * 60) + rs.accumulated_paused_seconds) SECOND) END,"+
		" closing_grace_until = CASE WHEN rs.actual_start_at IS NULL THEN sa.closing_grace_until ELSE DATE_ADD(DATE_ADD(rs.actual_start_at, INTERVAL (((rs.planned_duration_minutes + rs.extension_minutes) * 60) + rs.accumulated_paused_seconds) SECOND), INTERVAL %d SECOND) END,"+
		" control_epoch = sa.control_epoch + 1,"+
		" revision = sa.revision + 1,"+
		" updated_at = UTC_TIMESTAMP(6) "+
		"WHERE sa.schedule_id = ? "+
		"AND sa.protocol_version = 2 "+
		"AND sa.submitted_at IS NULL "+
		"AND COALESCE(sa.delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')", graceSeconds)
	_, err := q.ExecContext(ctx, stmt, runtimeID, sectionKey, scheduleID)
	return err
}

func (s *Service) emitRuntimeChanged(ctx context.Context, q tx.Tx, scheduleID string, revision int64, event string) error {
	// B4.1: exec-only mode skips wakeup-family INSERTs (live moves to Hub in C).
	if s != nil && s.outboxExecOnly {
		return nil
	}
	payload, _ := json.Marshal(map[string]any{"scheduleId": scheduleID, "event": event})
	return s.outbx.EnqueueInTx(ctx, q, "schedule_runtime", scheduleID, revision, outbox.FamilyRuntimeChanged, payload)
}

// CompleteInTx finishes the runtime, its sections, and the schedule inside the
// caller's transaction. It is the single writer of the completed state — the
// proctor CompleteExam path calls it too, so the two completion owners the
// earlier passes kept in sync by hand cannot drift again.
func CompleteInTx(ctx context.Context, q tx.Tx, scheduleID, runtimeID, completionReason string) error {
	const doneRt = "UPDATE exam_session_runtimes SET status = 'completed', actual_end_at = UTC_TIMESTAMP(6), active_section_key = NULL, current_section_key = NULL, current_section_remaining_seconds = 0, waiting_for_next_section = false, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
	if _, err := q.ExecContext(ctx, doneRt, runtimeID); err != nil {
		return err
	}
	const doneSec = "UPDATE exam_session_runtime_sections SET status = 'completed', actual_end_at = COALESCE(actual_end_at, UTC_TIMESTAMP(6)), completion_reason = COALESCE(completion_reason, ?), paused_at = NULL WHERE runtime_id = ?"
	if _, err := q.ExecContext(ctx, doneSec, completionReason, runtimeID); err != nil {
		return err
	}
	const doneSched = "UPDATE exam_schedules SET status = 'completed', updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
	if _, err := q.ExecContext(ctx, doneSched, scheduleID); err != nil {
		return err
	}
	return nil
}

// InsertControlEvent is the package-level control-event writer shared by the
// runtime command path and the proctor command path.
func InsertControlEvent(ctx context.Context, q tx.Tx, runtimeID, scheduleID, actorID, action string, sectionKey *string, minutes *int64, reason *string) error {
	return insertControlEvent(ctx, q, runtimeID, scheduleID, actorID, action, sectionKey, minutes, reason)
}

func insertControlEvent(ctx context.Context, q tx.Tx, runtimeID, scheduleID, actorID, action string, sectionKey *string, minutes *int64, reason *string) error {
	// Resolve runtime/exam identity in SQL so the control record cannot be
	// detached from the state transition that created it.
	const ins = "INSERT INTO cohort_control_events (id, schedule_id, runtime_id, exam_id, actor_id, action, section_key, minutes, reason, payload, created_at) VALUES (?, ?, (SELECT id FROM exam_session_runtimes WHERE id = ?), (SELECT exam_id FROM exam_schedules WHERE id = ?), ?, ?, ?, ?, ?, NULL, UTC_TIMESTAMP(6))"
	_, err := q.ExecContext(ctx, ins, uuid.NewString(), scheduleID, runtimeID, scheduleID, actorID, action, sectionKey, minutes, reason)
	return err
}

func pauseSATModules(ctx context.Context, q tx.Tx, scheduleID string) error {
	const stmt = "UPDATE assessment_module_attempts ma JOIN student_attempts sa ON sa.id = ma.attempt_id JOIN exam_entities e ON e.id = sa.exam_id SET ma.paused_at = COALESCE(ma.paused_at, UTC_TIMESTAMP(6)), ma.revision = ma.revision + 1 WHERE sa.schedule_id = ? AND e.provider_key = 'sat' AND ma.state = 'active' AND ma.started_at IS NOT NULL AND ma.paused_at IS NULL"
	_, err := q.ExecContext(ctx, stmt, scheduleID)
	return err
}

func resumeSATModules(ctx context.Context, q tx.Tx, scheduleID string) error {
	const stmt = "UPDATE assessment_module_attempts ma JOIN student_attempts sa ON sa.id = ma.attempt_id JOIN exam_entities e ON e.id = sa.exam_id SET ma.accumulated_paused_seconds = ma.accumulated_paused_seconds + GREATEST(TIMESTAMPDIFF(SECOND, ma.paused_at, UTC_TIMESTAMP(6)), 0), ma.paused_at = NULL, ma.revision = ma.revision + 1 WHERE sa.schedule_id = ? AND e.provider_key = 'sat' AND ma.state = 'active' AND ma.paused_at IS NOT NULL"
	_, err := q.ExecContext(ctx, stmt, scheduleID)
	return err
}

// ExtendSATModulesInTx extends every active started SAT module attempt of a
// schedule; shared with the proctor ExtendSection path.
func ExtendSATModulesInTx(ctx context.Context, q tx.Tx, scheduleID string, minutes int64) error {
	return extendSATModules(ctx, q, scheduleID, minutes)
}

func extendSATModules(ctx context.Context, q tx.Tx, scheduleID string, minutes int64) error {
	const stmt = "UPDATE assessment_module_attempts ma JOIN student_attempts sa ON sa.id = ma.attempt_id JOIN exam_entities e ON e.id = sa.exam_id SET ma.extension_seconds = ma.extension_seconds + (? * 60), ma.revision = ma.revision + 1 WHERE sa.schedule_id = ? AND e.provider_key = 'sat' AND ma.state = 'active' AND ma.started_at IS NOT NULL"
	_, err := q.ExecContext(ctx, stmt, minutes, scheduleID)
	return err
}

func eventWithReason(event string, reason *string) string {
	if reason == nil || *reason == "" {
		return event
	}
	return event + ":" + *reason
}

func strptr(s string) *string { v := s; return &v }

// asTime coerces driver time representations (time.Time, or TEXT when the DSN
// lacks parseTime) to UTC. It reports false for NULL/unparseable values.
func asTime(v any) (time.Time, bool) {
	switch t := v.(type) {
	case nil:
		return time.Time{}, false
	case time.Time:
		return t.UTC(), true
	case []byte:
		return parseDBTime(string(t))
	case string:
		return parseDBTime(t)
	default:
		return time.Time{}, false
	}
}

func parseDBTime(s string) (time.Time, bool) {
	s = strings.TrimSpace(s)
	if s == "" {
		return time.Time{}, false
	}
	for _, layout := range []string{"2006-01-02 15:04:05.999999", "2006-01-02 15:04:05", time.RFC3339Nano, time.RFC3339, "2006-01-02T15:04:05.999999"} {
		if t, err := time.ParseInLocation(layout, s, time.UTC); err == nil {
			return t.UTC(), true
		}
	}
	return time.Time{}, false
}

func strval(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

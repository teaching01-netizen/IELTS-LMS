// Package proctor owns proctor commands: per-attempt warn|pause|resume|extend|
// terminate, schedule end-section-now|extend-section|complete-exam, presence,
// and alert acknowledgement.
//
// Authorization is enforced at the service layer: every write requires an
// Admin|Proctor actor PLUS a live schedule assignment PLUS a CSRF-verified
// caller. The HTTP layer authenticates the session and verifies the CSRF
// token, then passes a verified Actor into each method; the service re-checks
// role + assignment here so a direct service caller cannot bypass either gate.
//
// Effects:
//
//	warn inserts a PROCTOR_WARNING violation row and moves the attempt to warned
//	(non-blocking: delivery_status is untouched).
//	pause/resume are protocol-aware (V2 delivery + deadline/grace shift) with a
//	 control_epoch+1 bump and schedule_roster/attempt_changed outbox rows.
//	terminate seals ONLY via the terminalization service as
//	 terminated/proctor_terminate/proctor — never a direct status write.
//	complete-exam completes the runtime and auto-submits via proctor_complete.
//	end-section-now rejects SAT/adaptive + IELTS-authentic schedules and
//	queues auto-submit when the final IELTS section is ended.
//	extend-section advances cohort clocks + sync_v2 reprojection.
//	extend-attempt on a provisional (post-submit) attempt REJECTS with a
//	 Conflict (post-submit cannot resume).
//
// Lock order everywhere: attempt -> runtime -> section.
// Every per-attempt command locks the attempt row (FOR UPDATE) before the
// runtime row and section rows; schedule commands lock schedule attempt rows
// before runtime/section rows — the same order as terminalization and runtime.
package proctor

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
	terminalization "example.com/ielts-proctoring/internal/terminalization"
)

// Actor roles permitted to issue proctor writes.
const (
	RoleAdmin   = "admin"
	RoleBuilder = "builder"
	RoleProctor = "proctor"
)

// Actor is the verified caller identity passed by the HTTP layer AFTER it has
// authenticated the session, verified the CSRF token, and loaded the actor
// role. CSRFVerified must be true: the service rejects unverified callers
// even when role + assignment would otherwise pass.
type Actor struct {
	ID           string
	Role         string
	CSRFVerified bool
}

// AttemptCommand is a per-attempt proctor command envelope.
type AttemptCommand struct {
	Message                 *string
	Reason                  *string
	ExpectedRuntimeRevision *int64
	ExpectedSectionKey      *string
}

// ExtendSectionCommand extends the active cohort section.
type ExtendSectionCommand struct {
	Minutes                 int64
	Reason                  *string
	ExpectedRuntimeRevision *int64
	ExpectedSectionKey      *string
}

// CompleteExamCommand completes the exam.
type CompleteExamCommand struct {
	Reason *string
}

// PresenceAction is join|heartbeat|leave.
type PresenceAction string

const (
	PresenceJoin      PresenceAction = "join"
	PresenceHeartbeat PresenceAction = "heartbeat"
	PresenceLeave     PresenceAction = "leave"
)

// Terminalizer is the terminalization.Service surface used by Terminate.
// Terminate seals ONLY via this interface as terminated/proctor_terminate/proctor.
type Terminalizer interface {
	Terminalize(ctx context.Context, cmd terminalization.SealCommand) (*terminalization.SealResult, error)
}

// OutboxEnqueuer is the minimal in-tx outbox hook (roster/attempt_changed).
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

// AssignmentChecker reports whether actorID holds a live staff assignment for
// the schedule. Implementations query schedule_staff_assignments for a
// non-revoked row; test fakes may use an in-memory allow-list.
type AssignmentChecker interface {
	HasLiveAssignment(ctx context.Context, q tx.Tx, scheduleID, actorID string) (bool, error)
}

// SQLAssignmentChecker reads live assignments in-tx.
type SQLAssignmentChecker struct{}

// HasLiveAssignment reports a non-revoked staff assignment row.
func (SQLAssignmentChecker) HasLiveAssignment(ctx context.Context, q tx.Tx, scheduleID, actorID string) (bool, error) {
	const sel = "SELECT EXISTS(SELECT 1 FROM schedule_staff_assignments WHERE schedule_id = ? AND (actor_id = ? OR user_id = ?) AND revoked_at IS NULL)"
	var exists int64
	if err := q.QueryRowContext(ctx, sel, scheduleID, actorID, actorID).Scan(&exists); err != nil {
		return false, err
	}
	return exists == 1, nil
}

// Service owns proctor commands with constructor injection.
type Service struct {
	tx     *tx.Runner
	db     tx.DB
	seal   Terminalizer
	outbx  OutboxEnqueuer
	assign AssignmentChecker
	// onCommitted fires after a runtime-mutating command commits (B2
	// snapshot invalidation). Nil disables (tests leave it unset).
	onCommitted func(scheduleID string)
	// outboxExecOnly skips wakeup-family INSERTs (B4.1 OUTBOX_EXEC_ONLY).
	outboxExecOnly bool
}

// SetOutboxExecOnly toggles B4.1 executable-only enqueueing (chainable).
func (s *Service) SetOutboxExecOnly(on bool) *Service {
	s.outboxExecOnly = on
	return s
}

// enqueueWakeup guards wakeup-family INSERTs behind the exec-only posture:
// on = skip (live moves to Hub in Phase C); off = enqueue (today).
// Executable families (auto-submit) never route here.
func (s *Service) enqueueWakeup(ctx context.Context, q tx.Tx, aggregateKind, aggregateID string, revision int64, eventFamily string, payload json.RawMessage) error {
	if s != nil && s.outboxExecOnly {
		return nil
	}
	return s.outbx.EnqueueInTx(ctx, q, aggregateKind, aggregateID, revision, eventFamily, payload)
}

// SetSnapshotInvalidator wires post-commit snapshot invalidation (B2).
// Callers (BuildApp) pass the shared SnapshotCache.Invalidate; nil clears.
func (s *Service) SetSnapshotInvalidator(fn func(scheduleID string)) *Service {
	s.onCommitted = fn
	return s
}

// invalidated runs the post-commit hook when set.
func (s *Service) invalidated(scheduleID string) {
	if s != nil && s.onCommitted != nil {
		s.onCommitted(scheduleID)
	}
}

// NewService builds the proctor service. seal may be a
// *terminalization.Service; outbx/assign default to SQL implementations.
func NewService(runner *tx.Runner, db tx.DB, seal Terminalizer, outbx OutboxEnqueuer, assign AssignmentChecker) *Service {
	if outbx == nil {
		outbx = SQLOutboxEnqueuer{}
	}
	if assign == nil {
		assign = SQLAssignmentChecker{}
	}
	return &Service{tx: runner, db: db, seal: seal, outbx: outbx, assign: assign}
}

// authorizeWrite enforces Admin|Proctor + CSRF at the service layer. The
// builder role is accepted only for reserved preview schedules; the HTTP
// layer separately verifies the builder's exam tenant before calling this
// service. Admins have the same schedule-wide override as the Rust route;
// proctors remain scoped to a live assignment. Reads of the schedule row use
// the tx handle so the assignment check observes the command's own snapshot.
func (s *Service) authorizeWrite(ctx context.Context, q tx.Tx, actor Actor, scheduleID string) error {
	if actor.Role != RoleAdmin && actor.Role != RoleBuilder && actor.Role != RoleProctor {
		return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Schedule not found.", HTTPStatus: 404}
	}
	if !actor.CSRFVerified {
		// Wire value must be CSRF_REJECTED (matches VerifyCSRF
		// normalization in internal/auth); CodeCSRF never hits the wire.
		return &apperrors.Error{Code: apperrors.Code("CSRF_REJECTED"), Message: "CSRF verification failed.", HTTPStatus: 403}
	}
	if actor.Role == RoleAdmin {
		return nil
	}
	if actor.Role == RoleBuilder {
		var cohortName string
		if err := q.QueryRowContext(ctx, "SELECT cohort_name FROM exam_schedules WHERE id = ?", scheduleID).Scan(&cohortName); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Schedule not found.", HTTPStatus: 404}
			}
			return err
		}
		if !strings.HasPrefix(strings.TrimSpace(cohortName), "__preview_runtime__:") {
			return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Schedule not found.", HTTPStatus: 404}
		}
		return nil
	}
	ok, err := s.assign.HasLiveAssignment(ctx, q, scheduleID, actor.ID)
	if err != nil {
		return err
	}
	if !ok {
		return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Schedule not found.", HTTPStatus: 404}
	}
	return nil
}

// lockAttemptScope locks the attempt row FOR UPDATE, then the schedule
// runtime row + active section row FOR UPDATE (attempt -> runtime -> section).
func lockAttemptScope(ctx context.Context, q tx.Tx, scheduleID, attemptID string) error {
	const lockAttempt = "SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE"
	var id string
	if err := q.QueryRowContext(ctx, lockAttempt, attemptID, scheduleID).Scan(&id); err != nil {
		if err == sql.ErrNoRows {
			return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Attempt not found.", HTTPStatus: 404}
		}
		return err
	}
	const lockRuntime = "SELECT id, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE"
	var runtimeID sql.NullString
	var active sql.NullString
	if err := q.QueryRowContext(ctx, lockRuntime, scheduleID).Scan(&runtimeID, &active); err != nil && err != sql.ErrNoRows {
		return err
	}
	if runtimeID.Valid && active.Valid && active.String != "" {
		const lockSection = "SELECT id FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ? FOR UPDATE"
		var sectionID string
		_ = q.QueryRowContext(ctx, lockSection, runtimeID.String, active.String).Scan(&sectionID)
	}
	return nil
}

// lockScheduleScope locks the runtime row and its sections (B2: the
// schedule-wide attempt sweep is gone — one schedule no longer serializes
// the whole cohort behind one admin click. Attempt-scoped effects flow via
// enqueueAutoSubmitForSchedule's non-locking capture + worker-side batched
// seal through the outbox). Lock order stays runtime -> section, matching
// terminalization and runtime command discipline.
func lockScheduleScope(ctx context.Context, q tx.Tx, scheduleID string) error {
	const lockRuntime = "SELECT id FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE"
	var runtimeID string
	err := q.QueryRowContext(ctx, lockRuntime, scheduleID).Scan(&runtimeID)
	if err != nil && err != sql.ErrNoRows {
		return err
	}
	if err == nil {
		const lockSections = "SELECT id FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE"
		srows, err := q.QueryContext(ctx, lockSections, runtimeID)
		if err != nil {
			return err
		}
		func() {
			defer srows.Close()
			for srows.Next() {
				var id string
				_ = srows.Scan(&id)
			}
		}()
		if err := srows.Err(); err != nil {
			return err
		}
	}
	return nil
}

// enqueueAutoSubmitForSchedule enqueues a scan job for the worker: the
// payload carries only the schedule identity (no attempt-ID list), and the
// worker pages eligible attempts by id cursor at execution time
// (executeOutboxEvent falls back to listAutoSubmitAttempts when
// attemptIds is empty, so old rows carrying IDs still drain). The old
// whole-cohort SELECT + embedded attemptIds[] is gone: it held the control
// tx open over an unbounded cohort scan and produced unbounded JSON
// payloads. Eligibility is still checked per attempt at seal time, so a
// committed completion always has a durable auto-submit job and late or
// concurrent submissions simply seal as no-ops. Receipt-first
// terminalization is preserved without opening a nested transaction here.
func (s *Service) enqueueAutoSubmitForSchedule(
	ctx context.Context,
	q tx.Tx,
	scheduleID string,
	revision int64,
	actorID string,
	reason string,
) error {
	// Cheap existence probe (1 row, no ID materialization): skip the outbox
	// row entirely when nothing is submittable, preserving the old
	// no-op behavior without the unbounded scan.
	var one string
	err := q.QueryRowContext(ctx, `
		SELECT id FROM student_attempts
		WHERE schedule_id = ?
		  AND submitted_at IS NULL
		  AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')
		  AND COALESCE(proctor_status, 'active') <> 'terminated'
		LIMIT 1`, scheduleID).Scan(&one)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}

	payload, err := json.Marshal(map[string]any{
		"scheduleId": scheduleID,
		"actorId":    actorID,
		"reason":     reason,
	})
	if err != nil {
		return err
	}
	return s.outbx.EnqueueInTx(ctx, q, "schedule_runtime", scheduleID, revision, outbox.FamilyAutoSubmitScheduleAttempts, payload)
}

// providerKeyOfSchedule resolves the exam provider for a schedule.
func providerKeyOfSchedule(ctx context.Context, q tx.Tx, scheduleID string) (string, error) {
	const sel = "SELECT e.provider_key FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id WHERE s.id = ?"
	var pk sql.NullString
	if err := q.QueryRowContext(ctx, sel, scheduleID).Scan(&pk); err != nil {
		if err == sql.ErrNoRows {
			return "", &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Schedule not found.", HTTPStatus: 404}
		}
		return "", err
	}
	if pk.Valid && pk.String != "" {
		return pk.String, nil
	}
	return "ielts", nil
}

// timingModelOfSchedule resolves the runtime timing model (empty = none).
func timingModelOfSchedule(ctx context.Context, q tx.Tx, scheduleID string) string {
	var tm sql.NullString
	_ = q.QueryRowContext(ctx, "SELECT timing_model FROM exam_session_runtimes WHERE schedule_id = ?", scheduleID).Scan(&tm)
	if tm.Valid {
		return tm.String
	}
	return ""
}

// ieltsAuthenticMode reports the IELTS authentic-mode policy flag.
func ieltsAuthenticMode(ctx context.Context, q tx.Tx, scheduleID string) bool {
	const sel = "SELECT v.config_snapshot FROM exam_schedules s JOIN exam_versions v ON v.id = s.published_version_id WHERE s.id = ?"
	var raw []byte
	if err := q.QueryRowContext(ctx, sel, scheduleID).Scan(&raw); err != nil || len(raw) == 0 {
		return false
	}
	var snap map[string]any
	if err := json.Unmarshal(raw, &snap); err != nil {
		return false
	}
	gen, _ := snap["general"].(map[string]any)
	flag, _ := gen["ieltsMode"].(bool)
	return flag
}

// Warn inserts a PROCTOR_WARNING violation row and moves the attempt to warned
// (non-blocking: delivery_status is untouched). Terminal attempts reject.
func (s *Service) Warn(ctx context.Context, actor Actor, scheduleID, attemptID string, cmd AttemptCommand) error {
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		if err := lockAttemptScope(ctx, q, scheduleID, attemptID); err != nil {
			return err
		}
		const term = "SELECT submitted_at, COALESCE(delivery_status, 'running') FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE"
		var submittedAny any
		var delivery string
		if err := q.QueryRowContext(ctx, term, attemptID, scheduleID).Scan(&submittedAny, &delivery); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Attempt not found.", HTTPStatus: 404}
			}
			return err
		}
		if submittedAny != nil {
			if t, ok := submittedAny.(time.Time); ok && !t.IsZero() {
				return terminalConflict("The attempt is already terminal and cannot accept a warning.")
			}
			if _, ok := submittedAny.([]byte); ok {
				return terminalConflict("The attempt is already terminal and cannot accept a warning.")
			}
			if str, ok := submittedAny.(string); ok && strings.TrimSpace(str) != "" {
				return terminalConflict("The attempt is already terminal and cannot accept a warning.")
			}
		}
		switch delivery {
		case "submitted", "terminated", "locked", "cancelled":
			return terminalConflict("The attempt is already terminal and cannot accept a warning.")
		}

		description := "Proctor warning issued."
		if cmd.Message != nil && strings.TrimSpace(*cmd.Message) != "" {
			description = *cmd.Message
		} else if cmd.Reason != nil && strings.TrimSpace(*cmd.Reason) != "" {
			description = *cmd.Reason
		}
		warningID := uuid.NewString()
		warnJSON, _ := json.Marshal(map[string]any{"id": warningID, "type": "PROCTOR_WARNING", "severity": "medium", "description": description})
		payload, _ := json.Marshal(map[string]any{"message": description})
		const ins = "INSERT INTO student_violation_events (id, schedule_id, attempt_id, violation_id, violation_type, severity, description, payload, created_at) VALUES (?, ?, ?, ?, 'PROCTOR_WARNING', 'medium', ?, ?, UTC_TIMESTAMP(6))"
		if _, err := q.ExecContext(ctx, ins, warningID, scheduleID, attemptID, warningID, description, string(payload)); err != nil {
			return err
		}
		const upd = "UPDATE student_attempts SET proctor_status = 'warned', proctor_note = ?, proctor_updated_at = UTC_TIMESTAMP(6), proctor_updated_by = ?, last_warning_id = ?, violations_snapshot = JSON_MERGE_PRESERVE(COALESCE(violations_snapshot, JSON_ARRAY()), ?), updated_at = UTC_TIMESTAMP(6), revision = revision + 1, control_epoch = control_epoch + 1 WHERE id = ? AND schedule_id = ?"
		if _, err := q.ExecContext(ctx, upd, description, actor.ID, warningID, string(warnJSON), attemptID, scheduleID); err != nil {
			return err
		}
		if err := insertAuditLog(ctx, q, scheduleID, actor.ID, "STUDENT_WARN", &attemptID, map[string]any{"message": cmd.Message, "warningId": warningID, "severity": "medium"}); err != nil {
			return err
		}
		return s.emitRoster(ctx, q, scheduleID, "warn_attempt", &attemptID, nil)
	})
}

// Pause moves a writable attempt to proctor paused (protocol-aware V2 delivery
// + control_epoch+1 bump) with roster/attempt_changed outbox rows.
func (s *Service) Pause(ctx context.Context, actor Actor, scheduleID, attemptID string, cmd AttemptCommand) error {
	return s.updateAttemptStatus(ctx, actor, scheduleID, attemptID, "paused", nil, "STUDENT_PAUSE", cmd)
}

// Resume moves a proctor-paused attempt back to active, shifting the V2
// deadline/grace forward by the paused duration (protocol-aware).
func (s *Service) Resume(ctx context.Context, actor Actor, scheduleID, attemptID string, cmd AttemptCommand) error {
	return s.updateAttemptStatus(ctx, actor, scheduleID, attemptID, "active", nil, "STUDENT_RESUME", cmd)
}

// ExtendAttempt grants per-student SAT module time. Provisional (post-submit)
// attempts REJECT with a Conflict: post-submit cannot resume.
func (s *Service) ExtendAttempt(ctx context.Context, actor Actor, scheduleID, attemptID string, minutes int64, cmd AttemptCommand) error {
	if minutes <= 0 {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Extension minutes must be greater than zero.", HTTPStatus: 400}
	}
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		if err := lockAttemptScope(ctx, q, scheduleID, attemptID); err != nil {
			return err
		}
		// Provisional extend-attempt: REJECT with Conflict (post-submit cannot resume).
		const term = "SELECT submitted_at, COALESCE(proctor_status,'active'), COALESCE(delivery_status,'running') FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE"
		var submittedAny any
		var proctorStatus, delivery string
		if err := q.QueryRowContext(ctx, term, attemptID, scheduleID).Scan(&submittedAny, &proctorStatus, &delivery); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Attempt not found.", HTTPStatus: 404}
			}
			return err
		}
		if isNonNullTime(submittedAny) || proctorStatus == "terminated" || delivery == "submitted" || delivery == "terminated" || delivery == "locked" || delivery == "cancelled" {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Post-submit attempts cannot be extended; the attempt is already terminal.", HTTPStatus: 409}
		}
		pk, err := providerKeyOfSchedule(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if pk != "sat" {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Per-student time extensions are currently supported for adaptive SAT attempts only.", HTTPStatus: 400}
		}
		if tm := timingModelOfSchedule(ctx, q, scheduleID); tm == "cohort_stage_v2" || tm == "cohort_section_v3" {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Individual time extensions are disabled for shared-clock SAT sessions; extend the active cohort section instead.", HTTPStatus: 400}
		}
		const ext = "UPDATE assessment_module_attempts SET extension_seconds = extension_seconds + (? * 60), revision = revision + 1 WHERE attempt_id = ? AND state = 'active' AND started_at IS NOT NULL"
		res, err := q.ExecContext(ctx, ext, minutes, attemptID)
		if err != nil {
			return err
		}
		if n, err := res.RowsAffected(); err != nil || n != 1 {
			if err != nil {
				return err
			}
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "The student does not have an active SAT module to extend.", HTTPStatus: 409}
		}
		const dl = "UPDATE student_attempts SET deadline_at = CASE WHEN deadline_at IS NULL THEN NULL ELSE DATE_ADD(deadline_at, INTERVAL ? MINUTE) END, closing_grace_until = CASE WHEN deadline_at IS NULL THEN closing_grace_until WHEN closing_grace_until IS NULL THEN DATE_ADD(deadline_at, INTERVAL 30 SECOND) ELSE DATE_ADD(closing_grace_until, INTERVAL ? MINUTE) END, control_epoch = control_epoch + 1, revision = revision + 1, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND schedule_id = ? AND protocol_version = 2 AND submitted_at IS NULL AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')"
		if _, err := q.ExecContext(ctx, dl, minutes, minutes, attemptID, scheduleID); err != nil {
			return err
		}
		if err := insertAuditLog(ctx, q, scheduleID, actor.ID, "EXTENSION_GRANTED", &attemptID, map[string]any{"scope": "attempt", "minutes": minutes, "reason": cmd.Reason}); err != nil {
			return err
		}
		return s.emitRoster(ctx, q, scheduleID, "extend_attempt", &attemptID, map[string]any{"minutes": minutes})
	})
}

// Terminate seals the attempt ONLY via the terminalization service as
// terminated/proctor_terminate/proctor — never a direct status write.
func (s *Service) Terminate(ctx context.Context, actor Actor, scheduleID, attemptID string, cmd AttemptCommand) error {
	if s.seal == nil {
		return &apperrors.Error{Code: apperrors.CodeInternal, Message: "Terminalization service is not configured.", HTTPStatus: 500}
	}
	// Authorize before sealing: Admin|Proctor + assignment + CSRF enforced at
	// the service layer even though the seal itself owns the terminal write.
	var authErr error
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		return lockAttemptScope(ctx, q, scheduleID, attemptID)
	})
	if err != nil {
		return err
	}
	_ = authErr
	actorID := actor.ID
	sealCmd := terminalization.SealCommand{
		AttemptID:   attemptID,
		ScheduleID:  scheduleID,
		Outcome:     terminalization.OutcomeTerminated,
		Reason:      terminalization.ReasonProctorTerminate,
		ActorKind:   terminalization.ActorProctor,
		ActorID:     &actorID,
		ProctorNote: cmd.Reason,
		RequestID:   uuid.NewString(),
	}
	if cmd.Message != nil && sealCmd.ProctorNote == nil {
		sealCmd.ProctorNote = cmd.Message
	}
	proj, _ := json.Marshal(map[string]any{"terminated": true, "reason": terminalization.ReasonProctorTerminate, "proctorStatus": "terminated"})
	sealCmd.FinalSubmission = proj
	_, err = s.seal.Terminalize(ctx, sealCmd)
	if err != nil {
		return err
	}
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := insertAuditLog(ctx, q, scheduleID, actor.ID, "STUDENT_TERMINATE", &attemptID, map[string]any{"message": cmd.Message, "reason": cmd.Reason}); err != nil {
			return err
		}
		return s.emitRoster(ctx, q, scheduleID, "STUDENT_TERMINATE", &attemptID, nil)
	})
}

// EndSectionNow completes the live section now and starts the next locked one
// (or completes the exam). It rejects SAT/adaptive schedules and IELTS
// authentic-mode schedules.
func (s *Service) EndSectionNow(ctx context.Context, actor Actor, scheduleID string, cmd AttemptCommand) error {
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		pk, err := providerKeyOfSchedule(ctx, q, scheduleID)
		if err != nil {
			return err
		}
		if pk == "sat" {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Adaptive SAT sections cannot be ended with a cohort section override. Use module timing or per-student controls so routing remains deterministic.", HTTPStatus: 400}
		}
		if ieltsAuthenticMode(ctx, q, scheduleID) {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Proctor section override is disabled in IELTS authentic mode.", HTTPStatus: 400}
		}
		if err := lockScheduleScope(ctx, q, scheduleID); err != nil {
			return err
		}
		const selRt = "SELECT id, status, active_section_key, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE"
		var runtimeID, status string
		var active sql.NullString
		var revision int64
		if err := q.QueryRowContext(ctx, selRt, scheduleID).Scan(&runtimeID, &status, &active, &revision); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Runtime not found.", HTTPStatus: 404}
			}
			return err
		}
		if status != "live" {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime must be live before ending a section.", HTTPStatus: 409}
		}
		if cmd.ExpectedRuntimeRevision != nil && revision != *cmd.ExpectedRuntimeRevision {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime changed; refresh before retrying.", HTTPStatus: 409}
		}
		if cmd.ExpectedSectionKey != nil {
			got := ""
			if active.Valid {
				got = active.String
			}
			if got != *cmd.ExpectedSectionKey {
				return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime changed; refresh before retrying.", HTTPStatus: 409}
			}
		}
		if !active.Valid || active.String == "" {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "No active section is available.", HTTPStatus: 409}
		}
		activeKey := active.String
		const selSecs = "SELECT section_key, section_order, planned_duration_minutes, extension_minutes, status FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE"
		rows, err := q.QueryContext(ctx, selSecs, runtimeID)
		if err != nil {
			return err
		}
		type sec struct {
			key          string
			order        int64
			planned, ext int64
			status       string
		}
		var secs []sec
		func() {
			defer rows.Close()
			for rows.Next() {
				var x sec
				_ = rows.Scan(&x.key, &x.order, &x.planned, &x.ext, &x.status)
				secs = append(secs, x)
			}
		}()
		if err := rows.Err(); err != nil {
			return err
		}
		activeIdx := -1
		for i, x := range secs {
			if x.key == activeKey {
				activeIdx = i
				break
			}
		}
		if activeIdx < 0 {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Active section row is missing.", HTTPStatus: 409}
		}
		nextIdx := -1
		for i := activeIdx + 1; i < len(secs); i++ {
			if secs[i].status == "locked" {
				nextIdx = i
				break
			}
		}
		const completionReason = "proctor_end"
		const doneSec = "UPDATE exam_session_runtime_sections SET status = 'completed', actual_end_at = UTC_TIMESTAMP(6), completion_reason = ?, paused_at = NULL WHERE runtime_id = ? AND section_key = ?"
		if _, err := q.ExecContext(ctx, doneSec, completionReason, runtimeID, activeKey); err != nil {
			return err
		}
		if nextIdx >= 0 {
			next := secs[nextIdx]
			const startNext = "UPDATE exam_session_runtime_sections SET status = 'live', available_at = COALESCE(available_at, UTC_TIMESTAMP(6)), actual_start_at = COALESCE(actual_start_at, UTC_TIMESTAMP(6)) WHERE runtime_id = ? AND section_key = ?"
			if _, err := q.ExecContext(ctx, startNext, runtimeID, next.key); err != nil {
				return err
			}
			const advRt = "UPDATE exam_session_runtimes SET active_section_key = ?, current_section_key = ?, current_section_remaining_seconds = ?, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
			if _, err := q.ExecContext(ctx, advRt, next.key, next.key, (next.planned+next.ext)*60, runtimeID); err != nil {
				return err
			}
			if err := syncV2(ctx, q, scheduleID, runtimeID, next.key, strptr("running")); err != nil {
				return err
			}
		} else {
			const doneRt = "UPDATE exam_session_runtimes SET status = 'completed', actual_end_at = UTC_TIMESTAMP(6), active_section_key = NULL, current_section_key = NULL, current_section_remaining_seconds = 0, waiting_for_next_section = false, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
			if _, err := q.ExecContext(ctx, doneRt, runtimeID); err != nil {
				return err
			}
			const doneSched = "UPDATE exam_schedules SET status = 'completed', updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
			if _, err := q.ExecContext(ctx, doneSched, scheduleID); err != nil {
				return err
			}
			if err := s.enqueueAutoSubmitForSchedule(
				ctx,
				q,
				scheduleID,
				revision+1,
				actor.ID,
				terminalization.ReasonProctorEnd,
			); err != nil {
				return err
			}
		}
		if err := insertControlEvent(ctx, q, runtimeID, scheduleID, actor.ID, "end_section_now", &activeKey, nil, cmd.Reason); err != nil {
			return err
		}
		if err := insertAuditLog(ctx, q, scheduleID, actor.ID, "SECTION_END", nil, map[string]any{"sectionKey": activeKey, "reason": cmd.Reason}); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{"scheduleId": scheduleID, "event": "end_section_now"})
		return s.enqueueWakeup(ctx, q, "schedule_runtime", scheduleID, revision+1, "runtime_changed", payload)
	})
	if err != nil {
		return err
	}
	// B2: post-commit snapshot invalidation (nil-safe when hook unset).
	s.invalidated(scheduleID)
	return nil
}

// ExtendSection adds minutes to the active cohort section, advances cohort
// clocks, and re-projects V2 timing (sync_v2).
func (s *Service) ExtendSection(ctx context.Context, actor Actor, scheduleID string, cmd ExtendSectionCommand) error {
	if cmd.Minutes <= 0 {
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Extension minutes must be greater than zero.", HTTPStatus: 400}
	}
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		if ieltsAuthenticMode(ctx, q, scheduleID) {
			return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Section extensions are disabled in IELTS authentic mode.", HTTPStatus: 400}
		}
		if err := lockScheduleScope(ctx, q, scheduleID); err != nil {
			return err
		}
		const selRt = "SELECT id, active_section_key, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE"
		var runtimeID string
		var active sql.NullString
		var revision int64
		if err := q.QueryRowContext(ctx, selRt, scheduleID).Scan(&runtimeID, &active, &revision); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Runtime not found.", HTTPStatus: 404}
			}
			return err
		}
		if cmd.ExpectedRuntimeRevision != nil && revision != *cmd.ExpectedRuntimeRevision {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime changed; refresh before retrying.", HTTPStatus: 409}
		}
		if cmd.ExpectedSectionKey != nil {
			got := ""
			if active.Valid {
				got = active.String
			}
			if got != *cmd.ExpectedSectionKey {
				return &apperrors.Error{Code: apperrors.CodeConflict, Message: "Runtime changed; refresh before retrying.", HTTPStatus: 409}
			}
		}
		if !active.Valid || active.String == "" {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "No active section is available.", HTTPStatus: 409}
		}
		activeKey := active.String
		const extSec = "UPDATE exam_session_runtime_sections SET extension_minutes = extension_minutes + ?, projected_end_at = DATE_ADD(COALESCE(projected_end_at, UTC_TIMESTAMP(6)), INTERVAL ? MINUTE) WHERE runtime_id = ? AND section_key = ?"
		if _, err := q.ExecContext(ctx, extSec, cmd.Minutes, cmd.Minutes, runtimeID, activeKey); err != nil {
			return err
		}
		const bumpRt = "UPDATE exam_session_runtimes SET current_section_remaining_seconds = current_section_remaining_seconds + (? * 60), updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
		if _, err := q.ExecContext(ctx, bumpRt, cmd.Minutes, runtimeID); err != nil {
			return err
		}
		const extSAT = "UPDATE assessment_module_attempts ma JOIN student_attempts sa ON sa.id = ma.attempt_id JOIN exam_entities e ON e.id = sa.exam_id SET ma.extension_seconds = ma.extension_seconds + (? * 60), ma.revision = ma.revision + 1 WHERE sa.schedule_id = ? AND e.provider_key = 'sat' AND ma.state = 'active' AND ma.started_at IS NOT NULL"
		if _, err := q.ExecContext(ctx, extSAT, cmd.Minutes, scheduleID); err != nil {
			return err
		}
		if err := syncV2(ctx, q, scheduleID, runtimeID, activeKey, nil); err != nil {
			return err
		}
		if err := insertControlEvent(ctx, q, runtimeID, scheduleID, actor.ID, "extend_section", &activeKey, &cmd.Minutes, cmd.Reason); err != nil {
			return err
		}
		if err := insertAuditLog(ctx, q, scheduleID, actor.ID, "EXTENSION_GRANTED", nil, map[string]any{"sectionKey": activeKey, "minutes": cmd.Minutes, "reason": cmd.Reason}); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{"scheduleId": scheduleID, "event": "extend_section"})
		return s.enqueueWakeup(ctx, q, "schedule_runtime", scheduleID, revision+1, "runtime_changed", payload)
	})
	if err != nil {
		return err
	}
	// B2: post-commit snapshot invalidation (nil-safe when hook unset).
	s.invalidated(scheduleID)
	return nil
}

// CompleteExam completes the runtime and auto-submits remaining attempts via
// the terminalization-compatible proctor_complete path. The per-attempt seal
// itself runs through the injected Terminalizer after this tx commits; this
// tx only advances the cohort clock so the seal race keeps receipt-first order.
//
// Reason hygiene: cmd.Reason is free-text operator context (audit/control
// events only). The auto-submit payload always carries the fixed
// terminalization vocabulary reason (proctor_complete) so the worker seal
// never fails vocabulary validation and exhausts its outbox retries.
func (s *Service) CompleteExam(ctx context.Context, actor Actor, scheduleID string, cmd CompleteExamCommand) error {
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		if err := lockScheduleScope(ctx, q, scheduleID); err != nil {
			return err
		}
		const selRt = "SELECT id, status, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE"
		var runtimeID, status string
		var revision int64
		if err := q.QueryRowContext(ctx, selRt, scheduleID).Scan(&runtimeID, &status, &revision); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Runtime not found.", HTTPStatus: 404}
			}
			return err
		}
		if status == "completed" || status == "cancelled" {
			return nil
		}
		const doneRt = "UPDATE exam_session_runtimes SET status = 'completed', actual_end_at = UTC_TIMESTAMP(6), active_section_key = NULL, current_section_key = NULL, current_section_remaining_seconds = 0, waiting_for_next_section = false, updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
		if _, err := q.ExecContext(ctx, doneRt, runtimeID); err != nil {
			return err
		}
		const doneSec = "UPDATE exam_session_runtime_sections SET status = 'completed', actual_end_at = COALESCE(actual_end_at, UTC_TIMESTAMP(6)), completion_reason = COALESCE(completion_reason, 'proctor_complete'), paused_at = NULL WHERE runtime_id = ?"
		if _, err := q.ExecContext(ctx, doneSec, runtimeID); err != nil {
			return err
		}
		const doneSched = "UPDATE exam_schedules SET status = 'completed', updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?"
		if _, err := q.ExecContext(ctx, doneSched, scheduleID); err != nil {
			return err
		}
		if err := insertControlEvent(ctx, q, runtimeID, scheduleID, actor.ID, "complete_runtime", nil, nil, cmd.Reason); err != nil {
			return err
		}
		if err := insertAuditLog(ctx, q, scheduleID, actor.ID, "SESSION_END", nil, map[string]any{"reason": cmd.Reason}); err != nil {
			return err
		}
		// The schedule lock above also locks every attempt in a stable order.
		// Capture the remaining writable attempts in the same transaction so a
		// committed runtime completion always has a durable auto-submit job.
		// cmd.Reason stays out of the seal path: it is free-text operator
		// context for audit/control rows, while the worker must seal with
		// the fixed terminalization vocabulary (proctor_complete).
		if err := s.enqueueAutoSubmitForSchedule(ctx, q, scheduleID, revision+1, actor.ID, terminalization.ReasonProctorComplete); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{"scheduleId": scheduleID, "event": "complete_exam"})
		return s.enqueueWakeup(ctx, q, "schedule_runtime", scheduleID, revision+1, "runtime_changed", payload)
	})
	if err != nil {
		return err
	}
	// B2: post-commit snapshot invalidation (nil-safe when hook unset).
	s.invalidated(scheduleID)
	return nil
}

// AutoSubmitAfterComplete seals one remaining attempt as auto-submit
// proctor_complete. Call after CompleteExam commits; each seal is its own
// receipt-first transaction via the injected Terminalizer.
func (s *Service) AutoSubmitAfterComplete(ctx context.Context, actor Actor, scheduleID, attemptID string) error {
	if s.seal == nil {
		return &apperrors.Error{Code: apperrors.CodeInternal, Message: "Terminalization service is not configured.", HTTPStatus: 500}
	}
	actorID := actor.ID
	proj, _ := json.Marshal(map[string]any{"autoSubmission": true, "completionReason": terminalization.ReasonProctorComplete, "proctorStatus": "terminated"})
	_, err := s.seal.Terminalize(ctx, terminalization.SealCommand{
		AttemptID: attemptID, ScheduleID: scheduleID,
		Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonProctorComplete,
		ActorKind: terminalization.ActorProctor, ActorID: &actorID,
		RequestID: uuid.NewString(), FinalSubmission: proj,
	})
	return err
}

// RecordPresence upserts proctor presence (join/heartbeat/leave). The
// presence row always belongs to the verified actor: a proctorID that
// disagrees with the actor is a 403 so direct service callers cannot spoof
// another proctor's row either.
func (s *Service) RecordPresence(ctx context.Context, actor Actor, scheduleID, proctorID, proctorName string, action PresenceAction) error {
	if err := s.requireWriterRole(actor); err != nil {
		return err
	}
	if proctorID != actor.ID {
		return &apperrors.Error{Code: apperrors.CodeForbidden, Message: "Presence identity mismatch.", HTTPStatus: 403}
	}
	switch action {
	case PresenceJoin, PresenceHeartbeat, PresenceLeave:
	default:
		return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Unknown presence action.", HTTPStatus: 400}
	}
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		switch action {
		case PresenceJoin, PresenceHeartbeat:
			const upsert = "INSERT INTO proctor_presence (id, schedule_id, proctor_id, proctor_name, status, joined_at, last_heartbeat_at, left_at) VALUES (?, ?, ?, ?, 'active', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), NULL) ON DUPLICATE KEY UPDATE proctor_name = VALUES(proctor_name), status = 'active', last_heartbeat_at = VALUES(last_heartbeat_at), left_at = NULL"
			if _, err := q.ExecContext(ctx, upsert, uuid.NewString(), scheduleID, proctorID, proctorName); err != nil {
				return err
			}
		case PresenceLeave:
			const leave = "UPDATE proctor_presence SET status = 'left', left_at = UTC_TIMESTAMP(6), last_heartbeat_at = UTC_TIMESTAMP(6) WHERE schedule_id = ? AND proctor_id = ? AND left_at IS NULL"
			if _, err := q.ExecContext(ctx, leave, scheduleID, proctorID); err != nil {
				return err
			}
		}
		return nil
	})
}

// AckAlert acknowledges a monitoring alert.
func (s *Service) AckAlert(ctx context.Context, actor Actor, alertID string) error {
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		const selAlert = "SELECT schedule_id FROM session_audit_logs WHERE id = ?"
		var scheduleID string
		if err := q.QueryRowContext(ctx, selAlert, alertID).Scan(&scheduleID); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Alert not found.", HTTPStatus: 404}
			}
			return err
		}
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		const ack = "UPDATE session_audit_logs SET acknowledged_at = UTC_TIMESTAMP(6), acknowledged_by = ? WHERE id = ?"
		if _, err := q.ExecContext(ctx, ack, actor.ID, alertID); err != nil {
			return err
		}
		return nil
	})
}

// updateAttemptStatus implements pause/resume with protocol-aware V2 delivery
// transitions, deadline/grace shifts, and control_epoch+1 bumps. Terminal
// attempts (submitted_at non-NULL or terminal delivery/proctor state) reject.
func (s *Service) updateAttemptStatus(ctx context.Context, actor Actor, scheduleID, attemptID, proctorStatus string, phase *string, actionType string, cmd AttemptCommand) error {
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		if err := lockAttemptScope(ctx, q, scheduleID, attemptID); err != nil {
			return err
		}
		const term = "SELECT submitted_at, COALESCE(proctor_status,'active'), COALESCE(delivery_status,'running') FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE"
		var submittedAny any
		var proctor, delivery string
		if err := q.QueryRowContext(ctx, term, attemptID, scheduleID).Scan(&submittedAny, &proctor, &delivery); err != nil {
			if err == sql.ErrNoRows {
				return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Attempt not found.", HTTPStatus: 404}
			}
			return err
		}
		if isNonNullTime(submittedAny) || proctor == "terminated" || delivery == "submitted" || delivery == "terminated" || delivery == "locked" || delivery == "cancelled" {
			return &apperrors.Error{Code: apperrors.CodeConflict, Message: "The attempt is already terminal and cannot accept this command.", HTTPStatus: 409}
		}
		const upd = "UPDATE student_attempts SET delivery_status = CASE WHEN COALESCE(protocol_version, 1) <> 2 THEN delivery_status WHEN ? = 'paused' THEN CASE WHEN COALESCE(delivery_status, 'running') IN ('submitted', 'terminated', 'locked', 'cancelled') THEN delivery_status ELSE 'paused' END WHEN ? = 'active' AND COALESCE(proctor_status, 'active') = 'paused' AND COALESCE(delivery_status, 'running') = 'paused' THEN 'running' ELSE delivery_status END, closing_grace_until = CASE WHEN COALESCE(protocol_version, 1) = 2 AND ? = 'active' AND COALESCE(proctor_status, 'active') = 'paused' AND deadline_at IS NOT NULL THEN DATE_ADD(DATE_ADD(deadline_at, INTERVAL GREATEST(TIMESTAMPDIFF(SECOND, COALESCE(proctor_updated_at, UTC_TIMESTAMP(6)), UTC_TIMESTAMP(6)), 0) SECOND), INTERVAL 30 SECOND) ELSE closing_grace_until END, deadline_at = CASE WHEN COALESCE(protocol_version, 1) = 2 AND ? = 'active' AND COALESCE(proctor_status, 'active') = 'paused' AND deadline_at IS NOT NULL THEN DATE_ADD(deadline_at, INTERVAL GREATEST(TIMESTAMPDIFF(SECOND, COALESCE(proctor_updated_at, UTC_TIMESTAMP(6)), UTC_TIMESTAMP(6)), 0) SECOND) ELSE deadline_at END, proctor_status = ?, phase = COALESCE(?, phase), proctor_note = COALESCE(?, proctor_note), proctor_updated_at = UTC_TIMESTAMP(6), proctor_updated_by = ?, updated_at = UTC_TIMESTAMP(6), revision = revision + 1, control_epoch = control_epoch + 1 WHERE id = ? AND schedule_id = ?"
		var reason *string
		if cmd.Reason != nil {
			reason = cmd.Reason
		} else {
			reason = cmd.Message
		}
		if _, err := q.ExecContext(ctx, upd, proctorStatus, proctorStatus, proctorStatus, proctorStatus, proctorStatus, phase, reason, actor.ID, attemptID, scheduleID); err != nil {
			return err
		}
		if actionType == "STUDENT_PAUSE" {
			const pauseMods = "UPDATE assessment_module_attempts ma JOIN student_attempts sa ON sa.id = ma.attempt_id JOIN exam_session_runtimes r ON r.schedule_id = sa.schedule_id SET ma.paused_at = COALESCE(ma.paused_at, UTC_TIMESTAMP(6)), ma.revision = ma.revision + 1 WHERE ma.attempt_id = ? AND r.timing_model IN ('legacy_section_v1', 'cohort_section_v3') AND ma.state = 'active' AND ma.started_at IS NOT NULL AND ma.paused_at IS NULL"
			if _, err := q.ExecContext(ctx, pauseMods, attemptID); err != nil {
				return err
			}
		}
		if actionType == "STUDENT_RESUME" {
			const resumeMods = "UPDATE assessment_module_attempts ma JOIN student_attempts sa ON sa.id = ma.attempt_id JOIN exam_session_runtimes r ON r.schedule_id = sa.schedule_id SET ma.accumulated_paused_seconds = ma.accumulated_paused_seconds + GREATEST(TIMESTAMPDIFF(SECOND, ma.paused_at, UTC_TIMESTAMP(6)), 0), ma.paused_at = NULL, ma.revision = ma.revision + 1 WHERE ma.attempt_id = ? AND r.timing_model IN ('legacy_section_v1', 'cohort_section_v3') AND ma.state = 'active' AND ma.paused_at IS NOT NULL"
			if _, err := q.ExecContext(ctx, resumeMods, attemptID); err != nil {
				return err
			}
		}
		if err := insertAuditLog(ctx, q, scheduleID, actor.ID, actionType, &attemptID, map[string]any{"message": cmd.Message, "reason": cmd.Reason}); err != nil {
			return err
		}
		if err := s.emitRoster(ctx, q, scheduleID, actionType, &attemptID, nil); err != nil {
			return err
		}
		return nil
	})
}

// requireWriterRole pre-checks Admin|Proctor before opening a transaction.
func (s *Service) requireWriterRole(actor Actor) error {
	if actor.Role != RoleAdmin && actor.Role != RoleProctor {
		return &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Schedule not found.", HTTPStatus: 404}
	}
	if !actor.CSRFVerified {
		// Wire value must be CSRF_REJECTED (matches VerifyCSRF
		// normalization in internal/auth); CodeCSRF never hits the wire.
		return &apperrors.Error{Code: apperrors.Code("CSRF_REJECTED"), Message: "CSRF verification failed.", HTTPStatus: 403}
	}
	return nil
}

// emitRoster enqueues schedule_roster/roster_changed + schedule_roster/attempt_changed.
func (s *Service) emitRoster(ctx context.Context, q tx.Tx, scheduleID, event string, attemptID *string, extra map[string]any) error {
	roster, _ := json.Marshal(rosterPayload(scheduleID, event, attemptID, extra))
	if err := s.enqueueWakeup(ctx, q, "schedule_roster", scheduleID, 0, "roster_changed", roster); err != nil {
		return err
	}
	attempt, _ := json.Marshal(rosterPayload(scheduleID, "attempt_changed", attemptID, extra))
	return s.enqueueWakeup(ctx, q, "schedule_roster", scheduleID, 0, "attempt_changed", attempt)
}

func rosterPayload(scheduleID, event string, attemptID *string, extra map[string]any) map[string]any {
	p := map[string]any{"scheduleId": scheduleID, "event": event}
	if attemptID != nil {
		p["attemptId"] = *attemptID
	}
	for k, v := range extra {
		p[k] = v
	}
	return p
}

func insertAuditLog(ctx context.Context, q tx.Tx, scheduleID, actorID, actionType string, attemptID *string, payload map[string]any) error {
	raw, _ := json.Marshal(payload)
	const ins = "INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))"
	_, err := q.ExecContext(ctx, ins, uuid.NewString(), scheduleID, actorID, actionType, attemptID, string(raw))
	return err
}

func insertControlEvent(ctx context.Context, q tx.Tx, runtimeID, scheduleID, actorID, action string, sectionKey *string, minutes *int64, reason *string) error {
	// exam_id is resolved server-side so callers cannot spoof the cohort identity.
	const ins = "INSERT INTO cohort_control_events (id, schedule_id, runtime_id, exam_id, actor_id, action, section_key, minutes, reason, payload, created_at) VALUES (?, ?, (SELECT id FROM exam_session_runtimes WHERE id = ?), (SELECT exam_id FROM exam_schedules WHERE id = ?), ?, ?, ?, ?, ?, NULL, UTC_TIMESTAMP(6))"
	// NOTE: the runtime_id subselect above is intentionally trivial (id lookup);
	// it keeps exam_id server-resolved while preserving the explicit column list.
	_, err := q.ExecContext(ctx, ins, uuid.NewString(), scheduleID, runtimeID, scheduleID, actorID, action, sectionKey, minutes, reason)
	return err
}

// syncV2 re-projects the V2 attempt clocks from the locked section:
// deadline=actual_start+(planned+extension)*60+paused, grace=+30s, protocol 2
// non-terminal only, with a control_epoch+1 fence bump.
func syncV2(ctx context.Context, q tx.Tx, scheduleID, runtimeID, sectionKey string, lifecycle *string) error {
	lifecycleAssign := ""
	switch strval(lifecycle) {
	case "paused":
		lifecycleAssign = "delivery_status = CASE WHEN COALESCE(sa.delivery_status, 'running') IN ('submitted', 'terminated', 'locked', 'cancelled') THEN sa.delivery_status ELSE 'paused' END, phase = CASE WHEN sa.phase IN ('pre-check', 'post-exam') THEN sa.phase ELSE 'exam' END,"
	case "running":
		lifecycleAssign = "delivery_status = CASE WHEN COALESCE(sa.proctor_status, 'active') = 'paused' OR COALESCE(sa.delivery_status, 'running') IN ('submitted', 'terminated', 'locked', 'cancelled') THEN sa.delivery_status ELSE 'running' END, phase = CASE WHEN sa.phase IN ('pre-check', 'post-exam') THEN sa.phase ELSE 'exam' END,"
	case "":
		lifecycleAssign = ""
	default:
		lifecycleAssign = ""
	}
	stmt := "UPDATE student_attempts sa " +
		"JOIN exam_session_runtime_sections rs ON rs.runtime_id = ? AND rs.section_key = ? " +
		"SET " + lifecycleAssign +
		" deadline_at = CASE WHEN rs.actual_start_at IS NULL THEN sa.deadline_at ELSE DATE_ADD(rs.actual_start_at, INTERVAL (((rs.planned_duration_minutes + rs.extension_minutes) * 60) + rs.accumulated_paused_seconds) SECOND) END," +
		" closing_grace_until = CASE WHEN rs.actual_start_at IS NULL THEN sa.closing_grace_until ELSE DATE_ADD(DATE_ADD(rs.actual_start_at, INTERVAL (((rs.planned_duration_minutes + rs.extension_minutes) * 60) + rs.accumulated_paused_seconds) SECOND), INTERVAL 30 SECOND) END," +
		" control_epoch = sa.control_epoch + 1," +
		" revision = sa.revision + 1," +
		" updated_at = UTC_TIMESTAMP(6) " +
		"WHERE sa.schedule_id = ? " +
		"AND sa.protocol_version = 2 " +
		"AND sa.submitted_at IS NULL " +
		"AND COALESCE(sa.delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')"
	_, err := q.ExecContext(ctx, stmt, runtimeID, sectionKey, scheduleID)
	return err
}

func terminalConflict(msg string) *apperrors.Error {
	return &apperrors.Error{Code: apperrors.CodeConflict, Message: msg, HTTPStatus: 409}
}

// isNonNullTime reports whether a scanned submitted_at value is non-NULL.
func isNonNullTime(v any) bool {
	switch t := v.(type) {
	case nil:
		return false
	case time.Time:
		return !t.IsZero()
	case []byte:
		return strings.TrimSpace(string(t)) != ""
	case string:
		return strings.TrimSpace(t) != ""
	default:
		return true
	}
}

func strptr(s string) *string { v := s; return &v }

func strval(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

var _ = fmt.Sprintf

package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/assessscore"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// ModuleStartRequest mirrors AssessmentModuleStartRequest (camelCase) on the
// Rust start_module flow
// (backend/crates/application/src/assessment_delivery.rs:394-461).
type ModuleStartRequest struct {
	ModuleID string `json:"moduleId"`
}

// ModuleSubmitRequest mirrors AssessmentModuleSubmitRequest (camelCase) on the
// Rust submit_module flow
// (backend/crates/application/src/assessment_delivery.rs:722-765).
type ModuleSubmitRequest struct {
	ModuleID string `json:"moduleId"`
}

// Live event names mirror the Rust route dual-publish
// (backend/crates/api/src/routes/assessment_delivery.rs:152-218).
const (
	liveEventModuleStarted   = "sat_module_started"
	liveEventModuleSubmitted = "sat_module_submitted"
)

// StartModule starts one SAT module attempt. It mirrors start_module (Rust
// assessment_delivery.rs:394-461) verbatim: bearer==url 403 check,
// schedule/attempt binding, SAT-provider gate, attempt-can-work gate, module
// FOR UPDATE (attempt_id+module_id), the timing-gate stage check, the
// active-started idempotent shortcut (commit, then bootstrap_payload outside
// the tx), the not_started-only CAS update, and the provider phase update.
// Reconcile-then-write per Rust start_module:402 (own tx, before the write tx).
// StartModule/SubmitModule take writerBinding [clientSessionID, tokenID]
// (see SaveResponse). Handlers forward both from verified claims.
func (s *Service) StartModule(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID, moduleID string, writerBinding ...string) (*Bootstrap, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	scheduleID, examID, providerKey, versionID, err := s.startScheduleBinding(ctx, bearerScheduleID)
	if err != nil {
		return nil, err
	}
	if providerKey != "sat" {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}
	if err := s.saveAttemptBinding(ctx, scheduleID, bearerAttemptID, examID); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if _, err := s.ReconcileAttemptTimeout(ctx, scheduleID, bearerAttemptID, now); err != nil {
		return nil, err
	}
	var hubEvents []liveupdates.Event
	// B1: module CAS + writer fence are point writes (RC-safe).
	if err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		if err := s.ensureAttemptCanWorkTx(ctx, t, scheduleID, bearerAttemptID); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, scheduleID, bearerAttemptID, writerBinding...); err != nil {
			return err
		}
		module, err := lockModuleAttemptTx(ctx, t, bearerAttemptID, moduleID)
		if err != nil {
			return err
		}
		// SAT-006: the gate reads the authoritative DB time after the runtime
		// and section rows are locked; that instant — not the pre-tx wall
		// clock — judges both the cohort deadline and the personal window.
		gated, err := s.moduleTimingGateTx(ctx, t, scheduleID, module.moduleID)
		if err != nil {
			return err
		}
		gateNow := gated.now
		if module.state == "active" && module.startedAt != nil {
			rev, err := s.appendModuleEventsTx(ctx, t, scheduleID, bearerAttemptID, liveEventModuleStarted)
			if err != nil {
				return err
			}
			hubEvents = dualModuleEvents(scheduleID, bearerAttemptID, rev, liveEventModuleStarted)
			return nil
		}
		if module.state != "not_started" {
			return apperrors.New(apperrors.CodeAssessmentConflict, "This SAT module cannot be started in its current state.")
		}
		if gated.gate.usesPersonalDeadline() && module.availableAt != nil && gateNow.Before(*module.availableAt) {
			return apperrors.New(apperrors.CodeAssessmentConflict, "This SAT module is not available until the scheduled break ends.")
		}
		// Room-anchored window (cohort_section_v3): the candidate's module clock is
		// the clock the whole room is on. Module 1's window is the section's start
		// plus its authored length and the branch module ends with the section, so
		// a candidate who opens a module late gets what is LEFT of the room's
		// window — never a fresh window measured from their own arrival. An
		// already-elapsed window allocates zero: the module is over for the room,
		// and the timeout path finalizes it into the adaptive successor rather
		// than handing the late joiner time the room does not have.
		allocatedSeconds := module.allocatedSeconds
		if gated.roomWindowKnown {
			allocatedSeconds = cohortModuleWindowSeconds(allocatedSeconds, gated.roomWindowEnd, gateNow)
		}
		res, err := t.ExecContext(ctx,
			"UPDATE assessment_module_attempts SET state = 'active', allocated_seconds = ?, available_at = COALESCE(available_at, ?), started_at = ?, paused_at = NULL, revision = revision + 1 WHERE id = ? AND state = 'not_started'",
			allocatedSeconds, gateNow, gateNow, module.id)
		if err != nil {
			return err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return err
		}
		if n != 1 {
			return apperrors.New(apperrors.CodeAssessmentConflict, "The SAT module was started by another request. Refresh and continue.")
		}
		// `student_attempts.current_module` remains the legacy IELTS
		// compatibility field. SAT position is authoritative in
		// `assessment_module_attempts` and projected from there.
		if err := markProviderAttemptExamPhaseInTx(ctx, t, bearerAttemptID); err != nil {
			return err
		}
		rev, err := s.appendModuleEventsTx(ctx, t, scheduleID, bearerAttemptID, liveEventModuleStarted)
		if err != nil {
			return err
		}
		hubEvents = dualModuleEvents(scheduleID, bearerAttemptID, rev, liveEventModuleStarted)
		return nil
	}); err != nil {
		return nil, err
	}
	out, err := s.assembleBootstrap(ctx, scheduleID, examID, providerKey, versionID, bearerAttemptID)
	if err != nil {
		return nil, err
	}
	s.publishHubEvents(hubEvents)
	return out, nil
}

// SubmitModule submits one SAT module attempt. It mirrors submit_module (Rust
// assessment_delivery.rs:722-765) verbatim: same prologue, module FOR UPDATE,
// the submitted|locked idempotent shortcut, the active|review-only gate, the
// timing gate plus the personal-deadline workability check, and
// finalize_module_tx (student_submit).
// Reconcile-then-write per Rust submit_module:730 (own tx, before the write tx).
func (s *Service) SubmitModule(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID, moduleID string, writerBinding ...string) (*Bootstrap, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	scheduleID, examID, providerKey, versionID, err := s.startScheduleBinding(ctx, bearerScheduleID)
	if err != nil {
		return nil, err
	}
	if providerKey != "sat" {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}
	if err := s.saveAttemptBinding(ctx, scheduleID, bearerAttemptID, examID); err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	if _, err := s.ReconcileAttemptTimeout(ctx, scheduleID, bearerAttemptID, now); err != nil {
		return nil, err
	}
	var hubEvents []liveupdates.Event
	// B1: module CAS + writer fence are point writes (RC-safe).
	if err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		if err := s.ensureAttemptCanWorkTx(ctx, t, scheduleID, bearerAttemptID); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, scheduleID, bearerAttemptID, writerBinding...); err != nil {
			return err
		}
		active, err := lockModuleAttemptTx(ctx, t, bearerAttemptID, moduleID)
		if err != nil {
			return err
		}
		if active.state == "submitted" || active.state == "locked" {
			rev, err := s.appendModuleEventsTx(ctx, t, scheduleID, bearerAttemptID, liveEventModuleSubmitted)
			if err != nil {
				return err
			}
			hubEvents = dualModuleEvents(scheduleID, bearerAttemptID, rev, liveEventModuleSubmitted)
			return nil
		}
		if active.state != "active" && active.state != "review" {
			return apperrors.New(apperrors.CodeAssessmentConflict, "This SAT module is not active.")
		}
		// SAT-006: deadline authority is the in-tx DB instant the gate returns,
		// read after the runtime/module locks were acquired.
		gated, err := s.moduleTimingGateTx(ctx, t, scheduleID, active.moduleID)
		if err != nil {
			return err
		}
		if gated.gate.usesPersonalDeadline() {
			if err := ensureSaveModuleAdmitted(active, gated.now); err != nil {
				return err
			}
		}
		if _, err := s.finalizeModuleTx(ctx, t, bearerAttemptID, active, "student_submit"); err != nil {
			return err
		}
		rev, err := s.appendModuleEventsTx(ctx, t, scheduleID, bearerAttemptID, liveEventModuleSubmitted)
		if err != nil {
			return err
		}
		hubEvents = dualModuleEvents(scheduleID, bearerAttemptID, rev, liveEventModuleSubmitted)
		return nil
	}); err != nil {
		return nil, err
	}
	out, err := s.assembleBootstrap(ctx, scheduleID, examID, providerKey, versionID, bearerAttemptID)
	if err != nil {
		return nil, err
	}
	s.publishHubEvents(hubEvents)
	return out, nil
}

// usesPersonalDeadline mirrors SatRuntimeTimingGate::uses_personal_module_deadline:
// both cohort timing models are controlled by the shared runtime section
// clock; individual module clocks remain legacy-only.
func (g timingGate) usesPersonalDeadline() bool { return g == timingGateLegacy }

// startScheduleBinding mirrors schedule_binding plus the published version id
// (needed to assemble the bootstrap payload after the write commits). It
// resolves the effective provider centrally (exams.EffectiveProviderKey) so
// legacy ACT rows (provider_key='ielts', exam_type='ACT') are not gated as
// unsupported (Phase 02 blocker 4).
func (s *Service) startScheduleBinding(ctx context.Context, scheduleID string) (id, examID, providerKey, versionID string, err error) {
	var examType string
	if err = s.db.QueryRowContext(ctx,
		"SELECT s.id, s.exam_id, e.provider_key, s.published_version_id, e.exam_type FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id WHERE s.id = ?",
		scheduleID).Scan(&id, &examID, &providerKey, &versionID, &examType); err != nil {
		if err == sql.ErrNoRows {
			return "", "", "", "", apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		return "", "", "", "", err
	}
	return id, examID, examdomain.EffectiveProviderKey(providerKey, examType), versionID, nil
}

// lockModuleAttemptTx locks one module attempt row FOR UPDATE by
// (attempt_id, module_id). A missing row surfaces NOT_FOUND.
func lockModuleAttemptTx(ctx context.Context, t tx.Tx, attemptID, moduleID string) (saveActiveModule, error) {
	var m saveActiveModule
	var availableAt, startedAt, pausedAt sql.NullTime
	var completionReason sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT id, module_id, state, allocated_seconds, available_at, started_at, paused_at, accumulated_paused_seconds, extension_seconds, completion_reason FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE",
		attemptID, moduleID).Scan(&m.id, &m.moduleID, &m.state, &m.allocatedSeconds, &availableAt, &startedAt, &pausedAt, &m.accumulatedPausedSeconds, &m.extensionSeconds, &completionReason); err != nil {
		if err == sql.ErrNoRows {
			// Round 81 (live rehearsal): this used to say "Attempt not
			// found.", indistinguishable from a bad attempt id. The
			// attempt binding already passed above, so a miss here is a
			// missing MODULE row (not seeded / wrong module id) — say so.
			return saveActiveModule{}, apperrors.New(apperrors.CodeNotFound, "Module attempt not found for this module.")
		}
		return saveActiveModule{}, err
	}
	m.availableAt = nullTime(availableAt)
	m.startedAt = nullTime(startedAt)
	m.pausedAt = nullTime(pausedAt)
	m.completionReason = nullString(completionReason)
	return m, nil
}

// markProviderAttemptExamPhaseInTx mirrors
// mark_provider_attempt_exam_phase_in_tx (Rust delivery/mod.rs:274): the
// provider-neutral phase projection for a started assessment. rows != 1
// surfaces NOT_FOUND.
func markProviderAttemptExamPhaseInTx(ctx context.Context, t tx.Tx, attemptID string) error {
	res, err := t.ExecContext(ctx,
		"UPDATE student_attempts SET phase = 'exam', control_epoch = control_epoch + 1, updated_at = CURRENT_TIMESTAMP(6), revision = revision + 1 WHERE id = ? AND submitted_at IS NULL AND COALESCE(delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')",
		attemptID)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	return nil
}

// maxModuleRevisionTx reads the dual-publish revision inside the commit tx:
// max(module.revision, 0), mirroring the Rust route revision projection.
func maxModuleRevisionTx(ctx context.Context, t tx.Tx, attemptID string) (int64, error) {
	var rev sql.NullInt64
	if err := t.QueryRowContext(ctx,
		"SELECT COALESCE(MAX(revision), 0) FROM assessment_module_attempts WHERE attempt_id = ?",
		attemptID).Scan(&rev); err != nil {
		return 0, err
	}
	if !rev.Valid || rev.Int64 < 0 {
		return 0, nil
	}
	return rev.Int64, nil
}

// appendModuleEventsTx dual-publishes the module event inside the commit tx
// (attempt + schedule_roster kinds) so state changes and bus rows commit
// atomically. It returns the shared publish revision for the post-commit hub
// fanout. Under the C1 direct posture the bus INSERTs are skipped (zero live
// SQL; single-deploy has no peers) while the revision still feeds Hub fanout.
func (s *Service) appendModuleEventsTx(ctx context.Context, t tx.Tx, scheduleID, attemptID, name string) (int64, error) {
	rev, err := maxModuleRevisionTx(ctx, t, attemptID)
	if err != nil {
		return 0, err
	}
	if s != nil && s.liveDirect {
		return rev, nil
	}
	if err := liveupdates.AppendInTx(ctx, t, s.liveOrigin, liveupdates.KindAttempt, attemptID, rev, name, nil); err != nil {
		return 0, err
	}
	if err := liveupdates.AppendInTx(ctx, t, s.liveOrigin, liveupdates.KindScheduleRoster, scheduleID, rev, name, nil); err != nil {
		return 0, err
	}
	return rev, nil
}

// dualModuleEvents builds the post-commit hub fanout pair
// (Event{Kind, ID, Revision, Name}).
func dualModuleEvents(scheduleID, attemptID string, revision int64, name string) []liveupdates.Event {
	return []liveupdates.Event{
		{Kind: liveupdates.KindAttempt, ID: attemptID, Revision: revision, Name: name},
		{Kind: liveupdates.KindScheduleRoster, ID: scheduleID, Revision: revision, Name: name},
	}
}

// publishHubEvents fans committed events out to in-process subscribers.
// Best-effort: it never fails the request. Under the sample sink posture
// every 1000th event also Appends one async debug row post-commit (outside
// any business tx; failures are dropped silently like hub drops).
func (s *Service) publishHubEvents(events []liveupdates.Event) {
	if s.liveHub != nil {
		for _, e := range events {
			s.liveHub.Publish(e)
		}
	}
	s.maybeSampleSink(events)
}

// maybeSampleSink writes one async debug row per 1000 hub events when the
// sample sink is on with a bus handle. Deterministic counter (no rand in
// the hot path); context is background (post-commit, never the request tx).
func (s *Service) maybeSampleSink(events []liveupdates.Event) {
	if s == nil || s.liveSinkBus == nil || s.liveSinkMode != config.LiveBusSinkSample {
		return
	}
	for _, e := range events {
		n := s.liveSinkCount.Add(1)
		if n%1000 != 0 {
			continue
		}
		_ = s.liveSinkBus.Append(context.Background(), e.Kind, e.ID, e.Revision, e.Name, e.Payload)
	}
}

// assembleBootstrap builds the delivery payload after the write commits,
// reusing the Bootstrap loader chain (outside any tx, so the write tx never
// nests).
func (s *Service) assembleBootstrap(ctx context.Context, scheduleID, examID, providerKey, versionID, attemptID string) (*Bootstrap, error) {
	now := time.Now().UTC()
	sections, err := s.LoadSections(ctx, versionID)
	if err != nil {
		return nil, err
	}
	scope, err := s.linkSectionScope(ctx, scheduleID)
	if err != nil {
		return nil, err
	}
	sections = deliverySectionsForScope(sections, scope)
	if err := s.ensureBaseModuleAttempt(ctx, attemptID, sections); err != nil {
		return nil, err
	}
	moduleAttempts, err := s.loadModuleAttempts(ctx, attemptID, now)
	if err != nil {
		return nil, err
	}
	responses, err := s.loadResponses(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	control, err := s.loadAttemptControl(ctx, attemptID, attemptControl{})
	if err != nil {
		return nil, err
	}
	result, err := s.loadBootstrapResult(ctx, providerKey, attemptID, control)
	if err != nil {
		return nil, err
	}
	timing, runtimeStatus, roomSections, err := s.loadTiming(ctx, scheduleID, providerKey, now)
	if err != nil {
		return nil, err
	}
	// Write-then-read: this response is built after the write committed, so the
	// entry windows it publishes already reflect it (a module that just started
	// carries its own window, and nothing else is promised).
	publishEntryWindows(moduleAttempts, sections, timing, roomSections, now)
	return &Bootstrap{
		ScheduleID:            scheduleID,
		ExamID:                examID,
		ProviderKey:           providerKey,
		VersionID:             versionID,
		ServerNow:             now,
		CandidateName:         control.candidateName,
		ScheduleRuntimeStatus: runtimeStatus,
		Timing:                timing,
		ProctorStatus:         control.proctorStatus,
		ProctorNote:           control.proctorNote,
		DeviceFingerprintHash: control.deviceFingerprintHash,
		Sections:              sections,
		Attempt: AttemptSnapshot{
			ID:                   attemptID,
			ModuleAttempts:       moduleAttempts,
			Responses:            responses,
			ProvisionalSubmitted: control.deliveryStatus == "submitted" && control.submittedAt == nil,
		},
		Result: result,
	}, nil
}

// nextModuleRow is one candidate follow-up module for finalizeModuleTx.
type nextModuleRow struct {
	id              string
	sectionID       string
	sectionKey      string
	moduleKey       string
	durationSeconds int
	adaptiveRole    string
	toolPolicy      sql.NullString
}

// finalizeModuleTx mirrors finalize_module_tx (Rust
// assessment_delivery.rs:2131-2217): score the module responses, flip the row
// to submitted (student_submit never locks) with a not_started/active/review
// CAS, then route + insert the follow-up module attempt.
func (s *Service) finalizeModuleTx(ctx context.Context, t tx.Tx, attemptID string, active saveActiveModule, completionReason string) (*nextModuleRow, error) {
	scoring, err := loadScoringRowsTx(ctx, t, active.id, active.moduleID)
	if err != nil {
		return nil, err
	}
	rawCorrect, operationalCount := scoreScoringRows(scoring)
	lockModule := completionReason == "time_expired" || completionReason == "proctor_end" || completionReason == "proctor_terminate"
	state := "submitted"
	if lockModule {
		state = "locked"
	}
	res, err := t.ExecContext(ctx,
		"UPDATE assessment_module_attempts SET state = ?, submitted_at = CURRENT_TIMESTAMP(6), locked_at = CASE WHEN ? THEN CURRENT_TIMESTAMP(6) ELSE locked_at END, paused_at = NULL, completion_reason = ?, raw_correct = ?, operational_question_count = ?, revision = revision + 1 WHERE id = ? AND state IN ('not_started', 'active', 'review')",
		state, lockModule, completionReason, rawCorrect, operationalCount, active.id)
	if err != nil {
		return nil, err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return nil, err
	}
	if n != 1 {
		return nil, apperrors.New(apperrors.CodeAssessmentConflict, "The SAT module was already finalized by another request.")
	}
	var currentSectionID string
	var breakAfterSeconds int
	if err := t.QueryRowContext(ctx,
		"SELECT s.id, s.break_after_seconds FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
		active.moduleID).Scan(&currentSectionID, &breakAfterSeconds); err != nil {
		return nil, err
	}
	next, err := s.nextModuleTx(ctx, t, attemptID, active.id, active.moduleID, rawCorrect, operationalCount)
	if err != nil {
		return nil, err
	}
	if next == nil {
		return nil, nil
	}
	now := time.Now().UTC()
	var cohortTimed int
	if err := t.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM student_attempts sa JOIN exam_session_runtimes r ON r.schedule_id = sa.schedule_id WHERE sa.id = ? AND r.timing_model IN ("+examruntime.CohortTimingModelsSQL+"))",
		attemptID).Scan(&cohortTimed); err != nil {
		return nil, err
	}
	availableAt := nextModuleAvailableAt(now, currentSectionID, next.sectionID, breakAfterSeconds)
	if cohortTimed != 0 {
		availableAt = now
	}
	if err := insertModuleAttemptTx(ctx, t, attemptID, next, availableAt); err != nil {
		return nil, err
	}
	return next, nil
}

// scoringRow is one response joined to its answer definition for scoring.
type scoringRow struct {
	isPretest        bool
	answerDefinition sql.NullString
	response         sql.NullString
}

// loadScoringRowsTx loads the scoring join for finalizeModuleTx.
//
// V2-canonical read (exam-day P0): student saves land in
// attempt_responses_v2 through the V2 durability transport, so the scorer
// must read V2 first. Legacy assessment_question_responses rows stay as the
// fallback for pre-V2 attempts that never wrote V2 rows. Per question the
// V2 canonical payload wins when present; legacy fills only gaps. The
// scorer input for a V2 row is its canonical "answer" field re-encoded as
// JSON (assessscore.V2ResponseToScorerInput), byte-equivalent to the legacy
// JSON-string response for the same logical answer.
func loadScoringRowsTx(ctx context.Context, t tx.Tx, moduleAttemptID, moduleID string) ([]scoringRow, error) {
	return loadScoringRowsV2FirstTx(ctx, t, moduleAttemptID, moduleID)
}

// loadScoringRowsV2FirstTx is the V2-first scoring join: one round-trip
// returning legacy + V2 columns per question, V2 winning per row. Exactly
// one scoringRow per eq.id (Go-side dedup, eq.id match preferred). Callers
// that need the legacy-only join (historical probes, tests pinning fallback)
// use loadScoringRowsLegacyTx directly.
//
// Fan-out guard (exam-day re-audit defect 1): V2 rows are keyed by
// (attempt_id, question_id) where question_id may be eq.id or
// eq.question_id, so a bare IN-join can match 0..2 V2 rows per eq row and
// inflate operationalCount/rawCorrect. The join therefore fences on the
// scoring module (v.module_id = eq.module_id) and prefers the eq.id match;
// Go-side dedup keeps exactly one row per eq.id.
func loadScoringRowsV2FirstTx(ctx context.Context, t tx.Tx, moduleAttemptID, moduleID string) ([]scoringRow, error) {
	rows, err := t.QueryContext(ctx,
		"SELECT eq.id, eq.is_pretest, qr.answer_definition, ar.response, CAST(v.response AS CHAR), CAST(v.question_id AS CHAR) FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id LEFT JOIN assessment_question_responses ar ON ar.module_attempt_id = ? AND ar.exam_question_id = eq.id LEFT JOIN attempt_responses_v2 v ON v.question_id IN (eq.id, eq.question_id) AND v.module_id = eq.module_id AND v.attempt_id = (SELECT attempt_id FROM assessment_module_attempts WHERE id = ?) WHERE eq.module_id = ? ORDER BY eq.display_order, CASE WHEN (CAST(v.question_id AS CHAR) COLLATE utf8mb4_unicode_ci) = eq.id THEN 0 ELSE 1 END",
		moduleAttemptID, moduleAttemptID, moduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []scoringRow
	seen := make(map[string]struct{})
	// Operational-only attribution: the scorer skips pretest rows entirely,
	// so paging counters must too — a pretest-only legacy answer (or a
	// pretest-only unanswered pass) is not a scoring gap and must not page
	// on EITHER the pass-level source series or the per-row fallback series.
	operationalV2 := false
	operationalLegacy := false
	legacyFallbackRows := 0
	operationalRows := 0
	for rows.Next() {
		var eqID string
		var r scoringRow
		var canonical sql.NullString
		var vQuestionID sql.NullString
		if err := rows.Scan(&eqID, &r.isPretest, &r.answerDefinition, &r.response, &canonical, &vQuestionID); err != nil {
			return nil, err
		}
		if _, dup := seen[eqID]; dup {
			// Second V2 match for the same question (eq.id + eq.question_id
			// variants): the ORDER BY already placed the eq.id match
			// first, so the duplicate is dropped, never double-counted.
			continue
		}
		seen[eqID] = struct{}{}
		if !r.isPretest {
			operationalRows++
		}
		if canonical.Valid && canonical.String != "" {
			if !r.isPretest {
				operationalV2 = true
			}
			if input, ok := assessscore.V2ResponseToScorerInput(canonical.String); ok {
				r.response = sql.NullString{String: input, Valid: true}
			} else {
				// Present-but-unusable payload (null/malformed answer):
				// V2 owns the question, so legacy must not resurrect a
				// stale row; an empty response scores as incorrect.
				r.response = sql.NullString{}
			}
		} else if r.response.Valid && r.response.String != "" {
			if !r.isPretest {
				operationalLegacy = true
				// Gap attribution is decided after the full pass: this
				// legacy row is a pageable gap only when V2 owns
				// sibling OPERATIONAL questions (pretest rows never
				// count — the scorer skips them).
				legacyFallbackRows++
			}
		}
		out = append(out, r)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	// Pass-level source: operational rows only. A pretest-only V2 (or
	// legacy) pass emits nothing — there is no scored content to attribute.
	if operationalV2 {
		telemetry.IncCounter(telemetry.MSATScoreSource, "source", telemetry.SATScoreV2)
	}
	if operationalLegacy {
		telemetry.IncCounter(telemetry.MSATScoreSource, "source", telemetry.SATScoreLegacy)
	}
	if operationalV2 && legacyFallbackRows > 0 {
		// Mixed pass: some OPERATIONAL questions scored from legacy gaps
		// while V2 owned the rest. Emit one increment per gap row (not
		// one per pass) so the page fires on ANY gap and the magnitude
		// tracks its size.
		for range legacyFallbackRows {
			telemetry.IncCounter(telemetry.MSATScoreFallbackRows, "source", telemetry.SATScoreLegacy)
		}
	} else if !operationalV2 && !operationalLegacy && operationalRows > 0 {
		// Zero-answer pass: operational questions existed but no response
		// row answered any of them (mass lease-fencing / transport
		// loss). Scoring silence would otherwise release an
		// all-incorrect module with no page — emit one increment per
		// unanswered OPERATIONAL question. Pretest-only passes stay
		// silent (the scorer skips pretest, so there is no gap).
		for range operationalRows {
			telemetry.IncCounter(telemetry.MSATScoreFallbackRows, "source", telemetry.SATScoreZero)
		}
	}
	return out, nil
}

// loadScoringRowsLegacyTx is the pre-V2 scoring join, retained for
// historical probes and tests pinning the legacy fallback. It emits no
// scoring telemetry itself: callers that page on legacy gaps route through
// loadScoringRowsV2FirstTx (the only paged path); direct users must decide
// their own paging (a silent historical probe must never page on-call).
func loadScoringRowsLegacyTx(ctx context.Context, t tx.Tx, moduleAttemptID, moduleID string) ([]scoringRow, error) {
	rows, err := t.QueryContext(ctx,
		"SELECT eq.is_pretest, qr.answer_definition, ar.response FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id LEFT JOIN assessment_question_responses ar ON ar.module_attempt_id = ? AND ar.exam_question_id = eq.id WHERE eq.module_id = ? ORDER BY eq.display_order",
		moduleAttemptID, moduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []scoringRow
	for rows.Next() {
		var r scoringRow
		if err := rows.Scan(&r.isPretest, &r.answerDefinition, &r.response); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// scoreScoringRows mirrors score_scoring_rows (Rust
// assessment_delivery.rs:2715): pretest rows never count; a malformed answer
// definition or a non-string response counts as incorrect.
func scoreScoringRows(rows []scoringRow) (rawCorrect, operationalCount int) {
	for _, r := range rows {
		if r.isPretest {
			continue
		}
		operationalCount++
		if responseIsCorrect(answerString(r.answerDefinition), r.response) {
			rawCorrect++
		}
	}
	return rawCorrect, operationalCount
}

func answerString(v sql.NullString) string {
	if !v.Valid {
		return ""
	}
	return v.String
}

// responseIsCorrect is the write-path verdict: one canonical import, not a
// fork. Exam-day re-audit defect 7 collapsed the verbatim duplicate into
// assessscore.SATResponseCorrect so seal-time scoring and result-review
// verdicts cannot drift on a one-line tolerance fix.
func responseIsCorrect(answerJSON string, response sql.NullString) bool {
	return assessscore.SATResponseCorrect(answerJSON, response.Valid, response.String)
}

// nextModuleTx mirrors next_module (Rust assessment_delivery.rs:2219): base
// modules route through the adaptive routing policy; other modules advance to
// the next section's base module. A nil row means the assessment has no
// follow-up module.
func (s *Service) nextModuleTx(ctx context.Context, t tx.Tx, attemptID, baseModuleAttemptID, moduleID string, rawCorrect, operationalCount int) (*nextModuleRow, error) {
	var sectionID, sectionKey string
	var sectionOrder int
	var adaptiveRole, versionID string
	if err := t.QueryRowContext(ctx,
		"SELECT s.id, s.section_key, s.display_order, m.adaptive_role, s.exam_version_id FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
		moduleID).Scan(&sectionID, &sectionKey, &sectionOrder, &adaptiveRole, &versionID); err != nil {
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		return nil, err
	}
	if adaptiveRole == "base" {
		var policySectionID, baseModuleID, lowerModuleID, higherModuleID, policyKey, policyConfig string
		var policyRevision int
		if err := t.QueryRowContext(ctx,
			"SELECT section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision FROM assessment_routing_policies WHERE section_id = ?",
			sectionID).Scan(&policySectionID, &baseModuleID, &lowerModuleID, &higherModuleID, &policyKey, &policyConfig, &policyRevision); err != nil {
			if err == sql.ErrNoRows {
				return nil, apperrors.New(apperrors.CodeValidation, "Adaptive routing policy is missing.")
			}
			return nil, err
		}
		if baseModuleID != moduleID {
			return nil, apperrors.New(apperrors.CodeValidation, "Adaptive routing policy base module does not match the submitted module.")
		}
		route, err := chooseAdaptiveRoute(rawCorrect, operationalCount, policyConfig)
		if err != nil {
			return nil, err
		}
		selectedModuleID := lowerModuleID
		routeName := "lower"
		if route == "higher" {
			selectedModuleID = higherModuleID
			routeName = "higher"
		}
		if _, err := t.ExecContext(ctx,
			"INSERT INTO assessment_route_decisions (id, attempt_id, section_id, base_module_attempt_id, base_module_id, selected_module_id, selected_route, raw_correct, operational_question_count, policy_key, policy_revision, policy_config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			uuid.NewString(), attemptID, policySectionID, baseModuleAttemptID, baseModuleID, selectedModuleID, routeName, rawCorrect, operationalCount, policyKey, policyRevision, policyConfig); err != nil {
			return nil, err
		}
		return scanNextModuleRowTx(ctx, t, selectedModuleID)
	}
	// Student Access scope: a narrowed run must not advance into a section it
	// never scheduled. Without this, a verbal-only student would be handed the
	// Math base module the moment Reading & Writing finished, and the exam
	// would never end. Scope is nil when the schedule has no link or the link
	// is unscoped, leaving the previous query untouched.
	scope, err := attemptSectionScopeTx(ctx, t, attemptID)
	if err != nil {
		return nil, err
	}
	nextSectionQuery := "SELECT id FROM assessment_sections WHERE exam_version_id = ? AND display_order > ?"
	nextSectionArgs := []any{versionID, sectionOrder}
	if keys := examdomain.SectionScopeKeys(scope); len(keys) > 0 {
		nextSectionQuery += " AND section_key IN (" + sqlPlaceholders(len(keys)) + ")"
		for _, key := range keys {
			nextSectionArgs = append(nextSectionArgs, key)
		}
	}
	nextSectionQuery += " ORDER BY display_order LIMIT 1"
	var nextSectionID sql.NullString
	if err := t.QueryRowContext(ctx, nextSectionQuery, nextSectionArgs...).Scan(&nextSectionID); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	if !nextSectionID.Valid {
		return nil, nil
	}
	var rowID, rowSectionID, rowSectionKey, rowModuleKey, rowAdaptiveRole string
	var rowDuration int
	var rowToolPolicy sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT m.id, m.section_id, s.section_key, m.module_key, m.duration_seconds, m.adaptive_role, m.tool_policy FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.section_id = ? AND m.adaptive_role = 'base' ORDER BY m.display_order LIMIT 1",
		nextSectionID.String).Scan(&rowID, &rowSectionID, &rowSectionKey, &rowModuleKey, &rowDuration, &rowAdaptiveRole, &rowToolPolicy); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	return &nextModuleRow{
		id: rowID, sectionID: rowSectionID, sectionKey: rowSectionKey,
		moduleKey: rowModuleKey, durationSeconds: rowDuration,
		adaptiveRole: rowAdaptiveRole, toolPolicy: rowToolPolicy,
	}, nil
}

// scanNextModuleRowTx loads one module row for the routed follow-up module;
// a missing row yields nil (Rust fetch_optional semantics).
func scanNextModuleRowTx(ctx context.Context, t tx.Tx, moduleID string) (*nextModuleRow, error) {
	var row nextModuleRow
	var sectionID, sectionKey, moduleKey, adaptiveRole string
	var duration int
	var toolPolicy sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT m.id, m.section_id, s.section_key, m.module_key, m.duration_seconds, m.adaptive_role, m.tool_policy FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?",
		moduleID).Scan(&row.id, &sectionID, &sectionKey, &moduleKey, &duration, &adaptiveRole, &toolPolicy); err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	row.sectionID = sectionID
	row.sectionKey = sectionKey
	row.moduleKey = moduleKey
	row.durationSeconds = duration
	row.adaptiveRole = adaptiveRole
	row.toolPolicy = toolPolicy
	return &row, nil
}

// chooseAdaptiveRoute mirrors PracticeThresholdRouting::choose_route (Rust
// adaptive_routing.rs:37).
func chooseAdaptiveRoute(rawCorrect, operationalCount int, policyConfig string) (string, error) {
	if operationalCount <= 0 {
		return "", apperrors.New(apperrors.CodeValidation, "routing policy requires a positive operational question count")
	}
	dec := json.NewDecoder(strings.NewReader(policyConfig))
	dec.UseNumber()
	var cfg map[string]any
	if err := dec.Decode(&cfg); err != nil {
		return "", apperrors.New(apperrors.CodeValidation, "routing policy is missing minimumCorrectForHigher")
	}
	raw, ok := cfg["minimumCorrectForHigher"]
	if !ok {
		return "", apperrors.New(apperrors.CodeValidation, "routing policy is missing minimumCorrectForHigher")
	}
	num, ok := raw.(json.Number)
	if !ok {
		return "", apperrors.New(apperrors.CodeValidation, "routing policy is missing minimumCorrectForHigher")
	}
	thr64, err := num.Int64()
	if err != nil {
		return "", apperrors.New(apperrors.CodeValidation, "routing policy is missing minimumCorrectForHigher")
	}
	if thr64 > 2147483647 || thr64 < -2147483648 {
		return "", apperrors.New(apperrors.CodeValidation, "routing policy threshold is outside the supported integer range")
	}
	threshold := int(thr64)
	if threshold < 1 || threshold > operationalCount {
		return "", apperrors.New(apperrors.CodeValidation, "routing policy threshold must be between 1 and the operational question count")
	}
	if rawCorrect < 0 || rawCorrect > operationalCount {
		return "", apperrors.New(apperrors.CodeValidation, "raw correct must be between 0 and the operational question count")
	}
	if rawCorrect >= threshold {
		return "higher", nil
	}
	return "lower", nil
}

// nextModuleAvailableAt mirrors next_module_available_at (Rust
// assessment_delivery.rs:2727): same-section modules open immediately, later
// sections wait out the break.
func nextModuleAvailableAt(now time.Time, currentSectionID, nextSectionID string, breakAfterSeconds int) time.Time {
	if currentSectionID == nextSectionID {
		return now
	}
	if breakAfterSeconds < 0 {
		breakAfterSeconds = 0
	}
	return now.Add(time.Duration(breakAfterSeconds) * time.Second)
}

// insertModuleAttemptTx mirrors insert_module_attempt_tx (Rust
// assessment_delivery.rs:1399): the unique (attempt_id, module_id) constraint
// is the identity fence (ON DUPLICATE KEY UPDATE id = id).
func insertModuleAttemptTx(ctx context.Context, t tx.Tx, attemptID string, module *nextModuleRow, availableAt time.Time) error {
	_, err := t.ExecContext(ctx,
		"INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, available_at, started_at, tool_state) VALUES (?, ?, ?, 'not_started', ?, ?, NULL, ?) ON DUPLICATE KEY UPDATE id = id",
		uuid.NewString(), attemptID, module.id, module.durationSeconds, availableAt, module.toolPolicy.String)
	return err
}

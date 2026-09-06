package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
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
func (s *Service) StartModule(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID, moduleID string, clientSessionID ...string) (*Bootstrap, error) {
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
	if err := s.runner.WithTx(ctx, func(ctx context.Context, t tx.Tx) error {
		if err := s.ensureAttemptCanWorkTx(ctx, t, scheduleID, bearerAttemptID); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, scheduleID, bearerAttemptID, clientSessionID); err != nil {
			return err
		}
		module, err := lockModuleAttemptTx(ctx, t, bearerAttemptID, moduleID)
		if err != nil {
			return err
		}
		gate, err := s.moduleTimingGateTx(ctx, t, scheduleID, module.moduleID, now)
		if err != nil {
			return err
		}
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
		if gate.usesPersonalDeadline() && module.availableAt != nil && now.Before(*module.availableAt) {
			return apperrors.New(apperrors.CodeAssessmentConflict, "This SAT module is not available until the scheduled break ends.")
		}
		res, err := t.ExecContext(ctx,
			"UPDATE assessment_module_attempts SET state = 'active', available_at = COALESCE(available_at, ?), started_at = ?, paused_at = NULL, revision = revision + 1 WHERE id = ? AND state = 'not_started'",
			now, now, module.id)
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
func (s *Service) SubmitModule(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID, moduleID string, clientSessionID ...string) (*Bootstrap, error) {
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
	if err := s.runner.WithTx(ctx, func(ctx context.Context, t tx.Tx) error {
		if err := s.ensureAttemptCanWorkTx(ctx, t, scheduleID, bearerAttemptID); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, scheduleID, bearerAttemptID, clientSessionID); err != nil {
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
		gate, err := s.moduleTimingGateTx(ctx, t, scheduleID, active.moduleID, now)
		if err != nil {
			return err
		}
		if gate.usesPersonalDeadline() {
			if err := ensureSaveModuleAdmitted(active, now); err != nil {
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
// (needed to assemble the bootstrap payload after the write commits).
func (s *Service) startScheduleBinding(ctx context.Context, scheduleID string) (id, examID, providerKey, versionID string, err error) {
	if err = s.db.QueryRowContext(ctx,
		"SELECT s.id, s.exam_id, e.provider_key, s.published_version_id FROM exam_schedules s JOIN exam_entities e ON e.id = s.exam_id WHERE s.id = ?",
		scheduleID).Scan(&id, &examID, &providerKey, &versionID); err != nil {
		if err == sql.ErrNoRows {
			return "", "", "", "", apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		return "", "", "", "", err
	}
	return id, examID, providerKey, versionID, nil
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
			return saveActiveModule{}, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
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
// fanout.
func (s *Service) appendModuleEventsTx(ctx context.Context, t tx.Tx, scheduleID, attemptID, name string) (int64, error) {
	rev, err := maxModuleRevisionTx(ctx, t, attemptID)
	if err != nil {
		return 0, err
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
// Best-effort: it never fails the request.
func (s *Service) publishHubEvents(events []liveupdates.Event) {
	if s.liveHub == nil {
		return
	}
	for _, e := range events {
		s.liveHub.Publish(e)
	}
}

// assembleBootstrap builds the delivery payload after the write commits,
// reusing the Bootstrap loader chain (outside any tx, so the write tx never
// nests).
func (s *Service) assembleBootstrap(ctx context.Context, scheduleID, examID, providerKey, versionID, attemptID string) (*Bootstrap, error) {
	now := time.Now().UTC()
	sections, err := s.loadSections(ctx, versionID)
	if err != nil {
		return nil, err
	}
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
	control, err := s.loadAttemptControl(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	result, err := s.loadBootstrapResult(ctx, providerKey, attemptID, control)
	if err != nil {
		return nil, err
	}
	timing, runtimeStatus, err := s.loadTiming(ctx, scheduleID, now)
	if err != nil {
		return nil, err
	}
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
			ID:             attemptID,
			ModuleAttempts: moduleAttempts,
			Responses:      responses,
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
		"SELECT EXISTS(SELECT 1 FROM student_attempts sa JOIN exam_session_runtimes r ON r.schedule_id = sa.schedule_id WHERE sa.id = ? AND r.timing_model IN ('cohort_stage_v2', 'cohort_section_v3'))",
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
func loadScoringRowsTx(ctx context.Context, t tx.Tx, moduleAttemptID, moduleID string) ([]scoringRow, error) {
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

// responseIsCorrect mirrors response_is_correct (Rust
// assessment_delivery.rs:2969): only a JSON string response can be correct.
func responseIsCorrect(answerJSON string, response sql.NullString) bool {
	if !response.Valid || strings.TrimSpace(response.String) == "" {
		return false
	}
	var respStr string
	if err := json.Unmarshal([]byte(response.String), &respStr); err != nil {
		return false
	}
	if strings.TrimSpace(answerJSON) == "" {
		return false
	}
	var def map[string]json.RawMessage
	if err := json.Unmarshal([]byte(answerJSON), &def); err != nil {
		return false
	}
	var kind string
	if raw, ok := def["kind"]; ok {
		_ = json.Unmarshal(raw, &kind)
	}
	switch kind {
	case "single_choice":
		raw, ok := answerField(def, "correctOptionId", "correct_option_id")
		if !ok || string(raw) == "null" {
			return false
		}
		var correct string
		if err := json.Unmarshal(raw, &correct); err != nil {
			return false
		}
		return correct == respStr
	case "student_produced_response":
		var accepted []string
		if raw, ok := answerField(def, "acceptedResponses", "accepted_responses"); ok {
			_ = json.Unmarshal(raw, &accepted)
		}
		normalizeFraction := answerBool(def, "normalizeFraction", "normalize_fraction")
		normalizeDecimal := answerBool(def, "normalizeDecimal", "normalize_decimal")
		var tolerance *string
		if raw, ok := answerField(def, "numericTolerance", "numeric_tolerance"); ok && string(raw) != "null" {
			var tol string
			if err := json.Unmarshal(raw, &tol); err == nil {
				tolerance = &tol
			}
		}
		for _, a := range accepted {
			if responseMatches(a, respStr, normalizeFraction, normalizeDecimal, tolerance) {
				return true
			}
		}
		return false
	default:
		return false
	}
}

// answerField reads a camelCase answer-definition field with its snake_case
// alias (Rust serde rename + alias).
func answerField(def map[string]json.RawMessage, camel, snake string) (json.RawMessage, bool) {
	if raw, ok := def[camel]; ok {
		return raw, true
	}
	raw, ok := def[snake]
	return raw, ok
}

// answerBool reads a boolean answer-definition flag (both casings).
func answerBool(def map[string]json.RawMessage, camel, snake string) bool {
	raw, ok := answerField(def, camel, snake)
	if !ok {
		return false
	}
	var b bool
	if err := json.Unmarshal(raw, &b); err != nil {
		return false
	}
	return b
}

// responseMatches mirrors response_matches (Rust assessment_delivery.rs:2994):
// numeric comparison with tolerance when either normalization is on and both
// sides parse, otherwise ASCII case-insensitive trimmed equality.
func responseMatches(accepted, response string, normalizeFraction, normalizeDecimal bool, tolerance *string) bool {
	if normalizeFraction || normalizeDecimal {
		if a, ok := parseNumericResponse(accepted, normalizeFraction); ok {
			if r, ok := parseNumericResponse(response, normalizeFraction); ok {
				explicit := 0.0
				if tolerance != nil {
					if t, err := strconv.ParseFloat(*tolerance, 64); err == nil && !math.IsNaN(t) && !math.IsInf(t, 0) && t >= 0 {
						explicit = t
					}
				}
				scale := math.Max(math.Abs(a), math.Abs(r))
				if scale < 1.0 {
					scale = 1.0
				}
				floor := (math.Nextafter(1, 2) - 1) * scale * 8.0
				bound := explicit
				if floor > bound {
					bound = floor
				}
				return math.Abs(a-r) <= bound
			}
		}
	}
	return asciiEqualFold(strings.TrimSpace(accepted), strings.TrimSpace(response))
}

// parseNumericResponse mirrors parse_numeric_response (Rust
// assessment_delivery.rs:3019).
func parseNumericResponse(value string, allowFraction bool) (float64, bool) {
	v := strings.TrimSpace(value)
	if allowFraction {
		if idx := strings.IndexByte(v, '/'); idx >= 0 {
			numStr, denStr := v[:idx], v[idx+1:]
			if strings.Contains(denStr, "/") {
				return 0, false
			}
			n, errNum := strconv.ParseFloat(numStr, 64)
			d, errDen := strconv.ParseFloat(denStr, 64)
			if errNum != nil || errDen != nil {
				return 0, false
			}
			if math.IsNaN(n) || math.IsInf(n, 0) || math.IsNaN(d) || math.IsInf(d, 0) || d == 0 {
				return 0, false
			}
			return n / d, true
		}
	}
	f, err := strconv.ParseFloat(v, 64)
	if err != nil || math.IsNaN(f) || math.IsInf(f, 0) {
		return 0, false
	}
	return f, true
}

// asciiEqualFold is ASCII-only case-insensitive equality (Rust
// eq_ignore_ascii_case).
func asciiEqualFold(a, b string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := 0; i < len(a); i++ {
		ca, cb := a[i], b[i]
		if 'A' <= ca && ca <= 'Z' {
			ca += 'a' - 'A'
		}
		if 'A' <= cb && cb <= 'Z' {
			cb += 'a' - 'A'
		}
		if ca != cb {
			return false
		}
	}
	return true
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
	var nextSectionID sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT id FROM assessment_sections WHERE exam_version_id = ? AND display_order > ? ORDER BY display_order LIMIT 1",
		versionID, sectionOrder).Scan(&nextSectionID); err != nil {
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

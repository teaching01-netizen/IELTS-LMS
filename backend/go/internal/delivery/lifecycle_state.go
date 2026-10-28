package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// lifecycleReadContext is the operation-level header of one LifecycleState
// read: schedule, attempt and version binding, the pinned SAT policy and the
// attempt control fields, all read by one statement inside the snapshot so
// later assembly never re-discovers them.
type lifecycleReadContext struct {
	scheduleID, examID, providerKey, versionID string
	attemptFound                               bool
	attemptScheduleID, attemptExamID           string
	rawPolicy, policyTimingModel               string
	versionRevision                            sql.NullInt64
	publishScope                               sql.NullString
	sessionMode                                string
	control                                    attemptControl
	now                                        time.Time
}

const lifecycleHeaderQuery = `
	SELECT s.id, s.exam_id, e.provider_key, e.exam_type, s.published_version_id,
	       a.id, a.schedule_id, a.exam_id,
	       CAST(s.sat_delivery_policy AS CHAR), COALESCE(s.sat_timing_model, r.timing_model, ''),
	       COALESCE(s.sat_session_mode, 'practice'), v.revision, v.sat_publish_scope,
	       a.candidate_name, COALESCE(a.proctor_status, 'active'), a.proctor_note,
	       COALESCE(a.delivery_status, 'running'), a.submitted_at, COALESCE(a.phase, ''),
	       a.sat_start_code_required, a.sat_start_code_accepted_at,
	       UTC_TIMESTAMP(6)
	FROM exam_schedules s
	JOIN exam_entities e ON e.id = s.exam_id
	LEFT JOIN student_attempts a ON a.id = ?
	LEFT JOIN exam_versions v ON v.id = s.published_version_id
	LEFT JOIN exam_session_runtimes r ON r.schedule_id = s.id
	WHERE s.id = ?`

func loadLifecycleReadContext(ctx context.Context, q tx.Tx, scheduleID, attemptID string) (lifecycleReadContext, error) {
	var c lifecycleReadContext
	var examType, rawPolicy sql.NullString
	var foundID, attemptScheduleID, attemptExamID, candidateName, proctorNote sql.NullString
	var submittedAt, codeAcceptedAt sql.NullTime
	var codeRequired sql.NullBool
	err := q.QueryRowContext(ctx, lifecycleHeaderQuery, attemptID, scheduleID).Scan(
		&c.scheduleID, &c.examID, &c.providerKey, &examType, &c.versionID,
		&foundID, &attemptScheduleID, &attemptExamID,
		&rawPolicy, &c.policyTimingModel, &c.sessionMode, &c.versionRevision, &c.publishScope,
		&candidateName, &c.control.proctorStatus, &proctorNote,
		&c.control.deliveryStatus, &submittedAt, &c.control.phase,
		&codeRequired, &codeAcceptedAt, &c.now)
	if err == sql.ErrNoRows {
		return c, apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
	}
	if err != nil {
		return c, err
	}
	c.providerKey = examdomain.EffectiveProviderKey(c.providerKey, examType.String)
	c.now = c.now.UTC()
	c.attemptFound = foundID.Valid
	if !c.attemptFound || c.providerKey != "sat" {
		return c, nil
	}
	c.attemptScheduleID, c.attemptExamID = attemptScheduleID.String, attemptExamID.String
	c.control.candidateName = candidateName.String
	c.control.proctorNote = nullStringToPtr(proctorNote)
	c.control.submittedAt = nullTime(submittedAt)
	c.control.codeRequired = codeRequired.Bool
	c.control.codeAcceptedAt = nullTime(codeAcceptedAt)
	c.rawPolicy = rawPolicy.String
	return c, nil
}

// errLifecycleFallback ends the read-only snapshot when the attempt is not on
// the pinned SAT recovery contract; Bootstrap serves it after the snapshot.
var errLifecycleFallback = errors.New("lifecycle state: bootstrap fallback")

// LifecycleState returns mutable attempt facts for the SAT recovery protocol.
// It deliberately avoids reconciliation, immutable question assembly, and
// response projection. Legacy SAT and non-SAT sessions keep the established
// Bootstrap behavior until their pinned contracts are migrated.
func (s *Service) LifecycleState(
	ctx context.Context,
	bearerScheduleID, bearerAttemptID, urlScheduleID string,
) (*Bootstrap, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	var state *Bootstrap
	err := s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		header, err := loadLifecycleReadContext(ctx, q, bearerScheduleID, bearerAttemptID)
		if err != nil {
			return err
		}
		if header.providerKey != "sat" {
			return errLifecycleFallback
		}
		if !header.attemptFound {
			return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
		}
		if header.attemptScheduleID != header.scheduleID || header.attemptExamID != header.examID {
			return apperrors.New(apperrors.CodeValidation, "Attempt does not belong to this assessment schedule.")
		}
		policy, err := attempts.ParseSATDeliveryPolicy([]byte(header.rawPolicy), header.policyTimingModel)
		if err != nil {
			return err
		}
		if policy == nil {
			return errLifecycleFallback
		}
		if !header.versionRevision.Valid {
			return apperrors.New(apperrors.CodeNotFound, "Published exam version not found.")
		}
		scheduleID, providerKey, now := header.scheduleID, header.providerKey, header.now
		snapshot := s.withTxDatabase(q)
		linkScope, err := snapshot.linkSectionScope(ctx, scheduleID)
		if err != nil {
			return err
		}
		scope := examdomain.IntersectSectionScopes(examdomain.ParseSATPublishScope(header.publishScope.String), linkScope)
		moduleAttempts, err := snapshot.loadSATLifecycleModules(ctx, bearerAttemptID, header.versionID, scope, now)
		if err != nil {
			return err
		}
		control, err := snapshot.loadAttemptControl(ctx, bearerAttemptID, header.control)
		if err != nil {
			return err
		}
		result, err := snapshot.loadBootstrapResult(ctx, providerKey, bearerAttemptID, control)
		if err != nil {
			return err
		}
		timing, runtimeStatus, _, err := snapshot.loadTiming(ctx, scheduleID, providerKey, now)
		if err != nil {
			return err
		}
		personalBreaks, err := snapshot.loadPersonalBreaks(ctx, bearerAttemptID, now)
		if err != nil {
			return err
		}
		startPolicy, _, err := snapshot.applySatStartPolicy(ctx, providerKey, scheduleID, control, now, []DeliverySection{})
		if err != nil {
			return err
		}
		awaiting, err := snapshot.awaitingStaffRoute(ctx, providerKey, bearerAttemptID, result, moduleAttempts)
		if err != nil {
			return err
		}
		state = &Bootstrap{
			ScheduleID:            scheduleID,
			ExamID:                header.examID,
			ProviderKey:           providerKey,
			VersionID:             header.versionID,
			VersionRevision:       header.versionRevision.Int64,
			ServerNow:             now,
			CandidateName:         control.candidateName,
			ScheduleRuntimeStatus: runtimeStatus,
			Timing:                timing,
			ProctorStatus:         control.proctorStatus,
			ProctorNote:           control.proctorNote,
			DeviceFingerprintHash: control.deviceFingerprintHash,
			Sections:              []DeliverySection{},
			Attempt: AttemptSnapshot{
				ID:                   bearerAttemptID,
				ModuleAttempts:       moduleAttempts,
				Responses:            []ResponseSnapshot{},
				PersonalBreaks:       personalBreaks,
				ProvisionalSubmitted: control.deliveryStatus == "submitted" && control.submittedAt == nil,
			},
			Result:             result,
			SatStartPolicy:     startPolicy,
			SATDeliveryPolicy:  policy,
			SatSessionMode:     header.sessionMode,
			AwaitingStaffRoute: awaiting,
		}
		return nil
	})
	if errors.Is(err, errLifecycleFallback) {
		return s.Bootstrap(ctx, bearerScheduleID, bearerAttemptID, urlScheduleID)
	}
	return state, err
}

// satLifecycleModulesQuery is the pinned lifecycle read's module projection:
// one row per module attempt of this attempt whose module belongs to the
// published version, with its entry offer and optional boundary. The boundary
// is keyed by module_attempt_id (its primary key), so the LEFT JOIN cannot
// multiply rows; one-to-many collections (breaks, responses) stay out of it.
const satLifecycleModulesQuery = `
	SELECT ma.id, ma.module_id, ma.state, ma.allocated_seconds,
	       ma.available_at, ma.started_at, ma.paused_at,
	       ma.accumulated_paused_seconds, ma.extension_seconds,
	       ma.completion_reason, ma.raw_correct, ma.operational_question_count,
	       ma.tool_state, ma.revision,
	       ma.entry_generation, ma.entry_starts_at, ma.entry_confirmed_at,
	       ma.entry_entered_at, ma.auto_start_at,
	       sec.section_key,
	       b.module_attempt_id, b.phase, b.policy_version,
	       b.work_deadline_at, b.entry_deadline_at, b.recovery_deadline_at,
	       b.next_action_at, b.resolution, b.resolved_at,
	       CAST(b.resolution_receipt AS CHAR), b.revision
	FROM assessment_module_attempts ma
	JOIN assessment_modules m ON m.id = ma.module_id
	JOIN assessment_sections sec ON sec.id = m.section_id
	LEFT JOIN assessment_module_boundaries b
	       ON b.module_attempt_id = ma.id AND b.attempt_id = ma.attempt_id AND b.run_generation = ma.run_generation
	WHERE ma.attempt_id = ? AND sec.exam_version_id = ?
	ORDER BY ma.created_at, ma.id`

// loadSATLifecycleModules is the one-statement form of loadModuleAttempts +
// moduleIDsForScope filtering + loadSATModuleBoundaries +
// loadPersonalEntryOffers for LifecycleState. Call it on the read-only
// snapshot so every row comes from the same transaction as the header.
func (s *Service) loadSATLifecycleModules(ctx context.Context, attemptID, versionID string, scope map[string]bool, now time.Time) ([]ModuleAttempt, error) {
	rows, err := s.db.QueryContext(ctx, satLifecycleModulesQuery, attemptID, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ModuleAttempt{}
	for rows.Next() {
		var m ModuleAttempt
		var availableAt, startedAt, pausedAt sql.NullTime
		var completionReason, toolState sql.NullString
		var rawCorrect, operationalCount sql.NullInt64
		var generation int
		var entryStartsAt, entryConfirmedAt, entryEnteredAt, autoStartAt sql.NullTime
		var sectionKey string
		var boundaryID, phase, policyVersion, resolution, resolutionReceipt sql.NullString
		var workDeadline, entryDeadline, recoveryDeadline, nextAction, resolvedAt sql.NullTime
		var boundaryRevision sql.Null[uint64]
		if err := rows.Scan(&m.ID, &m.ModuleID, &m.State, &m.AllocatedSeconds,
			&availableAt, &startedAt, &pausedAt,
			&m.AccumulatedPausedSeconds, &m.ExtensionSeconds,
			&completionReason, &rawCorrect, &operationalCount,
			&toolState, &m.Revision,
			&generation, &entryStartsAt, &entryConfirmedAt,
			&entryEnteredAt, &autoStartAt,
			&sectionKey,
			&boundaryID, &phase, &policyVersion,
			&workDeadline, &entryDeadline, &recoveryDeadline,
			&nextAction, &resolution, &resolvedAt,
			&resolutionReceipt, &boundaryRevision); err != nil {
			return nil, err
		}
		if !examdomain.AllowsSection(scope, sectionKey) {
			continue
		}
		m.AvailableAt = nullTime(availableAt)
		m.StartedAt = nullTime(startedAt)
		m.PausedAt = nullTime(pausedAt)
		m.CompletionReason = nullString(completionReason)
		m.RawCorrect = nullInt(rawCorrect)
		m.OperationalQuestionCount = nullInt(operationalCount)
		m.ToolState = rawJSON(toolState)
		if len(m.ToolState) == 0 {
			m.ToolState = json.RawMessage("{}")
		}
		m.DeadlineAt, m.RemainingSeconds = computeModuleTiming(
			m.AvailableAt, m.StartedAt, m.PausedAt, m.AllocatedSeconds,
			m.AccumulatedPausedSeconds, m.ExtensionSeconds, now)
		m.EntryGeneration = &generation
		m.EntryStartsAt = nullTime(entryStartsAt)
		m.EntryConfirmedAt = nullTime(entryConfirmedAt)
		m.EntryEnteredAt = nullTime(entryEnteredAt)
		m.AutoStartAt = nullTime(autoStartAt)
		if boundaryID.Valid {
			m.SATBoundary = &SATModuleBoundarySnapshot{
				Phase: phase.String, PolicyVersion: policyVersion.String,
				WorkDeadlineAt: nullTime(workDeadline), EntryDeadlineAt: nullTime(entryDeadline),
				RecoveryDeadlineAt: nullTime(recoveryDeadline), NextActionAt: nullTime(nextAction),
				Resolution: nullString(resolution), ResolvedAt: nullTime(resolvedAt),
				ResolutionReceipt: rawJSON(resolutionReceipt), Revision: boundaryRevision.V,
			}
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

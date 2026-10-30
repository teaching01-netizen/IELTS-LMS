package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/proctor"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/schedules"
	"github.com/google/uuid"
)

type studentScheduleContextRow struct {
	id, examID, providerKey, examType, examTitle    string
	proctorDisplayName, gradingDisplayName          string
	publishedVersionID, cohortName                  string
	institution, recurrenceEndDate                  sql.NullString
	startTime, endTime, createdAt, updatedAt        time.Time
	plannedDuration, recurrenceInterval, revision   int
	deliveryMode, recurrenceType, status, createdBy string
	bufferBefore, bufferAfter                       sql.NullInt64
	autoStart, autoStop                             bool
}

// loadStudentScheduleVersion projects the schedule and its published version for
// a student. `openedModules` is the attempt's assigned module set (from
// assessment_module_attempts); the content snapshot is fenced against it so an
// adaptive branch the candidate was never routed into cannot be read through
// this route either. A nil/empty set fails closed: base and non-adaptive
// modules survive, unassigned branches do not.
func loadStudentScheduleVersion(ctx context.Context, db *sql.DB, scheduleID string, openedModules map[string]bool) (map[string]any, map[string]any, string, error) {
	var row studentScheduleContextRow
	err := db.QueryRowContext(ctx, `
		SELECT s.id, s.exam_id, s.provider_key, e.exam_type, s.exam_title,
		       COALESCE(s.proctor_display_name, s.exam_title),
		       COALESCE(s.grading_display_name, s.exam_title),
		       s.published_version_id, s.cohort_name, s.institution,
		       s.start_time, s.end_time, s.planned_duration_minutes,
		       s.delivery_mode, s.recurrence_type, s.recurrence_interval,
		       s.recurrence_end_date, s.buffer_before_minutes, s.buffer_after_minutes,
		       s.auto_start, s.auto_stop, s.status, s.created_at, s.created_by,
		       s.updated_at, s.revision
		FROM exam_schedules s
		JOIN exam_entities e ON e.id = s.exam_id
		WHERE s.id = ?`, scheduleID).Scan(
		&row.id, &row.examID, &row.providerKey, &row.examType, &row.examTitle,
		&row.proctorDisplayName, &row.gradingDisplayName,
		&row.publishedVersionID, &row.cohortName, &row.institution,
		&row.startTime, &row.endTime, &row.plannedDuration,
		&row.deliveryMode, &row.recurrenceType, &row.recurrenceInterval,
		&row.recurrenceEndDate, &row.bufferBefore, &row.bufferAfter,
		&row.autoStart, &row.autoStop, &row.status, &row.createdAt, &row.createdBy,
		&row.updatedAt, &row.revision)
	if err == sql.ErrNoRows {
		return nil, nil, "", apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
	}
	if err != nil {
		return nil, nil, "", err
	}

	providerKey := effectiveStudentContextProvider(row.providerKey, row.examType)
	schedule := map[string]any{
		"id": row.id, "examId": row.examID, "providerKey": providerKey,
		"examTitle": row.examTitle, "proctorDisplayName": row.proctorDisplayName,
		"gradingDisplayName": row.gradingDisplayName, "publishedVersionId": row.publishedVersionID,
		"cohortName": row.cohortName, "startTime": row.startTime.UTC(), "endTime": row.endTime.UTC(),
		"plannedDurationMinutes": row.plannedDuration, "deliveryMode": row.deliveryMode,
		"recurrenceType": row.recurrenceType, "recurrenceInterval": row.recurrenceInterval,
		"autoStart": row.autoStart, "autoStop": row.autoStop, "status": row.status,
		"createdAt": row.createdAt.UTC(),
		"updatedAt": row.updatedAt.UTC(), "revision": row.revision,
	}
	// Staff identity never crosses to students: createdBy is dropped
	// (version-level authorship was already redacted; schedule-level
	// follows the same rule).
	if row.institution.Valid {
		schedule["institution"] = row.institution.String
	}
	if row.recurrenceEndDate.Valid {
		schedule["recurrenceEndDate"] = row.recurrenceEndDate.String
	}
	if row.bufferBefore.Valid {
		schedule["bufferBeforeMinutes"] = row.bufferBefore.Int64
	}
	if row.bufferAfter.Valid {
		schedule["bufferAfterMinutes"] = row.bufferAfter.Int64
	}

	var versionID, examID, parentVersionID, createdBy, publishNotes sql.NullString
	var contentRaw, configRaw, validationRaw sql.NullString
	var versionNumber, revision int
	var createdAt time.Time
	var isDraft, isPublished bool
	err = db.QueryRowContext(ctx, `
		SELECT id, exam_id, version_number, parent_version_id,
		       CAST(content_snapshot AS CHAR), CAST(config_snapshot AS CHAR),
		       CAST(validation_snapshot AS CHAR), created_by, created_at,
		       publish_notes, is_draft, is_published, revision
		FROM exam_versions WHERE id = ? AND exam_id = ?`, row.publishedVersionID, row.examID).Scan(
		&versionID, &examID, &versionNumber, &parentVersionID, &contentRaw, &configRaw,
		&validationRaw, &createdBy, &createdAt, &publishNotes, &isDraft, &isPublished, &revision)
	if err == sql.ErrNoRows {
		return nil, nil, "", apperrors.New(apperrors.CodeNotFound, "Published exam version not found.")
	}
	if err != nil {
		return nil, nil, "", err
	}
	// Security P0: student-facing version payloads carry no authoring
	// internals. content/config snapshots pass through the same allowlisted
	// redaction as SAT bootstrap (deliveredAnswer); validation snapshots,
	// publish notes, authorship and draft flags never cross to students.
	content, err := redactStudentSnapshot(contentRaw.String)
	if err != nil {
		return nil, nil, "", err
	}
	// SEV-1 content fence, same predicate as the delivery payload: an adaptive
	// branch only exists for the candidate the server routed into it. The V1
	// snapshot is a second projection of the same published version, so it needs
	// the same narrowing; answer-key redaction alone leaves the unassigned
	// branch's stimulus, prompt and options readable.
	fenceStudentSnapshotBranches(content, openedModules)
	if strings.EqualFold(strings.TrimSpace(row.examType), "ACT") {
		content["providerKey"] = "act"
	} else if _, exists := content["providerKey"]; !exists {
		content["providerKey"] = row.providerKey
	}
	config, err := redactStudentSnapshot(configRaw.String)
	if err != nil {
		return nil, nil, "", err
	}
	// Form definitions reach students only through purpose-specific DTOs
	// (public registrationForm, Eva state), never the raw config.
	delete(config, definition.SnapshotKey)
	version := map[string]any{
		"id": versionID.String, "examId": examID.String, "versionNumber": versionNumber,
		"contentSnapshot": content, "configSnapshot": config,
		"createdAt": createdAt.UTC(), "revision": revision,
	}
	if parentVersionID.Valid {
		version["parentVersionId"] = parentVersionID.String
	}
	return schedule, version, providerKey, nil
}

func effectiveStudentContextProvider(providerKey, examType string) string {
	if strings.EqualFold(strings.TrimSpace(examType), "ACT") {
		return "act"
	}
	return providerKey
}

// fenceStudentVersionForStartCode withholds the V1 content snapshot of a SAT
// code-start session until the candidate's own code redemption (an unresolved
// attempt fails closed). Only top-level scalars survive (identity, title,
// provider); every nested structure — sections, modules, questions, stimulus,
// media references — is dropped from a fresh map, never the cached tree.
func fenceStudentVersionForStartCode(ctx context.Context, app *App, scheduleID, attemptID string, version map[string]any) error {
	gated, err := studentStartCodeGated(ctx, app, scheduleID, attemptID)
	if err != nil || !gated {
		return err
	}
	withholdStudentVersionContent(version)
	return nil
}

func studentStartCodeGated(ctx context.Context, app *App, scheduleID, attemptID string) (bool, error) {
	if app == nil || app.Delivery == nil {
		return false, nil
	}
	return app.Delivery.StudentContentGated(ctx, scheduleID, attemptID)
}

func withholdStudentVersionContent(version map[string]any) {
	if version == nil {
		return
	}
	content, _ := version["contentSnapshot"].(map[string]any)
	stub := map[string]any{"contentWithheld": true}
	for key, value := range content {
		switch value.(type) {
		case map[string]any, []any:
			continue
		default:
			stub[key] = value
		}
	}
	version["contentSnapshot"] = stub
}

// fenceStudentSnapshotBranches walks a decoded V1 content snapshot in place and
// removes every adaptive branch module the attempt has no module attempt row
// for. Branch modules are identified by their authored role (`lower_branch` /
// `higher_branch`) plus their authored module id, in either key spelling, so
// the walk does not depend on one authoring generation's nesting.
//
// A branch whose id cannot be read is dropped: an unidentifiable branch cannot
// be proven assigned, and a missing question set is survivable while a leaked
// one is not.
func fenceStudentSnapshotBranches(node any, openedModules map[string]bool) {
	switch v := node.(type) {
	case map[string]any:
		for key, child := range v {
			if list, ok := child.([]any); ok {
				v[key] = fenceStudentSnapshotList(list, openedModules)
				continue
			}
			fenceStudentSnapshotBranches(child, openedModules)
		}
	case []any:
		for _, child := range v {
			fenceStudentSnapshotBranches(child, openedModules)
		}
	}
}

func fenceStudentSnapshotList(list []any, openedModules map[string]bool) []any {
	kept := make([]any, 0, len(list))
	for _, child := range list {
		if module, ok := child.(map[string]any); ok && snapshotModuleIsUnassignedBranch(module, openedModules) {
			continue
		}
		fenceStudentSnapshotBranches(child, openedModules)
		kept = append(kept, child)
	}
	return kept
}

func snapshotModuleIsUnassignedBranch(module map[string]any, openedModules map[string]bool) bool {
	role := snapshotStringField(module, "adaptiveRole", "adaptive_role")
	if role != "lower_branch" && role != "higher_branch" {
		return false
	}
	id := snapshotStringField(module, "id", "moduleId", "module_id", "moduleKey", "module_key")
	return id == "" || !openedModules[id]
}

func snapshotStringField(node map[string]any, keys ...string) string {
	for _, key := range keys {
		if value, ok := node[key].(string); ok && strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func decodeStudentSnapshot(raw string) map[string]any {
	var value map[string]any
	if json.Unmarshal([]byte(raw), &value) != nil || value == nil {
		return map[string]any{}
	}
	return value
}

// redactStudentSnapshot strips answer-key and authoring-internal fields from
// a V1 snapshot tree before it crosses to students. Answer definitions keep
// only the deliverable fields (same allowlist as delivery.deliveredAnswer:
// kind + options for single_choice; kind + normalization fields for
// student_produced_response). Validation metadata, rationales, internal
// notes, and pretest markers are dropped — they are test-strategy signals.
func redactStudentSnapshot(raw string) (map[string]any, error) {
	root := decodeStudentSnapshot(raw)
	redactSnapshotValue(root)
	return root, nil
}

// redactSnapshotValue walks a decoded snapshot tree in place, redacting
// every embedded answer definition it finds (sections/modules/questions
// nesting varies by authoring version; key names are stable).
//
// Key-universe contract: the scorer accepts camelCase AND snake_case
// twins, so deletion covers both spellings (normalized compare). An
// authoring row carrying snake_case key material must not pass through.
func redactSnapshotValue(node any) {
	switch v := node.(type) {
	case map[string]any:
		if raw, ok := v["answer"]; ok {
			if redacted, err := redactAnswerValue(raw); err == nil {
				v["answer"] = redacted
			} else {
				delete(v, "answer")
			}
		}
		if raw, ok := v["answerDefinition"]; ok {
			if redacted, err := redactAnswerValue(raw); err == nil {
				v["answerDefinition"] = redacted
			} else {
				delete(v, "answerDefinition")
			}
		}
		if raw, ok := v["answer_definition"]; ok {
			if redacted, err := redactAnswerValue(raw); err == nil {
				v["answer_definition"] = redacted
			} else {
				delete(v, "answer_definition")
			}
		}
		for key := range v {
			switch normalizeAnswerKey(key) {
			case "correctoptionid", "acceptedresponses", "rationale", "internalnote", "ispretest",
				"explanation", "scoringnote", "authornote":
				delete(v, key)
			}
		}
		for _, child := range v {
			redactSnapshotValue(child)
		}
	case []any:
		for _, child := range v {
			redactSnapshotValue(child)
		}
	}
}

// normalizeAnswerKey canonicalizes an answer-adjacent key for comparison:
// lowercase, underscores removed. "correct_option_id" and
// "CorrectOptionId" both normalize to "correctoptionid".
func normalizeAnswerKey(key string) string {
	var out []rune
	for _, r := range key {
		if r == '_' {
			continue
		}
		if r >= 'A' && r <= 'Z' {
			out = append(out, r+('a'-'A'))
		} else {
			out = append(out, r)
		}
	}
	return string(out)
}

// redactAnswerValue keeps only the deliverable fields of one answer
// definition, mirroring delivery.deliveredAnswer without importing the
// delivery package (cmd/api must not depend on internal service packages).
// Twin spellings accepted on input, canonical camelCase emitted; options
// re-allowlisted per element ({id, content} only).
func redactAnswerValue(raw any) (any, error) {
	encoded, err := json.Marshal(raw)
	if err != nil {
		return nil, err
	}
	var source map[string]json.RawMessage
	if err := json.Unmarshal(encoded, &source); err != nil {
		return nil, err
	}
	byNorm := map[string]json.RawMessage{}
	for key, value := range source {
		byNorm[normalizeAnswerKey(key)] = value
	}
	kind := ""
	if rawKind, ok := byNorm["kind"]; ok {
		_ = json.Unmarshal(rawKind, &kind)
	}
	out := map[string]any{}
	if rawKind, ok := source["kind"]; ok {
		var decoded any
		if err := json.Unmarshal(rawKind, &decoded); err == nil {
			out["kind"] = decoded
		}
	} else if kind != "" {
		out["kind"] = kind
	}
	switch kind {
	case "single_choice":
		rawOptions, ok := byNorm["options"]
		if !ok {
			break
		}
		var options []map[string]any
		if err := json.Unmarshal(rawOptions, &options); err != nil {
			break
		}
		redacted := make([]map[string]any, 0, len(options))
		for _, opt := range options {
			keep := map[string]any{}
			for key, value := range opt {
				switch normalizeAnswerKey(key) {
				case "id", "content":
					keep[key] = value
				}
			}
			redacted = append(redacted, keep)
		}
		out["options"] = redacted
	case "student_produced_response":
		for _, canonical := range []string{"normalizeFraction", "normalizeDecimal", "numericTolerance"} {
			if value, ok := byNorm[normalizeAnswerKey(canonical)]; ok {
				var decoded any
				if err := json.Unmarshal(value, &decoded); err == nil {
					out[canonical] = decoded
				}
			}
		}
	default:
		return nil, apperrors.New(apperrors.CodeValidation, "Unsupported delivered answer kind.")
	}
	return out, nil
}

func loadStudentRuntimeContext(ctx context.Context, db *sql.DB, scheduleID string, attemptIDs ...string) (map[string]any, error) {
	runtime, err := proctor.LoadSessionRuntimeBySchedule(ctx, db, scheduleID)
	if err != nil {
		if err == sql.ErrNoRows {
			return nil, nil
		}
		return nil, err
	}
	encoded, err := json.Marshal(runtime)
	if err != nil {
		return nil, err
	}
	var out map[string]any
	if err := json.Unmarshal(encoded, &out); err != nil {
		return nil, err
	}
	if examruntime.IsIELTSPersonal(runtime.TimingModel) && len(attemptIDs) > 0 && strings.TrimSpace(attemptIDs[0]) != "" {
		if err := projectIELTSPersonalRuntime(ctx, db, runtime.ID, attemptIDs[0], runtime.TimingModel, out); err != nil {
			return nil, err
		}
	}
	return out, nil
}

type ieltsRuntimeSectionProjection struct {
	key, label, state                                   string
	order, minutes, gap, extension, pausedSeconds       int
	start, deadline, expected, preparationEnd, pausedAt sql.NullTime
	roomRelease                                         sql.NullTime
}

func projectIELTSPersonalRuntime(ctx context.Context, db *sql.DB, runtimeID, attemptID, timingModel string, view map[string]any) error {
	rows, err := db.QueryContext(ctx, `
		SELECT rs.section_key, rs.label, rs.section_order, rs.planned_duration_minutes,
		       rs.gap_after_minutes, rs.extension_minutes, rs.accumulated_paused_seconds, rs.actual_start_at,
		       COALESCE(t.state, ''), t.started_at, t.deadline_at,
		       t.expected_start_at, t.preparation_deadline_at, t.paused_at
		FROM exam_session_runtime_sections rs
		LEFT JOIN ielts_attempt_section_timelines t
		  ON t.runtime_id = rs.runtime_id AND t.attempt_id = ? AND t.section_key = rs.section_key
		WHERE rs.runtime_id = ?
	ORDER BY rs.section_order, rs.section_key`, attemptID, runtimeID)
	if err != nil {
		return err
	}
	defer rows.Close()
	sections := make([]ieltsRuntimeSectionProjection, 0, 3)
	for rows.Next() {
		var section ieltsRuntimeSectionProjection
		if err := rows.Scan(&section.key, &section.label, &section.order, &section.minutes,
			&section.gap, &section.extension, &section.pausedSeconds, &section.roomRelease, &section.state,
			&section.start, &section.deadline, &section.expected, &section.preparationEnd, &section.pausedAt); err != nil {
			return err
		}
		if section.key == "listening" || section.key == "reading" || section.key == "writing" {
			sections = append(sections, section)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if len(sections) == 0 {
		return nil
	}
	var roomStatus string
	var completionReason sql.NullString
	var prepSeconds int
	var actualStart sql.NullTime
	var now time.Time
	if err := db.QueryRowContext(ctx, `SELECT status, completion_reason, ielts_preparation_seconds, actual_start_at, UTC_TIMESTAMP(6)
		FROM exam_session_runtimes WHERE id = ?`, runtimeID).Scan(&roomStatus, &completionReason, &prepSeconds, &actualStart, &now); err != nil {
		return err
	}
	now = now.UTC()
	if prepSeconds < 0 || prepSeconds > 3600 {
		prepSeconds = 120
	}
	selected := len(sections) - 1
	activeIndex := -1
	for i := range sections {
		section := &sections[i]
		if section.state == "active" && section.deadline.Valid {
			cutoff := now
			if section.pausedAt.Valid {
				cutoff = section.pausedAt.Time.UTC()
			}
			if cutoff.Before(section.deadline.Time.UTC()) {
				selected, activeIndex = i, i
				break
			}
			section.state = "completed"
		}
		if section.state == "unable" || section.state == "preparing" || section.state == "" {
			selected = i
			break
		}
	}
	selectedSection := sections[selected]
	sectionMaps := make([]map[string]any, 0, len(sections))
	for i, section := range sections {
		status := "locked"
		var startAt, endAt *time.Time
		if section.state == "active" && section.deadline.Valid {
			cutoff := now
			if section.pausedAt.Valid {
				cutoff = section.pausedAt.Time.UTC()
			}
			if cutoff.Before(section.deadline.Time.UTC()) {
				status = "live"
				if section.start.Valid {
					v := section.start.Time.UTC()
					startAt = &v
				}
			} else {
				status = "completed"
				v := section.deadline.Time.UTC()
				endAt = &v
			}
		} else if section.state == "completed" {
			status = "completed"
			if section.deadline.Valid {
				v := section.deadline.Time.UTC()
				endAt = &v
			}
		}
		if i == activeIndex && roomStatus == "paused" {
			status = "paused"
		}
		sectionDuration := section.minutes + section.extension
		if section.start.Valid && section.deadline.Valid {
			d := int(section.deadline.Time.Sub(section.start.Time).Seconds())
			if d > 0 {
				sectionDuration = (d + 59) / 60
			}
		}
		sectionMaps = append(sectionMaps, map[string]any{
			"sectionKey": section.key, "label": section.label, "sectionOrder": section.order,
			"plannedDurationMinutes": sectionDuration, "gapAfterMinutes": section.gap,
			"extensionMinutes": 0, "accumulatedPausedSeconds": 0, "status": status,
			"actualStartAt": startAt, "actualEndAt": endAt, "pausedAt": studentNullTimePtr(section.pausedAt),
			"projectedStartAt": nil, "projectedEndAt": nil, "completionReason": nil,
		})
	}
	deadline := (*time.Time)(nil)
	remaining := 0
	if activeIndex >= 0 && sections[activeIndex].deadline.Valid {
		v := sections[activeIndex].deadline.Time.UTC()
		deadline = &v
		base := now
		if sections[activeIndex].pausedAt.Valid {
			base = sections[activeIndex].pausedAt.Time.UTC()
		}
		if v.After(base) {
			remaining = int(v.Sub(base).Seconds())
			if v.Sub(base)%time.Second != 0 {
				remaining++
			}
		}
	}
	if roomStatus == "completed" {
		if completionReason.String == "time_expired" {
			roomStatus = "live"
		} else {
			roomStatus = "completed"
		}
	}
	view["status"] = roomStatus
	view["activeSectionKey"] = selectedSection.key
	view["currentSectionKey"] = selectedSection.key
	view["currentSectionDeadlineAt"] = deadline
	view["currentSectionRemainingSeconds"] = remaining
	view["sections"] = sectionMaps
	view["waitingForNextSection"] = activeIndex < 0
	view["serverNow"] = now
	if !selectedSection.expected.Valid {
		if selected == 0 {
			selectedSection.expected = actualStart
		} else if previous := sections[selected-1]; previous.deadline.Valid {
			// Same eligibility as the /ready mutation; an unreleased V2 section
			// advertises no expected start.
			if examruntime.IsIELTSCohortPersonal(timingModel) {
				var release *time.Time
				if selectedSection.roomRelease.Valid {
					release = &selectedSection.roomRelease.Time
				}
				if v, ok := examruntime.IELTSNextSectionEligibleAt(previous.deadline.Time, previous.gap, release); ok {
					selectedSection.expected = sql.NullTime{Time: v, Valid: true}
				}
			} else {
				v := previous.deadline.Time.Add(time.Duration(previous.gap) * time.Minute)
				selectedSection.expected = sql.NullTime{Time: v, Valid: true}
			}
		}
	}
	if !selectedSection.preparationEnd.Valid && selectedSection.expected.Valid {
		selectedSection.preparationEnd = sql.NullTime{
			Time: selectedSection.expected.Time.Add(time.Duration(prepSeconds) * time.Second), Valid: true,
		}
	}
	view["personalSectionState"] = selectedSection.state
	view["personalExpectedStartAt"] = studentNullTimePtr(selectedSection.expected)
	view["personalPreparationEndsAt"] = studentNullTimePtr(selectedSection.preparationEnd)
	if selectedSection.state == "unable" {
		view["personalPreparationMessage"] = "Could not start this section. Your completed work and saved answers are preserved. Contact the proctor for help."
	}
	if selectedSection.expected.Valid && activeIndex < 0 {
		v := selectedSection.expected.Time.UTC()
		view["nextSectionStartAt"] = v
	}
	return nil
}

func studentNullTimePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	v := value.Time.UTC()
	return &v
}

func loadStaffRuntimeContext(ctx context.Context, db *sql.DB, scheduleID string) (map[string]any, error) {
	out, err := loadStudentRuntimeContext(ctx, db, scheduleID)
	if err != nil || out == nil {
		return out, err
	}
	plan, err := proctor.LoadExamPlanBySchedule(ctx, db, scheduleID)
	if err != nil {
		return nil, err
	}
	out["examPlan"] = plan
	return out, nil
}

// resolveStudentAttemptIDForUser resolves the caller's attempt for the
// cookie-session reads (v1SessionInner/v1LiveInner via
// studentSessionContext). Fail-closed binding:
//   - candidateID != "": resolve by candidate identity ONLY, then VERIFY
//     the resolved row's user_id == userID; a cross-user candidate renders
//     sql.ErrNoRows (callers 404, no cross-user leak).
//   - candidateID == "": resolve by user_id; a miss renders ErrNoRows.
//   - Either way, REQUIRE a live schedule_registrations row for
//     (scheduleID, userID); without one the caller never checked in and
//     gets ErrNoRows (attempt:nil shape in studentSessionContext).
//
// Bootstrap is unaffected: v1BootstrapInner mints via
// bootstrapStudentAttempt (candidateID required, creates the registration)
// and never calls this resolver.
func resolveStudentAttemptIDForUser(ctx context.Context, db *sql.DB, scheduleID, candidateID, userID string) (string, error) {
	candidateID = strings.TrimSpace(candidateID)
	userID = strings.TrimSpace(userID)
	if userID == "" {
		return "", sql.ErrNoRows
	}
	if candidateID != "" {
		var attemptID, ownerID string
		err := db.QueryRowContext(ctx, `
		SELECT id, COALESCE(user_id, '') FROM student_attempts
		WHERE schedule_id = ?
		  AND (candidate_id = ? OR wcode = ? OR student_key = ?)
		ORDER BY updated_at DESC, id DESC LIMIT 1`,
			scheduleID, candidateID, candidateID, candidateID).Scan(&attemptID, &ownerID)
		if err != nil {
			return "", err
		}
		if ownerID != userID {
			return "", sql.ErrNoRows
		}
		if err := requireScheduleRegistration(ctx, db, scheduleID, userID); err != nil {
			return "", err
		}
		return attemptID, nil
	}
	var attemptID string
	err := db.QueryRowContext(ctx, `
		SELECT id FROM student_attempts
		WHERE schedule_id = ? AND user_id = ?
		ORDER BY updated_at DESC, id DESC LIMIT 1`,
		scheduleID, userID).Scan(&attemptID)
	if err != nil {
		return "", err
	}
	if err := requireScheduleRegistration(ctx, db, scheduleID, userID); err != nil {
		return "", err
	}
	return attemptID, nil
}

// openedModuleIDsForAttempt resolves the attempt's assigned module set for a
// content projection. A nil Delivery service or an unresolved attempt yields
// nil, which every fence reads as "base modules only" — fail closed.
func openedModuleIDsForAttempt(ctx context.Context, app *App, attemptID string) (map[string]bool, error) {
	if app == nil || app.Delivery == nil || strings.TrimSpace(attemptID) == "" {
		return nil, nil
	}
	return app.Delivery.AttemptOpenedModuleIDs(ctx, attemptID)
}

// requireScheduleRegistration reports ErrNoRows when no registration row
// binds (scheduleID, userID). Both user_id and actor_id count: entry binds
// either column depending on the flow (see CreateRegistration).
func requireScheduleRegistration(ctx context.Context, db *sql.DB, scheduleID, userID string) error {
	var one int
	err := db.QueryRowContext(ctx, `
		SELECT 1 FROM schedule_registrations
		WHERE schedule_id = ? AND (user_id = ? OR actor_id = ?)
		LIMIT 1`, scheduleID, userID, userID).Scan(&one)
	return err
}

func studentSessionContext(ctx context.Context, app *App, sess *auth.Session, scheduleID, candidateID, clientSessionID string, includeCredential bool) (map[string]any, error) {
	// Resolve the attempt BEFORE projecting the version: the content fence needs
	// the attempt's assigned module set, and an unresolved attempt must narrow to
	// base modules rather than fall back to the whole tree.
	attemptID, err := resolveStudentAttemptForSession(ctx, app.DB, scheduleID, candidateID, sess)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	openedModules, err := openedModuleIDsForAttempt(ctx, app, attemptID)
	if err != nil {
		return nil, err
	}
	schedule, version, _, err := loadStudentScheduleVersion(ctx, app.DB, scheduleID, openedModules)
	if err != nil {
		return nil, err
	}
	if err := fenceStudentVersionForStartCode(ctx, app, scheduleID, attemptID, version); err != nil {
		return nil, err
	}
	runtime, err := loadStudentRuntimeContext(ctx, app.DB, scheduleID, attemptID)
	if err != nil {
		return nil, err
	}
	context := map[string]any{
		"schedule": schedule, "version": version, "runtime": runtime,
		"attempt": nil, "attemptCredential": nil, "degradedLiveMode": false,
	}
	if attemptID == "" {
		return context, nil
	}
	// Round 83 (live rehearsal): the SAT Bootstrap path seeds the base
	// module row via ensureBaseModuleAttempt, but this V1 session path
	// never did — module-start then 404d on a missing module row (now
	// disambiguated by round 81). Seed here when the Delivery service
	// is wired; a nil Delivery (unit scope) skips silently. Seeding is
	// idempotent (existence probe + ON DUPLICATE KEY no-op), so session
	// refreshes stay cheap: one indexed SELECT when rows exist.
	if app.Delivery != nil {
		if serr := app.Delivery.EnsureBaseModuleAttemptForSchedule(ctx, attemptID, scheduleID); serr != nil {
			return nil, serr
		}
	}
	attempt, err := app.Student.GetAttemptProjection(ctx, attemptID)
	if err != nil {
		return nil, err
	}
	context["attempt"] = attempt
	applyStudentRecoveryContext(context, attempt)
	clientSessionID = strings.TrimSpace(clientSessionID)
	if !includeCredential {
		enforced, owner, err := attempts.WriterPolicyOf(ctx, app.DB, attemptID)
		if err != nil {
			return nil, err
		}
		if enforced {
			if owner == "" || owner != clientSessionID {
				context["version"] = nil
			}
			redactWriterIdentity(attempt, clientSessionID)
		}
		return context, nil
	}
	if clientSessionID == "" {
		clientSessionID = uuid.NewString()
	}
	context["clientSessionId"] = clientSessionID
	// Credential issue/refresh goes through the same admission boundary as
	// entry: authoritative lease, and no writer credential (nor protected
	// content) for a session competing with the current owner.
	admission, err := admitStudentSession(ctx, app, sess.UserID, scheduleID, attemptID, clientSessionID, nil, auth.ExamGrantOptions{AccountSessionID: sess.ID})
	if err != nil {
		return nil, err
	}
	context["admission"] = admissionPayload(admission)
	if admission.SingleWriter {
		redactWriterIdentity(attempt, clientSessionID)
	}
	if admission.Outcome == attempts.AdmissionBlocked {
		context["version"] = nil
		return context, nil
	}
	if admission.Token != "" {
		context["attemptCredential"] = map[string]any{"attemptToken": admission.Token, "expiresAt": admission.ExpiresAt.UTC(), "credentialPolicy": admission.CredentialPolicy}
		// Only the admitted writer receives the offline package descriptor.
		manifest, err := buildIELTSOfflineManifest(ctx, app.DB, runtime, version, attemptID, clientSessionID, admission.LeaseEpoch)
		if err != nil {
			return nil, err
		}
		if manifest != nil {
			context["offlineManifest"] = manifest
		}
	}
	return context, nil
}

type studentBootstrapRequest struct {
	StudentKey      string `json:"studentKey"`
	CandidateID     string `json:"candidateId"`
	CandidateName   string `json:"candidateName"`
	CandidateEmail  string `json:"candidateEmail"`
	ClientSessionID string `json:"clientSessionId"`
}

func bootstrapStudentAttempt(ctx context.Context, app *App, sess *auth.Session, scheduleID string, req studentBootstrapRequest) (map[string]any, error) {
	if sess.Proof.IsRecovery() {
		return studentSessionContext(ctx, app, sess, scheduleID, strings.TrimSpace(req.CandidateID), req.ClientSessionID, true)
	}
	candidateID := strings.TrimSpace(req.CandidateID)
	if candidateID == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "candidateId is required.")
	}
	if strings.TrimSpace(req.CandidateName) == "" {
		req.CandidateName = "Candidate " + candidateID
	}
	if strings.TrimSpace(req.CandidateEmail) == "" {
		if err := app.DB.QueryRowContext(ctx, "SELECT email FROM users WHERE id = ?", sess.UserID).Scan(&req.CandidateEmail); err != nil {
			return nil, err
		}
	}
	wcode := schedules.NormalizeAccessCode(candidateID)
	if wcode == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "candidateId is required.")
	}
	reg, err := app.Schedules.CreateRegistration(ctx, scheduleID, schedules.RegistrationRequest{
		Wcode: wcode, Email: req.CandidateEmail, StudentName: req.CandidateName, UserID: sess.UserID,
	})
	if err != nil {
		return nil, err
	}
	studentKey := reg.StudentKey
	if strings.TrimSpace(req.StudentKey) != "" {
		studentKey = req.StudentKey
	}
	_, err = app.Schedules.CreateScheduleAttempt(ctx, scheduleID, reg.ID, studentKey, candidateID, req.CandidateName, req.CandidateEmail, req.ClientSessionID)
	if err != nil {
		return nil, err
	}
	return studentSessionContext(ctx, app, sess, scheduleID, candidateID, req.ClientSessionID, true)
}

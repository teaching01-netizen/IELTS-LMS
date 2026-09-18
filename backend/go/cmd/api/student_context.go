package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/schedules"
	"github.com/google/uuid"
)

type studentScheduleContextRow struct {
	id, examID, providerKey, examTitle              string
	proctorDisplayName, gradingDisplayName          string
	publishedVersionID, cohortName                  string
	institution, recurrenceEndDate                  sql.NullString
	startTime, endTime, createdAt, updatedAt        time.Time
	plannedDuration, recurrenceInterval, revision   int
	deliveryMode, recurrenceType, status, createdBy string
	bufferBefore, bufferAfter                       sql.NullInt64
	autoStart, autoStop                             bool
}

func loadStudentScheduleVersion(ctx context.Context, db *sql.DB, scheduleID string) (map[string]any, map[string]any, string, error) {
	var row studentScheduleContextRow
	err := db.QueryRowContext(ctx, `
		SELECT s.id, s.exam_id, s.provider_key, s.exam_title,
		       COALESCE(s.proctor_display_name, s.exam_title),
		       COALESCE(s.grading_display_name, s.exam_title),
		       s.published_version_id, s.cohort_name, s.institution,
		       s.start_time, s.end_time, s.planned_duration_minutes,
		       s.delivery_mode, s.recurrence_type, s.recurrence_interval,
		       s.recurrence_end_date, s.buffer_before_minutes, s.buffer_after_minutes,
		       s.auto_start, s.auto_stop, s.status, s.created_at, s.created_by,
		       s.updated_at, s.revision
		FROM exam_schedules s
		WHERE s.id = ?`, scheduleID).Scan(
		&row.id, &row.examID, &row.providerKey, &row.examTitle,
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

	schedule := map[string]any{
		"id": row.id, "examId": row.examID, "providerKey": row.providerKey,
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
	if _, exists := content["providerKey"]; !exists {
		content["providerKey"] = row.providerKey
	}
	config, err := redactStudentSnapshot(configRaw.String)
	if err != nil {
		return nil, nil, "", err
	}
	version := map[string]any{
		"id": versionID.String, "examId": examID.String, "versionNumber": versionNumber,
		"contentSnapshot": content, "configSnapshot": config,
		"createdAt": createdAt.UTC(), "revision": revision,
	}
	if parentVersionID.Valid {
		version["parentVersionId"] = parentVersionID.String
	}
	return schedule, version, row.providerKey, nil
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

func loadStudentRuntimeContext(ctx context.Context, db *sql.DB, scheduleID string) (map[string]any, error) {
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
	schedule, version, _, err := loadStudentScheduleVersion(ctx, app.DB, scheduleID)
	if err != nil {
		return nil, err
	}
	runtime, err := loadStudentRuntimeContext(ctx, app.DB, scheduleID)
	if err != nil {
		return nil, err
	}
	attemptID, err := resolveStudentAttemptIDForUser(ctx, app.DB, scheduleID, candidateID, sess.UserID)
	if err != nil && err != sql.ErrNoRows {
		return nil, err
	}
	context := map[string]any{
		"schedule": schedule, "version": version, "runtime": runtime,
		"attempt": nil, "attemptCredential": nil, "degradedLiveMode": false,
	}
	if err == sql.ErrNoRows {
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
	if includeCredential {
		activeSession, _ := attempt["activeClientSessionId"].(string)
		if strings.TrimSpace(clientSessionID) == "" {
			clientSessionID = strings.TrimSpace(activeSession)
		}
		if clientSessionID == "" {
			clientSessionID = uuid.NewString()
		}
		lease := uint64(1)
		token, expiresAt, err := auth.IssueAttemptToken(ctx, app.DB, app.Config, sess.UserID, scheduleID, attemptID, clientSessionID, nil, &lease, time.Now().UTC())
		if err != nil {
			return nil, err
		}
		context["attemptCredential"] = map[string]any{"attemptToken": token, "expiresAt": expiresAt.UTC()}
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

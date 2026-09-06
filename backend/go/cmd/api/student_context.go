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
		"createdAt": row.createdAt.UTC(), "createdBy": row.createdBy,
		"updatedAt": row.updatedAt.UTC(), "revision": row.revision,
	}
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
	content := decodeStudentSnapshot(contentRaw.String)
	if _, exists := content["providerKey"]; !exists {
		content["providerKey"] = row.providerKey
	}
	version := map[string]any{
		"id": versionID.String, "examId": examID.String, "versionNumber": versionNumber,
		"contentSnapshot": content, "configSnapshot": decodeStudentSnapshot(configRaw.String),
		"createdBy": createdBy.String, "createdAt": createdAt.UTC(),
		"isDraft": isDraft, "isPublished": isPublished, "revision": revision,
	}
	if parentVersionID.Valid {
		version["parentVersionId"] = parentVersionID.String
	}
	if validationRaw.Valid && strings.TrimSpace(validationRaw.String) != "" && strings.TrimSpace(validationRaw.String) != "null" {
		version["validationSnapshot"] = decodeStudentSnapshot(validationRaw.String)
	}
	if publishNotes.Valid {
		version["publishNotes"] = publishNotes.String
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

func resolveStudentAttemptIDForUser(ctx context.Context, db *sql.DB, scheduleID, candidateID, userID string) (string, error) {
	candidateID = strings.TrimSpace(candidateID)
	userID = strings.TrimSpace(userID)
	var attemptID string
	err := db.QueryRowContext(ctx, `
		SELECT id FROM student_attempts
		WHERE schedule_id = ?
		  AND ((? <> '' AND (candidate_id = ? OR wcode = ? OR student_key = ?))
		       OR (? <> '' AND user_id = ?))
		ORDER BY updated_at DESC, id DESC LIMIT 1`,
		scheduleID, candidateID, candidateID, candidateID, candidateID, userID, userID).Scan(&attemptID)
	return attemptID, err
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

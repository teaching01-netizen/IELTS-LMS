package student

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/google/uuid"
)

// PrecheckRequest is the authenticated student system-check write. The
// attempt id and actor are attached by the HTTP boundary after validating the
// cookie session or attempt bearer.
type PrecheckRequest struct {
	AttemptID             string
	ScheduleID            string
	StudentKey            string
	ClientSessionID       string
	ActorUserID           string
	PreCheck              json.RawMessage
	DeviceFingerprintHash *string
}

// HeartbeatRequest is the authenticated student connectivity write.
type HeartbeatRequest struct {
	AttemptID       string
	ScheduleID      string
	StudentKey      string
	ClientSessionID string
	ActorUserID     string
	MutationID      string
	EventType       string
	Payload         json.RawMessage
	ClientTimestamp time.Time
}

// AuditRequest is the authenticated student integrity/audit write.
type AuditRequest struct {
	AttemptID       string
	ScheduleID      string
	StudentKey      string
	ClientSessionID string
	ActorUserID     string
	ActionType      string
	Payload         json.RawMessage
	ClientTimestamp *time.Time
}

type telemetryAttempt struct {
	ID                    string
	ScheduleID            string
	StudentKey            string
	UserID                sql.NullString
	CandidateName         string
	ActiveClientSessionID sql.NullString
	Integrity             string
	Recovery              string
	Violations            string
}

func (s *Service) RecordPrecheck(ctx context.Context, req PrecheckRequest) (map[string]any, error) {
	if s.db == nil {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable.")
	}
	if strings.TrimSpace(req.AttemptID) == "" || strings.TrimSpace(req.ScheduleID) == "" {
		return nil, validationError("Attempt and schedule are required.")
	}
	if !isJSONObject(req.PreCheck) {
		return nil, validationError("preCheck must be a JSON object.")
	}

	// B1: point-write tx on one attempt row (RC-safe; no snapshot dependency).
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()

	attempt, err := loadTelemetryAttempt(ctx, tx, req.AttemptID, req.ScheduleID)
	if err != nil {
		return nil, err
	}
	if err := authorizeTelemetryAttempt(ctx, tx, &attempt, req.StudentKey, req.ActorUserID); err != nil {
		return nil, err
	}
	clientSessionID, err := ensureTelemetryClientSession(ctx, tx, attempt, req.ClientSessionID)
	if err != nil {
		return nil, err
	}

	integrity := telemetryObject(attempt.Integrity)
	precheckWasRecorded := false
	if _, exists := integrity["preCheck"]; exists {
		precheckWasRecorded = true
	}
	var precheck any
	if err := json.Unmarshal(req.PreCheck, &precheck); err != nil {
		return nil, validationError("preCheck must be valid JSON.")
	}
	integrity["preCheck"] = precheck
	if req.DeviceFingerprintHash != nil && strings.TrimSpace(*req.DeviceFingerprintHash) != "" {
		integrity["deviceFingerprintHash"] = strings.TrimSpace(*req.DeviceFingerprintHash)
	}
	recovery := telemetryObject(attempt.Recovery)
	recovery["clientSessionId"] = clientSessionID
	recovery["lastPersistedAt"] = time.Now().UTC().Format(time.RFC3339Nano)
	if _, err := tx.ExecContext(ctx, `
		UPDATE student_attempts
		SET integrity = ?, recovery = ?, active_client_session_id = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(6)
		WHERE id = ? AND schedule_id = ?`, encodeTelemetryObject(integrity), encodeTelemetryObject(recovery), clientSessionID, req.AttemptID, req.ScheduleID); err != nil {
		return nil, err
	}
	if !precheckWasRecorded {
		payload := map[string]any{"preCheck": precheck}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at)
			VALUES (?, ?, ?, 'PRECHECK_COMPLETED', ?, ?, UTC_TIMESTAMP(6))`,
			uuid.NewString(), req.ScheduleID, firstNonEmpty(req.ActorUserID, attempt.StudentKey), req.AttemptID, encodeTelemetryObject(payload)); err != nil {
			return nil, err
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetAttemptProjection(ctx, req.AttemptID)
}

// RecordHeartbeat persists the event and updates the attempt integrity
// projection. mutation_id makes retries safe without suppressing distinct
// heartbeat/disconnect events.
func (s *Service) RecordHeartbeat(ctx context.Context, req HeartbeatRequest) (map[string]any, error) {
	if s.db == nil {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable.")
	}
	if strings.TrimSpace(req.AttemptID) == "" || strings.TrimSpace(req.ScheduleID) == "" {
		return nil, validationError("Attempt and schedule are required.")
	}
	switch req.EventType {
	case "heartbeat", "disconnect", "reconnect", "lost":
	default:
		return nil, validationError("Unsupported heartbeat event type.")
	}
	if strings.TrimSpace(req.MutationID) == "" {
		req.MutationID = uuid.NewString()
	}
	if req.ClientTimestamp.IsZero() {
		req.ClientTimestamp = time.Now().UTC()
	}

	// B1: point-write tx on one attempt row (RC-safe; no snapshot dependency).
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	attempt, err := loadTelemetryAttempt(ctx, tx, req.AttemptID, req.ScheduleID)
	if err != nil {
		return nil, err
	}
	if err := authorizeTelemetryAttempt(ctx, tx, &attempt, req.StudentKey, req.ActorUserID); err != nil {
		return nil, err
	}
	clientSessionID, err := ensureTelemetryClientSession(ctx, tx, attempt, req.ClientSessionID)
	if err != nil {
		return nil, err
	}

	var existingID string
	lookupErr := tx.QueryRowContext(ctx, "SELECT id FROM student_heartbeat_events WHERE attempt_id = ? AND mutation_id = ? FOR UPDATE", req.AttemptID, req.MutationID).Scan(&existingID)
	if lookupErr == nil {
		if err := tx.Commit(); err != nil {
			return nil, err
		}
		return s.GetAttemptProjection(ctx, req.AttemptID)
	}
	if lookupErr != sql.ErrNoRows {
		return nil, lookupErr
	}

	payload := nullableTelemetryJSON(req.Payload)
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO student_heartbeat_events
		(id, attempt_id, schedule_id, mutation_id, event_type, payload, client_timestamp, server_received_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, uuid.NewString(), req.AttemptID, req.ScheduleID, req.MutationID, req.EventType, payload, req.ClientTimestamp.UTC()); err != nil {
		return nil, err
	}
	integrity := telemetryObject(attempt.Integrity)
	now := time.Now().UTC().Format(time.RFC3339Nano)
	integrity["lastHeartbeatAt"] = now
	integrity["lastHeartbeatStatus"] = req.EventType
	if req.EventType == "disconnect" || req.EventType == "lost" {
		integrity["lastDisconnectAt"] = now
	}
	if req.EventType == "reconnect" {
		integrity["lastReconnectAt"] = now
	}
	recovery := telemetryObject(attempt.Recovery)
	recovery["clientSessionId"] = clientSessionID
	recovery["lastPersistedAt"] = now
	if _, err := tx.ExecContext(ctx, `
		UPDATE student_attempts
		SET integrity = ?, recovery = ?, active_client_session_id = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(6)
		WHERE id = ? AND schedule_id = ?`, encodeTelemetryObject(integrity), encodeTelemetryObject(recovery), clientSessionID, req.AttemptID, req.ScheduleID); err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return s.GetAttemptProjection(ctx, req.AttemptID)
}

func (s *Service) RecordAudit(ctx context.Context, req AuditRequest) error {
	if s.db == nil {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable.")
	}
	if strings.TrimSpace(req.AttemptID) == "" || strings.TrimSpace(req.ScheduleID) == "" {
		return validationError("Attempt and schedule are required.")
	}
	actionType := strings.TrimSpace(req.ActionType)
	if actionType == "" || len(actionType) > 255 {
		return validationError("actionType is required and must be at most 255 characters.")
	}

	// B1: point-write tx on one attempt row (RC-safe; no snapshot dependency).
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	attempt, err := loadTelemetryAttempt(ctx, tx, req.AttemptID, req.ScheduleID)
	if err != nil {
		return err
	}
	if err := authorizeTelemetryAttempt(ctx, tx, &attempt, "", req.ActorUserID); err != nil {
		return err
	}
	payload := telemetryObject(string(req.Payload))
	if req.ClientTimestamp != nil {
		payload["clientTimestamp"] = req.ClientTimestamp.UTC().Format(time.RFC3339Nano)
	}
	if actionType == "VIOLATION_DETECTED" {
		violationID, _ := payload["violationId"].(string)
		if strings.TrimSpace(violationID) == "" {
			return validationError("payload.violationId is required for VIOLATION_DETECTED.")
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at)
		VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`, uuid.NewString(), req.ScheduleID, attempt.CandidateName, actionType, req.AttemptID, encodeTelemetryObject(payload)); err != nil {
		return err
	}

	if actionType == "VIOLATION_DETECTED" {
		violationID := strings.TrimSpace(payload["violationId"].(string))
		violationType, _ := payload["violationType"].(string)
		severity, _ := payload["severity"].(string)
		if violationType != "" && (severity == "low" || severity == "medium" || severity == "high" || severity == "critical") {
			description, _ := payload["message"].(string)
			if description == "" {
				description, _ = payload["description"].(string)
			}
			if description == "" {
				description = "Violation detected."
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO student_violation_events
				(id, schedule_id, attempt_id, violation_id, violation_type, severity, description, payload, created_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))
				ON DUPLICATE KEY UPDATE id = id`, uuid.NewString(), req.ScheduleID, req.AttemptID, violationID, violationType, severity, description, encodeTelemetryObject(payload)); err != nil {
				return err
			}

			// VIOLATION_DETECTED is the authoritative student-side security write.
			// Keep the attempt projection in the same transaction as the audit/event
			// rows so clients that hydrate from /student/sessions observe the event
			// even when their non-response mutation mirror is still local.
			violations := telemetryViolationArray(attempt.Violations)
			alreadyProjected := false
			for _, violation := range violations {
				if id, _ := violation["id"].(string); id == violationID {
					alreadyProjected = true
					break
				}
			}
			if !alreadyProjected {
				timestamp := time.Now().UTC().Format(time.RFC3339Nano)
				if req.ClientTimestamp != nil {
					timestamp = req.ClientTimestamp.UTC().Format(time.RFC3339Nano)
				}
				violations = append(violations, map[string]any{
					"id":          violationID,
					"type":        violationType,
					"severity":    severity,
					"timestamp":   timestamp,
					"description": description,
				})
				encodedViolations, _ := json.Marshal(violations)
				if _, err := tx.ExecContext(ctx, `
					UPDATE student_attempts
					SET violations_snapshot = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(6)
					WHERE id = ? AND schedule_id = ?`, string(encodedViolations), req.AttemptID, req.ScheduleID); err != nil {
					return err
				}
			}
		}
	}
	return tx.Commit()
}

func loadTelemetryAttempt(ctx context.Context, q interface {
	QueryRowContext(context.Context, string, ...any) *sql.Row
}, attemptID, scheduleID string) (telemetryAttempt, error) {
	var attempt telemetryAttempt
	err := q.QueryRowContext(ctx, `
		SELECT id, schedule_id, student_key, user_id, candidate_name,
		       active_client_session_id, CAST(integrity AS CHAR), CAST(recovery AS CHAR),
		       CAST(violations_snapshot AS CHAR)
		FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE`, attemptID, scheduleID).Scan(
		&attempt.ID, &attempt.ScheduleID, &attempt.StudentKey, &attempt.UserID, &attempt.CandidateName,
		&attempt.ActiveClientSessionID, &attempt.Integrity, &attempt.Recovery, &attempt.Violations)
	if err == sql.ErrNoRows {
		return telemetryAttempt{}, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	return attempt, err
}

func authorizeTelemetryAttempt(ctx context.Context, q interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, attempt *telemetryAttempt, studentKey, actorUserID string) error {
	studentKey = strings.TrimSpace(studentKey)
	if studentKey != "" && studentKey != "sat" && studentKey != attempt.StudentKey {
		return apperrors.New(apperrors.CodeForbidden, "Attempt does not belong to this student.")
	}
	actorUserID = strings.TrimSpace(actorUserID)
	if actorUserID == "" {
		return nil
	}
	if attempt.UserID.Valid && attempt.UserID.String != actorUserID {
		return apperrors.New(apperrors.CodeForbidden, "Attempt does not belong to this student.")
	}
	if !attempt.UserID.Valid || attempt.UserID.String == "" {
		if _, err := q.ExecContext(ctx, "UPDATE student_attempts SET user_id = ? WHERE id = ? AND user_id IS NULL", actorUserID, attempt.ID); err != nil {
			return err
		}
		attempt.UserID = sql.NullString{String: actorUserID, Valid: true}
	}
	return nil
}

func ensureTelemetryClientSession(ctx context.Context, q interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, attempt telemetryAttempt, requested string) (string, error) {
	clientSessionID := strings.TrimSpace(requested)
	if clientSessionID == "" && attempt.ActiveClientSessionID.Valid {
		clientSessionID = strings.TrimSpace(attempt.ActiveClientSessionID.String)
	}
	if clientSessionID == "" {
		clientSessionID = uuid.NewString()
	}
	if attempt.ActiveClientSessionID.Valid && strings.TrimSpace(attempt.ActiveClientSessionID.String) != "" && attempt.ActiveClientSessionID.String != clientSessionID {
		return "", apperrors.New(apperrors.CodeActiveSessionSuperseded, "Attempt write credential has been superseded by a newer student session.")
	}
	if !attempt.ActiveClientSessionID.Valid || strings.TrimSpace(attempt.ActiveClientSessionID.String) == "" {
		if _, err := q.ExecContext(ctx, "UPDATE student_attempts SET active_client_session_id = ? WHERE id = ? AND active_client_session_id IS NULL", clientSessionID, attempt.ID); err != nil {
			return "", err
		}
	}
	return clientSessionID, nil
}

func isJSONObject(raw json.RawMessage) bool {
	var value map[string]any
	return len(raw) > 0 && json.Unmarshal(raw, &value) == nil && value != nil
}

func telemetryObject(raw string) map[string]any {
	var value map[string]any
	if json.Unmarshal([]byte(raw), &value) != nil || value == nil {
		return map[string]any{}
	}
	return value
}

func telemetryViolationArray(raw string) []map[string]any {
	var value []map[string]any
	if json.Unmarshal([]byte(raw), &value) != nil || value == nil {
		return []map[string]any{}
	}
	return value
}

func encodeTelemetryObject(value map[string]any) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

func nullableTelemetryJSON(raw json.RawMessage) any {
	if len(raw) == 0 || strings.TrimSpace(string(raw)) == "" || strings.TrimSpace(string(raw)) == "null" {
		return nil
	}
	return string(raw)
}

// Package student owns the V1 compatibility boundary for the Go backend.
//
// DeprecatedV1 reads and writes remain available while older clients drain.
// V1 writes are deliberately isolated from the V2 response protocol and use
// the legacy aggregate plus mutation ledger under the attempt row lock. Each
// DeprecatedV1 read bumps an injected counter hook so operators can track
// residual V1 traffic until retirement completes.
package student

import (
	"context"
	"database/sql"
	"encoding/json"
)

// CounterHook records one DeprecatedV1 read; production wires a telemetry
// counter, tests use an in-memory hook.
type CounterHook func(method string)

// Service reads draining-V1 student state explicitly.
type Service struct {
	db       *sql.DB
	onV1Read CounterHook
	// presence is the plan-D2 in-memory liveness map (nil = inline tx
	// path). Wired in BuildApp when PRESENCE_MODE=memory.
	presence *PresenceMap
	// rowFirst mirrors the plan-B3 posture (wired from ROW_FIRST_WRITES).
	// When on, answer/flag readers for protocol-2 attempts resolve through
	// the attempt_responses_v2 materializer; protocol-1 blobs stay
	// column-authoritative. Off keeps today's column reads everywhere.
	rowFirst bool
}

// SetRowFirst selects the B3 read-through posture. Chainable.
func (s *Service) SetRowFirst(on bool) *Service {
	s.rowFirst = on
	return s
}

// SetPresence wires the plan-D2 memory path (chainable). Nil keeps the
// inline per-beat tx.
func (s *Service) SetPresence(p *PresenceMap) *Service {
	s.presence = p
	return s
}

// PresenceMap exposes the wired map (nil when inline). The handler routes
// memory beats here; the worker flusher drains it.
func (s *Service) PresenceMap() *PresenceMap { return s.presence }

// NewService wires dependencies explicitly. A nil hook disables counting.
func NewService(db *sql.DB, hook CounterHook) *Service {
	return &Service{db: db, onV1Read: hook}
}

func (s *Service) count(method string) {
	if s.onV1Read != nil {
		s.onV1Read(method)
	}
}

// Session is the V1 session projection (attempt + schedule + exam title).
type Session struct {
	AttemptID  string          `json:"attemptId"`
	ScheduleID string          `json:"scheduleId"`
	Phase      string          `json:"phase"`
	Answers    json.RawMessage `json:"answers"`
}

// Static is the V1 static session context (published content snapshot).
type Static struct {
	AttemptID string          `json:"attemptId"`
	Content   json.RawMessage `json:"contentSnapshot"`
	Config    json.RawMessage `json:"configSnapshot"`
}

// Live is the V1 live session context (runtime status + attempt phase).
type Live struct {
	AttemptID     string  `json:"attemptId"`
	ScheduleID    string  `json:"scheduleId"`
	RuntimeStatus string  `json:"runtimeStatus"`
	Phase         string  `json:"phase"`
	Delivery      *string `json:"deliveryStatus,omitempty"`
}

// Precheck is the V1 precheck projection (integrity JSON).
type Precheck struct {
	AttemptID string          `json:"attemptId"`
	Integrity json.RawMessage `json:"integrity"`
}

// Bootstrap is the V1 bootstrap projection (flags + recovery JSON).
type Bootstrap struct {
	AttemptID string          `json:"attemptId"`
	Flags     json.RawMessage `json:"flags"`
	Recovery  json.RawMessage `json:"recovery"`
}

// HeartbeatRow is one V1 heartbeat event row.
type HeartbeatRow struct {
	ID         string          `json:"id"`
	AttemptID  string          `json:"attemptId"`
	ScheduleID string          `json:"scheduleId"`
	EventType  string          `json:"eventType"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}

// AuditRow is one V1 session audit log row.
type AuditRow struct {
	ID         string          `json:"id"`
	ScheduleID string          `json:"scheduleId"`
	ActionType string          `json:"actionType"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}

// GetSession returns the V1 attempt session projection.
//
// DeprecatedV1: migration-only read path; do not add V1 mutation logic.
func (s *Service) GetSession(ctx context.Context, attemptID string) (Session, error) {
	s.count("GetSession")
	var out Session
	if s.rowFirst {
		return s.getSessionRowFirst(ctx, attemptID)
	}
	var answers sql.NullString
	err := s.db.QueryRowContext(ctx, "SELECT id, schedule_id, phase, CAST(answers AS CHAR) FROM student_attempts WHERE id = ?", attemptID).Scan(&out.AttemptID, &out.ScheduleID, &out.Phase, &answers)
	if err != nil {
		return Session{}, err
	}
	if answers.Valid && answers.String != "" {
		out.Answers = json.RawMessage(answers.String)
	} else {
		out.Answers = json.RawMessage("{}")
	}
	return out, nil
}

// GetStatic returns the V1 static content snapshot for an attempt.
//
// DeprecatedV1: migration-only read path; do not add V1 mutation logic.
func (s *Service) GetStatic(ctx context.Context, attemptID string) (Static, error) {
	s.count("GetStatic")
	var out Static
	err := s.db.QueryRowContext(ctx, "SELECT a.id, CAST(v.content_snapshot AS CHAR), CAST(v.config_snapshot AS CHAR) FROM student_attempts a JOIN exam_versions v ON v.id = a.published_version_id WHERE a.id = ?", attemptID).Scan(&out.AttemptID, rawJSON(&out.Content), rawJSON(&out.Config))
	if err != nil {
		return Static{}, err
	}
	return out, nil
}

// GetLive returns the V1 live context (attempt phase + runtime status).
//
// DeprecatedV1: migration-only read path; do not add V1 mutation logic.
func (s *Service) GetLive(ctx context.Context, attemptID string) (Live, error) {
	s.count("GetLive")
	var out Live
	var runtime sql.NullString
	var delivery sql.NullString
	err := s.db.QueryRowContext(ctx, "SELECT a.id, a.schedule_id, a.phase, CAST(a.delivery_status AS CHAR), (SELECT status FROM exam_session_runtimes WHERE schedule_id = a.schedule_id) FROM student_attempts a WHERE a.id = ?", attemptID).Scan(&out.AttemptID, &out.ScheduleID, &out.Phase, &delivery, &runtime)
	if err != nil {
		return Live{}, err
	}
	if runtime.Valid {
		out.RuntimeStatus = runtime.String
	} else {
		out.RuntimeStatus = "not_started"
	}
	if delivery.Valid {
		v := delivery.String
		out.Delivery = &v
	}
	return out, nil
}

// Precheck returns the V1 integrity projection.
//
// DeprecatedV1: migration-only read path; do not add V1 mutation logic.
func (s *Service) Precheck(ctx context.Context, attemptID string) (Precheck, error) {
	s.count("Precheck")
	var out Precheck
	err := s.db.QueryRowContext(ctx, "SELECT id, CAST(integrity AS CHAR) FROM student_attempts WHERE id = ?", attemptID).Scan(&out.AttemptID, rawJSON(&out.Integrity))
	if err != nil {
		return Precheck{}, err
	}
	return out, nil
}

// Bootstrap returns the V1 flags/recovery projection.
//
// DeprecatedV1: migration-only read path; do not add V1 mutation logic.
func (s *Service) Bootstrap(ctx context.Context, attemptID string) (Bootstrap, error) {
	s.count("Bootstrap")
	if s.rowFirst {
		return s.getBootstrapRowFirst(ctx, attemptID)
	}
	var out Bootstrap
	err := s.db.QueryRowContext(ctx, "SELECT id, CAST(flags AS CHAR), CAST(recovery AS CHAR) FROM student_attempts WHERE id = ?", attemptID).Scan(&out.AttemptID, rawJSON(&out.Flags), rawJSON(&out.Recovery))
	if err != nil {
		return Bootstrap{}, err
	}
	return out, nil
}

// Heartbeat lists recent V1 heartbeat events for an attempt.
//
// DeprecatedV1: migration-only read path; do not add V1 mutation logic.
func (s *Service) Heartbeat(ctx context.Context, attemptID string, limit int) ([]HeartbeatRow, error) {
	s.count("Heartbeat")
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, "SELECT id, attempt_id, schedule_id, event_type, CAST(payload AS CHAR) FROM student_heartbeat_events WHERE attempt_id = ? ORDER BY server_received_at DESC LIMIT ?", attemptID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []HeartbeatRow
	for rows.Next() {
		var r HeartbeatRow
		var payload sql.NullString
		if err := rows.Scan(&r.ID, &r.AttemptID, &r.ScheduleID, &r.EventType, &payload); err != nil {
			return nil, err
		}
		if payload.Valid && payload.String != "" {
			r.Payload = json.RawMessage(payload.String)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// Audit lists recent V1 session audit rows for a schedule.
//
// DeprecatedV1: migration-only read path; do not add V1 mutation logic.
func (s *Service) Audit(ctx context.Context, scheduleID string, limit int) ([]AuditRow, error) {
	s.count("Audit")
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	rows, err := s.db.QueryContext(ctx, "SELECT id, schedule_id, action_type, CAST(payload AS CHAR) FROM session_audit_logs WHERE schedule_id = ? ORDER BY created_at DESC LIMIT ?", scheduleID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AuditRow
	for rows.Next() {
		var r AuditRow
		var payload sql.NullString
		if err := rows.Scan(&r.ID, &r.ScheduleID, &r.ActionType, &payload); err != nil {
			return nil, err
		}
		if payload.Valid && payload.String != "" {
			r.Payload = json.RawMessage(payload.String)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

type rawJSONRef struct {
	dst *json.RawMessage
}

func rawJSON(dst *json.RawMessage) sql.Scanner {
	return &rawJSONRef{dst: dst}
}

func (r *rawJSONRef) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		*r.dst = json.RawMessage("{}")
	case string:
		if v == "" {
			*r.dst = json.RawMessage("{}")
		} else {
			*r.dst = json.RawMessage(v)
		}
	case []byte:
		if len(v) == 0 {
			*r.dst = json.RawMessage("{}")
		} else {
			*r.dst = append(json.RawMessage(nil), v...)
		}
	default:
		*r.dst = json.RawMessage("{}")
	}
	return nil
}

// Package liveupdates owns the cross-instance live-update bus and the
// in-process fan-out hub for the Go backend.
//
// DB bus (mirrors backend/crates/infrastructure/src/live_update_bus.rs):
// live_update_events(sequence_id, origin_instance_id, event_kind,
// event_target_id, event_revision, event_name, event_payload). Writers append
// inside their business transaction via AppendInTx; each instance polls
// sequence_id > cursor AND origin <> own ORDER BY sequence_id LIMIT 200 every
// 250ms and feeds the hub. Kinds: schedule_runtime | schedule_roster |
// schedule_alert | attempt.
//
// Hub: an in-process broadcast with per-subscriber buffering; slow subscribers
// are dropped rather than stalling the bus. ShouldForward enforces the role
// filter (student: own schedule runtime + own attempt only; staff: allowed
// schedules; attempt events need an attempt subscription).
//
// Admission (mirrors websocket_lease.rs): lease table
// websocket_connection_leases + the singleton
// websocket_lease_admission_lock serialize admission across instances. Caps:
// total 600 / user 5 / schedule 600; outbound queue 128; slow-client 1500ms;
// write timeout 1500ms; lease TTL 60s with 30s heartbeat.
package liveupdates

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"strings"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// Bus tunables mirror the Rust worker/infra path.
const (
	PollLimit      = 200
	PollInterval   = 250 * time.Millisecond
	QueueCap       = 128
	SlowThreshold  = 1500 * time.Millisecond
	WriteTimeout   = 1500 * time.Millisecond
	LeaseTTL       = 60 * time.Second
	LeaseHeartbeat = 30 * time.Second
)

// Admission caps mirror AppConfig defaults.
const (
	CapTotal       = 600
	CapPerUser     = 5
	CapPerSchedule = 600
)

// Event kinds carried on the bus.
const (
	KindScheduleRuntime = "schedule_runtime"
	KindScheduleRoster  = "schedule_roster"
	KindScheduleAlert   = "schedule_alert"
	KindAttempt         = "attempt"
)

// Roles understood by the role filter.
const (
	RoleStudent = "student"
	RoleProctor = "proctor"
	RoleAdmin   = "admin"
)

// Event is the wire shape: (seq, origin, kind, id, revision, event).
type Event struct {
	SequenceID int64           `json:"sequenceId"`
	Origin     string          `json:"origin,omitempty"`
	Kind       string          `json:"kind"`
	ID         string          `json:"id"`
	Revision   int64           `json:"revision"`
	Name       string          `json:"event"`
	Payload    json.RawMessage `json:"payload,omitempty"`
}

// Bus owns bus SQL. Poll state (cursor) is held by the caller, never global.
type Bus struct {
	db     *sql.DB
	origin string
}

// NewBus wires the pool and this instance's origin id explicitly.
func NewBus(db *sql.DB, origin string) *Bus { return &Bus{db: db, origin: origin} }

// Origin returns this instance's origin id.
func (b *Bus) Origin() string { return b.origin }

// Append persists an event outside a caller-owned transaction. It is used by
// the worker when relaying a durable outbox wake-up to the cross-instance bus;
// business writers should use AppendInTx so state and notification commit
// atomically.
func (b *Bus) Append(ctx context.Context, kind, targetID string, revision int64, name string, payload any) error {
	if b == nil || b.db == nil {
		return apperrors.New(apperrors.CodeInternal, "Live-update bus is not configured.")
	}
	return AppendInTx(ctx, b.db, b.origin, kind, targetID, revision, name, payload)
}

// AppendInTx inserts a bus row inside the caller's business transaction so
// state changes and wakeups commit atomically.
func AppendInTx(ctx context.Context, q interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, origin, kind, targetID string, revision int64, name string, payload any) error {
	var raw any
	if payload != nil {
		b, err := json.Marshal(payload)
		if err != nil {
			return err
		}
		raw = string(b)
	}
	_, err := q.ExecContext(ctx, `
		INSERT INTO live_update_events
			(origin_instance_id, event_kind, event_target_id, event_revision, event_name, event_payload, created_at)
		VALUES (?, ?, ?, ?, ?, ?, NOW())`,
		origin, kind, targetID, revision, name, raw)
	return err
}

// PollNew returns rows with sequence_id > cursor AND origin <> own,
// ordered, bounded to PollLimit (callers may pass a smaller limit).
func (b *Bus) PollNew(ctx context.Context, cursor int64, limit int) ([]Event, error) {
	if limit < 1 {
		limit = PollLimit
	}
	if limit > PollLimit {
		limit = PollLimit
	}
	if cursor < 0 {
		cursor = 0
	}
	rows, err := b.db.QueryContext(ctx, `
		SELECT sequence_id, origin_instance_id, event_kind, event_target_id,
			event_revision, event_name, event_payload
		FROM live_update_events
		WHERE sequence_id > ? AND origin_instance_id <> ?
		ORDER BY sequence_id ASC
		LIMIT ?`, cursor, b.origin, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		var payload sql.NullString
		if err := rows.Scan(&e.SequenceID, &e.Origin, &e.Kind, &e.ID, &e.Revision, &e.Name, &payload); err != nil {
			return nil, err
		}
		if payload.Valid && strings.TrimSpace(payload.String) != "" && payload.String != "null" {
			e.Payload = json.RawMessage(payload.String)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// LatestSequence returns MAX(sequence_id), 0 when the bus is empty.
func (b *Bus) LatestSequence(ctx context.Context) (int64, error) {
	var v sql.NullInt64
	if err := b.db.QueryRowContext(ctx, "SELECT MAX(sequence_id) FROM live_update_events").Scan(&v); err != nil {
		return 0, err
	}
	if !v.Valid {
		return 0, nil
	}
	return v.Int64, nil
}

// PurgeOlderThan deletes bus rows older than retentionHours, bounded.
func (b *Bus) PurgeOlderThan(ctx context.Context, retentionHours, limit int64) (int64, error) {
	if retentionHours < 1 {
		retentionHours = 72
	}
	if limit < 1 {
		limit = 1000
	}
	res, err := b.db.ExecContext(ctx, `
		DELETE FROM live_update_events
		WHERE created_at < DATE_SUB(NOW(), INTERVAL ? HOUR)
		ORDER BY sequence_id ASC
		LIMIT ?`, retentionHours, limit)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// Subscription is one hub subscriber's view.
type Subscription struct {
	ch         chan Event
	scheduleID *string
	attemptID  *string
	role       string
	allowed    map[string]struct{}
	dropped    int64
}

// Channel exposes the event stream.
func (s *Subscription) Channel() <-chan Event { return s.ch }

// Hub fans bus events out to in-process subscribers. It never blocks the
// publisher: a full subscriber buffer drops the event and counts it.
type Hub struct {
	mu   sync.RWMutex
	subs map[*Subscription]struct{}
}

// NewHub builds an empty hub; callers own its lifetime explicitly.
func NewHub() *Hub { return &Hub{subs: map[*Subscription]struct{}{}} }

// Subscribe registers a subscriber with its role filter inputs.
func (h *Hub) Subscribe(role string, scheduleID, attemptID *string, allowedScheduleIDs []string) *Subscription {
	sub := &Subscription{
		ch:         make(chan Event, QueueCap),
		scheduleID: scheduleID, attemptID: attemptID,
		role: strings.ToLower(strings.TrimSpace(role)),
	}
	if allowedScheduleIDs != nil {
		sub.allowed = map[string]struct{}{}
		for _, id := range allowedScheduleIDs {
			sub.allowed[id] = struct{}{}
		}
	}
	h.mu.Lock()
	h.subs[sub] = struct{}{}
	n := len(h.subs)
	h.mu.Unlock()
	telemetry.SetGauge(telemetry.MWSConnections, float64(n))
	return sub
}

// Unsubscribe removes a subscriber and closes its channel.
func (h *Hub) Unsubscribe(sub *Subscription) {
	h.mu.Lock()
	if _, ok := h.subs[sub]; ok {
		delete(h.subs, sub)
		close(sub.ch)
	}
	n := len(h.subs)
	h.mu.Unlock()
	telemetry.SetGauge(telemetry.MWSConnections, float64(n))
}

// Publish fans one event out; slow subscribers drop it.
func (h *Hub) Publish(e Event) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for sub := range h.subs {
		if !ShouldForward(e, sub.role, optStr(sub.scheduleID), optStr(sub.attemptID), sub.allowed) {
			continue
		}
		select {
		case sub.ch <- e:
		default:
			sub.dropped++
			telemetry.IncCounter(telemetry.MWSSlowDisconnect)
		}
	}
}

// ShouldForward enforces the role filter. A nil allowed map means a platform
// reader (admin/admin_observer) with global schedule scope; a non-nil empty
// map means the actor has no allowed schedules and receives nothing. Students receive only their
// subscribed schedule's runtime frames and their own attempt events; staff
// receive runtime/roster/alert frames for allowed schedules (an attempt
// subscription alone never gets schedule broadcasts), and attempt events
// only with an exact attempt subscription.
func ShouldForward(e Event, role, scheduleID, attemptID string, allowed map[string]struct{}) bool {
	if role == RoleStudent {
		switch e.Kind {
		case KindScheduleRuntime:
			if scheduleID == "" || scheduleID != e.ID {
				return false
			}
			return allowedContains(allowed, e.ID)
		case KindAttempt:
			return attemptID != "" && attemptID == e.ID
		default:
			return false
		}
	}
	switch e.Kind {
	case KindScheduleRuntime, KindScheduleRoster, KindScheduleAlert:
		if !allowedContains(allowed, e.ID) {
			return false
		}
		if scheduleID != "" && scheduleID != e.ID {
			return false
		}
		// A lone attempt subscription without a schedule subscription
		// receives no schedule broadcasts.
		return attemptID == "" || scheduleID != ""
	case KindAttempt:
		return attemptID != "" && attemptID == e.ID
	default:
		return false
	}
}

// LeaseRepository serializes websocket admission using the singleton lock
// row, then enforces total/user/schedule caps in one transaction.
type LeaseRepository struct {
	db *sql.DB
}

// NewLeaseRepository wires the pool explicitly.
func NewLeaseRepository(db *sql.DB) *LeaseRepository { return &LeaseRepository{db: db} }

// Acquire attempts admission; ok=false means a cap rejected the connection.
// Expired leases are pruned first; the new lease lives LeaseTTL.
func (r *LeaseRepository) Acquire(ctx context.Context, instanceID, userID string, scheduleID *string, totalCap, userCap, scheduleCap int64) (token string, ok bool, err error) {
	if totalCap < 1 {
		totalCap = CapTotal
	}
	if userCap < 1 {
		userCap = CapPerUser
	}
	if scheduleCap < 1 {
		scheduleCap = CapPerSchedule
	}
	tx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", false, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = tx.Rollback()
		}
	}()
	// Singleton admission lock: COUNT(*) alone locks nothing, so serialize here.
	if err := tx.QueryRowContext(ctx,
		"SELECT id FROM websocket_lease_admission_lock WHERE id = 1 FOR UPDATE").Scan(new(int)); err != nil {
		return "", false, err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM websocket_connection_leases WHERE expires_at <= NOW()"); err != nil {
		return "", false, err
	}
	var active int64
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM websocket_connection_leases WHERE expires_at > NOW()").Scan(&active); err != nil {
		return "", false, err
	}
	if active >= totalCap {
		_ = tx.Rollback()
		committed = true
		telemetry.IncCounter(telemetry.MWSLeaseFailures, "reason", "total_cap")
		return "", false, nil
	}
	var userCount int64
	if err := tx.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM websocket_connection_leases WHERE user_id = ? AND expires_at > NOW()", userID).Scan(&userCount); err != nil {
		return "", false, err
	}
	if userCount >= userCap {
		_ = tx.Rollback()
		committed = true
		telemetry.IncCounter(telemetry.MWSLeaseFailures, "reason", "user_cap")
		return "", false, nil
	}
	if scheduleID != nil && strings.TrimSpace(*scheduleID) != "" {
		var sc int64
		if err := tx.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM websocket_connection_leases WHERE schedule_id = ? AND expires_at > NOW()", *scheduleID).Scan(&sc); err != nil {
			return "", false, err
		}
		if sc >= scheduleCap {
			_ = tx.Rollback()
			committed = true
			telemetry.IncCounter(telemetry.MWSLeaseFailures, "reason", "schedule_cap")
			return "", false, nil
		}
	}
	token = newToken()
	var schedVal any
	if scheduleID != nil {
		schedVal = *scheduleID
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO websocket_connection_leases
			(lease_token, instance_id, user_id, schedule_id, heartbeat_at, expires_at)
		VALUES (?, ?, ?, ?, NOW(), DATE_ADD(NOW(), INTERVAL 60 SECOND))`,
		token, instanceID, userID, schedVal); err != nil {
		return "", false, err
	}
	if err := tx.Commit(); err != nil {
		return "", false, err
	}
	committed = true
	return token, true, nil
}

// Heartbeat extends a live lease by LeaseTTL. The lease identity bound at
// Acquire (instance + user) must match, and expired leases never revive:
// zero rows is NOT_FOUND. Call every LeaseHeartbeat.
func (r *LeaseRepository) Heartbeat(ctx context.Context, token, instanceID, userID string) error {
	res, err := r.db.ExecContext(ctx, `
		UPDATE websocket_connection_leases
		SET heartbeat_at = NOW(), expires_at = DATE_ADD(NOW(), INTERVAL 60 SECOND)
		WHERE lease_token = ? AND instance_id = ? AND user_id = ? AND expires_at > NOW()`, token, instanceID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return apperrors.New(apperrors.CodeNotFound, "Lease not found.")
	}
	return nil
}

// Release drops a live lease on clean disconnect. The lease identity bound
// at Acquire (instance + user) must match: zero rows is NOT_FOUND.
func (r *LeaseRepository) Release(ctx context.Context, token, instanceID, userID string) error {
	res, err := r.db.ExecContext(ctx,
		"DELETE FROM websocket_connection_leases WHERE lease_token = ? AND instance_id = ? AND user_id = ?", token, instanceID, userID)
	if err != nil {
		return err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return apperrors.New(apperrors.CodeNotFound, "Lease not found.")
	}
	return nil
}

func allowedContains(allowed map[string]struct{}, id string) bool {
	if allowed == nil {
		return true
	}
	_, ok := allowed[id]
	return ok
}

func optStr(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func newToken() string {
	// 128-bit crypto-random lease token (PK): unguessable across instances.
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("liveupdates: crypto/rand unavailable: " + err.Error())
	}
	return base64.RawURLEncoding.EncodeToString(b[:])
}

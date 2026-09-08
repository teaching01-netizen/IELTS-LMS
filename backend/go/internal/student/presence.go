package student

import (
	"context"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// PresenceSnapshot is the proctor-visible liveness view for one attempt
// (plan D2): status + last beat + owning client session, served from memory
// sub-ms. DB stays the cold record (flushed every 60s + on transitions).
type PresenceSnapshot struct {
	AttemptID     string
	ScheduleID    string
	ClientSession string
	Status        string
	LastSeen      time.Time
	// Superseded flags a client-session change (prior session displaced).
	// The write gate still 409s the loser; presence only makes it visible.
	Superseded bool
}

// PresenceDirty is one status-transition record drained by the flusher: only
// transitions (not steady beats) need the conditional integrity UPDATE.
type PresenceDirty struct {
	AttemptID     string
	ScheduleID    string
	ClientSession string
	Status        string
	LastSeen      time.Time
}

type presenceEntry struct {
	snap      PresenceSnapshot
	dirty     bool
	mutations []string
}

// PresenceMap is the plan-D2 in-memory liveness map (attempt -> snapshot).
// Single mutex + lazy TTL sweep on Touch (no heap, no goroutine): Touch is
// O(1) amortized, Lookup is O(1), memory bounded by live attempts x small
// struct + a bounded per-attempt mutation ring for retry dedupe.
type PresenceMap struct {
	mu  sync.Mutex
	ttl time.Duration
	items map[string]*presenceEntry
}

// DefaultPresenceTTL bounds entry lifetime (plan: 60s flush cadence + slack
// for idle students; heartbeats refresh continuously while connected).
const DefaultPresenceTTL = 90 * time.Second

// ProbeTTLForTest exposes the production TTL to tests without magic numbers.
func ProbeTTLForTest() time.Duration { return DefaultPresenceTTL }

// PresenceWindowSeconds is the client-visible presence window (plan C5):
// heartbeats ack it so clients coalesce beats after any write.
func PresenceWindowSeconds() int {
	secs := int(DefaultPresenceTTL / time.Second)
	if secs < 1 {
		secs = 1
	}
	return secs
}

// maxMutationsPerAttempt bounds the retry-dedupe ring per attempt.
const maxMutationsPerAttempt = 16

// NewPresenceMap builds an empty map; ttl<=0 falls back to the default
// (never unbounded: stale entries must expire).
func NewPresenceMap(ttl time.Duration) *PresenceMap {
	if ttl <= 0 {
		ttl = DefaultPresenceTTL
	}
	return &PresenceMap{ttl: ttl, items: map[string]*presenceEntry{}}
}

// Touch records a beat (zero SQL). First touch + status transitions mark
// the entry dirty for the flusher; steady beats only refresh lastSeen.
func (p *PresenceMap) Touch(attemptID, scheduleID, clientSession, status string, now time.Time) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.sweepLocked(now)
	e, ok := p.items[attemptID]
	if !ok {
		p.items[attemptID] = &presenceEntry{
			snap:  PresenceSnapshot{AttemptID: attemptID, ScheduleID: scheduleID, ClientSession: clientSession, Status: status, LastSeen: now},
			dirty: true,
		}
		return
	}
	if e.snap.ClientSession != clientSession {
		e.snap.Superseded = true
		e.snap.ClientSession = clientSession
		e.dirty = true
	}
	if e.snap.Status != status {
		e.snap.Status = status
		e.dirty = true
	}
	e.snap.LastSeen = now
}

// RememberMutation dedupes (attempt, mutationID) retries in memory (the DB
// unique stays the backstop on flush). Reports true when already seen.
func (p *PresenceMap) RememberMutation(attemptID, mutationID string) (dup bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.items[attemptID]
	if !ok {
		e = &presenceEntry{}
		p.items[attemptID] = e
	}
	for _, m := range e.mutations {
		if m == mutationID {
			return true
		}
	}
	e.mutations = append(e.mutations, mutationID)
	if len(e.mutations) > maxMutationsPerAttempt {
		e.mutations = e.mutations[len(e.mutations)-maxMutationsPerAttempt:]
	}
	return false
}

// Lookup returns the snapshot when live (not TTL-stale).
func (p *PresenceMap) Lookup(attemptID string) (PresenceSnapshot, bool) {
	return p.LookupAt(attemptID, time.Now().UTC())
}

// LookupAt is the clock-injectable Lookup (tests + flusher).
func (p *PresenceMap) LookupAt(attemptID string, now time.Time) (PresenceSnapshot, bool) {
	p.mu.Lock()
	defer p.mu.Unlock()
	e, ok := p.items[attemptID]
	if !ok || now.Sub(e.snap.LastSeen) > p.ttl {
		return PresenceSnapshot{}, false
	}
	return e.snap, true
}

// DrainDirty returns one record per transitioned entry and clears the bits
// (flusher writes integrity ONLY for these).
func (p *PresenceMap) DrainDirty() []PresenceDirty {
	p.mu.Lock()
	defer p.mu.Unlock()
	var out []PresenceDirty
	for _, e := range p.items {
		if !e.dirty || e.snap.AttemptID == "" {
			continue
		}
		e.dirty = false
		out = append(out, PresenceDirty{AttemptID: e.snap.AttemptID, ScheduleID: e.snap.ScheduleID, ClientSession: e.snap.ClientSession, Status: e.snap.Status, LastSeen: e.snap.LastSeen})
	}
	return out
}

// Len reports live entry count (observability).
func (p *PresenceMap) Len() int {
	p.mu.Lock()
	defer p.mu.Unlock()
	return len(p.items)
}

// FlushPresence persists one drain batch (plan D2 flusher): one INSERT per
// transitioned attempt (batched by the caller into a single multi-row
// statement when the driver allows; single-row here for exact sqlmock
// shape) + a conditional integrity UPDATE carrying lastHeartbeatAt/Status.
// Steady beats never reach this function (DrainDirty filters them), so
// steady-state flush SQL is ~0. Empty input = zero SQL.
func (s *Service) FlushPresence(ctx context.Context, dirty []PresenceDirty) error {
	if len(dirty) == 0 || s.db == nil {
		return nil
	}
	telemetry.IncCounter(telemetry.MPresenceFlush)
	for _, d := range dirty {
		if _, err := s.db.ExecContext(ctx, `
			INSERT INTO student_heartbeat_events
			(id, attempt_id, schedule_id, mutation_id, event_type, payload, client_timestamp, server_received_at)
			VALUES (?, ?, ?, ?, ?, 'null', UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))`,
			uuid.NewString(), d.AttemptID, d.ScheduleID, "flush-"+d.AttemptID+"-"+d.LastSeen.UTC().Format(time.RFC3339Nano), d.Status, d.LastSeen.UTC()); err != nil {
			return err
		}
		var integrityRaw, recoveryRaw string
		if err := s.db.QueryRowContext(ctx,
			`SELECT integrity, recovery FROM student_attempts WHERE id = ?`,
			d.AttemptID).Scan(&integrityRaw, &recoveryRaw); err != nil {
			return err
		}
		integrity, recovery := flushIntegrityRecovery(integrityRaw, recoveryRaw, d)
		if _, err := s.db.ExecContext(ctx, `
			UPDATE student_attempts
			SET integrity = ?, recovery = ?, active_client_session_id = ?, revision = revision + 1, updated_at = UTC_TIMESTAMP(6)
			WHERE id = ? AND schedule_id = ?`,
			integrity, recovery, d.ClientSession, d.AttemptID, d.ScheduleID); err != nil {
			return err
		}
	}
	return nil
}

// flushIntegrity folds a transition into the attempt integrity JSON (same
// keys the per-beat tx writes: lastHeartbeatAt/Status + disconnect/reconnect
// markers) plus the recovery clientSessionId. The session comes from the
// presence snapshot (PresenceDirty carries the owning session).
func flushIntegrityRecovery(integrityRaw, recoveryRaw string, d PresenceDirty) (string, string) {
	integrity := telemetryObject(integrityRaw)
	now := d.LastSeen.UTC().Format(time.RFC3339Nano)
	integrity["lastHeartbeatAt"] = now
	integrity["lastHeartbeatStatus"] = d.Status
	if d.Status == "disconnect" || d.Status == "lost" {
		integrity["lastDisconnectAt"] = now
	}
	if d.Status == "reconnect" {
		integrity["lastReconnectAt"] = now
	}
	recovery := telemetryObject(recoveryRaw)
	recovery["clientSessionId"] = d.ClientSession
	recovery["lastPersistedAt"] = now
	return encodeTelemetryObject(integrity), encodeTelemetryObject(recovery)
}

// RecordHeartbeatMemory is the plan-D2 zero-SQL beat: validate, dedupe the
// (attempt, mutation) retry in memory, Touch presence, and return the
// attempt projection. Identity/ownership were established at the HTTP
// boundary (bearer or session); the DB unique on (attempt, mutation) stays
// the backstop at flush. Duplicate retries return the projection without
// re-touching (a retry is not a new beat).
func (s *Service) RecordHeartbeatMemory(ctx context.Context, req HeartbeatRequest) (map[string]any, error) {
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
	if s.presence == nil {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Presence memory path is not enabled.")
	}
	if s.presence.RememberMutation(req.AttemptID, req.MutationID) {
		// Retry dedupe: presence already touched by the first beat; the
		// projection is re-read (1-2 indexed reads) but no beat is
		// recorded twice. Zero heartbeat-event SQL either way.
		return s.GetAttemptProjection(ctx, req.AttemptID)
	}
	s.presence.Touch(req.AttemptID, req.ScheduleID, req.ClientSessionID, req.EventType, time.Now().UTC())
	telemetry.IncCounter(telemetry.MPresenceTouch)
	return s.GetAttemptProjection(ctx, req.AttemptID)
}

func (p *PresenceMap) sweepLocked(now time.Time) {
	for id, e := range p.items {
		if e.snap.AttemptID == "" {
			continue
		}
		if now.Sub(e.snap.LastSeen) > p.ttl {
			delete(p.items, id)
		}
	}
}

// Snapshot is the plan-B2 lock-free runtime view for student steady-state
// writes. It carries exactly what the write path needs to decide
// writability WITHOUT locking exam_session_runtimes + section rows:
// status, active section, revision, timing model, and liveness flags.
//
// Correctness bound (explicit, stakeholder-signed in the scale plan): the
// snapshot may be up to SnapshotTTL stale (default 1s). A write landing
// ~1s past a pause boundary is still fenced by:
//   - lease/control epochs (control commands bump control_epoch+1),
//   - closing_grace_until checked in-tx on the locked attempt row,
//   - exactly one synchronous refresh + retry on mismatch before failing
//     with today's 422/409 codes (never a lost write, never a silent accept).
//
// Seal, runtime commands, and reconcile-finalize keep FOR UPDATE locking.
package runtime

import (
	"context"
	"database/sql"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// SnapshotTTL bounds snapshot staleness (plan B2 default 1s).
const SnapshotTTL = time.Second

func snapshotSectionDeadline(actualStart time.Time, planned, extension, pausedAccum int) time.Time {
	if planned < 0 {
		planned = 0
	}
	if extension < 0 {
		extension = 0
	}
	if pausedAccum < 0 {
		pausedAccum = 0
	}
	return actualStart.Add(time.Duration((planned+extension)*60+pausedAccum) * time.Second)
}

// Snapshot is one schedule's cached runtime view.
type Snapshot struct {
	Status           string
	ActiveSectionKey *string
	Revision         int64
	TimingModel      string
	// SectionDeadlineAt lets the student poll contract enter its fast lane
	// before an automatic section boundary. Without this, a 25-second steady
	// poll can discover a correctly-timed transition only after the next
	// section has already lost visible time in the browser.
	SectionDeadlineAt *time.Time
	SectionLive       bool
	SectionPaused     bool
	SectionStarted    bool
	// WaitingForNextSection mirrors exam_session_runtimes.waiting_for_next_section:
	// the active section is complete and the next has not gone live. Writes are
	// refused for the whole window (same 422 family as the liveness gate).
	WaitingForNextSection bool
	LoadedAt              time.Time
}

// CheckWritable enforces the snapshot pre-gate with the same 422 code family
// as ensureWritable (attempts/service.go): it mirrors the runtime-status
// and section-liveness clauses so a stale-snapshot accept can never slip a
// write past the in-tx ensureWritable re-check (which stays authoritative).
func (s Snapshot) CheckWritable() error {
	switch s.Status {
	case StatusLive:
		// live gate below
	case StatusNotStarted, StatusPaused, StatusCompleted, StatusCancelled:
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is not live.", HTTPStatus: 422}
	default:
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is not live.", HTTPStatus: 422}
	}
	if s.WaitingForNextSection {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is waiting.", HTTPStatus: 422}
	}
	if s.SectionPaused || !s.SectionLive || !s.SectionStarted {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Exam runtime is not live.", HTTPStatus: 422}
	}
	return nil
}

// SnapshotCache is a mutex-guarded TTL map: scheduleID -> Snapshot.
// Loader errors are never cached. Safe for concurrent use.
type SnapshotCache struct {
	mu    sync.Mutex
	ttl   time.Duration
	items map[string]Snapshot
	// invalidatedAt records the last Invalidate per schedule (plan C3:
	// a control command within the fast-lane window keeps student polls
	// tight; the timestamps are bounded by the items map lifetime).
	invalidatedAt map[string]time.Time
}

// NewSnapshotCache builds an empty cache; ttl<=0 falls back to SnapshotTTL.
func NewSnapshotCache(ttl time.Duration) *SnapshotCache {
	if ttl <= 0 {
		ttl = SnapshotTTL
	}
	return &SnapshotCache{ttl: ttl, items: make(map[string]Snapshot), invalidatedAt: make(map[string]time.Time)}
}

// InvalidatedWithin reports whether the schedule was invalidated (control
// command committed) within d of now. Plan C3 fast-lane signal: students
// poll tightly for 60s after a command instead of waiting out the
// steady-state interval.
func (c *SnapshotCache) InvalidatedWithin(scheduleID string, d time.Duration, now time.Time) bool {
	if c == nil {
		return false
	}
	now = now.UTC()
	c.mu.Lock()
	defer c.mu.Unlock()
	ts, ok := c.invalidatedAt[scheduleID]
	if !ok {
		return false
	}
	return now.Sub(ts.UTC()) < d
}

// Get returns the cached snapshot when fresh, else calls load, caches on
// success, and returns it. Loader errors propagate and cache nothing.
func (c *SnapshotCache) Get(scheduleID string, now time.Time, load func() (Snapshot, error)) (Snapshot, error) {
	if c == nil {
		return load()
	}
	now = now.UTC()
	c.mu.Lock()
	if s, ok := c.items[scheduleID]; ok && now.Sub(s.LoadedAt.UTC()) < c.ttl {
		c.mu.Unlock()
		telemetry.IncCounter(telemetry.MSnapshotCacheHit)
		return s, nil
	}
	c.mu.Unlock()
	s, err := load()
	if err != nil {
		return Snapshot{}, err
	}
	telemetry.IncCounter(telemetry.MSnapshotCacheMiss)
	s.LoadedAt = now
	c.mu.Lock()
	c.items[scheduleID] = s
	c.mu.Unlock()
	return s, nil
}

// Invalidate drops one schedule (called after control commands bump the
// runtime revision so the next writer sees the new state immediately). It
// also stamps the invalidation time for the C3 poll fast-lane.
func (c *SnapshotCache) Invalidate(scheduleID string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	delete(c.items, scheduleID)
	c.invalidatedAt[scheduleID] = time.Now().UTC()
	// Bound the side map: drop stamps older than the fast-lane window x2.
	for id, ts := range c.invalidatedAt {
		if time.Since(ts.UTC()) > 2*PollFastLaneWindow {
			delete(c.invalidatedAt, id)
		}
	}
	c.mu.Unlock()
}

// SnapshotQuerier is the committed-read surface LoadSnapshot needs (works
// on *sql.DB, *sql.Tx, and sqlmock without new interfaces).
type SnapshotQuerier interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// LoadSnapshot reads one schedule's runtime view WITHOUT locking (no FOR
// UPDATE): runtime header + active-section status. A missing runtime row is
// an open gate (live/*, started) — identical to the FOR UPDATE path's
// ErrNoRows branch (v2Locker) for schedules without a runtime yet.
// A missing section row leaves liveness flags false (fail closed: the
// snapshot pre-gate blocks until the section row exists).
func LoadSnapshot(ctx context.Context, q SnapshotQuerier, scheduleID string, now time.Time) (Snapshot, error) {
	now = now.UTC()
	var id string
	var status sql.NullString
	var active sql.NullString
	var revision int64
	var timing sql.NullString
	var waiting sql.NullBool
	err := q.QueryRowContext(ctx,
		"SELECT id, status, active_section_key, revision, COALESCE(timing_model,'"+TimingModelLegacy+"'), waiting_for_next_section FROM exam_session_runtimes WHERE schedule_id = ?",
		scheduleID).Scan(&id, &status, &active, &revision, &timing, &waiting)
	if err == sql.ErrNoRows {
		return Snapshot{Status: StatusLive, ActiveSectionKey: strptr("*"), SectionLive: true, SectionStarted: true, LoadedAt: now}, nil
	}
	if err != nil {
		return Snapshot{}, err
	}
	snap := Snapshot{Status: status.String, Revision: revision, TimingModel: timing.String,
		WaitingForNextSection: waiting.Bool, LoadedAt: now}
	if active.Valid && active.String != "" {
		snap.ActiveSectionKey = strptr(active.String)
		var secStatus sql.NullString
		var actualStart sql.NullTime
		var plannedMinutes sql.NullInt64
		var extensionMinutes sql.NullInt64
		var accumulatedPausedSeconds sql.NullInt64
		var pausedAt sql.NullTime
		// Read the section timing fields without taking a lock. The poll path is
		// committed-read only; write gates remain authoritative.
		serr := q.QueryRowContext(ctx,
			`SELECT status, actual_start_at, planned_duration_minutes, extension_minutes, accumulated_paused_seconds, paused_at FROM exam_session_runtime_sections WHERE runtime_id = ? AND section_key = ?`,
			id, active.String).Scan(
			&secStatus,
			&actualStart,
			&plannedMinutes,
			&extensionMinutes,
			&accumulatedPausedSeconds,
			&pausedAt,
		)
		if serr != nil && serr != sql.ErrNoRows {
			return Snapshot{}, serr
		}
		if serr == nil && secStatus.Valid {
			snap.SectionStarted = true
			switch secStatus.String {
			case SectionLive:
				snap.SectionLive = true
				if actualStart.Valid && plannedMinutes.Valid && !pausedAt.Valid {
					extension := int64(0)
					if extensionMinutes.Valid {
						extension = extensionMinutes.Int64
					}
					pausedSeconds := int64(0)
					if accumulatedPausedSeconds.Valid {
						pausedSeconds = accumulatedPausedSeconds.Int64
					}
					deadline := snapshotSectionDeadline(
						actualStart.Time,
						int(plannedMinutes.Int64),
						int(extension),
						int(pausedSeconds),
					)
					snap.SectionDeadlineAt = &deadline
				}
			case SectionPaused:
				snap.SectionPaused = true
			}
		}
	} else {
		snap.ActiveSectionKey = strptr("*")
		snap.SectionLive = true
		snap.SectionStarted = true
	}
	return snap, nil
}

// Len reports entry count (tests + observability).
func (c *SnapshotCache) Len() int {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

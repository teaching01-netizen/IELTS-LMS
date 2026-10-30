// Snapshot is the plan-B2 lock-free runtime view: status, active section,
// revision, timing model, and liveness flags, read WITHOUT locking
// exam_session_runtimes + section rows.
//
// Correctness bound (audit finding 3): this view may be up to SnapshotTTL stale
// (default 1s), so it can serve READS that tolerate that — student runtime polls
// (Service.PollView) — and nothing else. It must never authorize a write: the V2
// answer-write gate reads the current runtime + section state on the writing
// transaction itself (cmd/api/v2locker_snapshot.go and v2Locker). There is no
// cached pre-gate left to be trusted, and no "the in-tx re-check makes it safe"
// assumption: that assumption is what let a write land against a stale view.
//
// Seal, runtime commands, and reconcile-finalize keep FOR UPDATE locking.
package runtime

import (
	"context"
	"database/sql"
	"errors"
	"sync"
	"time"

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

// Snapshot is one schedule's runtime view: the fields below are what the V2
// write gate needs, and they are only trustworthy when the read happened on the
// writing transaction (LoadSnapshot is called that way by both gate modes). The
// cached copy (SnapshotCache) exists for student polls, which ignore the
// liveness flags — a cache entry must never be a gate input.
type Snapshot struct {
	Status           string
	ActiveSectionKey *string
	Revision         int64
	TimingModel      string
	CompletionReason string
	// SectionDeadlineAt lets the student poll contract enter its fast lane
	// before an automatic section boundary. Without this, a 25-second steady
	// poll can discover a correctly-timed transition only after the next
	// section has already lost visible time in the browser.
	SectionDeadlineAt *time.Time
	SectionStartAt    *time.Time
	SectionLive       bool
	SectionPaused     bool
	SectionStarted    bool
	// SectionLive/Paused/Started come from SectionLiveness and are consumed by
	// attempts.ensureWritable: only a live section is writable. SectionDeadlineAt
	// is a read-only fast-lane hint for student polling.
	// WaitingForNextSection mirrors exam_session_runtimes.waiting_for_next_section:
	// the active section is complete and the next has not gone live. Writes are
	// refused for the whole window (same 422 family as the liveness gate).
	WaitingForNextSection bool
	// SharedSchedule is the committed timetable of an IELTS shared room; the
	// write gate and student view resolve the section from it.
	SharedSchedule *IELTSSharedSchedule
	LoadedAt       time.Time
}

// SectionLiveness maps a stored section status to the write gate's liveness
// booleans. It is the single owner of that mapping: the FOR UPDATE gate
// (v2Locker) and the lock-free gate (LoadSnapshot) both call it, so the two
// modes cannot drift into rejecting different writes.
//
//	live      opened and writable
//	paused    opened, clock stopped: not writable
//	locked    planned but never opened: not writable ("has not started")
//	completed ran and is over: not writable (the between-sections window,
//	          where the runtime deliberately keeps pointing at this section)
func SectionLiveness(status string) (started, live, paused bool) {
	switch status {
	case SectionLive:
		return true, true, false
	case SectionPaused:
		return true, false, true
	case SectionLocked:
		return false, false, false
	default:
		// completed or an unrecognised status: it ran, it is no longer live.
		return true, false, false
	}
}

// snapshotCacheMaxEntries bounds retained schedules; expired entries are
// swept first, and a full cache still serves loads without storing them.
const snapshotCacheMaxEntries = 4096

// SnapshotCache is a mutex-guarded TTL map: scheduleID -> Snapshot.
// Loader errors are never cached. Safe for concurrent use. Concurrent misses
// for one schedule share one load, and a load that began before an
// Invalidate never repopulates the cache.
type SnapshotCache struct {
	mu       sync.Mutex
	ttl      time.Duration
	items    map[string]Snapshot
	inflight map[string]*snapshotCall
	// generation counts Invalidate calls; a load publishes only if it is
	// unchanged since the load began.
	// offcut: one generation for every schedule; key it per schedule if room
	// commands become frequent enough to suppress unrelated publishes.
	generation uint64
	lastSweep  time.Time
	// invalidatedAt records the last Invalidate per schedule (plan C3:
	// a control command within the fast-lane window keeps student polls
	// tight; the timestamps are bounded by the items map lifetime).
	invalidatedAt map[string]time.Time
}

type snapshotCall struct {
	done chan struct{}
	snap Snapshot
	err  error
}

// NewSnapshotCache builds an empty cache; ttl<=0 falls back to SnapshotTTL.
func NewSnapshotCache(ttl time.Duration) *SnapshotCache {
	if ttl <= 0 {
		ttl = SnapshotTTL
	}
	return &SnapshotCache{ttl: ttl, items: make(map[string]Snapshot), inflight: make(map[string]*snapshotCall), invalidatedAt: make(map[string]time.Time)}
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

// Get returns the cached snapshot when fresh, else joins or leads the one
// load for this schedule, caches on success, and returns it. A follower waits
// for the leader or its own ctx; when the leader failed only because its own
// request ended, a live follower retries once with its own loader. Loader
// errors propagate and cache nothing.
func (c *SnapshotCache) Get(ctx context.Context, scheduleID string, now time.Time, load func() (Snapshot, error)) (Snapshot, error) {
	if c == nil {
		return load()
	}
	now = now.UTC()
	for attempt := 0; ; attempt++ {
		c.mu.Lock()
		if s, ok := c.items[scheduleID]; ok && now.Sub(s.LoadedAt.UTC()) < c.ttl {
			c.mu.Unlock()
			telemetry.IncCounter(telemetry.MSnapshotCacheHit)
			return s, nil
		}
		call, following := c.inflight[scheduleID]
		if !following {
			call = &snapshotCall{done: make(chan struct{})}
			c.inflight[scheduleID] = call
			generation := c.generation
			c.mu.Unlock()
			c.lead(scheduleID, now, generation, call, load)
			return call.snap, call.err
		}
		c.mu.Unlock()
		select {
		case <-call.done:
		case <-ctx.Done():
			return Snapshot{}, ctx.Err()
		}
		if call.err != nil && (errors.Is(call.err, context.Canceled) || errors.Is(call.err, context.DeadlineExceeded)) && ctx.Err() == nil && attempt == 0 {
			continue
		}
		return call.snap, call.err
	}
}

func (c *SnapshotCache) lead(scheduleID string, now time.Time, generation uint64, call *snapshotCall, load func() (Snapshot, error)) {
	s, err := load()
	if err == nil {
		telemetry.IncCounter(telemetry.MSnapshotCacheMiss)
		s.LoadedAt = now
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.inflight, scheduleID)
	call.snap, call.err = s, err
	close(call.done)
	if err != nil || c.generation != generation {
		return
	}
	if now.Sub(c.lastSweep) >= c.ttl {
		c.lastSweep = now
		for id, cached := range c.items {
			if now.Sub(cached.LoadedAt.UTC()) >= c.ttl {
				delete(c.items, id)
			}
		}
	}
	if _, ok := c.items[scheduleID]; ok || len(c.items) < snapshotCacheMaxEntries {
		c.items[scheduleID] = s
	}
}

// Invalidate drops one schedule (called after control commands bump the
// runtime revision so the next writer sees the new state immediately). It
// also stamps the invalidation time for the C3 poll fast-lane.
func (c *SnapshotCache) Invalidate(scheduleID string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	c.generation++
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
	var completionReason sql.NullString
	err := q.QueryRowContext(ctx,
		"SELECT id, status, active_section_key, revision, COALESCE(timing_model,'"+TimingModelLegacy+"'), waiting_for_next_section, COALESCE(completion_reason, '') FROM exam_session_runtimes WHERE schedule_id = ?",
		scheduleID).Scan(&id, &status, &active, &revision, &timing, &waiting, &completionReason)
	if err == sql.ErrNoRows {
		return Snapshot{Status: StatusLive, ActiveSectionKey: strptr("*"), SectionLive: true, SectionStarted: true, LoadedAt: now}, nil
	}
	if err != nil {
		return Snapshot{}, err
	}
	snap := Snapshot{Status: status.String, Revision: revision, TimingModel: timing.String, CompletionReason: completionReason.String,
		WaitingForNextSection: waiting.Bool, LoadedAt: now}
	if IsIELTSSharedSchedule(snap.TimingModel) {
		var raw sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT ielts_shared_schedule FROM exam_session_runtimes WHERE id = ?", id).Scan(&raw); err != nil {
			return Snapshot{}, err
		}
		if raw.Valid {
			shared, err := ParseIELTSSharedSchedule([]byte(raw.String))
			if err != nil {
				return Snapshot{}, err
			}
			snap.SharedSchedule = &shared
		}
	}
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
			// SectionLiveness keeps SectionStarted false for a planned-but-
			// locked section, so the gate refuses a write on a section that has
			// not begun instead of reading the row's mere existence as a start.
			snap.SectionStarted, snap.SectionLive, snap.SectionPaused = SectionLiveness(secStatus.String)
			if actualStart.Valid {
				snap.SectionStartAt = &actualStart.Time
			}
			if snap.SectionLive && actualStart.Valid && plannedMinutes.Valid && !pausedAt.Valid {
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

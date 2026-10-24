package delivery

import (
	"context"
	"errors"
	"sync"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func nanoClock() int64 { return time.Now().UTC().UnixNano() }

// VersionCacheMaxVersions bounds cached published trees (plan D1 default
// 50; single-digit MB each worst case).
const VersionCacheMaxVersions = 50

type versionEntry struct {
	revision int64
	sections []DeliverySection
	// lastUsed orders LRU eviction (unix nanos; guarded by mu).
	lastUsed int64
}

type versionCall struct {
	done     chan struct{}
	sections []DeliverySection
	revision int64
	err      error
}

// flightKey separates loads by the revision they were asked for, so a caller
// probing a newer revision never waits on (or receives) an older load.
type flightKey struct {
	versionID string
	revision  int64
}

// anyRevision keys Get's unconditional loads.
const anyRevision int64 = -1

// VersionCache stores fully-assembled published content trees
// (post-deliveredAnswer, post-JSON-parse) keyed by versionID. Reads share
// the value read-only (callers must not mutate: Bootstrap only reads the
// tree to seed per-attempt rows). TTL is infinite until publish bumps the
// version: Invalidate(versionID) runs on the authoring publish path, and
// the revision check fails closed to miss (a stale entry is never served).
// A minimal singleflight (no x/sync in go.mod) collapses an exam-day start
// wave: N concurrent misses for one (version, revision) = 1 loader call.
//
// Publication is revision-safe: a load is stored only under the revision its
// loader observed with the content, only when that is the requested one, and
// only if no Invalidate ran while it was loading.
type VersionCache struct {
	mu       sync.Mutex
	max      int
	items    map[string]*versionEntry
	inflight map[flightKey]*versionCall
	// generation counts Invalidate calls; a load publishes only if it is
	// unchanged since the load began.
	// offcut: one generation for every version; key it per version if
	// invalidations become frequent enough to suppress unrelated publishes.
	generation uint64
	clock      func() int64
}

// NewVersionCache builds an empty cache; max<=0 falls back to
// VersionCacheMaxVersions (never unbounded).
func NewVersionCache(max int) *VersionCache {
	if max <= 0 {
		max = VersionCacheMaxVersions
	}
	return &VersionCache{
		max:      max,
		items:    make(map[string]*versionEntry),
		inflight: make(map[flightKey]*versionCall),
		clock:    nanoClock,
	}
}

// Loader loads + verifies one version: it returns the assembled tree with
// the revision observed together with that content, so the cache never labels
// a tree with a revision it was not read at. Loaders must be safe for single
// concurrent execution per version (singleflight).
type VersionLoader func() ([]DeliverySection, int64, error)

// Get returns the cached tree at whatever revision is stored, else runs
// loader once per concurrent herd and stores the result under the revision
// the loader observed. Loader errors cache nothing (the next Get retries).
func (c *VersionCache) Get(ctx context.Context, versionID string, loader VersionLoader) ([]DeliverySection, int64, error) {
	c.mu.Lock()
	if e, ok := c.items[versionID]; ok {
		e.lastUsed = c.clock()
		sections, rev := e.sections, e.revision
		c.mu.Unlock()
		return sections, rev, nil
	}
	c.mu.Unlock()
	call, err := c.flight(ctx, flightKey{versionID, anyRevision}, loader)
	if err != nil {
		return nil, 0, err
	}
	return call.sections, call.revision, nil
}

// GetChecked returns the cached tree only when the stored revision equals
// probedRev (the cheap exam_versions probe Bootstrap already ran); else it
// loads via loader under singleflight for (versionID, probedRev). A load
// whose observed revision differs (a publish raced the probe) is returned to
// its callers as the current content but never stored.
func (c *VersionCache) GetChecked(ctx context.Context, versionID string, probedRev int64, loader VersionLoader) ([]DeliverySection, error) {
	c.mu.Lock()
	if e, ok := c.items[versionID]; ok && e.revision == probedRev {
		e.lastUsed = c.clock()
		sections := e.sections
		c.mu.Unlock()
		telemetry.IncCounter(telemetry.MVersionCacheHit)
		return sections, nil
	}
	c.mu.Unlock()
	call, err := c.flight(ctx, flightKey{versionID, probedRev}, loader)
	if err != nil {
		return nil, err
	}
	return call.sections, nil
}

// flight joins or leads the load for key. A follower waits for the leader or
// its own ctx; when the leader failed only because its own request ended, a
// still-live follower retries once under its own loader and budget.
func (c *VersionCache) flight(ctx context.Context, key flightKey, loader VersionLoader) (*versionCall, error) {
	for attempt := 0; ; attempt++ {
		c.mu.Lock()
		call, following := c.inflight[key]
		if !following {
			call = &versionCall{done: make(chan struct{})}
			c.inflight[key] = call
			generation := c.generation
			c.mu.Unlock()
			if key.revision != anyRevision {
				telemetry.IncCounter(telemetry.MVersionCacheMiss)
			}
			c.lead(key, generation, call, loader)
			return call, call.err
		}
		c.mu.Unlock()
		select {
		case <-call.done:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
		if call.err != nil && isContextErr(call.err) && ctx.Err() == nil && attempt == 0 {
			continue
		}
		return call, call.err
	}
}

func (c *VersionCache) lead(key flightKey, generation uint64, call *versionCall, loader VersionLoader) {
	sections, rev, err := loader()
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.inflight, key)
	call.sections, call.revision, call.err = sections, rev, err
	close(call.done)
	if err == nil && c.generation == generation && (key.revision == anyRevision || rev == key.revision) {
		c.storeLocked(key.versionID, sections, rev)
	}
}

func isContextErr(err error) bool {
	return errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded)
}

// PeekRevision reports the cached revision without loading (zero work).
// ok=false means absent (caller loads). Bootstrap uses it to decide whether
// the cheap revision probe already matches before assembling loaders.
func (c *VersionCache) PeekRevision(versionID string) (rev int64, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, found := c.items[versionID]
	if !found {
		return 0, false
	}
	return e.revision, true
}

// Invalidate drops one version (authoring publish path). Missing keys are
// a no-op.
func (c *VersionCache) Invalidate(versionID string) {
	c.mu.Lock()
	c.generation++
	delete(c.items, versionID)
	c.mu.Unlock()
}

// Len reports entry count (tests + observability).
func (c *VersionCache) Len() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

func (c *VersionCache) storeLocked(versionID string, sections []DeliverySection, rev int64) {
	if _, ok := c.items[versionID]; !ok && len(c.items) >= c.max {
		oldest := ""
		var oldestUsed int64
		first := true
		for id, e := range c.items {
			if first || e.lastUsed < oldestUsed {
				oldest, oldestUsed, first = id, e.lastUsed, false
			}
		}
		if oldest != "" {
			delete(c.items, oldest)
		}
	}
	c.items[versionID] = &versionEntry{revision: rev, sections: sections, lastUsed: c.clock()}
}

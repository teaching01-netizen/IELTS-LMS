package delivery

import (
	"context"
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
	revision  int64
	err      error
}

// VersionCache stores fully-assembled published content trees
// (post-deliveredAnswer, post-JSON-parse) keyed by versionID. Reads share
// the value read-only (callers must not mutate: Bootstrap only reads the
// tree to seed per-attempt rows). TTL is infinite until publish bumps the
// version: Invalidate(versionID) runs on the authoring publish path, and
// the revision check fails closed to miss (a stale entry is never served).
// A minimal singleflight (no x/sync in go.mod) collapses an exam-day start
// wave: N concurrent misses for one version = 1 loader call.
type VersionCache struct {
	mu      sync.Mutex
	max     int
	items   map[string]*versionEntry
	inflight map[string]*versionCall
	clock   func() int64
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
		inflight: make(map[string]*versionCall),
		clock:    nanoClock,
	}
}

// Loader loads + verifies one version: it returns the assembled tree with
// the CURRENT row revision so Get can fail closed on mismatch. Loaders must
// be safe for single concurrent execution per version (singleflight).
type VersionLoader func() ([]DeliverySection, int64, error)

// Get returns the cached tree when present, else runs loader exactly once
// per concurrent herd, stores on success, and returns it. Loader errors
// cache nothing (the next Get retries).
func (c *VersionCache) Get(_ context.Context, versionID string, loader VersionLoader) ([]DeliverySection, int64, error) {
	c.mu.Lock()
	if e, ok := c.items[versionID]; ok {
		e.lastUsed = c.clock()
		sections, rev := e.sections, e.revision
		c.mu.Unlock()
		return sections, rev, nil
	}
	if call, ok := c.inflight[versionID]; ok {
		c.mu.Unlock()
		<-call.done
		return call.sections, call.revision, call.err
	}
	call := &versionCall{done: make(chan struct{})}
	c.inflight[versionID] = call
	c.mu.Unlock()

	sections, rev, err := loader()

	c.mu.Lock()
	delete(c.inflight, versionID)
	call.sections, call.revision, call.err = sections, rev, err
	close(call.done)
	if err == nil {
		c.storeLocked(versionID, sections, rev)
	}
	c.mu.Unlock()
	return sections, rev, err
}

// GetChecked returns the cached tree only when the stored revision equals
// probedRev (the cheap exam_versions probe Bootstrap already ran); else it
// loads via loader under singleflight, stores with probedRev, and returns
// it. A publish racing the load fails closed: after the singleflight wait
// the stored revision is re-checked, and a mismatch reloads directly (no
// stale tree is ever served; at most one redundant load per racing pair).
func (c *VersionCache) GetChecked(_ context.Context, versionID string, probedRev int64, loader VersionLoader) ([]DeliverySection, error) {
	c.mu.Lock()
	if e, ok := c.items[versionID]; ok && e.revision == probedRev {
		e.lastUsed = c.clock()
		sections := e.sections
		c.mu.Unlock()
		telemetry.IncCounter(telemetry.MVersionCacheHit)
		return sections, nil
	}
	if call, ok := c.inflight[versionID]; ok {
		c.mu.Unlock()
		<-call.done
		c.mu.Lock()
		if e, ok := c.items[versionID]; ok && e.revision == probedRev {
			e.lastUsed = c.clock()
			sections := e.sections
			c.mu.Unlock()
			telemetry.IncCounter(telemetry.MVersionCacheHit)
			return sections, nil
		}
		c.mu.Unlock()
		sections, _, err := loader()
		if err != nil {
			return nil, err
		}
		c.mu.Lock()
		c.storeLocked(versionID, sections, probedRev)
		c.mu.Unlock()
		return sections, nil
	}
	call := &versionCall{done: make(chan struct{})}
	c.inflight[versionID] = call
	c.mu.Unlock()

	telemetry.IncCounter(telemetry.MVersionCacheMiss)
	sections, _, err := loader()

	c.mu.Lock()
	delete(c.inflight, versionID)
	call.sections, call.revision, call.err = sections, probedRev, err
	close(call.done)
	if err == nil {
		c.storeLocked(versionID, sections, probedRev)
	}
	c.mu.Unlock()
	if err != nil {
		return nil, err
	}
	return sections, nil
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

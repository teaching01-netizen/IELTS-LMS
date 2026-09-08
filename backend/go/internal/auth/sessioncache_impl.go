// SessionCache is the in-process session LRU behind plan A2.
//
// Design notes (single-deploy only): with exactly one app process, a
// process-local cache IS global, so a cache hit can skip both the SELECT
// and the touch UPDATE with no coherence risk. Eviction only drops cache
// entries (never logs anyone out): the next lookup reloads from the DB.
// Negative decisions (unknown/revoked/expired) are never cached: every
// miss re-reads the DB, so revocation is visible on the next lookup.
package auth

import (
	"container/list"
	"sync"
	"time"
)

// SessionCacheConfig tunes the cache. Zero values are normalized by
// NewSessionCache: Enabled=false disables (never stores, never hits),
// MaxEntries<=0 falls back to 150000, TouchCoalesceSecs<=0 to 300.
type SessionCacheConfig struct {
	Enabled           bool
	MaxEntries        int
	TouchCoalesceSecs int
}

const (
	defaultSessionCacheMax          = 150000
	defaultSessionTouchCoalesceSecs = 300
)

type sessionCacheEntry struct {
	session Session
	// flushedAt marks the last DB touch write for this entry. Zero means
	// the entry was just loaded and still owes its first coalesced touch.
	flushedAt time.Time
}

// SessionCache is a mutex-guarded LRU keyed by session token hash with a
// bounded secondary index (userID -> token hashes) for logout-all.
// It is safe for concurrent use.
type SessionCache struct {
	mu       sync.Mutex
	enabled   bool
	max      int
	coalesce time.Duration
	ll       *list.List // front = most recently used; element.Value = cacheKey
	items    map[string]*list.Element
	byUser   map[string]map[string]struct{}
	hits       uint64
	misses   uint64
}

type cacheKey struct {
	tokenHash string
	entry     sessionCacheEntry
}

// NewSessionCache builds an empty cache from cfg.
func NewSessionCache(cfg SessionCacheConfig) *SessionCache {
	max := cfg.MaxEntries
	if max <= 0 {
		max = defaultSessionCacheMax
	}
	coalesceSecs := cfg.TouchCoalesceSecs
	if coalesceSecs <= 0 {
		coalesceSecs = defaultSessionTouchCoalesceSecs
	}
	return &SessionCache{
		enabled:   cfg.Enabled,
		max:       max,
		coalesce:  time.Duration(coalesceSecs) * time.Second,
		ll:        list.New(),
		items:     make(map[string]*list.Element),
		byUser:    make(map[string]map[string]struct{}),
	}
}

// Get returns the cached session when present and unexpired at now.
// Expiry is evaluated on every call against caller time: absolute
// (ExpiresAt) and idle (IdleTimeoutAt) deadlines both fail closed to miss.
// A hit moves the entry to the MRU position. Disabled cache always misses.
func (c *SessionCache) Get(tokenHash string, now time.Time) (Session, bool) {
	if c == nil {
		return Session{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.enabled {
		c.misses++
		return Session{}, false
	}
	now = now.UTC()
	el, ok := c.items[tokenHash]
	if !ok {
		c.misses++
		return Session{}, false
	}
	k := el.Value.(cacheKey)
	if !k.entry.session.ExpiresAt.After(now) || !k.entry.session.IdleTimeoutAt.After(now) {
		c.removeLocked(tokenHash, el)
		c.misses++
		return Session{}, false
	}
	c.ll.MoveToFront(el)
	c.hits++
	return k.entry.session, true
}

// Put stores (or refreshes) a session loaded from the DB. Storing refreshes
// MRU position, the user index, and resets the touch-coalesce origin to now
// (the load itself observed fresh idle state, so the first TouchDue inside
// the window is suppressed; the DB touch still happens on load when due —
// see LookupSessionWithCache). Disabled cache drops the write. Expired
// sessions are never stored.
func (c *SessionCache) Put(tokenHash string, s Session, now time.Time) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.enabled {
		return
	}
	now = now.UTC()
	if !s.ExpiresAt.After(now) || !s.IdleTimeoutAt.After(now) {
		return
	}
	if el, ok := c.items[tokenHash]; ok {
		c.ll.MoveToFront(el)
		old := el.Value.(cacheKey)
		c.unindexLocked(old.entry.session.UserID, tokenHash)
		el.Value = cacheKey{tokenHash: tokenHash, entry: sessionCacheEntry{session: s, flushedAt: now}}
		c.indexLocked(s.UserID, tokenHash)
		return
	}
	for len(c.items) >= c.max {
		back := c.ll.Back()
		if back == nil {
			break
		}
		bk := back.Value.(cacheKey)
		c.removeLocked(bk.tokenHash, back)
	}
	el := c.ll.PushFront(cacheKey{tokenHash: tokenHash, entry: sessionCacheEntry{session: s, flushedAt: now}})
	c.items[tokenHash] = el
	c.indexLocked(s.UserID, tokenHash)
}

// TouchDue reports whether a DB touch UPDATE is owed for tokenHash at now:
// true when the entry exists and now - flushedAt >= coalesce window.
// Unknown or disabled entries report not-due (caller falls back to the
// unconditional touch on the DB-loaded path).
func (c *SessionCache) TouchDue(tokenHash string, now time.Time) bool {
	if c == nil {
		return false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.enabled {
		return false
	}
	now = now.UTC()
	el, ok := c.items[tokenHash]
	if !ok {
		return false
	}
	k := el.Value.(cacheKey)
	if k.entry.flushedAt.IsZero() {
		return true
	}
	return !now.Before(k.entry.flushedAt.Add(c.coalesce))
}

// MarkFlushed records a completed DB touch for tokenHash at now.
func (c *SessionCache) MarkFlushed(tokenHash string, now time.Time) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.enabled {
		return
	}
	now = now.UTC()
	el, ok := c.items[tokenHash]
	if !ok {
		return
	}
	k := el.Value.(cacheKey)
	k.entry.flushedAt = now
	el.Value = k
}

// Invalidate drops one token immediately (single logout / revoke).
// Missing keys are a no-op.
func (c *SessionCache) Invalidate(tokenHash string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if el, ok := c.items[tokenHash]; ok {
		c.removeLocked(tokenHash, el)
	}
}

// InvalidateUser drops every cached session of a user (logout-all /
// password-reset revocation). Missing users are a no-op.
func (c *SessionCache) InvalidateUser(userID string) {
	if c == nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	set, ok := c.byUser[userID]
	if !ok {
		return
	}
	// Copy: removeLocked mutates byUser.
	hashes := make([]string, 0, len(set))
	for h := range set {
		hashes = append(hashes, h)
	}
	for _, h := range hashes {
		if el, ok := c.items[h]; ok {
			c.removeLocked(h, el)
		}
	}
}

// Len reports the entry count (tests + capacity observability).
func (c *SessionCache) Len() int {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.items)
}

// HitRate reports hits/(hits+misses), 0 when no lookups yet.
// peek reports presence without affecting recency, hits, or misses.
// LookupSessionWithCache uses it to distinguish first-ever load (touch
// fires, today's behavior) from coalesced reload (touch suppressed).
func (c *SessionCache) peek(tokenHash string) (Session, bool) {
	if c == nil {
		return Session{}, false
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	el, ok := c.items[tokenHash]
	if !ok {
		return Session{}, false
	}
	return el.Value.(cacheKey).entry.session, true
}

func (c *SessionCache) HitRate() float64 {
	if c == nil {
		return 0
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	total := c.hits + c.misses
	if total == 0 {
		return 0
	}
	return float64(c.hits) / float64(total)
}

func (c *SessionCache) indexLocked(userID, tokenHash string) {
	if userID == "" {
		return
	}
	set, ok := c.byUser[userID]
	if !ok {
		set = make(map[string]struct{})
		c.byUser[userID] = set
	}
	set[tokenHash] = struct{}{}
}

func (c *SessionCache) unindexLocked(userID, tokenHash string) {
	if userID == "" {
		return
	}
	if set, ok := c.byUser[userID]; ok {
		delete(set, tokenHash)
		if len(set) == 0 {
			delete(c.byUser, userID)
		}
	}
}

func (c *SessionCache) removeLocked(tokenHash string, el *list.Element) {
	k := el.Value.(cacheKey)
	c.unindexLocked(k.entry.session.UserID, tokenHash)
	delete(c.items, tokenHash)
	c.ll.Remove(el)
}

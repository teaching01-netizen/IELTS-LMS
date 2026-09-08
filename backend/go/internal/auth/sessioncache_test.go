package auth

import (
	"testing"
	"time"
)

func testSession(id, user string, now time.Time) Session {
	return Session{
		ID:            id,
		UserID:        user,
		Role:          RoleStudent,
		CSRFToken:     "csrf-" + id,
		ExpiresAt:     now.Add(time.Hour),
		IdleTimeoutAt: now.Add(30 * time.Minute),
	}
}

// A2 RED: disabled cache never stores and never hits.
func TestSessionCacheDisabledNeverHits(t *testing.T) {
	c := NewSessionCache(SessionCacheConfig{Enabled: false, MaxEntries: 100})
	now := time.Now().UTC()
	s := testSession("s1", "u1", now)
	c.Put("hash-1", s, now)
	if _, ok := c.Get("hash-1", now); ok {
		t.Fatalf("disabled cache must never hit")
	}
	if c.HitRate() != 0 {
		t.Fatalf("disabled cache hit rate must be 0")
	}
}

// A2 RED: basic put/get roundtrip within expiry.
func TestSessionCacheHitWithinExpiry(t *testing.T) {
	c := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100})
	now := time.Now().UTC()
	s := testSession("s1", "u1", now)
	c.Put("hash-1", s, now)
	got, ok := c.Get("hash-1", now.Add(time.Minute))
	if !ok {
		t.Fatalf("expected cache hit")
	}
	if got.ID != "s1" || got.UserID != "u1" {
		t.Fatalf("cached session mismatch: %+v", got)
	}
}

// A2 RED: expired entries (absolute or idle) never hit. Negative decisions
// must not linger: expiry is evaluated on every Get against caller time.
func TestSessionCacheExpiryNeverHits(t *testing.T) {
	c := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100})
	now := time.Now().UTC()
	s := testSession("s1", "u1", now)
	c.Put("hash-1", s, now)
	if _, ok := c.Get("hash-1", now.Add(2*time.Hour)); ok {
		t.Fatalf("absolute-expiry entry must miss")
	}
	c.Put("hash-1", s, now)
	if _, ok := c.Get("hash-1", now.Add(31*time.Minute)); ok {
		t.Fatalf("idle-expiry entry must miss")
	}
}

// A2 RED: revocation invalidates synchronously (stale-session acceptance 0).
func TestSessionCacheInvalidateOnRevoke(t *testing.T) {
	c := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100})
	now := time.Now().UTC()
	c.Put("hash-1", testSession("s1", "u1", now), now)
	c.Put("hash-2", testSession("s2", "u1", now), now)
	c.Put("hash-3", testSession("s3", "u2", now), now)
	c.Invalidate("hash-1")
	if _, ok := c.Get("hash-1", now); ok {
		t.Fatalf("revoked token must miss immediately")
	}
	if _, ok := c.Get("hash-2", now); !ok {
		t.Fatalf("other session of same user must survive single revoke")
	}
	c.InvalidateUser("u1")
	if _, ok := c.Get("hash-2", now); ok {
		t.Fatalf("logout-all must invalidate every session of the user")
	}
	if _, ok := c.Get("hash-3", now); !ok {
		t.Fatalf("other user's session must survive logout-all")
	}
}

// A2 RED: LRU eviction drops cache only (never logs anyone out): evicted
// keys miss and reload from DB on next lookup; survivors still hit.
func TestSessionCacheLRUEvictionIsCacheOnly(t *testing.T) {
	c := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 2})
	now := time.Now().UTC()
	c.Put("h1", testSession("s1", "u1", now), now)
	c.Put("h2", testSession("s2", "u2", now), now)
	// Touch h1 so h2 is LRU... then insert h3 to evict h2. (Either eviction
	// victim is acceptable; the invariant is size bound + survivors hit.)
	if _, ok := c.Get("h1", now); !ok {
		t.Fatalf("h1 must hit before eviction")
	}
	c.Put("h3", testSession("s3", "u3", now), now)
	if c.Len() != 2 {
		t.Fatalf("cache must stay bounded at 2, got %d", c.Len())
	}
	if _, ok := c.Get("h1", now); !ok {
		t.Fatalf("recently-touched h1 must survive eviction")
	}
}

// A2 RED: touch coalescing — TouchDue fires at most once per window.
func TestSessionCacheTouchCoalescing(t *testing.T) {
	c := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100, TouchCoalesceSecs: 300})
	now := time.Now().UTC()
	c.Put("hash-1", testSession("s1", "u1", now), now)
	if !c.TouchDue("hash-1", now.Add(time.Minute)) {
		// First touch after put may or may not be due depending on whether
		// Put marks flushed; the hard invariant is the second call inside
		// the window is NOT due after one due.
		t.Logf("first touch not due (put marks flushed); continuing")
	}
	// Force a due, then assert suppression inside the window.
	c.MarkFlushed("hash-1", now)
	if c.TouchDue("hash-1", now.Add(time.Minute)) {
		t.Fatalf("touch 1m after flush must be suppressed (300s window)")
	}
	if !c.TouchDue("hash-1", now.Add(301*time.Second)) {
		t.Fatalf("touch past the window must be due")
	}
}

// A2 RED: hit-rate accounting separates hits from DB misses.
func TestSessionCacheHitRate(t *testing.T) {
	c := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100})
	now := time.Now().UTC()
	c.Put("h1", testSession("s1", "u1", now), now)
	if _, ok := c.Get("h1", now); !ok {
		t.Fatalf("expected hit")
	}
	if _, ok := c.Get("missing", now); ok {
		t.Fatalf("expected miss")
	}
	if got := c.HitRate(); got != 0.5 {
		t.Fatalf("hit rate = %v, want 0.5", got)
	}
}

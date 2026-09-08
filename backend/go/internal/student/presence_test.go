package student

import (
	"testing"
	"time"
)

// D2 RED: Touch records presence with zero SQL (no db handle needed); Lookup
// is visible to proctors sub-second.
func TestPresenceTouchVisible(t *testing.T) {
	p := NewPresenceMap(ProbeTTLForTest())
	now := time.Now().UTC()
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now)
	got, ok := p.Lookup("att-1")
	if !ok {
		t.Fatalf("beat must be visible")
	}
	if got.Status != "heartbeat" || got.ClientSession != "sess-a" {
		t.Fatalf("wrong snapshot: %+v", got)
	}
	if got.LastSeen.IsZero() {
		t.Fatalf("lastSeen must be stamped")
	}
}

// D2 RED: mutation ring dedupes retries (same attempt+mutation -> dup=true).
func TestPresenceMutationDedupe(t *testing.T) {
	p := NewPresenceMap(ProbeTTLForTest())
	if dup := p.RememberMutation("att-1", "mut-1"); dup {
		t.Fatalf("first mutation must be new")
	}
	if dup := p.RememberMutation("att-1", "mut-1"); !dup {
		t.Fatalf("retry must dedupe")
	}
	if dup := p.RememberMutation("att-1", "mut-2"); dup {
		t.Fatalf("distinct mutation must be new")
	}
}

// D2 RED: status transitions flip the dirty bit (flusher writes integrity
// ONLY on transitions); steady beats stay clean.
func TestPresenceTransitionDirty(t *testing.T) {
	p := NewPresenceMap(ProbeTTLForTest())
	now := time.Now().UTC()
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now)
	if p.DrainDirty() == nil {
		t.Fatalf("first touch must mark dirty")
	}
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now.Add(time.Second))
	if got := p.DrainDirty(); len(got) != 0 {
		t.Fatalf("steady beats must not dirty the flush: %v", got)
	}
	p.Touch("att-1", "sched-1", "sess-a", "disconnect", now.Add(2*time.Second))
	dirty := p.DrainDirty()
	if len(dirty) != 1 || dirty[0].Status != "disconnect" {
		t.Fatalf("transition must dirty exactly once: %+v", dirty)
	}
}

// D2 RED: superseded client sessions still surface (409 ownership stays at
// the write gate; presence never hides a supersede).
func TestPresenceSupersedeVisible(t *testing.T) {
	p := NewPresenceMap(ProbeTTLForTest())
	now := time.Now().UTC()
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now)
	p.Touch("att-1", "sched-1", "sess-b", "heartbeat", now.Add(time.Second))
	got, ok := p.Lookup("att-1")
	if !ok || got.ClientSession != "sess-b" {
		t.Fatalf("latest session must win: %+v", got)
	}
	if !got.Superseded {
		t.Fatalf("session change must flag superseded (prior sess-a displaced)")
	}
}

// D2 RED: TTL expiry drops stale entries (bounded memory).
func TestPresenceExpiry(t *testing.T) {
	p := NewPresenceMap(90 * time.Second)
	now := time.Now().UTC()
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now)
	if _, ok := p.LookupAt("att-1", now.Add(91*time.Second)); ok {
		t.Fatalf("stale entry must expire")
	}
}

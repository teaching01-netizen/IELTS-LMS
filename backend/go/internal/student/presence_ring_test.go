package student

// Plan D2: the per-attempt mutation ring is bounded (16) so a hot attempt
// cannot grow memory unboundedly on exam day. Oldest evicts first; evicted
// IDs re-report as new (dup=false) — the DB unique stays the dedupe
// backstop, the ring is only the fast path. RED: bound + eviction shape.
import (
	"fmt"
	"testing"
	"time"
)

func TestPresenceMutationRingBound(t *testing.T) {
	p := NewPresenceMap(ProbeTTLForTest())
	for i := 0; i < maxMutationsPerAttempt; i++ {
		if dup := p.RememberMutation("att-1", fmt.Sprintf("mut-%d", i)); dup {
			t.Fatalf("fill %d must be new", i)
		}
	}
	// Ring full: newest evicts oldest (mut-0).
	if dup := p.RememberMutation("att-1", "mut-new"); dup {
		t.Fatalf("overflow insert must be new")
	}
	// mut-0 was evicted -> must re-report as NEW (dup=false).
	if dup := p.RememberMutation("att-1", "mut-0"); dup {
		t.Fatalf("evicted mut-0 must not dedupe")
	}
	// mut-new (just inserted) must dedupe.
	if dup := p.RememberMutation("att-1", "mut-new"); !dup {
		t.Fatalf("retained mut-new must dedupe")
	}
	// Unrelated attempts are isolated.
	if dup := p.RememberMutation("att-2", "mut-0"); dup {
		t.Fatalf("distinct attempt must not share the ring")
	}
}

func TestPresenceLookupFreshWithinTTL(t *testing.T) {
	p := NewPresenceMap(90 * time.Second)
	now := time.Now().UTC()
	p.Touch("att-1", "sched-1", "sess-a", "heartbeat", now)
	if _, ok := p.LookupAt("att-1", now.Add(89*time.Second)); !ok {
		t.Fatalf("entry inside TTL must stay visible")
	}
	if _, ok := p.LookupAt("att-1", now.Add(90*time.Second)); !ok {
		t.Fatalf("entry at exactly TTL must stay visible (strict >)")
	}
}

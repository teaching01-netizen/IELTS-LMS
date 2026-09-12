package runtime

import (
	"testing"
	"time"
)

// strptr is defined in service.go (test package shares it); snapshotAlias
// keeps this file's intent explicit without redeclaration.

// B2 RED: snapshot gate allows writes while runtime is live.
func TestSnapshotGateAllowsLiveWrite(t *testing.T) {
	snap := Snapshot{Status: StatusLive, ActiveSectionKey: strptr("rw"), SectionLive: true, SectionStarted: true, Revision: 3}
	if err := snap.CheckWritable(); err != nil {
		t.Fatalf("live snapshot must allow writes: %v", err)
	}
}

// B2 RED: snapshot gate blocks writes while paused/completed with today's
// 422/409-shaped errors (never a lost write, never a silent accept).
func TestSnapshotGateBlocksPaused(t *testing.T) {
	snap := Snapshot{Status: StatusPaused, ActiveSectionKey: strptr("rw"), Revision: 3}
	if err := snap.CheckWritable(); err == nil {
		t.Fatalf("paused snapshot must block writes")
	}
}

func TestSnapshotGateBlocksCompleted(t *testing.T) {
	snap := Snapshot{Status: StatusCompleted, Revision: 3}
	if err := snap.CheckWritable(); err == nil {
		t.Fatalf("completed snapshot must block writes")
	}
}

// B2 RED: cache serves within TTL with zero loader calls; expiry reloads.
func TestSnapshotCacheTTL(t *testing.T) {
	calls := 0
	c := NewSnapshotCache(60 * time.Second)
	load := func() (Snapshot, error) {
		calls++
		return Snapshot{Status: StatusLive, Revision: int64(calls)}, nil
	}
	s1, err := c.Get("sched-1", time.Now().UTC(), load)
	if err != nil || s1.Revision != 1 {
		t.Fatalf("first load: %+v %v", s1, err)
	}
	s2, err := c.Get("sched-1", time.Now().UTC(), load)
	if err != nil || s2.Revision != 1 {
		t.Fatalf("TTL hit must not reload: %+v %v", s2, err)
	}
	if calls != 1 {
		t.Fatalf("loader calls = %d, want 1", calls)
	}
	s3, err := c.Get("sched-1", time.Now().UTC().Add(61*time.Second), load)
	if err != nil || s3.Revision != 2 {
		t.Fatalf("expired entry must reload: %+v %v", s3, err)
	}
}

// B2 RED: Invalidate forces reload (control commands bump revision and
// must be visible to the next writer within one refresh, not one TTL).
func TestSnapshotCacheInvalidate(t *testing.T) {
	calls := 0
	c := NewSnapshotCache(60 * time.Second)
	load := func() (Snapshot, error) {
		calls++
		return Snapshot{Status: StatusLive, Revision: int64(calls)}, nil
	}
	if _, err := c.Get("sched-1", time.Now().UTC(), load); err != nil {
		t.Fatal(err)
	}
	c.Invalidate("sched-1")
	s, err := c.Get("sched-1", time.Now().UTC(), load)
	if err != nil || s.Revision != 2 {
		t.Fatalf("invalidated entry must reload: %+v %v", s, err)
	}
}

// B2 RED: loader errors are not cached (a failed refresh retries next call).
func TestSnapshotCacheErrorNotCached(t *testing.T) {
	calls := 0
	c := NewSnapshotCache(60 * time.Second)
	good := false
	load := func() (Snapshot, error) {
		calls++
		if !good {
			return Snapshot{}, errSnapshotTest()
		}
		return Snapshot{Status: StatusLive, Revision: 9}, nil
	}
	now := time.Now().UTC()
	if _, err := c.Get("sched-1", now, load); err == nil {
		t.Fatalf("loader error must propagate")
	}
	good = true
	s, err := c.Get("sched-1", now, load)
	if err != nil || s.Revision != 9 {
		t.Fatalf("error must not cache: %+v %v", s, err)
	}
	if calls != 2 {
		t.Fatalf("calls = %d, want 2", calls)
	}
}

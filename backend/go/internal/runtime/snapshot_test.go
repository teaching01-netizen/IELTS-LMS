package runtime

import (
	"testing"
	"time"
)

// strptr is defined in service.go (test package shares it); snapshotAlias
// keeps this file's intent explicit without redeclaration.

// The snapshot no longer decides writability: it is a ~1s-stale view for student
// polls, and the V2 write gate reads current runtime + section state on the
// writing transaction (cmd/api/v2locker_snapshot.go, v2Locker). There is no
// Snapshot verdict left to trust, so this file only pins the cache contract.

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

// SectionLiveness is the single owner of status -> liveness for BOTH gate modes
// (v2Locker and runtime.LoadSnapshot), so this table is the contract they share:
// only 'live' is writable, and an unopened ('locked') section is not "started".
func TestSectionLivenessTable(t *testing.T) {
	cases := []struct {
		status  string
		started bool
		live    bool
		paused  bool
	}{{SectionLive, true, true, false},
		{SectionPaused, true, false, true},
		{SectionLocked, false, false, false},
		{SectionCompleted, true, false, false},
		{"", true, false, false},
		{"unrecognised", true, false, false},
	}
	for _, tc := range cases {
		started, live, paused := SectionLiveness(tc.status)
		if started != tc.started || live != tc.live || paused != tc.paused {
			t.Fatalf("SectionLiveness(%q) = started=%v live=%v paused=%v, want %v/%v/%v",
				tc.status, started, live, paused, tc.started, tc.live, tc.paused)
		}
		if live && (paused || !started) {
			t.Fatalf("SectionLiveness(%q) is internally inconsistent", tc.status)
		}
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

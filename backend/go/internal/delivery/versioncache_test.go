package delivery

import (
	"context"
	"encoding/json"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func fixtureSections() []DeliverySection {
	return []DeliverySection{
		{ID: "sec-1", SectionKey: "rw", Title: "Reading", DisplayOrder: 1, Modules: []DeliveryModule{
			{ID: "mod-1", ModuleKey: "rw-1", Title: "R/W 1", Questions: []DeliveredQuestion{
				{ExamQuestionID: "eq-1", QuestionID: "q-1", DisplayOrder: 1, Answer: json.RawMessage(`{"correct":"A"}`)},
			}},
		}},
	}
}

// D1 RED: cached tree is byte-equal to the loaded tree; loader runs once
// across repeat Gets (hit path does zero loader work).
func TestVersionCacheEquivalence(t *testing.T) {
	c := NewVersionCache(50)
	var calls atomic.Int64
	load := func() ([]DeliverySection, int64, error) {
		calls.Add(1)
		return fixtureSections(), 7, nil
	}
	first, rev, err := c.Get(context.Background(), "v-1", load)
	if err != nil || rev != 7 {
		t.Fatalf("get: %v rev=%d", err, rev)
	}
	second, _, err := c.Get(context.Background(), "v-1", load)
	if err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("loader calls = %d, want 1", calls.Load())
	}
	a, _ := json.Marshal(first)
	b, _ := json.Marshal(second)
	if string(a) != string(b) {
		t.Fatalf("cached tree must be byte-equal:\n%s\n%s", a, b)
	}
}

// D1 RED: Invalidate forces a reload (publish path); new revision served.
func TestVersionCacheInvalidate(t *testing.T) {
	c := NewVersionCache(50)
	var rev atomic.Int64
	rev.Store(7)
	load := func() ([]DeliverySection, int64, error) {
		return fixtureSections(), rev.Load(), nil
	}
	if _, r, _ := c.Get(context.Background(), "v-1", load); r != 7 {
		t.Fatalf("rev = %d", r)
	}
	rev.Store(8)
	c.Invalidate("v-1")
	if _, r, _ := c.Get(context.Background(), "v-1", load); r != 8 {
		t.Fatalf("after invalidate rev = %d, want 8", r)
	}
}

// D1 RED: revision mismatch fails closed to miss (stale entry never served).
func TestVersionCacheRevisionMismatch(t *testing.T) {
	c := NewVersionCache(50)
	loads := []struct {
		rev int64
	}{
		{7}, {8},
	}
	i := 0
	// Loader models verify-then-load: first call stores rev 7; the row
	// revision moves to 8 before the second Get, so the loader returns the
	// new tree + rev and the cache must serve rev 8, not the stale 7.
	load := func() ([]DeliverySection, int64, error) {
		r := loads[i].rev
		return fixtureSections(), r, nil
	}
	if _, r, _ := c.Get(context.Background(), "v-1", load); r != 7 {
		t.Fatalf("rev = %d", r)
	}
	i = 1
	c.Invalidate("v-1")
	if _, r, _ := c.Get(context.Background(), "v-1", load); r != 8 {
		t.Fatalf("stale entry served: rev = %d, want 8", r)
	}
}

// D1 RED: herd — 200 concurrent Gets collapse to exactly 1 loader call.
func TestVersionCacheHerd(t *testing.T) {
	c := NewVersionCache(50)
	var calls atomic.Int64
	load := func() ([]DeliverySection, int64, error) {
		calls.Add(1)
		time.Sleep(20 * time.Millisecond)
		return fixtureSections(), 7, nil
	}
	var wg sync.WaitGroup
	for i := 0; i < 200; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, _, err := c.Get(context.Background(), "v-shared", load); err != nil {
				t.Error(err)
			}
		}()
	}
	wg.Wait()
	if calls.Load() != 1 {
		t.Fatalf("herd loader calls = %d, want 1", calls.Load())
	}
}

// D1: GetChecked serves the hit only on revision match; mismatch reloads.
func TestVersionCacheGetChecked(t *testing.T) {
	c := NewVersionCache(50)
	var calls atomic.Int64
	var observed atomic.Int64
	observed.Store(7)
	load := func() ([]DeliverySection, int64, error) {
		calls.Add(1)
		return fixtureSections(), observed.Load(), nil
	}
	ctx := context.Background()
	if _, err := c.GetChecked(ctx, "v-1", 7, load); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetChecked(ctx, "v-1", 7, load); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 1 {
		t.Fatalf("same-rev hit must not reload, calls=%d", calls.Load())
	}
	observed.Store(8)
	if _, err := c.GetChecked(ctx, "v-1", 8, load); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("rev mismatch must reload, calls=%d", calls.Load())
	}
	if rev, _ := c.PeekRevision("v-1"); rev != 8 {
		t.Fatalf("stored rev = %d, want 8", rev)
	}
}

// D1 RED: LRU cap evicts oldest (memory bounded at 50 versions).
func TestVersionCacheEvicts(t *testing.T) {
	c := NewVersionCache(2)
	load := func() ([]DeliverySection, int64, error) { return fixtureSections(), 1, nil }
	if _, _, err := c.Get(context.Background(), "v-1", load); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.Get(context.Background(), "v-2", load); err != nil {
		t.Fatal(err)
	}
	if _, _, err := c.Get(context.Background(), "v-3", load); err != nil {
		t.Fatal(err)
	}
	if c.Len() != 2 {
		t.Fatalf("len = %d, want cap 2", c.Len())
	}
}

// A load that observes a different revision than the one probed (a publish
// raced the probe) serves its content but is never stored under either label.
func TestVersionCacheGetCheckedNeverMislabelsRevision(t *testing.T) {
	c := NewVersionCache(50)
	var calls atomic.Int64
	load := func() ([]DeliverySection, int64, error) {
		calls.Add(1)
		return fixtureSections(), 8, nil
	}
	sections, err := c.GetChecked(context.Background(), "v-1", 7, load)
	if err != nil || len(sections) != 1 {
		t.Fatalf("mismatched load must still serve current content: %v %v", sections, err)
	}
	if _, ok := c.PeekRevision("v-1"); ok {
		t.Fatal("a tree observed at rev 8 must not be cached for a rev-7 probe")
	}
	if _, err := c.GetChecked(context.Background(), "v-1", 7, load); err != nil {
		t.Fatal(err)
	}
	if calls.Load() != 2 {
		t.Fatalf("unpublished load must not satisfy a later probe, calls=%d", calls.Load())
	}
}

// An Invalidate that lands while a load is in flight stops that load from
// repopulating the cache.
func TestVersionCacheInvalidateDuringLoadSkipsPublish(t *testing.T) {
	c := NewVersionCache(50)
	release := make(chan struct{})
	started := make(chan struct{})
	load := func() ([]DeliverySection, int64, error) {
		close(started)
		<-release
		return fixtureSections(), 7, nil
	}
	done := make(chan error, 1)
	go func() {
		_, err := c.GetChecked(context.Background(), "v-1", 7, load)
		done <- err
	}()
	<-started
	c.Invalidate("v-1")
	close(release)
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	if _, ok := c.PeekRevision("v-1"); ok {
		t.Fatal("a load that began before Invalidate must not publish")
	}
}

// Flights are per (version, revision): a newer probe never waits on, or
// receives, an older probe's load.
func TestVersionCacheFlightsAreRevisionScoped(t *testing.T) {
	c := NewVersionCache(50)
	release := make(chan struct{})
	started := make(chan struct{})
	slow := func() ([]DeliverySection, int64, error) {
		close(started)
		<-release
		return fixtureSections(), 7, nil
	}
	go func() { _, _ = c.GetChecked(context.Background(), "v-1", 7, slow) }()
	<-started
	fast := func() ([]DeliverySection, int64, error) { return fixtureSections(), 8, nil }
	if _, err := c.GetChecked(context.Background(), "v-1", 8, fast); err != nil {
		t.Fatal(err)
	}
	if rev, ok := c.PeekRevision("v-1"); !ok || rev != 8 {
		t.Fatalf("rev-8 load must publish independently, got rev=%d ok=%v", rev, ok)
	}
	close(release)
}

// A waiting follower honours its own context instead of the leader's load.
func TestVersionCacheFollowerHonoursItsContext(t *testing.T) {
	c := NewVersionCache(50)
	release := make(chan struct{})
	started := make(chan struct{})
	slow := func() ([]DeliverySection, int64, error) {
		close(started)
		<-release
		return fixtureSections(), 7, nil
	}
	go func() { _, _ = c.GetChecked(context.Background(), "v-1", 7, slow) }()
	<-started
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := c.GetChecked(ctx, "v-1", 7, slow); err != context.Canceled {
		t.Fatalf("canceled follower must return its own ctx error, got %v", err)
	}
	close(release)
}

// When the leader's request ends mid-load, a live follower retries under its
// own loader rather than inheriting the cancellation.
func TestVersionCacheFollowerRetriesAfterLeaderCancellation(t *testing.T) {
	c := NewVersionCache(50)
	release := make(chan struct{})
	started := make(chan struct{})
	leader := func() ([]DeliverySection, int64, error) {
		close(started)
		<-release
		return nil, 0, context.Canceled
	}
	go func() { _, _ = c.GetChecked(context.Background(), "v-1", 7, leader) }()
	<-started
	result := make(chan error, 1)
	go func() {
		_, err := c.GetChecked(context.Background(), "v-1", 7, func() ([]DeliverySection, int64, error) {
			return fixtureSections(), 7, nil
		})
		result <- err
	}()
	time.Sleep(10 * time.Millisecond)
	close(release)
	if err := <-result; err != nil {
		t.Fatalf("live follower must retry after the leader's cancellation: %v", err)
	}
	if rev, ok := c.PeekRevision("v-1"); !ok || rev != 7 {
		t.Fatalf("follower retry must publish, rev=%d ok=%v", rev, ok)
	}
}

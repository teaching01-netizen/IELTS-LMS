package runtime

// Plan B2/E-exam-day: the snapshot-cache slice (hits vs misses) proves the
// 0-SQL-on-hit gate. RED: Get emits MSnapshotCacheHit/Miss.
import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestSnapshotCacheEmitsHitAndMiss(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	c := NewSnapshotCache(time.Minute)
	now := time.Now().UTC()
	load := func() (Snapshot, error) {
		return Snapshot{Status: StatusLive, Revision: 3, SectionLive: true, SectionStarted: true, LoadedAt: now}, nil
	}
	if _, err := c.Get("sched-1", now, load); err != nil {
		t.Fatalf("first load: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSnapshotCacheMiss); got != 1 {
		t.Fatalf("first load must count 1 miss, got %v", got)
	}
	if _, err := c.Get("sched-1", now.Add(100*time.Millisecond), load); err != nil {
		t.Fatalf("second load: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSnapshotCacheHit); got != 1 {
		t.Fatalf("fresh repeat must count 1 hit, got %v", got)
	}
}

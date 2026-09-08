package delivery

// Plan D1/E-exam-day: the version-cache slice (hit vs miss) is the
// operator's bootstrap-herd proof. A 2k-student herd on one published
// version must read ~1 miss + ~1999 hits — a miss storm means the
// revision probe is flapping. RED: GetChecked counts exactly.
import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestVersionCacheEmitsHitAndMiss(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	c := NewVersionCache(50)
	ctx := context.Background()
	load := func() ([]DeliverySection, int64, error) { return fixtureSections(), 7, nil }
	if _, err := c.GetChecked(ctx, "v-1", 7, load); err != nil {
		t.Fatalf("first: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MVersionCacheMiss); got != 1 {
		t.Fatalf("first load must count 1 miss, got %v", got)
	}
	if _, err := c.GetChecked(ctx, "v-1", 7, load); err != nil {
		t.Fatalf("second: %v", err)
	}
	if _, err := c.GetChecked(ctx, "v-1", 7, load); err != nil {
		t.Fatalf("third: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MVersionCacheHit); got != 2 {
		t.Fatalf("repeat loads must count 2 hits, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MVersionCacheMiss); got != 1 {
		t.Fatalf("miss must stay 1, got %v", got)
	}
	// Revision bump = new probe revision = miss again (publish path).
	if _, err := c.GetChecked(ctx, "v-1", 8, load); err != nil {
		t.Fatalf("bump: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MVersionCacheMiss); got != 2 {
		t.Fatalf("revision bump must count a 2nd miss, got %v", got)
	}
}

package delivery

// Plan D1 publish path: InvalidateVersion drops one cached tree so the
// next bootstrap reloads (no stale tree after publish). Nil service, nil
// cache, and missing keys are all no-ops (never panic); other versions
// survive. The revision probe is the correctness backstop, invalidation
// is the freshness optimization. RED: all shapes.
import (
	"context"
	"testing"
)

func TestInvalidateVersionShapes(t *testing.T) {
	var nilSvc *Service
	nilSvc.InvalidateVersion("v-1") // must not panic

	svc := NewService(nil, nil)
	svc.InvalidateVersion("v-1") // nil cache: no-op, must not panic
	if svc.VersionCached() {
		t.Fatalf("nil cache must report VersionCached=false")
	}

	c := NewVersionCache(50)
	ctx := context.Background()
	load := func() ([]DeliverySection, int64, error) { return fixtureSections(), 7, nil }
	cached := NewService(nil, nil).SetVersionCache(c)
	if !cached.VersionCached() {
		t.Fatalf("wired cache must report VersionCached=true")
	}
	if _, err := c.GetChecked(ctx, "v-1", 7, load); err != nil {
		t.Fatal(err)
	}
	if _, err := c.GetChecked(ctx, "v-2", 7, load); err != nil {
		t.Fatal(err)
	}
	if c.Len() != 2 {
		t.Fatalf("want 2 cached versions, got %d", c.Len())
	}
	cached.InvalidateVersion("v-1")
	if c.Len() != 1 {
		t.Fatalf("invalidate must drop exactly one, len=%d", c.Len())
	}
	if _, ok := c.PeekRevision("v-1"); ok {
		t.Fatalf("v-1 must be gone after invalidate")
	}
	if rev, ok := c.PeekRevision("v-2"); !ok || rev != 7 {
		t.Fatalf("v-2 must survive with rev 7, got rev=%d ok=%v", rev, ok)
	}
	cached.InvalidateVersion("missing") // missing key: no-op
	if c.Len() != 1 {
		t.Fatalf("missing-key invalidate must be a no-op, len=%d", c.Len())
	}
}

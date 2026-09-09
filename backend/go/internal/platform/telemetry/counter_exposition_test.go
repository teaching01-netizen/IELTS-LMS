package telemetry

// Plan single-deploy scale (round 141, TDD RED): the 2k herd proved the
// version-cache counters never reach /metrics — IncCounter writes exist
// (versioncache.go) but post-herd scrapes showed no version_cache_* series.
// This test pins the contract: incremented counters MUST render in
// Snapshot exposition with HELP/TYPE headers.
import (
	"strings"
	"testing"
)

func TestCountersRenderInSnapshotExposition(t *testing.T) {
	r := NewRegistry()
	r.IncCounter(MVersionCacheHit)
	r.IncCounter(MVersionCacheHit)
	r.IncCounter(MVersionCacheMiss)
	out := r.Snapshot()
	if !strings.Contains(out, MVersionCacheHit+" 2") {
		t.Fatalf("Snapshot missing hit counter series:\n%s", out)
	}
	if !strings.Contains(out, MVersionCacheMiss+" 1") {
		t.Fatalf("Snapshot missing miss counter series:\n%s", out)
	}
	if !strings.Contains(out, "# TYPE "+MVersionCacheHit+" counter") {
		t.Fatalf("Snapshot missing counter TYPE header:\n%s", out)
	}
}

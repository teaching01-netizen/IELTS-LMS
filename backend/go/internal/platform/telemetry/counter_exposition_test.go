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

func TestRateLimitFailureCountersAreRegistered(t *testing.T) {
	registered := map[string]bool{}
	for _, name := range Names() {
		registered[name] = true
	}
	for _, name := range []string{
		MRatelimitDBErrorTotal,
		MRatelimitCapacityTotal,
		MEntryGateCapacityTotal,
	} {
		if !registered[name] {
			t.Fatalf("rate-limit counter %q is missing from telemetry.Names", name)
		}
	}

	r := NewRegistry()
	r.IncCounter(MRatelimitDBErrorTotal, "tier", "polling", "key_class", "attempt")
	r.IncCounter(MRatelimitCapacityTotal, "tier", "writes", "key_class", "user")
	r.IncCounter(MEntryGateCapacityTotal, "tier", "student-entry", "key_class", "schedule")
	snapshot := r.Snapshot()
	for _, name := range []string{
		MRatelimitDBErrorTotal,
		MRatelimitCapacityTotal,
		MEntryGateCapacityTotal,
	} {
		if !strings.Contains(snapshot, "# TYPE "+name+" counter") {
			t.Fatalf("snapshot missing counter type for %q:\n%s", name, snapshot)
		}
	}
}

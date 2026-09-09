package auth

// Plan A2/E-exam-day: the session-cache slice (hits vs misses) is the
// operator's per-request-bleed signal. Hits skip the SELECT + touch UPDATE;
// misses reload from the DB. RED: Get emits MSessionCacheHit/Miss.
import (
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestSessionCacheEmitsHitAndMiss(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	c := NewSessionCache(SessionCacheConfig{Enabled: true, MaxEntries: 100})
	now := time.Now().UTC()
	s := testSession("s1", "u1", now)
	c.Put("hash-1", s, now)
	if _, ok := c.Get("hash-1", now.Add(time.Minute)); !ok {
		t.Fatalf("seeded entry must hit")
	}
	if _, ok := c.Get("hash-absent", now); ok {
		t.Fatalf("absent entry must miss")
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSessionCacheHit); got != 1 {
		t.Fatalf("one hit must count 1, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSessionCacheMiss, "reason", "absent"); got != 1 {
		t.Fatalf("one absent miss must count 1, got %v", got)
	}
}

package student

// Plan C5/D2: the server echoes nextHeartbeatSecs (= presence TTL) on
// every heartbeat ack so clients coalesce beats after any write. The
// client (heartbeatCoalesce.ts) multiplies by 1000 for the ms window —
// a server/client unit mismatch doubles or zeroes the skip window.
// This test pins: window == TTL seconds (single source of truth),
// positive, and stable across calls.
//
// NOTE: all pass today (no drift) — verified the test executes against
// the real DefaultPresenceTTL (90s). The test is the pin: a TTL change
// without a client-coordinated window update fails here first.
import (
	"testing"
	"time"
)

func TestPresenceWindowMatchesTTL(t *testing.T) {
	want := int(DefaultPresenceTTL / time.Second)
	if got := PresenceWindowSeconds(); got != want {
		t.Fatalf("window must equal TTL seconds (%d), got %d", want, got)
	}
	if got := PresenceWindowSeconds(); got < 1 {
		t.Fatalf("window must be positive, got %d", got)
	}
	if a, b := PresenceWindowSeconds(), PresenceWindowSeconds(); a != b {
		t.Fatalf("window must be stable, got %d then %d", a, b)
	}
	// Client contract: ms window = secs * 1000 (heartbeatCoalesce.ts:28).
	// A 90s window must not overflow the client's ms math.
	if ms := int64(PresenceWindowSeconds()) * 1000; ms != 90000 {
		t.Fatalf("client ms window must be 90000, got %d", ms)
	}
}

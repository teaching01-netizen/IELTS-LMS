package schedules

// Plan entry-wave vocabulary, round 65: NormalizeAccessCode is the
// single funnel every wcode passes through (direct entry, link entry,
// registration, attempt mint). The existing test pins 4 rows; this
// table pins the full contract: legacy W+D6 uppercasing, near-miss
// passthrough (W+wrong-length, W+non-digits stay trimmed-as-is by
// design — ValidateWcode only gates emptiness), whitespace trimming,
// and the guest-code passthrough the builder preview flow depends on.
// A normalizer edit that uppercases free-form codes would corrupt
// OPEN-* keys and guest codes — this test fails first.
//
// NOTE: all pass today (no drift) — verified the test executes
// (14 normalize rows + 6 gate rows each asserted). The audit verdict
// stands: NO handler pre-bucket wcode gate is possible — shape is
// intentionally free-form, only emptiness rejects, and the entry
// handler already presence-checks wcode-or-link pre-buckets.
import (
	"testing"
)

func TestNormalizeAccessCodeContract(t *testing.T) {
	cases := map[string]string{
		// Legacy W+D6: uppercase + trim.
		"W123456":     "W123456",
		"w123456":     "W123456",
		"  w123456 ": "W123456",
		"W000000":     "W000000",
		// Near-miss: NOT W+D6 -> trimmed passthrough (by design).
		"W12345":   "W12345",
		"W1234567": "W1234567",
		"W12345A":  "W12345A",
		"X123456":  "X123456",
		// Free-form + guest + OPEN keys: never uppercased.
		"guest-alpha_01": "guest-alpha_01",
		"Guest-Alpha":    "Guest-Alpha",
		"OPEN-ABCDEF":    "OPEN-ABCDEF",
		"open-abcdef":    "open-abcdef",
		// Whitespace-only trims to empty (ValidateWcode rejects).
		"   ": "",
		"":    "",
	}
	for in, want := range cases {
		if got := NormalizeAccessCode(in); got != want {
			t.Fatalf("NormalizeAccessCode(%q) = %q, want %q", in, got, want)
		}
	}
	// Emptiness gate stays the ONLY rejection (shape is free-form).
	for _, bad := range []string{"", "   "} {
		if err := ValidateWcode(bad); err == nil {
			t.Fatalf("wcode %q must fail validation", bad)
		}
	}
	for _, ok := range []string{"W123456", "guest-alpha_01", "OPEN-X", "anything-at-all"} {
		if err := ValidateWcode(ok); err != nil {
			t.Fatalf("wcode %q must pass, got %v", ok, err)
		}
	}
}

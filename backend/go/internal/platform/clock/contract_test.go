package clock

import (
	"testing"
	"time"
)

// WS-16 P2: clock contract. Fixed is pinned (Now returns the stamped UTC
// instant); System advances monotonically in UTC. Server-authoritative
// timing (plan 26) depends on both: tests pin Fixed, prod reads System.
func TestFixedClockPinsNow(t *testing.T) {
	stamp := time.Date(2026, 9, 9, 12, 0, 0, 0, time.FixedZone("CEST", 3600))
	c := FixedAt(stamp)
	got := c.Now()
	if !got.Equal(stamp.UTC()) {
		t.Fatalf("Fixed.Now must return the stamped instant in UTC, got %v want %v", got, stamp.UTC())
	}
	if got.Location() != time.UTC {
		t.Fatalf("Fixed.Now must be UTC, got %v", got.Location())
	}
	if again := c.Now(); !again.Equal(got) {
		t.Fatalf("Fixed.Now must not advance, got %v then %v", got, again)
	}
}

func TestFixedZeroValueIsStable(t *testing.T) {
	var c Fixed
	if a, b := c.Now(), c.Now(); !a.Equal(b) {
		t.Fatalf("zero Fixed must be stable, got %v then %v", a, b)
	}
}

func TestSystemClockAdvancesInUTC(t *testing.T) {
	var c System
	a := c.Now()
	if a.Location() != time.UTC {
		t.Fatalf("System.Now must be UTC, got %v", a.Location())
	}
	// Monotonic wall advance: a later read must not precede an earlier one.
	deadline := time.Now().Add(2 * time.Second)
	var b time.Time
	for {
		b = c.Now()
		if b.After(a) || time.Now().After(deadline) {
			break
		}
	}
	if b.Before(a) {
		t.Fatalf("System.Now must advance monotonically, got %v then %v", a, b)
	}
}

// Both implementations satisfy the Clock interface (compile-time shape +
// runtime assertion for the DI seam).
func TestClocksSatisfyInterface(t *testing.T) {
	var _ Clock = System{}
	var _ Clock = Fixed{}
	clocks := []Clock{System{}, FixedAt(time.Now())}
	for i, c := range clocks {
		if c.Now().IsZero() && i == 0 {
			t.Fatalf("System.Now must never be zero")
		}
	}
}

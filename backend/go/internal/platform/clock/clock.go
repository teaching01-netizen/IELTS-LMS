// Package clock abstracts time so server-authoritative timing is explicit
// and tests can use a fixed clock. Student command acceptance always uses
// server/DB time, never browser wall time (plan 26).
package clock

import "time"

// Clock provides UTC time.
type Clock interface {
	Now() time.Time
}

// System clock.
type System struct{}

func (System) Now() time.Time { return time.Now().UTC() }

// Fixed clock for tests.
type Fixed struct{ T time.Time }

func (f Fixed) Now() time.Time { return f.T.UTC() }

func FixedAt(t time.Time) Fixed { return Fixed{T: t.UTC()} }

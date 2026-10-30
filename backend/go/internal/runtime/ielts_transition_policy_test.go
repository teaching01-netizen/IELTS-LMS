package runtime

import (
	"testing"
	"time"
)

func TestIELTSNextSectionEligibleAt(t *testing.T) {
	deadline := time.Date(2026, 10, 30, 9, 0, 0, 0, time.UTC)
	at := func(d time.Duration) *time.Time { v := deadline.Add(d); return &v }
	cases := []struct {
		name    string
		gap     int
		release *time.Time
		want    time.Time
		ok      bool
	}{
		{"unreleased", 0, nil, time.Time{}, false},
		{"early release waits for grace", 0, at(-time.Minute), deadline.Add(ResponseSaveGrace), true},
		{"release exactly at grace", 0, at(ResponseSaveGrace), deadline.Add(ResponseSaveGrace), true},
		{"late release wins", 0, at(time.Minute), deadline.Add(time.Minute), true},
		{"gap adds after grace", 2, at(0), deadline.Add(ResponseSaveGrace + 2*time.Minute), true},
	}
	for _, tc := range cases {
		got, ok := IELTSNextSectionEligibleAt(deadline, tc.gap, tc.release)
		if ok != tc.ok || !got.Equal(tc.want) {
			t.Fatalf("%s: got (%v,%v) want (%v,%v)", tc.name, got, ok, tc.want, tc.ok)
		}
	}
}

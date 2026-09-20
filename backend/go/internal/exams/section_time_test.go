package exams

import "testing"

// A SAT section is Module 1 plus exactly one Module 2 branch, so its authored
// length is base + the LONGER branch. Summing all three authored modules is the
// bug this rule exists to prevent: that value is what the runtime clocks the
// section from.
func TestCandidateSectionSecondsUsesTheLongerBranch(t *testing.T) {
	cases := []struct {
		name                string
		base, lower, higher int
		want                int
	}{
		{name: "blueprint reading-writing 32/32/32", base: 32 * 60, lower: 32 * 60, higher: 32 * 60, want: 64 * 60},
		{name: "blueprint math 35/35/35", base: 35 * 60, lower: 35 * 60, higher: 35 * 60, want: 70 * 60},
		{name: "higher branch is longer", base: 35 * 60, lower: 30 * 60, higher: 40 * 60, want: 75 * 60},
		{name: "lower branch is longer", base: 35 * 60, lower: 45 * 60, higher: 40 * 60, want: 80 * 60},
		{name: "only the base is authored", base: 1920, lower: 0, higher: 0, want: 1920},
		{name: "negative branch is floored at zero", base: 1800, lower: -60, higher: -60, want: 1800},
		{name: "negative base is floored at zero", base: -1, lower: -1, higher: -1, want: 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := CandidateSectionSeconds(tc.base, tc.lower, tc.higher); got != tc.want {
				t.Fatalf("CandidateSectionSeconds(%d, %d, %d) = %d, want %d", tc.base, tc.lower, tc.higher, got, tc.want)
			}
		})
	}
}

// The rule is exactly what the release summary SQL computes
// (release/contentSummary: base + GREATEST(lower, higher)), so the stored
// section duration and the published candidate time cannot disagree.
func TestCandidateSectionSecondsNeverCountsBothBranches(t *testing.T) {
	base, lower, higher := 2100, 2100, 2100
	if got, want := CandidateSectionSeconds(base, lower, higher), 2*base; got != want {
		t.Fatalf("got %d, want %d (one branch, never two)", got, want)
	}
}

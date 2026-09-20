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

// No reader may count both branches: the runtime plan and the release summary
// must agree on one branch. The parity pins in cmd/migrate and internal/release
// execute the SQL copies against this file's numbers, and the client copy is
// pinned by releaseSelectors.test.ts.
func TestCandidateSectionSecondsNeverCountsBothBranches(t *testing.T) {
	base, lower, higher := 2100, 2100, 2100
	if got, want := CandidateSectionSeconds(base, lower, higher), 2*base; got != want {
		t.Fatalf("got %d, want %d (one branch, never two)", got, want)
	}
}

// CandidateSectionSecondsForRoles is the guard every clock reader calls: only a
// base plus at least one branch proves a candidate length.
func TestCandidateSectionSecondsForRolesOwnsTheShapeGuard(t *testing.T) {
	cases := []struct {
		name                string
		base, lower, higher int
		want                int
		complete            bool
	}{
		{name: "base plus both branches", base: 1920, lower: 1920, higher: 1920, want: 3840, complete: true},
		{name: "base plus one branch", base: 1920, lower: 1920, higher: 0, want: 3840, complete: true},
		{name: "base only", base: 1920, lower: 0, higher: 0, complete: false},
		{name: "branches only", base: 0, lower: 1920, higher: 1920, complete: false},
		{name: "zero durations", base: 0, lower: 0, higher: 0, complete: false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got, ok := CandidateSectionSecondsForRoles(tc.base, tc.lower, tc.higher)
			if ok != tc.complete {
				t.Fatalf("complete = %v, want %v (base=%d lower=%d higher=%d)", ok, tc.complete, tc.base, tc.lower, tc.higher)
			}
			if tc.complete && got != tc.want {
				t.Fatalf("got %d, want %d", got, tc.want)
			}
		})
	}
}

// AddModule reproduces the comparison the removed SQL relied on: under the
// column's utf8mb4_0900_ai_ci collation, ASCII role names match
// case-insensitively — while whitespace stays significant (NO PAD), so a padded
// role matches nothing. The schema's CHECK admits case variants and rejects
// padded roles outright.
func TestAdaptiveRoleSecondsMatchesTheSQLCollation(t *testing.T) {
	var clock AdaptiveRoleSeconds
	clock.AddModule("BASE", 2100)
	clock.AddModule("Lower_Branch", 2400)
	clock.AddModule("HIGHER_BRANCH", 1800)
	clock.AddModule(" base ", 9999) // padded: the NO PAD comparison matched nothing
	got, ok := clock.CandidateSeconds()
	if !ok {
		t.Fatal("case-variant roles must prove a candidate length")
	}
	if want := CandidateSectionSeconds(2100, 2400, 1800); got != want {
		t.Fatalf("got %d, want %d", got, want)
	}
	if clock.Base != 2100 || clock.Lower != 2400 || clock.Higher != 1800 {
		t.Fatalf("role totals = %+v, want base 2100, lower 2400, higher 1800", clock)
	}
}

// AdaptiveRoleSeconds folds scanned module rows into the same rule, and a role
// that appears more than once keeps the largest value — the choice migration
// 0067's MAX(CASE ...) and the release summary's GREATEST(...) already made.
func TestAdaptiveRoleSecondsFoldsRowsAndKeepsTheLargestPerRole(t *testing.T) {
	var clock AdaptiveRoleSeconds
	clock.AddModule("base", 1800)
	clock.AddModule("base", 2100) // larger duplicate wins
	clock.AddModule("lower_branch", 1920)
	clock.AddModule("lower_branch", 1800) // smaller duplicate is ignored
	clock.AddModule("higher_branch", 2400)
	clock.AddModule("none", 9999) // non-adaptive role: contributes nothing
	got, ok := clock.CandidateSeconds()
	if !ok {
		t.Fatal("a base plus branches must prove a candidate length")
	}
	if want := CandidateSectionSeconds(2100, 1920, 2400); got != want {
		t.Fatalf("got %d, want %d", got, want)
	}
	if clock.Base != 2100 || clock.Lower != 1920 || clock.Higher != 2400 {
		t.Fatalf("role totals = %+v, want base 2100, lower 1920, higher 2400", clock)
	}
}

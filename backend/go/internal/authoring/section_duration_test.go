package authoring

import "testing"

// The delivery-settings save writes assessment_sections.duration_seconds from
// the module timings it just persisted. That column is the SAT section clock
// (schedules.runtimePlanIn -> exam_session_runtime_sections
// .planned_duration_minutes), so it must be base + the longer branch: a
// candidate sits Module 1 plus exactly one Module 2.
func TestSectionCandidateSecondsCountsOneBranch(t *testing.T) {
	timings := []ModuleTiming{
		{ModuleID: "mod-base", DurationSeconds: 35 * 60},
		{ModuleID: "mod-lower", DurationSeconds: 35 * 60},
		{ModuleID: "mod-higher", DurationSeconds: 35 * 60},
	}
	if got, want := sectionCandidateSeconds(timings, "mod-base", "mod-lower", "mod-higher"), 70*60; got != want {
		t.Fatalf("math section duration = %d, want %d (M1 + one branch, not all three modules)", got, want)
	}
}

func TestSectionCandidateSecondsPicksTheLongerBranch(t *testing.T) {
	timings := []ModuleTiming{
		{ModuleID: "mod-base", DurationSeconds: 32 * 60},
		{ModuleID: "mod-lower", DurationSeconds: 30 * 60},
		{ModuleID: "mod-higher", DurationSeconds: 40 * 60},
	}
	if got, want := sectionCandidateSeconds(timings, "mod-base", "mod-lower", "mod-higher"), 72*60; got != want {
		t.Fatalf("section duration = %d, want %d", got, want)
	}
	if got, want := sectionCandidateSeconds(timings, "mod-base", "mod-higher", "mod-lower"), 72*60; got != want {
		t.Fatalf("branch order must not matter: got %d, want %d", got, want)
	}
}

// A request that omits a module id (or the routing rows that name it) yields
// the modules it does carry rather than a panic or a negative duration.
func TestSectionCandidateSecondsToleratesMissingIDs(t *testing.T) {
	timings := []ModuleTiming{{ModuleID: "mod-base", DurationSeconds: 1800}}
	if got, want := sectionCandidateSeconds(timings, "mod-base", "mod-lower", "mod-higher"), 1800; got != want {
		t.Fatalf("section duration = %d, want %d", got, want)
	}
	if got := sectionCandidateSeconds(nil, "", "", ""); got != 0 {
		t.Fatalf("empty timings = %d, want 0", got)
	}
}

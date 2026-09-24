package runtime

import "testing"

func TestResolveTimingModelOldRowCompatibility(t *testing.T) {
	// Null/empty choice keeps the deployed model: old SAT rows stay cohort,
	// other providers stay legacy.
	if got := ResolveTimingModel("sat", ""); got != TimingModelCohortSection {
		t.Fatalf("old SAT row = %q, want cohort_section_v3", got)
	}
	if got := ResolveTimingModel("act", ""); got != TimingModelLegacy {
		t.Fatalf("old ACT row = %q, want legacy_section_v1", got)
	}
	if got := ResolveTimingModel("sat", "  "); got != TimingModelCohortSection {
		t.Fatalf("blank choice = %q, want cohort_section_v3", got)
	}
}

func TestResolveTimingModelNewRowSelection(t *testing.T) {
	if got := ResolveTimingModel("sat", TimingModelPersonal); got != TimingModelPersonal {
		t.Fatalf("new SAT row = %q, want sat_personal_v1", got)
	}
	// Non-SAT providers cannot select the personal model.
	if got := ResolveTimingModel("act", TimingModelPersonal); got != TimingModelLegacy {
		t.Fatalf("ACT personal row = %q, want legacy_section_v1", got)
	}
}

func TestIsSatPersonalNeverMatchesOldRows(t *testing.T) {
	for _, model := range []string{"", "  ", TimingModelLegacy, TimingModelCohortStage, TimingModelCohortSection} {
		if IsSatPersonal(model) {
			t.Fatalf("IsSatPersonal(%q) = true, want false", model)
		}
	}
	if !IsSatPersonal(TimingModelPersonal) {
		t.Fatalf("IsSatPersonal(sat_personal_v1) = false, want true")
	}
}

func TestNoInflightModelRewrite(t *testing.T) {
	// The stored runtime model is authoritative once written: resolving a new
	// schedule choice must not reinterpret an existing runtime row. This pins
	// the rule at the predicate level — callers must pass the runtime row's
	// own model, never re-resolve from the schedule.
	existing := TimingModelCohortSection
	if IsSatPersonal(existing) {
		t.Fatalf("existing cohort runtime must not read as personal")
	}
	if !IsCohortTimed(existing) {
		t.Fatalf("existing cohort runtime must stay cohort-timed")
	}
}

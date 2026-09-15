package runtime

// Timing models an exam runtime can be scheduled under. This is the only place
// the strings are allowed to live, so a predicate and its SQL IN-list cannot
// drift apart (they did: the client and the server each re-spelled the pair in
// a dozen places, and two of them tested only one model).
//
//   - legacy_section_v1: per-module clocks. The student's module timer is the
//     expiry authority; there is no shared section deadline and no authored
//     gap between sections.
//   - cohort_stage_v2: server-owned section clock. Stage keys are
//     "<section>:m1"/"<section>:m2".
//   - cohort_section_v3: server-owned section clock and the authored gap
//     between sections is observed. The stage key IS the section key.
const (
	TimingModelLegacy        = "legacy_section_v1"
	TimingModelCohortStage   = "cohort_stage_v2"
	TimingModelCohortSection = "cohort_section_v3"
)

// CohortTimingModelsSQL is the IN-list matching [IsCohortTimed]. Interpolate it
// into a query instead of re-spelling the pair, so a query and the Go
// predicate that guards the same branch cannot disagree.
const CohortTimingModelsSQL = "'" + TimingModelCohortStage + "', '" + TimingModelCohortSection + "'"

// IsCohortTimed reports whether the model runs on the server-owned section
// clock (a shared section deadline plus the authored between-sections gap)
// rather than a per-module timer.
func IsCohortTimed(model string) bool {
	return model == TimingModelCohortStage || model == TimingModelCohortSection
}

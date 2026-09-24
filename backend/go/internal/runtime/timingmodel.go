package runtime

import "strings"

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
	// TimingModelPersonal is the attempt-owned SAT timing model: module and
	// break deadlines belong to each attempt. An idempotent, server-issued
	// future start lets the browser load the next surface before its clock
	// begins; a missed start is rearmed before the surface becomes active.
	TimingModelPersonal = "sat_personal_v1"
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

// IsPersonalClockTimed reports whether the model gives the module its own
// pausable clock that proctor pause/resume must stop and credit (see
// delivery.reconcileCohortSectionExpiredTx: cohort_section_v3 keeps a personal
// module clock alongside the section clock; legacy has nothing else).
func IsPersonalClockTimed(model string) bool {
	return model == TimingModelLegacy || model == TimingModelCohortSection || model == TimingModelPersonal
}

// PersonalClockModelsSQL is the IN-list matching [IsPersonalClockTimed].
const PersonalClockModelsSQL = "'" + TimingModelLegacy + "', '" + TimingModelCohortSection + "', '" + TimingModelPersonal + "'"

// IsSatPersonal reports whether the model is the attempt-owned SAT timing
// model. Null/empty (old rows) never matches: existing schedules with no
// choice remain on the deployed cohort model.
func IsSatPersonal(model string) bool {
	return model == TimingModelPersonal
}

// ProviderTimingModel resolves the timing model a schedule runs under BEFORE
// any exam_session_runtimes row exists (the pre-start projection).
//
// SAT is cohort-timed from the first second: its pre-start model is
// cohort_section_v3 (the server owns the section clock) and its pre-start
// status is not_started. Every other provider keeps the legacy per-module
// clock, whose attempts have no cohort runtime to wait for.
//
// This is the single owner of that rule: the proctor session projection, the
// student bootstrap projection, and the scheduling plan all read it, so the
// proctor dashboard and the student client cannot answer "what does this
// schedule look like before it starts?" differently.
func ProviderTimingModel(providerKey string) string {
	if strings.EqualFold(strings.TrimSpace(providerKey), "sat") {
		return TimingModelCohortSection
	}
	return TimingModelLegacy
}

// ResolveTimingModel applies a stored schedule choice over the provider
// default. Empty/unknown choices keep the deployed model so old rows (NULL)
// and existing runtime rows never change meaning in flight.
func ResolveTimingModel(providerKey, scheduleChoice string) string {
	choice := strings.TrimSpace(scheduleChoice)
	switch choice {
	case TimingModelPersonal, TimingModelCohortSection, TimingModelCohortStage, TimingModelLegacy:
		// Only SAT may select the personal model; other providers keep their
		// default even if a stale choice names it.
		if choice == TimingModelPersonal && !strings.EqualFold(strings.TrimSpace(providerKey), "sat") {
			return ProviderTimingModel(providerKey)
		}
		return choice
	default:
		return ProviderTimingModel(providerKey)
	}
}

// IsPreStartCohort reports whether a schedule with no runtime row yet is
// cohort-timed — i.e. whether "no row" means not_started rather than "live
// legacy attempt".
func IsPreStartCohort(providerKey string) bool {
	return IsCohortTimed(ProviderTimingModel(providerKey))
}

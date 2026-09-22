package exams

import "strings"

// CandidateSectionSeconds is the candidate-facing length of one adaptive
// section: the base module plus the LONGER of the two adaptive branches.
//
// A candidate sits Module 1 and then exactly ONE Module 2 — the lower or the
// higher branch, chosen by the routing policy — so the section's authored
// length is base + max(lower, higher). Summing every authored module
// overstates the longest real sitting by a whole branch, and because the SAT
// runtime clocks a section from assessment_sections.duration_seconds
// (schedules.runtimePlanIn -> exam_session_runtime_sections
// .planned_duration_minutes -> the student's countdown), that overstatement
// reached the exam clock.
//
// This is the one owner of the rule. The write side (sat_initialization.go for
// blueprint init, authoring/delivery_settings.go for every delivery-settings
// save) writes assessment_sections.duration_seconds from it, and every clock
// reader goes through its guard (CandidateSectionSecondsForRoles, or
// AdaptiveRoleSeconds for readers that scan module rows), so the runtime plan
// and the proctor exam-plan projection cannot derive two lengths.
//
// Copies that cannot call Go are pinned to this file by parity tests instead of
// being trusted: migration 0067 (cmd/migrate/repair_0067_parity_test.go) and
// the release summary SQL (internal/release/candidate_length_parity_test.go)
// execute their SQL against this file's numbers, and the client's
// candidateSecondsForSection is pinned by releaseSelectors.test.ts.
func CandidateSectionSeconds(baseSeconds, lowerSeconds, higherSeconds int) int {
	longest := lowerSeconds
	if higherSeconds > longest {
		longest = higherSeconds
	}
	if longest < 0 {
		longest = 0
	}
	if baseSeconds < 0 {
		baseSeconds = 0
	}
	return baseSeconds + longest
}

// CandidateSectionSecondsForRoles is the single owner of the adaptive-section
// guard: a section proves a candidate length only when it has a positive base
// module and at least one positive branch, and the length is then the base plus
// the LONGER branch. Readers reach it by folding scanned module rows through
// AdaptiveRoleSeconds (whose CandidateSeconds delegates here), so the guard is
// never restated per reader.
func CandidateSectionSecondsForRoles(baseSeconds, lowerSeconds, higherSeconds int) (int, bool) {
	if baseSeconds <= 0 || (lowerSeconds <= 0 && higherSeconds <= 0) {
		return 0, false
	}
	return CandidateSectionSeconds(baseSeconds, lowerSeconds, higherSeconds), true
}

// AdaptiveRoleSeconds is one adaptive section's authored module seconds split
// by role. Readers that scan assessment_modules rows fold them in with
// AddModule, so the role vocabulary and the length rule stay here instead of
// being restated per reader.
type AdaptiveRoleSeconds struct {
	Base   int
	Lower  int
	Higher int
}

// AddModule records one module row. The role is matched the way the SQL this
// fold replaced matched it: under the column's utf8mb4_0900_ai_ci collation,
// so ASCII role names are case-insensitive ('BASE' is base) while whitespace
// stays significant (NO PAD: ' base ' matches nothing, and the schema's CHECK
// rejects it outright). Roles outside the adaptive vocabulary — including the
// permitted non-adaptive 'none' — contribute nothing. A role that appears more
// than once keeps the LARGEST value — the choice migration 0067's MAX(CASE ...)
// and the release summary's GREATEST(...) already made, so a stray smaller row
// can never shorten a clock.
func (r *AdaptiveRoleSeconds) AddModule(role string, seconds int) {
	switch strings.ToLower(role) {
	case "base":
		if seconds > r.Base {
			r.Base = seconds
		}
	case "lower_branch":
		if seconds > r.Lower {
			r.Lower = seconds
		}
	case "higher_branch":
		if seconds > r.Higher {
			r.Higher = seconds
		}
	}
}

// CandidateSeconds returns the candidate-facing length of the section and
// whether its shape proves one.
func (r AdaptiveRoleSeconds) CandidateSeconds() (int, bool) {
	return CandidateSectionSecondsForRoles(r.Base, r.Lower, r.Higher)
}

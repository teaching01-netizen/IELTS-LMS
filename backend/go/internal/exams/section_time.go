package exams

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
// This is the one owner of the rule on the write side:
// sat_initialization.go (blueprint init) and authoring/delivery_settings.go
// (every delivery-settings save) both write
// assessment_sections.duration_seconds from it. The release summary SQL
// (internal/release/service.go) and the client's candidateSecondsForSection
// compute the same value.
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

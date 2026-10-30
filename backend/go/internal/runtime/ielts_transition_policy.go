package runtime

import "time"

// ResponseSaveGrace is the save-only window after a section clock reaches
// zero. attempts.ResponseSaveGrace aliases it so writability and V2
// activation eligibility cannot drift apart.
const ResponseSaveGrace = 3 * time.Second

// IELTSNextSectionEligibleAt is the V2 (cohort personal) earliest start of a
// subsequent section: the candidate's previous deadline plus the save grace
// and authored gap, never before the room released the section. No release
// means not eligible. Pure arithmetic: no locks, writes, or authorization.
func IELTSNextSectionEligibleAt(previousDeadline time.Time, gapMinutes int, roomRelease *time.Time) (time.Time, bool) {
	if roomRelease == nil {
		return time.Time{}, false
	}
	eligible := previousDeadline.UTC().Add(ResponseSaveGrace + time.Duration(gapMinutes)*time.Minute)
	if release := roomRelease.UTC(); release.After(eligible) {
		eligible = release
	}
	return eligible, true
}

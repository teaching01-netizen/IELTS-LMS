package delivery

import (
	"strings"

	"example.com/ielts-proctoring/internal/sat"
)

// Student result release policy (design decision D2).
//
// ONE predicate decides whether a student-facing projection may carry score
// fields. The bootstrap is the only student-facing result surface that talks
// to the attempt owner, so the rule lives next to the projection it protects
// rather than in a handler or the client.
//
// Default is withhold: a status that is not listed as student-visible gets the
// receipt projection (identity, outcome, release status) and no score fields at
// all. Fail closed on an unknown provider, an unknown status and a NULL status.
//
// Practice opt-in: a practice sitting may be configured to release immediately,
// but that is a stored per-sitting policy the product has not defined yet. When
// it exists it belongs in this table (or as an extra argument to
// StudentResultScoreVisible) - never as a second rule somewhere else.
//
// Current state worth knowing: SAT results materialize as `pending` (submitted)
// or `invalidated` (terminated) and no release step currently publishes a SAT
// result to `released`. Withholding therefore means a SAT candidate sees a
// completion receipt and no score, which is what the shipped client already
// does - SatCompleteScreen renders no score fields at all.
const studentVisibleReleasedStatus = "released"

var studentVisibleScoreStatuses = map[string]map[string]bool{
	"sat": {studentVisibleReleasedStatus: true},
	"act": {studentVisibleReleasedStatus: true},
}

// StudentResultScoreVisible reports whether score fields may be exposed to the
// attempt owner for this release status. Unknown providers and unknown or empty
// statuses fail closed (false).
func StudentResultScoreVisible(providerKey, releaseStatus string) bool {
	status := strings.ToLower(strings.TrimSpace(releaseStatus))
	if status == "" {
		return false
	}
	provider := strings.ToLower(strings.TrimSpace(providerKey))
	visible, known := studentVisibleScoreStatuses[provider]
	if !known {
		return status == studentVisibleReleasedStatus
	}
	return visible[status]
}

// studentSafeBootstrapResult applies the release policy to a terminal attempt's
// result. A released result is returned unchanged; anything else becomes the
// receipt projection.
//
// The receipt projection is deliberately NOT nil: the SAT student client uses
// `result != null` as its completion signal (useSatExamController gates the
// complete phase on `data.result`), and it reads the submission receipt
// independently of grading readiness. Withholding must remove score fields,
// never the fact that the attempt is over.
func studentSafeBootstrapResult(providerKey string, result any) any {
	switch typed := result.(type) {
	case nil:
		return nil
	case *sat.AssessmentResult:
		if typed == nil || StudentResultScoreVisible(providerKey, typed.ReleaseStatus) {
			return typed
		}
		return satReceiptProjection(typed)
	case map[string]any:
		if typed == nil || StudentResultScoreVisible(providerKey, stringMapField(typed, "releaseStatus")) {
			return typed
		}
		return actReceiptProjection(typed)
	default:
		return result
	}
}

// satReceiptProjection is the receipt-only SAT projection: the same wire type
// so clients need no new DTO, with every score-bearing field dropped.
func satReceiptProjection(in *sat.AssessmentResult) *sat.AssessmentResult {
	return &sat.AssessmentResult{
		ID:            in.ID,
		SubmissionID:  in.SubmissionID,
		AttemptID:     in.AttemptID,
		ProviderKey:   in.ProviderKey,
		OutcomeStatus: in.OutcomeStatus,
		ReleaseStatus: in.ReleaseStatus,
		// ScoreKind, TotalScore, ScorePayload and Sections are intentionally
		// absent: a withheld result must carry no partial score signal.
	}
}

// actReceiptProjection is the receipt-only ACT projection. ACT bootstraps a
// free-form map, so the receipt keeps only the identity + outcome keys and
// drops scorePayload/totalScore.
func actReceiptProjection(in map[string]any) map[string]any {
	out := make(map[string]any, 5)
	for _, key := range []string{"id", "submissionId", "attemptId", "providerKey", "outcomeStatus", "releaseStatus"} {
		if value, ok := in[key]; ok {
			out[key] = value
		}
	}
	return out
}

func stringMapField(in map[string]any, key string) string {
	if value, ok := in[key].(string); ok {
		return value
	}
	return ""
}

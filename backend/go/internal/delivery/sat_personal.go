package delivery

import (
	"time"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// Stage labels for the personal-timing funnel. Closed vocabulary: the metric
// labels never carry a candidate, attempt, or schedule id.
const (
	personalStageModule = "module"
	personalStageBreak  = "break"
)

// recordPersonalOffer counts one offer lifecycle transition for a stage.
func recordPersonalOffer(stage, event string) {
	telemetry.IncCounter(telemetry.MSATPersonalOfferTotal, "stage", stage, "event", event)
}

// recordPersonalEntry counts one entry-confirmation outcome for a stage.
func recordPersonalEntry(stage, result string) {
	telemetry.IncCounter(telemetry.MSATPersonalEntryTotal, "stage", stage, "result", result)
}

// recordPersonalFrameLead records how much of the authored stage a candidate
// actually received: the seconds between the server-issued start and the first
// acknowledged active frame. Negative means the frame became active after its
// clock began — time the candidate lost — which is the release-gate alarm
// (plan 2026-09-24, 7.2). The gauge keeps the last observation for context; the
// counter is what pages.
func recordPersonalFrameLead(stage string, startsAt, enteredAt time.Time) {
	lead := int(startsAt.Sub(enteredAt) / time.Second)
	telemetry.SetGauge(telemetry.MSATPersonalFrameLeadSeconds, float64(lead), "stage", stage)
	if lead < 0 {
		telemetry.IncCounter(telemetry.MSATPersonalFrameLateTotal, "stage", stage)
	}
}

// SAT personal timing (sat_personal_v1): attempt-owned module and break
// deadlines. The authored module/break time begins at a server-issued
// startsAt in the future. The server's deadlineAt is exactly
// startsAt + authoredSeconds, adjusted only by authorized pause/extension
// rules. Reloads resume the original deadline; they never reset it.

// personalOfferLeadSeconds is the short lead (initially three seconds) added
// to database time when arming a future-start offer.
//
// The authored window is anchored to the server's own instant, never to a
// request or render time: the offer is armed at DATE_ADD(UTC_TIMESTAMP(6), lead)
// and enterModule sets started_at = entry_starts_at, so the deadline the
// candidate lands on is exactly startsAt + the authored allotment
// (computeModuleTiming derives it from started_at + allocated_seconds).
const personalOfferLeadSeconds = 3

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
// deadlines. The normal path is single-operation and immediate: StartModule
// sets started_at = DB NOW and the server's deadlineAt is exactly
// started_at + authoredSeconds, adjusted only by authorized pause/extension
// rules. Reloads resume the original deadline; they never reset it. M1→M2
// and break→next-M1 are server-driven (finalize + break-expiry activate the
// next module atomically); the client renders authoritative state only.

// personalOfferLeadSeconds is deprecated: the normal module/break path no
// longer arms future-start offers. It remains only for the deprecated
// StartBreak/EnterBreak and armPersonalModuleOfferTx offer paths, which are
// retained backward-compatibly until the follow-up cleanup migration removes
// the entry_* columns.
const personalOfferLeadSeconds = 3

package authoringcoedit

import (
	"strings"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// Outcome is the closed outcome vocabulary shared by the co-edit Go counters.
// Anything outside it normalizes to "other" so a caller passing an id cannot
// open a cardinality hole.
type Outcome string

const (
	OutcomeAccepted    Outcome = "accepted"
	OutcomeRejected    Outcome = "rejected"
	OutcomeConflict    Outcome = "conflict"
	OutcomeClosed      Outcome = "closed"
	OutcomeFrozen      Outcome = "frozen"
	OutcomeUnavailable Outcome = "unavailable"
	OutcomeOversized   Outcome = "oversized"
	OutcomeOther       Outcome = "other"
)

func normalizeOutcome(raw string) string {
	switch Outcome(strings.TrimSpace(raw)) {
	case OutcomeAccepted, OutcomeRejected, OutcomeConflict, OutcomeClosed,
		OutcomeFrozen, OutcomeUnavailable, OutcomeOversized:
		return string(Outcome(strings.TrimSpace(raw)))
	default:
		return string(OutcomeOther)
	}
}

// LifecycleReason is the closed lifecycle label: a close reason or "n/a".
func normalizeReason(raw string) string {
	if CloseReason(strings.TrimSpace(raw)).Valid() {
		return strings.TrimSpace(raw)
	}
	return "other"
}

// EmitToken records one token issuance attempt.
func EmitToken(outcome Outcome) {
	telemetry.IncCounter(telemetry.MCoeditTokenTotal, "outcome", normalizeOutcome(string(outcome)))
}

// EmitStore records one store-endpoint outcome (the Go transaction result, not
// the WebSocket delivery outcome).
func EmitStore(outcome Outcome) {
	telemetry.IncCounter(telemetry.MCoeditGoStoreTotal, "outcome", normalizeOutcome(string(outcome)))
}

// EmitFieldPatch records one partial non-collaborative field patch outcome.
func EmitFieldPatch(outcome Outcome) {
	telemetry.IncCounter(telemetry.MCoeditGoFieldPatchTotal, "outcome", normalizeOutcome(string(outcome)))
}

// EmitGuard records one legacy-write guard decision. "accepted" means the
// legacy write was allowed because no active room exists; "conflict" means it
// was refused with COEDIT_ACTIVE.
func EmitGuard(outcome Outcome) {
	telemetry.IncCounter(telemetry.MCoeditGoGuardTotal, "outcome", normalizeOutcome(string(outcome)))
}

// EmitLifecycle records one destructive lifecycle operation by reason.
func EmitLifecycle(reason CloseReason, outcome Outcome) {
	telemetry.IncCounter(telemetry.MCoeditGoLifecycleTotal,
		"reason", normalizeReason(string(reason)), "outcome", normalizeOutcome(string(outcome)))
}

// EmitManifestMismatch records a freeze manifest that did not match MySQL.
// This is correctness-adjacent: publish is halted when it fires.
func EmitManifestMismatch() {
	telemetry.IncCounter(telemetry.MCoeditGoFreezeManifestMis, "outcome", string(OutcomeConflict))
}

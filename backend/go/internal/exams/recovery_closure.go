package exams

// Closure eligibility for staff-assisted exam recovery.
//
// The feature may reopen a sitting only when the trusted closure record proves
// the sitting ended because its clock ran out. Student submission, proctor
// control, cancellation and unknown legacy closures never become eligible by
// waiting for a deadline: submitted_at/delivery_status alone are not
// provenance. This file owns the classification so the HTTP surface, the
// issuance transaction and the terminalization reopen path cannot disagree
// about what "timed out" means.

import "strings"

// RecoveryClosureClass is the conservative classification of a closure.
type RecoveryClosureClass string

const (
	// RecoveryClosureLive: the sitting is still open. A device transfer does
	// not need to reopen a terminal generation.
	RecoveryClosureLive RecoveryClosureClass = "live"
	// RecoveryClosureTimeExpired: the trusted closure record proves the
	// attempt or the selected stage ended by its clock.
	RecoveryClosureTimeExpired RecoveryClosureClass = "time_expired"
	// RecoveryClosureManuallySubmitted: the student explicitly submitted.
	RecoveryClosureManuallySubmitted RecoveryClosureClass = "manually_submitted"
	// RecoveryClosureControlledEnd: a proctor action, cancellation or another
	// authoritative administrative stop closed the sitting.
	RecoveryClosureControlledEnd RecoveryClosureClass = "controlled_end"
	// RecoveryClosureUnknown: the record is missing or contradictory. The
	// feature fails closed instead of guessing.
	RecoveryClosureUnknown RecoveryClosureClass = "unknown"
)

// Stable staff-visible detail reasons. The HTTP layer maps these onto the
// existing error envelope; they are not new base error codes.
const (
	RecoveryReasonIneligible     = "RECOVERY_INELIGIBLE"
	RecoveryReasonManualSubmit   = "RECOVERY_MANUAL_SUBMIT"
	RecoveryReasonControlledEnd  = "RECOVERY_CONTROLLED_END"
	RecoveryReasonTargetRequired = "RECOVERY_TARGET_REQUIRED"
)

// Attempt and stage closure reasons owned by the lifecycle vocabulary.
const (
	closureReasonStudentSubmit   = "student_submit"
	closureReasonSATComplete     = "sat_complete"
	closureReasonTimeExpired     = "time_expired"
	closureReasonAutoStop        = "auto_stop"
	closureReasonProctorComplete = "proctor_complete"
	closureReasonProctorEnd      = "proctor_end"
	closureReasonProctorForceSub = "proctor_force_submit"
	closureReasonProctorTerm     = "proctor_terminate"
	closureReasonLegacyUnknown   = "legacy_unknown"
)

// ClosureFacts is the trusted evidence available while classifying one
// attempt and the stage the operator selected.
//
// ReceiptReason is the immutable attempt terminalization reason for the
// current generation. TargetReason is the selected module/timeline
// completion reason. For SAT, a sat_complete receipt is only eligible when
// the selected stage itself proves time_expired: students who finish early
// also seal with sat_complete, and their work must stay final.
type ClosureFacts struct {
	Provider      string
	Open          bool
	ReceiptReason string
	TargetReason  string

	// Attempt-level blockers. These are set from trusted rows (terminal
	// receipt actor/reason, proctor status, cancellation state), never guessed
	// from elapsed wall time.
	StudentSubmitted bool
	ProctorEnded     bool
	Cancelled        bool
	UnknownClosure   bool

	// Stage-level blockers for the focused target.
	TargetManualSubmit  bool
	TargetControlledEnd bool
	TargetUnknown       bool
}

// RecoveryEligibility is the classified result.
type RecoveryEligibility struct {
	Eligible bool                 `json:"eligible"`
	Class    RecoveryClosureClass `json:"class"`
	Reason   string               `json:"reason,omitempty"`
}

// ClassifyRecoveryClosure applies the provenance rules. Blockers win over a
// time_expired-looking clock: contradictory evidence is ineligible.
func ClassifyRecoveryClosure(facts ClosureFacts) RecoveryEligibility {
	provider := strings.ToLower(strings.TrimSpace(facts.Provider))
	switch provider {
	case "ielts", "sat", "act":
	default:
		return ineligible(RecoveryClosureUnknown, RecoveryReasonIneligible)
	}
	receipt := normalizeClosureReason(facts.ReceiptReason)
	target := normalizeClosureReason(facts.TargetReason)

	switch {
	case facts.Cancelled || facts.ProctorEnded:
		return ineligible(RecoveryClosureControlledEnd, RecoveryReasonControlledEnd)
	case facts.StudentSubmitted || facts.TargetManualSubmit || target == closureReasonStudentSubmit:
		return ineligible(RecoveryClosureManuallySubmitted, RecoveryReasonManualSubmit)
	case facts.TargetControlledEnd || isControlledClosureReason(target):
		return ineligible(RecoveryClosureControlledEnd, RecoveryReasonControlledEnd)
	case facts.TargetUnknown || facts.UnknownClosure || target == closureReasonLegacyUnknown:
		return ineligible(RecoveryClosureUnknown, RecoveryReasonIneligible)
	}

	if facts.Open {
		// The sitting is live. Selecting a stage that previously timed out is
		// the normal rewind case; otherwise the transfer only changes devices.
		if target == closureReasonTimeExpired {
			return RecoveryEligibility{Eligible: true, Class: RecoveryClosureTimeExpired}
		}
		return RecoveryEligibility{Eligible: true, Class: RecoveryClosureLive}
	}

	switch receipt {
	case closureReasonTimeExpired:
		return RecoveryEligibility{Eligible: true, Class: RecoveryClosureTimeExpired}
	case closureReasonSATComplete:
		// SAT seals every completed sitting as sat_complete. Only the focused
		// stage's own timeout reason proves this is a timeout closure.
		if target == closureReasonTimeExpired {
			return RecoveryEligibility{Eligible: true, Class: RecoveryClosureTimeExpired}
		}
		return ineligible(RecoveryClosureUnknown, RecoveryReasonIneligible)
	case closureReasonStudentSubmit:
		return ineligible(RecoveryClosureManuallySubmitted, RecoveryReasonManualSubmit)
	case closureReasonAutoStop, closureReasonProctorComplete, closureReasonProctorEnd,
		closureReasonProctorForceSub, closureReasonProctorTerm:
		return ineligible(RecoveryClosureControlledEnd, RecoveryReasonControlledEnd)
	default:
		// legacy_unknown, a missing receipt, or an unrecognised reason: never
		// infer a timeout from elapsed time or from submitted_at.
		return ineligible(RecoveryClosureUnknown, RecoveryReasonIneligible)
	}
}

// EligibleForStaffRecovery is the boolean convenience used by guards.
func EligibleForStaffRecovery(facts ClosureFacts) bool {
	return ClassifyRecoveryClosure(facts).Eligible
}

func ineligible(class RecoveryClosureClass, reason string) RecoveryEligibility {
	return RecoveryEligibility{Eligible: false, Class: class, Reason: reason}
}

func normalizeClosureReason(reason string) string {
	return strings.ToLower(strings.TrimSpace(reason))
}

func isControlledClosureReason(reason string) bool {
	switch reason {
	case closureReasonAutoStop, closureReasonProctorComplete, closureReasonProctorEnd,
		closureReasonProctorForceSub, closureReasonProctorTerm:
		return true
	default:
		return false
	}
}

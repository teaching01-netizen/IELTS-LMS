package delivery

import (
	examdomain "example.com/ielts-proctoring/internal/exams"
	"strings"
)

type RecoveryClosureClass = examdomain.RecoveryClosureClass
type ClosureFacts = examdomain.ClosureFacts
type RecoveryEligibility = examdomain.RecoveryEligibility

const (
	RecoveryClosureLive              = examdomain.RecoveryClosureLive
	RecoveryClosureTimeExpired       = examdomain.RecoveryClosureTimeExpired
	RecoveryClosureManuallySubmitted = examdomain.RecoveryClosureManuallySubmitted
	RecoveryClosureControlledEnd     = examdomain.RecoveryClosureControlledEnd
	RecoveryClosureUnknown           = examdomain.RecoveryClosureUnknown
	RecoveryReasonIneligible         = examdomain.RecoveryReasonIneligible
	RecoveryReasonManualSubmit       = examdomain.RecoveryReasonManualSubmit
	RecoveryReasonControlledEnd      = examdomain.RecoveryReasonControlledEnd
	RecoveryReasonTargetRequired     = examdomain.RecoveryReasonTargetRequired
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

func ClassifyRecoveryClosure(facts ClosureFacts) RecoveryEligibility {
	return examdomain.ClassifyRecoveryClosure(facts)
}
func EligibleForStaffRecovery(facts ClosureFacts) bool {
	return examdomain.EligibleForStaffRecovery(facts)
}
func normalizeClosureReason(reason string) string { return strings.ToLower(strings.TrimSpace(reason)) }

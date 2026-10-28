package delivery

import "testing"

// The plan's representative table is the acceptance oracle: every case must
// classify exactly, not merely return a boolean that happens to match.
func TestEligibleForStaffRecoveryRepresentativeTable(t *testing.T) {
	for _, tc := range []struct {
		name    string
		facts   ClosureFacts
		allowed bool
		class   RecoveryClosureClass
		reason  string
	}{
		{"live", ClosureFacts{Provider: "act", Open: true}, true, RecoveryClosureLive, ""},
		{"expired", ClosureFacts{Provider: "act", ReceiptReason: "time_expired"}, true, RecoveryClosureTimeExpired, ""},
		{"manual", ClosureFacts{Provider: "ielts", ReceiptReason: "student_submit"}, false, RecoveryClosureManuallySubmitted, RecoveryReasonManualSubmit},
		{"sat-timeout", ClosureFacts{Provider: "sat", ReceiptReason: "sat_complete", TargetReason: "time_expired"}, true, RecoveryClosureTimeExpired, ""},
		{"sat-forced", ClosureFacts{Provider: "sat", ReceiptReason: "sat_complete", TargetReason: "proctor_end"}, false, RecoveryClosureControlledEnd, RecoveryReasonControlledEnd},
		{"unknown", ClosureFacts{Provider: "ielts", ReceiptReason: "legacy_unknown"}, false, RecoveryClosureUnknown, RecoveryReasonIneligible},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := ClassifyRecoveryClosure(tc.facts)
			if got.Eligible != tc.allowed {
				t.Fatalf("eligible = %v, want %v (%+v)", got.Eligible, tc.allowed, got)
			}
			if got.Class != tc.class {
				t.Fatalf("class = %q, want %q", got.Class, tc.class)
			}
			if got.Reason != tc.reason {
				t.Fatalf("reason = %q, want %q", got.Reason, tc.reason)
			}
		})
	}
}

func TestClassifyRecoveryClosureFailsClosedOnSATCompleteAlone(t *testing.T) {
	// sat_complete is also written when the student finishes early. Without a
	// timed-out focused stage there is no timeout provenance.
	for _, target := range []string{"", "student_submit", "locked", "submitted"} {
		got := ClassifyRecoveryClosure(ClosureFacts{Provider: "sat", ReceiptReason: "sat_complete", TargetReason: target})
		if got.Eligible {
			t.Fatalf("target reason %q made an early SAT completion recoverable: %+v", target, got)
		}
	}
}

func TestClassifyRecoveryClosureBlockerPrecedence(t *testing.T) {
	// Contradictory records (a timeout-looking clock plus an explicit stop)
	// are ineligible; the most authoritative blocker wins.
	tests := []struct {
		name  string
		facts ClosureFacts
		class RecoveryClosureClass
	}{
		{"cancelled beats timeout", ClosureFacts{Provider: "ielts", ReceiptReason: "time_expired", Cancelled: true}, RecoveryClosureControlledEnd},
		{"proctor end beats timeout", ClosureFacts{Provider: "ielts", ReceiptReason: "time_expired", ProctorEnded: true}, RecoveryClosureControlledEnd},
		{"student submit beats timeout", ClosureFacts{Provider: "act", ReceiptReason: "time_expired", StudentSubmitted: true}, RecoveryClosureManuallySubmitted},
		{"target submit beats open", ClosureFacts{Provider: "sat", Open: true, TargetManualSubmit: true}, RecoveryClosureManuallySubmitted},
		{"target control beats open", ClosureFacts{Provider: "sat", Open: true, TargetControlledEnd: true}, RecoveryClosureControlledEnd},
		{"target unknown beats open", ClosureFacts{Provider: "sat", Open: true, TargetUnknown: true}, RecoveryClosureUnknown},
		{"legacy unknown", ClosureFacts{Provider: "ielts", ReceiptReason: "legacy_unknown"}, RecoveryClosureUnknown},
		{"missing receipt", ClosureFacts{Provider: "ielts"}, RecoveryClosureUnknown},
		{"unknown receipt", ClosureFacts{Provider: "act", ReceiptReason: "mystery"}, RecoveryClosureUnknown},
		{"unknown provider", ClosureFacts{Provider: "toefl", ReceiptReason: "time_expired"}, RecoveryClosureUnknown},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := ClassifyRecoveryClosure(tc.facts); got.Eligible || got.Class != tc.class {
				t.Fatalf("got %+v, want class %q and ineligible", got, tc.class)
			}
		})
	}
}

func TestClassifyRecoveryClosureControlledReasons(t *testing.T) {
	for _, reason := range []string{"auto_stop", "proctor_complete", "proctor_end", "proctor_force_submit", "proctor_terminate"} {
		got := ClassifyRecoveryClosure(ClosureFacts{Provider: "ielts", ReceiptReason: reason})
		if got.Eligible || got.Class != RecoveryClosureControlledEnd {
			t.Fatalf("reason %q classified as %+v", reason, got)
		}
	}
}

func TestClassifyRecoveryClosureOpenEarlierStageTimeout(t *testing.T) {
	// The whole sitting is live but the operator rewinds an earlier stage that
	// provably timed out after automatic advancement.
	got := ClassifyRecoveryClosure(ClosureFacts{Provider: "sat", Open: true, TargetReason: "time_expired"})
	if !got.Eligible || got.Class != RecoveryClosureTimeExpired {
		t.Fatalf("got %+v", got)
	}
	// Live stage with whitespace/case variants remains live.
	got = ClassifyRecoveryClosure(ClosureFacts{Provider: " ACT ", Open: true, TargetReason: " Time_Expired "})
	if !got.Eligible || got.Class != RecoveryClosureTimeExpired {
		t.Fatalf("normalization failed: %+v", got)
	}
}

package terminalization

import (
	"strings"
	"testing"
)

func TestOutcomeCompatMatrix(t *testing.T) {
	cases := []struct {
		name     string
		existing string
		request  string
		want     bool
	}{
		{"submitted replays submitted (same reason)", OutcomeSubmitted, OutcomeSubmitted, true},
		{"submitted replays submitted (different reason ignored)", OutcomeSubmitted, OutcomeSubmitted, true},
		{"terminated replays terminated (different reason ignored)", OutcomeTerminated, OutcomeTerminated, true},
		{"submitted vs terminated conflicts", OutcomeSubmitted, OutcomeTerminated, false},
		{"terminated vs submitted conflicts", OutcomeTerminated, OutcomeSubmitted, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := OutcomeCompat(tc.existing, tc.request); got != tc.want {
				t.Fatalf("OutcomeCompat(%q,%q)=%v want %v", tc.existing, tc.request, got, tc.want)
			}
		})
	}
}

func TestOutcomeCompatIgnoresReason(t *testing.T) {
	// T4: same outcome with a different reason MUST still be compatible.
	if !OutcomeCompat(OutcomeSubmitted, OutcomeSubmitted) {
		t.Fatal("same outcome must be compatible even when reasons differ")
	}
	if OutcomeCompat(OutcomeSubmitted, OutcomeTerminated) {
		t.Fatal("different outcome must conflict even when reasons match")
	}
}

func TestClaimPredicateHasProvisionalOrBranch(t *testing.T) {
	// Missing-receipt repair covers provisional rows (submitted/post-exam/NULL/NULL),
	// so the claim predicate must retain the provisional OR-branch verbatim.
	want := "(delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL)"
	if !strings.Contains(ClaimPredicate, want) {
		t.Fatalf("ClaimPredicate %q must contain provisional OR-branch %q", ClaimPredicate, want)
	}
	if !strings.Contains(ClaimPredicate, "submitted_at IS NULL AND phase <> 'post-exam'") {
		t.Fatalf("ClaimPredicate %q must contain the primary pending branch", ClaimPredicate)
	}
}

func TestStragglerPredicateNeverUsesDeliveryStatusAlone(t *testing.T) {
	if !strings.Contains(stragglerSweepSQL, "a.submitted_at IS NOT NULL AND NOT EXISTS") {
		t.Fatalf("straggler sweep must use submitted_at IS NOT NULL AND NOT EXISTS receipt, got: %s", stragglerSweepSQL)
	}
	if strings.Contains(stragglerSweepSQL, "delivery_status") {
		t.Fatalf("straggler sweep must NEVER key on delivery_status alone, got: %s", stragglerSweepSQL)
	}
}

func TestSATGapPredicate(t *testing.T) {
	for _, want := range []string{"a.phase = 'post-exam'", "e.provider_key = 'sat'", "ar.id IS NULL", "JOIN attempt_terminalizations t ON t.attempt_id = a.id"} {
		if !strings.Contains(satGapSweepSQL, want) {
			t.Fatalf("satGapSweepSQL must contain %q, got: %s", want, satGapSweepSQL)
		}
	}
}

func TestVocabularyValidation(t *testing.T) {
	base := SealCommand{AttemptID: "a1", ScheduleID: "s1", Outcome: OutcomeSubmitted, Reason: ReasonStudentSubmit, ActorKind: ActorStudent, RequestID: "r1"}
	if err := ValidateSealCommand(base); err != nil {
		t.Fatalf("valid command rejected: %v", err)
	}
	for _, outcome := range []string{"", "complete", "SUBMITTED", "cancelled"} {
		bad := base
		bad.Outcome = outcome
		if err := ValidateSealCommand(bad); err == nil {
			t.Fatalf("outcome %q must be rejected", outcome)
		}
	}
	for _, reason := range []string{"", "student", "timeout", "proctor_warn", "unknown"} {
		bad := base
		bad.Reason = reason
		if err := ValidateSealCommand(bad); err == nil {
			t.Fatalf("reason %q must be rejected", reason)
		}
	}
	for _, actor := range []string{"", "teacher", "admin", "owner"} {
		bad := base
		bad.ActorKind = actor
		if err := ValidateSealCommand(bad); err == nil {
			t.Fatalf("actor %q must be rejected", actor)
		}
	}
	// Every spec reason validates.
	for _, reason := range []string{ReasonStudentSubmit, ReasonSATComplete, ReasonTimeExpired, ReasonAutoStop, ReasonProctorComplete, ReasonProctorEnd, ReasonProctorForceSub, ReasonProctorTerminate, ReasonLegacyUnknown} {
		ok := base
		ok.Reason = reason
		if err := ValidateSealCommand(ok); err != nil {
			t.Fatalf("reason %q must validate: %v", reason, err)
		}
	}
}

func TestSATOutcomeStatus(t *testing.T) {
	if got := SATOutcomeStatus(OutcomeTerminated, ActorProctor); got != SATInvalidatedProctor {
		t.Fatalf("terminated+proctor=%q want invalidated_proctor", got)
	}
	for _, actor := range []string{ActorStudent, ActorSystem} {
		if got := SATOutcomeStatus(OutcomeTerminated, actor); got != SATInvalidatedTimeout {
			t.Fatalf("terminated+%s=%q want invalidated_timeout", actor, got)
		}
	}
	if got := SATOutcomeStatus(OutcomeSubmitted, ActorStudent); got != SATPending {
		t.Fatalf("submitted=%q want pending", got)
	}
}

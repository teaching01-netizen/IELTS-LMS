package terminalization

// Plan I3 + T4: the seal vocabulary gate (ValidateSealCommand) is the only
// thing standing between a malformed outcome and the receipt table.
// OutcomeCompat("", "") == true is correct string equality but must be
// unreachable: ValidateSealCommand rejects unknown outcomes BEFORE any
// receipt read, so the compat call sites only ever see validated
// outcomes. This test pins: every unknown/empty outcome+reason+actor
// fails validation (fail-closed), and the two valid outcomes pass.
//
// NOTE: all pass today (no drift) — verified the test executes
// (9 bad rows each fail validation independently). The test is the
// pin: widening the vocabulary without updating the gate fails here.
import (
	"testing"
)

func TestValidateSealCommandVocabulary(t *testing.T) {
	base := SealCommand{AttemptID: "att-1", ScheduleID: "sched-1", Outcome: OutcomeSubmitted, Reason: ReasonStudentSubmit, ActorKind: ActorStudent, RequestID: "r-1"}
	if err := ValidateSealCommand(base); err != nil {
		t.Fatalf("valid seal command must pass, got %v", err)
	}
	for _, outcome := range []string{OutcomeSubmitted, OutcomeTerminated} {
		cmd := base
		cmd.Outcome = outcome
		if err := ValidateSealCommand(cmd); err != nil {
			t.Fatalf("outcome %q must pass, got %v", outcome, err)
		}
	}
	bad := []struct {
		name string
		mut  func(*SealCommand)
	}{
		{"empty outcome", func(c *SealCommand) { c.Outcome = "" }},
		{"unknown outcome", func(c *SealCommand) { c.Outcome = "archived" }},
		{"case-mismatch outcome", func(c *SealCommand) { c.Outcome = "Submitted" }},
		{"empty reason", func(c *SealCommand) { c.Reason = "" }},
		{"unknown reason", func(c *SealCommand) { c.Reason = "vibes" }},
		{"empty actor", func(c *SealCommand) { c.ActorKind = "" }},
		{"unknown actor", func(c *SealCommand) { c.ActorKind = "admin" }},
		{"empty attempt", func(c *SealCommand) { c.AttemptID = "" }},
		{"empty schedule", func(c *SealCommand) { c.ScheduleID = "" }},
	}
	for _, tc := range bad {
		cmd := base
		tc.mut(&cmd)
		if err := ValidateSealCommand(cmd); err == nil {
			t.Fatalf("%s must fail validation", tc.name)
		}
	}
	// OutcomeCompat empty-equality is unreachable-but-true: document it
	// so a future "fix" (empty->false) doesn't mask a validation hole.
	if !OutcomeCompat("", "") {
		t.Fatalf("OutcomeCompat empty equality documents validation reliance")
	}
}

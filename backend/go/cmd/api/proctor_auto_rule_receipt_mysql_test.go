package main

import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
)

// Automatic rules run in every operator's browser. The same trigger carries
// the same operation id, so a second operator (or tab, or reload) replays the
// first enforcement instead of warning or pausing the student again.
func TestAutoRuleEnforcementIsIdempotentAcrossOperatorsMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, _, _, _ := seedStaleETagExam(t, db)
	staff := proctor.NewService(tx.NewRunner(db), db, nil, nil, nil)
	first := proctor.Actor{ID: "auto-rule-operator-a", Role: "admin", CSRFVerified: true}
	second := proctor.Actor{ID: "auto-rule-operator-b", Role: "admin", CSRFVerified: true}
	message := "Auto-warning triggered by violation_count"
	warn := proctor.AttemptCommand{OperationID: "auto-rule:warn-trigger-1", Message: &message}

	for _, actor := range []proctor.Actor{first, second} {
		if err := staff.Warn(ctx, actor, schedule, attempt, warn); err != nil {
			t.Fatal(err)
		}
	}
	var warnings int
	if err := db.QueryRow("SELECT COUNT(*) FROM student_violation_events WHERE attempt_id=? AND violation_type='PROCTOR_WARNING'", attempt).Scan(&warnings); err != nil {
		t.Fatal(err)
	}
	if warnings != 1 {
		t.Fatalf("one trigger warned the student %d times", warnings)
	}

	pause := proctor.AttemptCommand{OperationID: "auto-rule:pause-trigger-1"}
	if err := staff.Pause(ctx, first, schedule, attempt, pause); err != nil {
		t.Fatal(err)
	}
	// A proctor resumes the student; another operator's view still sees the
	// same trigger and replays it.
	if err := staff.Resume(ctx, first, schedule, attempt, proctor.AttemptCommand{}); err != nil {
		t.Fatal(err)
	}
	if err := staff.Pause(ctx, second, schedule, attempt, pause); err != nil {
		t.Fatal(err)
	}
	var status string
	if err := db.QueryRow("SELECT COALESCE(proctor_status,'active') FROM student_attempts WHERE id=?", attempt).Scan(&status); err != nil {
		t.Fatal(err)
	}
	if status != "active" {
		t.Fatalf("a replayed trigger re-paused a resumed student: status=%s", status)
	}

	// Manual commands without an operation id keep their existing behaviour.
	if err := staff.Warn(ctx, first, schedule, attempt, proctor.AttemptCommand{}); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRow("SELECT COUNT(*) FROM student_violation_events WHERE attempt_id=? AND violation_type='PROCTOR_WARNING'", attempt).Scan(&warnings); err != nil {
		t.Fatal(err)
	}
	if warnings != 2 {
		t.Fatalf("manual warning count = %d, want 2", warnings)
	}
}

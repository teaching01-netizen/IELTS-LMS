package sat

// The terminal-state rule has one owner: attempts.SATModuleTerminal, which the
// SAT submit and compatibility completion gates both use.
import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// Every state the platform can store is decided by attempts.SATModuleTerminal,
// never by a rule restated here. A future edit that re-spells the rule in sat
// fails this property.
func TestFinalizerDelegatesTerminalRuleToAttempts(t *testing.T) {
	states := []string{
		"submitted", "locked",
		"active", "not_started", "review", "paused", "expired", "",
	}
	for _, state := range states {
		got := moduleStatesAcceptable([]moduleRow{{State: state}})
		want := attempts.SATModuleTerminal(state)
		if got != want {
			t.Fatalf("state %q: finalizer says %v, attempts.SATModuleTerminal says %v", state, got, want)
		}
	}
	// Mixed sets follow the same predicate, and every-state-terminal accepts.
	submitted := moduleRow{State: attempts.SATModuleSubmitted}
	locked := moduleRow{State: attempts.SATModuleLocked}
	active := moduleRow{State: "active"}
	for _, tc := range []struct {
		name string
		mods []moduleRow
		want bool
	}{
		{"both terminal", []moduleRow{submitted, locked}, true},
		{"one open", []moduleRow{submitted, active}, false},
		{"none loaded", nil, true},
	} {
		if got := moduleStatesAcceptable(tc.mods); got != tc.want {
			t.Fatalf("%s: moduleStatesAcceptable = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// Completion refuses an unfinished module before invoking the seal boundary.
func TestFinalizerRefusesUnfinishedModule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	expectCompleteAssessmentPrefix(mock, "running", "exam", "active", satTopologyRows(
		[2]string{"reading-writing", attempts.SATModuleSubmitted},
		[2]string{"reading-writing", attempts.SATModuleSubmitted},
		[2]string{"math", "active"},
	))
	mock.ExpectRollback()

	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-unfinished", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("an unfinished module must refuse finalization with CONFLICT, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

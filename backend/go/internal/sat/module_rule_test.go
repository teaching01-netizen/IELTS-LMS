package sat

// The terminal-state rule has one owner: attempts.SATModuleTerminal, which the
// V2 provisional submit gate also uses. These tests pin both halves of that
// claim — the finalizer's verdict is exactly the predicate's verdict for every
// state, and the real completion path refuses an unfinished module.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"regexp"
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

// The finalizer itself refuses an unfinished module: staged through the real
// CompleteAssessment path, one active module beside the terminal set must stop
// the completion before any scoring work.
func TestFinalizerRefusesUnfinishedModule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	satUnscopedRun(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satModules(
		[]driver.Value{"mod-rw-m1", "reading-writing", "rw-m1", "base", attempts.SATModuleSubmitted, int64(20), int64(27), int64(27)},
		[]driver.Value{"mod-rw-m2-lower", "reading-writing", "rw-m2-lower", "lower_branch", attempts.SATModuleSubmitted, int64(20), int64(27), int64(27)},
		[]driver.Value{"mod-math-m1", "math", "math-m1", "base", "active", int64(20), int64(27), int64(27)},
	))
	// No policy read, no scoring write: the refusal happens before them.
	mock.ExpectRollback()

	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-unfinished", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("an unfinished module must refuse finalization with CONFLICT, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

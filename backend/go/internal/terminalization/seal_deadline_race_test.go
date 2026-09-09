package terminalization

// Round 167 (TDD RED): the deadline storm shape — two submit requests for
// the same attempt race (client double-click / deadline retry). Both run
// the seal; the receipt PK (attempt_id) admits exactly one INSERT. The
// loser must surface the duplicate key as a *replay of the winner's
// receipt* (idempotent, Created=false) — never a raw 1062/dup-key INTERNAL
// and never a second Created=true receipt.
import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// TestDeadlineDoubleSubmitReplaysWinner pins the dup-key INSERT path:
// INSERT fails 1062 -> FindByAttemptID returns the winner's receipt ->
// seal replays (Created=false, same TerminalizationID).
func TestDeadlineDoubleSubmitReplaysWinner(t *testing.T) {
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.MatchExpectationsInOrder(true)
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("running", "active"))
	sealExpectProvider(mock, "sat")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnError(sql.ErrNoRows)
	sealExpectRecordedAt(mock)
	// SAT snapshot locks module-attempt rows FOR UPDATE before the receipt
	// INSERT (buildServerSnapshot): empty set here (no modules started).
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "started_at", "submitted_at", "locked_at", "completion_reason", "revision"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses WHERE module_attempt_id")).
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_attempt_id", "exam_question_id", "response", "marked_for_review", "eliminated_options", "annotations", "revision"}))
	dupErr := errors.New("Error 1062 (23000): Duplicate entry 'att-1' for key 'attempt_terminalizations.PRIMARY'")
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).
		WillReturnError(dupErr)
	// Loser re-reads the winner's receipt under the same tx and replays it
	// (incl. the SAT materialize read for the *existing* outcome).
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sealReceiptRow(OutcomeSubmitted, ReasonStudentSubmit))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id")).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	res, err := svc.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent))
	if err != nil {
		t.Fatalf("dup-key loser must replay winner receipt, got: %v", err)
	}
	if res.Created {
		t.Fatalf("replay must not claim Created=true: %+v", res)
	}
	if res.TerminalizationID != "term-1" {
		t.Fatalf("replay must carry winner receipt id, got: %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

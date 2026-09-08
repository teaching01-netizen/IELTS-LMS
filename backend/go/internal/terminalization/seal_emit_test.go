package terminalization

// Plan E-exam-day: the seal slice (created vs replay vs conflict) is the
// operator's terminalization proof. Fresh seals count created{accepted};
// same-outcome reseals count replay{exact_replay}; cross-outcome seals
// count conflict and fail. RED: Terminalize emits exactly one series each.
import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestSealEmitsCreatedReplayConflict(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	// 1) replay: submitted attempt + same-outcome receipt.
	db1, mock1, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db1.Close()
	svc1 := NewService(tx.NewRunner(db1), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock1)
	mock1.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("submitted", "active"))
	sealExpectProvider(mock1, "ielts")
	mock1.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sealReceiptRow(OutcomeSubmitted, ReasonStudentSubmit))
	mock1.ExpectCommit()
	if _, err := svc1.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent)); err != nil {
		t.Fatalf("replay: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MTerminalReplay, "outcome", telemetry.OutcomeExactReplay); got != 1 {
		t.Fatalf("replay must count 1, got %v", got)
	}

	// 2) conflict: same receipt, cross outcome.
	db2, mock2, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	svc2 := NewService(tx.NewRunner(db2), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock2)
	mock2.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("running", "active"))
	sealExpectProvider(mock2, "ielts")
	mock2.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sealReceiptRow(OutcomeSubmitted, ReasonStudentSubmit))
	mock2.ExpectRollback()
	if _, err := svc2.Terminalize(context.Background(), baseSealCmd(OutcomeTerminated, ReasonProctorTerminate, ActorProctor)); err == nil {
		t.Fatalf("cross-outcome must conflict")
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MTerminalConflict); got != 1 {
		t.Fatalf("conflict must count 1, got %v", got)
	}

	// 3) fresh seal counts created{accepted}.
	db3, mock3, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db3.Close()
	mock3.MatchExpectationsInOrder(true)
	svc3 := NewService(tx.NewRunner(db3), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock3)
	mock3.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("running", "active"))
	sealExpectProvider(mock3, "ielts")
	mock3.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnError(sql.ErrNoRows)
	sealExpectRecordedAt(mock3)
	mock3.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock3.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock3.ExpectExec(regexp.QuoteMeta("INSERT INTO outbox_events")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock3.ExpectCommit()
	if _, err := svc3.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent)); err != nil {
		t.Fatalf("fresh seal: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MTerminalCreated, "outcome", telemetry.OutcomeAccepted); got != 1 {
		t.Fatalf("created must count 1, got %v", got)
	}
	if err := mock3.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

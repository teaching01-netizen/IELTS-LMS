package terminalization

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func sealCodeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func lockAttemptRow(delivery, proctor string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "organization_id", "exam_id", "published_version_id",
		"phase", "delivery_status", "proctor_status", "revision", "answer_revision",
		"answers", "writing_answers", "flags",
	}).AddRow("att-1", "sched-1", nil, "exam-1", "pv-1", "exam",
		delivery, proctor, int64(4), int64(9), []byte("{}"), []byte("{}"), []byte("{}"))
}

func sealReceiptRow(outcome, reason string) *sqlmock.Rows {
	now := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"attempt_id", "organization_id", "terminalization_id", "schedule_id",
		"outcome", "reason", "actor_kind", "actor_id",
		"effective_at", "recorded_at", "answer_revision", "final_snapshot", "request_id",
	}).AddRow("att-1", nil, "term-1", "sched-1", outcome, reason,
		"student", nil, now, now, int64(9), []byte("{}"), "req-1")
}

func baseSealCmd(outcome, reason, actor string) SealCommand {
	return SealCommand{AttemptID: "att-1", ScheduleID: "sched-1",
		Outcome: outcome, Reason: reason, ActorKind: actor, RequestID: "req-new"}
}

func sealBeginUTC(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

func sealExpectProvider(mock sqlmock.Sqlmock, key string) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT provider_key FROM exam_entities")).
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow(key))
}

func sealExpectRecordedAt(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Date(2026, 3, 1, 11, 0, 0, 0, time.UTC)))
}

func TestSubmitVsTerminateCrossOutcomeConflicts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("running", "active"))
	sealExpectProvider(mock, "ielts")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sealReceiptRow(OutcomeSubmitted, ReasonStudentSubmit))
	mock.ExpectRollback()
	_, err = svc.Terminalize(context.Background(), baseSealCmd(OutcomeTerminated, ReasonProctorTerminate, ActorProctor))
	if sealCodeOf(err) != apperrors.CodeTerminalConflict {
		t.Fatalf("expected TERMINALIZATION_CONFLICT, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSameOutcomeTerminalReplay(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("submitted", "active"))
	sealExpectProvider(mock, "ielts")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sealReceiptRow(OutcomeSubmitted, ReasonStudentSubmit))
	mock.ExpectCommit()
	res, err := svc.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent))
	if err != nil {
		t.Fatalf("replay must succeed: %v", err)
	}
	if res.Created {
		t.Fatal("replay must return Created=false")
	}
	if res.TerminalizationID != "term-1" {
		t.Fatalf("replay must keep existing id, got %q", res.TerminalizationID)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRepairVsRealSealReplaysCompatibly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("submitted", "active"))
	sealExpectProvider(mock, "ielts")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sealReceiptRow(OutcomeSubmitted, ReasonLegacyUnknown))
	mock.ExpectCommit()
	res, err := svc.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent))
	if err != nil {
		t.Fatalf("real seal after repair must replay: %v", err)
	}
	if res.Created || res.Reason != ReasonLegacyUnknown {
		t.Fatalf("must replay repair receipt as-is: %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestFreshSealInsertsReceiptBeforeClaim(t *testing.T) {
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
	sealExpectProvider(mock, "ielts")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnError(sql.ErrNoRows)
	sealExpectRecordedAt(mock)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO outbox_events")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	res, err := svc.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent))
	if err != nil {
		t.Fatalf("fresh seal must succeed: %v", err)
	}
	if !res.Created || res.TerminalizationID == "" {
		t.Fatalf("fresh seal must create a receipt: %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSealClaimRaceLosesWithConflict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("running", "active"))
	sealExpectProvider(mock, "ielts")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnError(sql.ErrNoRows)
	sealExpectRecordedAt(mock)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()
	_, err = svc.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent))
	if sealCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT on lost claim race, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

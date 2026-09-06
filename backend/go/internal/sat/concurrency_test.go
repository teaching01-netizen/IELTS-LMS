package sat

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func satCodeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func satService(db *sql.DB) *Service {
	return NewService(db, tx.NewRunner(db), clock.System{}, nil)
}

func satBegin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

func satAttemptRow(delivery, phase, proctor string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "organization_id", "exam_id", "published_version_id",
		"proctor_status", "delivery_status", "phase", "answer_revision",
	}).AddRow("att-1", "sched-1", nil, "exam-sat", "pv-sat", proctor, delivery, phase, int64(3))
}

func satDBTime(mock sqlmock.Sqlmock) {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(
		sqlmock.NewRows([]string{"ts"}).AddRow(now))
}

func satNoReceipt(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
}

func TestSATProvisionalSubmitVsTerminate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"outcome"}).AddRow("terminated"))
	mock.ExpectRollback()
	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-1", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeAttemptProctorBlocked {
		t.Fatalf("expected ATTEMPT_PROCTOR_BLOCKED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATWatchdogVsDirectCompletion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"id"}).AddRow("sub-direct"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE submission_id")).WillReturnRows(
		sqlmock.NewRows([]string{"id", "attempt_id", "provider_key", "outcome_status", "total_score", "score_payload", "release_status"}).AddRow("res-1", "att-1", "sat", "scored", int64(1200), "{}", "ready_to_release"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_section_results WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"section_key", "route", "raw_correct", "operational_question_count", "scaled_score", "details"}))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	res, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-watchdog", ActorKind: "system"})
	if err != nil {
		t.Fatalf("watchdog re-seal must succeed: %v", err)
	}
	if res == nil || res.ID != "res-1" {
		t.Fatalf("must return the direct-completion result, got %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATCompletionVsTimeoutUnsealed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(
		sqlmock.NewRows([]string{"section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).AddRow("rw", "rw-m1", "routing", "submitted", int64(20), int64(27), int64(27)).AddRow("math", "math-m1", "routing", "active", nil, nil, int64(27)))
	mock.ExpectRollback()
	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-race", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT when a module is still active, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

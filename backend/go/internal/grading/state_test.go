package grading

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

func gradingCodeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func gradingSvc(db *sql.DB) *Service { return NewService(db, tx.NewRunner(db)) }

func gradingBegin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

func gradingStatusRow(status string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"grading_status"}).AddRow(status)
}

func gradingDBNow(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(
		sqlmock.NewRows([]string{"ts"}).AddRow(time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)))
}

func gradingReviewEvent(mock sqlmock.Sqlmock) {
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO review_events")).WillReturnResult(sqlmock.NewResult(1, 1))
}

// submitted -> grading_complete is the happy path (MarkComplete).
func TestGradingMarkCompleteHappyPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	gradingBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(gradingStatusRow(SubmissionSubmitted))
	gradingDBNow(mock)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_submissions SET grading_status")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE review_drafts SET release_status")).WillReturnResult(sqlmock.NewResult(0, 1))
	gradingReviewEvent(mock)
	mock.ExpectCommit()
	if err := svc.MarkComplete(context.Background(), "sub-1", "teacher-1"); err != nil {
		t.Fatalf("MarkComplete on submitted must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// released -> grading_complete is illegal: the machine moves forward
// only (released must ReopenReview first).
func TestGradingIllegalTransitionConflicts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	gradingBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(gradingStatusRow(SubmissionReleased))
	mock.ExpectRollback()
	err = svc.MarkComplete(context.Background(), "sub-1", "teacher-1")
	if gradingCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT on released->complete, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func releaseNowSubmissionRow(status string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"student_id", "student_name", "schedule_id", "published_version_id", "grading_status"}).
		AddRow("student-1", "Student One", "sched-1", "ver-1", status)
}

func releaseNowDraftRow() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"release_status", "section_drafts", "annotations", "drawings", "teacher_summary"}).
		AddRow(ReleaseReady, "{}", "[]", "[]", "{}")
}

func releaseNowAuditRows() *sqlmock.Rows {
	audit := `{"expectedQuestionCount":0,"verifiedCorrectCount":0,"verifiedIncorrectCount":0,"verifiedUnansweredCount":0,"unresolvedCount":0,"invalidCount":0,"unknownAnswerCount":0,"integrityStatus":"verified","gradingSourceVersionId":"ver-1","unknownAnswerIds":[],"issueCodes":[],"questions":[]}`
	return sqlmock.NewRows([]string{"section", "auto_grading_results"}).
		AddRow("listening", audit).
		AddRow("reading", audit)
}

func expectReleaseNowMaterialization(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM review_drafts WHERE submission_id")).WillReturnRows(releaseNowDraftRow())
	mock.ExpectQuery(regexp.QuoteMeta("SELECT schedule_id, published_version_id FROM student_submissions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"schedule_id", "published_version_id"}).AddRow("sched-1", "ver-1"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT source, version_id FROM grading_schedule_objective_grading_source")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT section, auto_grading_results FROM section_submissions")).WillReturnRows(releaseNowAuditRows())
	gradingDBNow(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT task_id, task_label, prompt, student_text, word_count")).WillReturnRows(
		sqlmock.NewRows([]string{"task_id", "task_label", "prompt", "student_text", "word_count"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, version FROM student_results WHERE submission_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE review_drafts SET release_status")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_submissions SET grading_status")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO release_events")).WillReturnResult(sqlmock.NewResult(1, 1))
	gradingReviewEvent(mock)
	mock.ExpectCommit()
}

// ready_to_release -> released creates a result snapshot and stamps both tables (ReleaseNow).
func TestGradingReleaseNowHappyPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	gradingBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(releaseNowSubmissionRow(SubmissionReadyToRelease))
	expectReleaseNowMaterialization(mock)
	if err := svc.ReleaseNow(context.Background(), "sub-1", "teacher-1"); err != nil {
		t.Fatalf("ReleaseNow on ready_to_release must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// ready_to_release without a staged row still creates the release snapshot
// atomically (ReleaseNow).
func TestGradingReleaseNowWithoutStagedResultMaterializes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	gradingBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(releaseNowSubmissionRow(SubmissionReadyToRelease))
	expectReleaseNowMaterialization(mock)
	err = svc.ReleaseNow(context.Background(), "sub-1", "teacher-1")
	if err != nil {
		t.Fatalf("ReleaseNow without staged result must materialize: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// grading_complete cannot release directly: it must pass through
// ready_to_release (MarkReadyToRelease) first.
func TestGradingReleaseSkipsStageConflicts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	gradingBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(releaseNowSubmissionRow(SubmissionGradingComplete))
	mock.ExpectRollback()
	err = svc.ReleaseNow(context.Background(), "sub-1", "teacher-1")
	if gradingCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT on grading_complete->released, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A draft that is not ready_to_release cannot schedule: the pre-check
// short-circuits with CodeConflict before any row lock (ScheduleRelease).
func TestGradingScheduleReleaseDraftConflict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	gradingBegin(mock)
	gradingDBNow(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"student_id", "student_name", "schedule_id", "published_version_id", "grading_status"}).
			AddRow("student-1", "Student One", "sched-1", "ver-1", SubmissionGradingComplete))
	mock.ExpectQuery(regexp.QuoteMeta("FROM review_drafts WHERE submission_id")).WillReturnRows(
		sqlmock.NewRows([]string{"release_status"}).AddRow(ReleaseDraft))
	mock.ExpectRollback()
	releaseAt := time.Date(2026, 4, 1, 9, 0, 0, 0, time.UTC)
	err = svc.ScheduleRelease(context.Background(), "sub-1", "teacher-1", releaseAt)
	if gradingCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT on draft->schedule-release, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// released -> reopened fans out to both tables (ReopenReview).
func TestGradingReopenHappyPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	gradingBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(gradingStatusRow(SubmissionReleased))
	gradingDBNow(mock)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_submissions SET grading_status")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_results SET release_status")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE review_drafts SET release_status")).WillReturnResult(sqlmock.NewResult(0, 1))
	gradingReviewEvent(mock)
	mock.ExpectCommit()
	if err := svc.ReopenReview(context.Background(), "sub-1", "teacher-1", "recheck"); err != nil {
		t.Fatalf("ReopenReview on released must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package grading

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func resultRow() *sqlmock.Rows {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "submission_id", "student_id", "student_name", "release_status",
		"released_at", "released_by", "scheduled_release_date", "overall_band",
		"section_bands", "listening_result", "reading_result", "writing_results",
		"speaking_result", "teacher_summary", "version", "previous_version_id",
		"revision_reason", "authorized_actor_id", "created_at", "updated_at",
	}).AddRow(
		"res-1", "sub-1", "stu-1", "Student One", "released",
		nil, nil, nil, 7.5,
		`{"overall":7.5}`, `{"band":8}`, `{"band":7}`, `{"task1":{}}`,
		nil, `{"note":"good"}`, 3, nil,
		nil, nil, now, now,
	)
}

func expectResultQuery(mock sqlmock.Sqlmock, rows *sqlmock.Rows) {
	gradingBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_results")).
		WithArgs("sub-1").WillReturnRows(rows)
}

func TestLatestSubmissionForScheduleHit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions")).
		WithArgs("sched-1").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("sub-9"))
	got, err := svc.LatestSubmissionForSchedule(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("hit must succeed: %v", err)
	}
	if got != "sub-9" {
		t.Fatalf("unexpected id: %q", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLatestSubmissionForScheduleMiss(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions")).
		WithArgs("sched-empty").WillReturnError(sql.ErrNoRows)
	if _, err := svc.LatestSubmissionForSchedule(context.Background(), "sched-empty"); !errors.Is(err, sql.ErrNoRows) {
		t.Fatalf("miss must surface sql.ErrNoRows, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLatestGradingResultHit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	expectResultQuery(mock, resultRow())
	mock.ExpectCommit()
	got, err := svc.LatestGradingResult(context.Background(), "sub-1")
	if err != nil {
		t.Fatalf("hit must succeed: %v", err)
	}
	if got["id"] != "res-1" || got["submissionId"] != "sub-1" || got["overallBand"] != 7.5 || got["version"] != 3 {
		t.Fatalf("unexpected projection: %+v", got)
	}
	if sb, ok := got["sectionBands"].(map[string]any); !ok || sb["overall"] != 7.5 {
		t.Fatalf("sectionBands not decoded: %+v", got["sectionBands"])
	}
	if got["speakingResult"] != nil {
		t.Fatalf("null speaking must decode to nil, got %+v", got["speakingResult"])
	}
	if _, ok := got["releasedAt"]; ok {
		t.Fatalf("null releasedAt must be omitted: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLatestGradingResultMiss(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	gradingBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_results")).
		WithArgs("sub-missing").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	if _, err := svc.LatestGradingResult(context.Background(), "sub-missing"); gradingCodeOf(err) != "NOT_FOUND" {
		t.Fatalf("miss must surface NOT_FOUND, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLatestGradingResultCorruptJSON(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	rows := sqlmock.NewRows([]string{
		"id", "submission_id", "student_id", "student_name", "release_status",
		"released_at", "released_by", "scheduled_release_date", "overall_band",
		"section_bands", "listening_result", "reading_result", "writing_results",
		"speaking_result", "teacher_summary", "version", "previous_version_id",
		"revision_reason", "authorized_actor_id", "created_at", "updated_at",
	}).AddRow(
		"res-1", "sub-1", "stu-1", "Student One", "released",
		nil, nil, nil, 7.5,
		`{not-json`, nil, nil, `{}`,
		nil, `{}`, 3, nil,
		nil, nil, now, now,
	)
	expectResultQuery(mock, rows)
	mock.ExpectCommit()
	_, err = svc.LatestGradingResult(context.Background(), "sub-1")
	var corrupt *ResultProjectionCorruptError
	if !errors.As(err, &corrupt) {
		t.Fatalf("corrupt JSON must return *ResultProjectionCorruptError, got %v", err)
	}
	if corrupt.Column != "section_bands" {
		t.Fatalf("unexpected column: %+v", corrupt)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

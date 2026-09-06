package grading

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func gradingSourceRows(source string, versionID *string) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"source", "version_id"})
	if versionID == nil {
		return rows.AddRow(source, nil)
	}
	return rows.AddRow(source, *versionID)
}

// Row present with source=draft_version returns the version id.
func TestGradingSourceDraftVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	version := "ver-123"
	mock.ExpectQuery(regexp.QuoteMeta("FROM grading_schedule_objective_grading_source")).
		WithArgs("sched-1").WillReturnRows(gradingSourceRows("draft_version", &version))
	got, err := svc.GradingSourceVersionID(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("draft row must load: %v", err)
	}
	if got == nil || *got != version {
		t.Fatalf("expected version %q, got %+v", version, got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Row absent yields nil (caller falls back to published_version_id).
func TestGradingSourceRowAbsent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	mock.ExpectQuery(regexp.QuoteMeta("FROM grading_schedule_objective_grading_source")).
		WithArgs("sched-1").WillReturnRows(sqlmock.NewRows([]string{"source", "version_id"}))
	got, err := svc.GradingSourceVersionID(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("absent row must not error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for absent row, got %q", *got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Row present with the wrong source yields nil.
func TestGradingSourceWrongSource(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	version := "ver-123"
	mock.ExpectQuery(regexp.QuoteMeta("FROM grading_schedule_objective_grading_source")).
		WithArgs("sched-1").WillReturnRows(gradingSourceRows("published_version", &version))
	got, err := svc.GradingSourceVersionID(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("wrong source must not error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for published_version source, got %q", *got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Blank version id yields nil even with source=draft_version.
func TestGradingSourceBlankVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	blank := "   "
	mock.ExpectQuery(regexp.QuoteMeta("FROM grading_schedule_objective_grading_source")).
		WithArgs("sched-1").WillReturnRows(gradingSourceRows("draft_version", &blank))
	got, err := svc.GradingSourceVersionID(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("blank version must not error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected nil for blank version, got %q", *got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

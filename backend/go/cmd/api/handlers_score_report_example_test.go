package main

import (
	"database/sql"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestScoreReportExampleVersionUsesDraftThenPublished(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	app := &App{DB: db}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("exam-draft").
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow("draft-1"))
	got, err := scoreReportExampleVersion(t.Context(), app, "exam-draft")
	if err != nil || got != "draft-1" {
		t.Fatalf("draft version: got %q err %v", got, err)
	}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("exam-none").
		WillReturnRows(sqlmock.NewRows([]string{"version"}).AddRow(nil))
	if _, err := scoreReportExampleVersion(t.Context(), app, "exam-none"); err == nil {
		t.Fatal("an exam with no draft and no published version must be refused")
	} else if typed, ok := apperrors.As(err); !ok || typed.Code != apperrors.CodeValidation {
		t.Fatalf("want validation, got %v", err)
	}

	mock.ExpectQuery("SELECT COALESCE").WithArgs("exam-missing").WillReturnError(sql.ErrNoRows)
	if _, err := scoreReportExampleVersion(t.Context(), app, "exam-missing"); err == nil {
		t.Fatal("a missing exam must be refused")
	} else if typed, ok := apperrors.As(err); !ok || typed.Code != apperrors.CodeNotFound {
		t.Fatalf("want not found, got %v", err)
	}

	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package main

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	"example.com/ielts-proctoring/internal/platform/config"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func gateTestApp(t *testing.T, db *sql.DB) *App {
	t.Helper()
	cfg := config.Load()
	cfg.EntryGateEnabled = false
	return BuildApp(cfg, db)
}

func TestVerifyDirectEntryAcceptsAnyNonEmptyCodeForOpenSchedule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta("SELECT status FROM exam_schedules WHERE id = ?")).WithArgs("sched-1").WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("scheduled"))

	app := gateTestApp(t, db)
	if err := verifyDirectEntry(context.Background(), app, "sched-1", "anything-at-all"); err != nil {
		t.Fatalf("arbitrary non-empty code must be accepted, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyDirectEntryRejectsOnlyEmptyCodeOrClosedSchedule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	app := gateTestApp(t, db)
	if err := verifyDirectEntry(context.Background(), app, "sched-1", "   "); err == nil {
		t.Fatal("empty code must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	mock.ExpectQuery(regexp.QuoteMeta("SELECT status FROM exam_schedules WHERE id = ?")).WithArgs("sched-1").WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("completed"))
	if err := verifyDirectEntry(context.Background(), app, "sched-1", "anything-at-all"); err == nil {
		t.Fatal("closed schedule must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestVerifyDirectEntryDoesNotRequireAccessLinksService(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta("SELECT status FROM exam_schedules WHERE id = ?")).WithArgs("sched-1").WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))

	app := gateTestApp(t, db)
	app.AccessLinks = nil
	if err := verifyDirectEntry(context.Background(), app, "sched-1", "guest-code"); err != nil {
		t.Fatalf("direct entry must not depend on AccessLinks, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

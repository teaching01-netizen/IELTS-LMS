package main

import (
	"context"
	"database/sql/driver"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestFindPublishedFixtureExam(t *testing.T) {
	t.Run("returns the immutable published fixture version", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()

		mock.ExpectQuery("SELECT id, title, current_published_version_id").
			WithArgs(studentSlug).
			WillReturnRows(sqlmock.NewRows([]string{"id", "title", "current_published_version_id"}).
				AddRow("exam-1", "Student fixture", "published-1"))

		got, found, err := findPublishedFixtureExam(context.Background(), db, studentSlug)
		if err != nil || !found {
			t.Fatalf("findPublishedFixtureExam() = (%+v, %t, %v)", got, found, err)
		}
		if got.id != "exam-1" || got.title != "Student fixture" || got.versionID != "published-1" {
			t.Fatalf("unexpected published fixture: %+v", got)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("reports an existing fixture without a published version", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()

		mock.ExpectQuery("SELECT id, title, current_published_version_id").
			WithArgs(studentSlug).
			WillReturnRows(sqlmock.NewRows([]string{"id", "title", "current_published_version_id"}).
				AddRow("exam-1", "Incomplete fixture", nil))

		_, found, err := findPublishedFixtureExam(context.Background(), db, studentSlug)
		if !found || err == nil {
			t.Fatalf("findPublishedFixtureExam() found=%t err=%v; want found and validation error", found, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("reports query failures", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()

		mock.ExpectQuery("SELECT id, title, current_published_version_id").
			WithArgs(studentSlug).
			WillReturnError(errors.New("database unavailable"))

		_, found, err := findPublishedFixtureExam(context.Background(), db, studentSlug)
		if found || err == nil {
			t.Fatalf("findPublishedFixtureExam() found=%t err=%v; want query error", found, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

func TestCleanupPreservesImmutableTerminalizations(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	slugs := []driver.Value{builderSlug, builderDurabilitySlug, studentSlug, actStudentSlug}
	mock.ExpectBegin()
	mock.ExpectExec("UPDATE exam_schedules s").WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE assessment_access_links l").WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)DELETE FROM exam_schedules.+NOT EXISTS.+attempt_terminalizations`).
		WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)DELETE FROM sat_workbook_imports.+NOT EXISTS.+attempt_terminalizations`).
		WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)DELETE FROM assessment_access_links.+NOT EXISTS.+attempt_terminalizations`).
		WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)DELETE FROM exam_events.+NOT EXISTS.+attempt_terminalizations`).
		WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)UPDATE exam_versions SET parent_version_id = NULL.+NOT EXISTS.+attempt_terminalizations`).
		WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)DELETE FROM exam_versions.+NOT EXISTS.+attempt_terminalizations`).
		WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)DELETE e FROM exam_entities e.+NOT EXISTS.+attempt_terminalizations`).
		WithArgs(slugs...).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(`(?s)DELETE FROM users.+student_attempts`).
		WithArgs(builderEmail, studentEmail, unregisteredEmail, adminOperatorEmail, lifecycleAdminEmail).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()

	if err := cleanup(context.Background(), db); err != nil {
		t.Fatalf("cleanup() error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

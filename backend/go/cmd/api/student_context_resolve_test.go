package main

import (
	"context"
	"database/sql"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func resolveTestDB(t *testing.T) (*sql.DB, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	return db, mock
}

// Cross-user candidate: the candidate resolves to another user's attempt -
// must 404-collapse (sql.ErrNoRows) with no registration probe (fail fast,
// no oracle on the victim row beyond the ownership check).
func TestResolveStudentAttemptRejectsCrossUserCandidate(t *testing.T) {
	db, mock := resolveTestDB(t)
	mock.ExpectQuery("FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"id", "COALESCE(user_id, '')"}).AddRow("att-1", "victim-u"))
	_, err := resolveStudentAttemptIDForUser(context.Background(), db, "sched-1", "W001", "caller-u")
	if err != sql.ErrNoRows {
		t.Fatalf("cross-user candidate must ErrNoRows, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Registration required (candidate path): owned attempt but no
// schedule_registrations row for (schedule, user) -> ErrNoRows.
func TestResolveStudentAttemptRequiresRegistrationCandidate(t *testing.T) {
	db, mock := resolveTestDB(t)
	mock.ExpectQuery("FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"id", "COALESCE(user_id, '')"}).AddRow("att-1", "u-1"))
	mock.ExpectQuery("FROM schedule_registrations").
		WillReturnError(sql.ErrNoRows)
	_, err := resolveStudentAttemptIDForUser(context.Background(), db, "sched-1", "W001", "u-1")
	if err != sql.ErrNoRows {
		t.Fatalf("missing registration must ErrNoRows, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Registration required (user-only path): attempt resolves by user_id but
// no registration row -> ErrNoRows.
func TestResolveStudentAttemptRequiresRegistrationByUser(t *testing.T) {
	db, mock := resolveTestDB(t)
	mock.ExpectQuery("FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery("FROM schedule_registrations").
		WillReturnError(sql.ErrNoRows)
	_, err := resolveStudentAttemptIDForUser(context.Background(), db, "sched-1", "", "u-1")
	if err != sql.ErrNoRows {
		t.Fatalf("missing registration must ErrNoRows, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Happy paths: owned attempt + live registration row resolves the id on
// both the candidate and user-only paths.
func TestResolveStudentAttemptHappyPaths(t *testing.T) {
	db, mock := resolveTestDB(t)
	mock.ExpectQuery("FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"id", "COALESCE(user_id, '')"}).AddRow("att-1", "u-1"))
	mock.ExpectQuery("FROM schedule_registrations").
		WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))
	mock.ExpectQuery("FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-2"))
	mock.ExpectQuery("FROM schedule_registrations").
		WillReturnRows(sqlmock.NewRows([]string{"1"}).AddRow(1))
	if got, err := resolveStudentAttemptIDForUser(context.Background(), db, "sched-1", "W001", "u-1"); err != nil || got != "att-1" {
		t.Fatalf("candidate path = %q, %v; want att-1, nil", got, err)
	}
	if got, err := resolveStudentAttemptIDForUser(context.Background(), db, "sched-1", "", "u-1"); err != nil || got != "att-2" {
		t.Fatalf("user path = %q, %v; want att-2, nil", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Empty caller user id resolves nothing and issues no SQL.
func TestResolveStudentAttemptEmptyUser(t *testing.T) {
	db, mock := resolveTestDB(t)
	if _, err := resolveStudentAttemptIDForUser(context.Background(), db, "sched-1", "W001", ""); err != sql.ErrNoRows {
		t.Fatalf("empty user must ErrNoRows, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

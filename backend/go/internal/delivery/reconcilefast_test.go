package delivery

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// D1 RED: steady drained attempt (no open modules, result present) skips the
// reconcile tx entirely — only cheap committed-read probes, no FOR UPDATE.
func TestReconcileFastPathSkipsTx(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	mock.ExpectQuery("FROM assessment_module_attempts WHERE attempt_id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"open_modules", "terminal_modules"}).AddRow(0, 2))
	mock.ExpectQuery("FROM assessment_results WHERE attempt_id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT"}).AddRow(1))
	// NO tx expectations: any BEGIN/FOR UPDATE fails the test.
	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if changed {
		t.Fatalf("steady drained attempt must report unchanged")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// D1 RED: open modules present -> full tx path runs (behavior preserved).
func TestReconcileFastPathFallsThrough(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	mock.ExpectQuery("FROM assessment_module_attempts WHERE attempt_id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"open_modules", "terminal_modules"}).AddRow(1, 0))
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key"}).
			AddRow("rt-1", "live", "legacy_section_v1", nil))
	mock.ExpectQuery("state IN").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}))
	mock.ExpectQuery("state IN").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT"}).AddRow(0))
	mock.ExpectCommit()
	if _, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC()); err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package delivery

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// SAT full-entry-time (plan 2026-09-24, task 3.4): the timeout sweep must never
// expire a module the candidate was never shown. A personal offer that was never
// confirmed (armed, started_at NULL) and one that was confirmed but whose first
// active frame was never acknowledged (entry_confirmed_at set, entry_entered_at
// NULL) both stay open so the client can request a fresh offer; only an ENTERED
// module expires on its own deadline plus the existing save-only grace.

// personalReconcileHarness stages the reconcile preamble for a personal runtime
// up to (not including) the open-module row.
func personalReconcileHarness(mock sqlmock.Sqlmock, runtimeStatus string, breakRows int64) {
	mock.ExpectQuery("FROM assessment_module_attempts WHERE attempt_id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"open_modules", "terminal_modules"}).AddRow(1, 0))
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "provider_key"}).AddRow("att-1", "sat"))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key"}).
			AddRow("rt-1", runtimeStatus, "sat_personal_v1", nil))
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	// Personal + live: the break sweep runs first (own deadline, no grace).
	mock.ExpectExec("UPDATE assessment_attempt_breaks").
		WillReturnResult(sqlmock.NewResult(0, breakRows))
}

// personalOfferRow is the locked open-module projection for a personal attempt.
func personalOfferRow(mock sqlmock.Sqlmock, state string, startedAt, confirmedAt, enteredAt any) {
	mock.ExpectQuery("state IN").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "module_id", "state", "allocated_seconds", "available_at", "started_at",
			"paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason",
			"entry_confirmed_at", "entry_entered_at",
		}).AddRow("ma-1", "mod-1", state, 120, nil, startedAt, nil, 0, 0, nil, confirmedAt, enteredAt))
}

func TestPersonalUnconfirmedOfferIsNotExpiredByTimeout(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	personalReconcileHarness(mock, "live", 0)
	// Armed, never confirmed: started_at IS NULL, no entry marks. The authored
	// allotment must not be read as an expired module.
	personalOfferRow(mock, "not_started", nil, nil, nil)
	mock.ExpectCommit()

	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if changed {
		t.Fatal("an unconfirmed personal offer must not finalize a module")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPersonalConfirmedButUnenteredOfferIsNotExpiredByTimeout(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	started := time.Now().UTC().Add(-10 * time.Minute)
	confirmed := started
	personalReconcileHarness(mock, "live", 0)
	// Confirmed entry (started_at = entry_starts_at, entry_confirmed_at set) but
	// the first active frame was never acknowledged and no response exists: the
	// candidate never saw this module, so it must stay rearmable.
	personalOfferRow(mock, "active", started, confirmed, nil)
	mock.ExpectCommit()

	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if changed {
		t.Fatal("a confirmed-but-unentered personal offer must not finalize a module")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPersonalEnteredModuleExpiresOnItsOwnDeadline(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	started := time.Now().UTC().Add(-10 * time.Minute)
	personalReconcileHarness(mock, "live", 0)
	// Entered (entry_entered_at set) and past the authored 120s allotment: the
	// module closes like any other per-module clock.
	personalOfferRow(mock, "active", started, started, started)
	// finalizeModuleTx: scoring rows (none), UPDATE 1 row, section lookup,
	// next module none (last open -> arms completion).
	mock.ExpectQuery("FROM assessment_exam_questions eq").
		WillReturnRows(sqlmock.NewRows([]string{"is_pretest", "answer_definition", "response", "response_v2"}))
	mock.ExpectExec("UPDATE assessment_module_attempts SET state").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM assessment_modules m JOIN assessment_sections").
		WillReturnRows(sqlmock.NewRows([]string{"id", "break_after_seconds"}).AddRow("sec-1", 0))
	mock.ExpectQuery("FROM assessment_modules m JOIN assessment_sections s ON").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"}).
			AddRow("sec-1", "rw", 1, "terminal", "v-1"))
	deliveryUnscopedAttemptLink(mock)
	mock.ExpectQuery("FROM assessment_sections WHERE exam_version_id").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectCommit()

	changed, err := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if !changed {
		t.Fatal("an entered, expired personal module must finalize")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package runtime

import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// B4: exec-only runtime commands skip the wakeup INSERT but still transition.
// Pause with fence on a live runtime: revision bump + control event + V2 sync
// run; the runtime_changed outbox INSERT does not.
func TestPauseExecOnlySkipsWakeup(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), nil).SetOutboxExecOnly(true)
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE schedule_id").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "exam_id", "status", "active_section_key", "revision", "timing_model"}).
			AddRow("rt-1", "sched-1", "exam-1", "live", "rw", 3, "legacy_section_v1"))
	mock.ExpectExec("UPDATE exam_session_runtimes SET status = 'paused'").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE exam_session_runtime_sections SET status = 'paused'").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE assessment_module_attempts").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE assessment_attempt_breaks").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE student_attempts sa JOIN").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO cohort_control_events").
		WillReturnResult(sqlmock.NewResult(0, 1))
	// NO outbox INSERT expected here (exec-only skips runtime_changed).
	mock.ExpectCommit()
	if err := svc.Pause(context.Background(), "sched-1", RevisionFence{}, nil, "admin-1"); err != nil {
		t.Fatalf("exec-only pause must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

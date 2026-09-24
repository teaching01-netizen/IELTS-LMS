package runtime

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// The attempt-owned personal break deadline (plan 2026-09-24) is a clock the
// room's controls must reach: pause must freeze it, resume must credit the paused
// seconds back to it, and a proctor extension must move it. Otherwise a candidate
// who is on a break when the proctor pauses or extends silently loses the time.

// A proctor extension during a break moves the break's owned deadline too.
func TestExtendMovesTheActivePersonalBreakDeadline(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), nil).SetOutboxExecOnly(true)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM student_attempts WHERE schedule_id = ? ORDER BY id FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "exam_id", "status", "active_section_key", "revision", "timing_model"}).
			AddRow("rt-1", "sched-1", "exam-1", "live", "reading-writing", 3, TimingModelPersonal))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections SET extension_minutes")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes SET current_section_remaining_seconds")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts")).
		WithArgs(int64(5), "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	// The break statement is the point of this test: same minutes, same scope,
	// and only an already-active break with a deadline.
	mock.ExpectExec("(?s)UPDATE assessment_attempt_breaks b.*"+
		"SET b.deadline_at = DATE_ADD\\(b.deadline_at, INTERVAL \\(\\? \\* 60\\) SECOND\\).*"+
		"WHERE sa.schedule_id = \\? AND b.state = 'active' AND b.deadline_at IS NOT NULL").
		WithArgs(int64(5), "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("deadline_at = CASE WHEN rt.timing_model")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// NO outbox INSERT: exec-only skips runtime_changed.
	mock.ExpectCommit()

	if err := svc.Extend(context.Background(), "sched-1", RevisionFence{}, 5, nil); err != nil {
		t.Fatalf("extend must reach the active break: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Pausing the room freezes an active break at the same instant the module clocks
// freeze, so the candidate does not lose paused time.
func TestPauseFreezesAnActivePersonalBreak(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("SET b.paused_at = UTC_TIMESTAMP(6)")).
		WithArgs("sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return pauseSATModules(ctx, q, "sched-1")
	}); err != nil {
		t.Fatalf("pause must freeze the break: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Resuming credits the paused seconds back to the break's owned deadline, so a
// pause/resume inside a break does not consume the authored break.
func TestResumeCreditsPausedBreakTimeToTheOwnedDeadline(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("(?s)UPDATE assessment_attempt_breaks b.*" +
		"SET b.accumulated_paused_seconds = b.accumulated_paused_seconds \\+ GREATEST\\(TIMESTAMPDIFF\\(SECOND, b.paused_at, UTC_TIMESTAMP\\(6\\)\\), 0\\).*" +
		"b.deadline_at = DATE_ADD\\(b.deadline_at, INTERVAL GREATEST\\(TIMESTAMPDIFF\\(SECOND, b.paused_at, UTC_TIMESTAMP\\(6\\)\\), 0\\) SECOND\\).*" +
		"WHERE sa.schedule_id = \\? AND b.state = 'active' AND b.paused_at IS NOT NULL").
		WithArgs("sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return resumeSATModules(ctx, q, "sched-1")
	}); err != nil {
		t.Fatalf("resume must credit the break: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

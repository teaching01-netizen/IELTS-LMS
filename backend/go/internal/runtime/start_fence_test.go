package runtime

// Start's correctness envelope, second half: WHICH version a runtime is bound
// to, and in WHAT order the rows that decide it are locked.
//
// The runtime's plan used to be derived from a read that happened before the
// transaction, and the schedule was flipped live by an unconditional UPDATE at
// the very end. A version switch committing in between left the schedule (and
// every attempt minted after it) naming V2 while the runtime's section/timing
// topology described V1. These tests pin the three facts that close that gap:
//
//  1. the plan is derived INSIDE the transaction, through its tx handle, from
//     the schedule row the transaction locked first;
//  2. the live transition is a compare-and-set on exactly that row's
//     (status, published_version_id, revision), and a miss rolls everything
//     back;
//  3. a schedule that is not `scheduled` cannot be opened at all.
//
// sqlmock's expectations are ORDERED, so every test here (and in
// start_atomic_test.go) also asserts the global lock order: the schedule row
// before its attempts before the runtime row. A Start that locked attempts
// first fails these suites at the first statement.

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func conflictStatus(t *testing.T, err error) {
	t.Helper()
	if err == nil {
		t.Fatal("expected a conflict, got nil")
	}
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) {
		t.Fatalf("expected an application error, got %T: %v", err, err)
	}
	if appErr.Code != apperrors.CodeConflict || appErr.HTTPStatus != 409 {
		t.Fatalf("expected 409 CONFLICT, got %s/%d: %s", appErr.Code, appErr.HTTPStatus, appErr.Message)
	}
}

// TestStartPlansFromTheLockedScheduleRow: the planner receives the row Start
// locked (its version and revision), and reads through the SAME transaction —
// the planner's own query is staged between the runtime lock and the exam
// entity read, so a planner that ran before the transaction (or outside it)
// would break the ordered statement set.
func TestStartPlansFromTheLockedScheduleRow(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, rec := runtimeServiceWithOutbox(db)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectScheduleLock(mock, "scheduled", "ver-locked", 9)
	mock.ExpectQuery("FROM student_attempts WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	// The planner's read, inside the transaction, keyed by the LOCKED version.
	mock.ExpectQuery("FROM assessment_sections WHERE exam_version_id").
		WithArgs("ver-locked").
		WillReturnRows(sqlmock.NewRows([]string{"section_key"}).AddRow("reading-writing"))
	mock.ExpectQuery("provider_key FROM exam_entities").
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("sat"))
	mock.ExpectExec("INSERT INTO exam_session_runtimes").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO exam_session_runtime_sections").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE exam_schedules SET status = 'live'").
		WithArgs("sched-1", "ver-locked", int64(9)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE student_attempts sa JOIN").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO cohort_control_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO outbox_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	var seen []StartSchedule
	planner := func(ctx context.Context, q tx.Tx, sch StartSchedule) ([]PlanEntry, string, error) {
		seen = append(seen, sch)
		rows, err := q.QueryContext(ctx, "SELECT section_key FROM assessment_sections WHERE exam_version_id = ?", sch.PublishedVersionID)
		if err != nil {
			return nil, "", err
		}
		defer rows.Close()
		var plan []PlanEntry
		for rows.Next() {
			var key string
			if err := rows.Scan(&key); err != nil {
				return nil, "", err
			}
			plan = append(plan, PlanEntry{SectionKey: key, Label: key, Order: 0, DurationMinutes: 32})
		}
		return plan, TimingModelCohortSection, rows.Err()
	}

	runtimeID, err := svc.Start(context.Background(), "sched-1", "admin-1", planner)
	if err != nil {
		t.Fatalf("start must commit: %v", err)
	}
	if runtimeID == "" {
		t.Fatal("start must return the created runtime id")
	}
	if len(seen) != 1 {
		t.Fatalf("the planner must run exactly once, ran %d times", len(seen))
	}
	if seen[0].PublishedVersionID != "ver-locked" || seen[0].Revision != 9 || seen[0].ExamID != "exam-1" || seen[0].ProviderKey != "sat" || seen[0].PlannedDurationMinutes != 154 {
		t.Fatalf("the planner must be handed the locked row, got %+v", seen[0])
	}
	if rec.calls != 1 {
		t.Fatalf("a committed start publishes exactly one wakeup, got %d", rec.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestStartFailsClosedWhenTheScheduleFenceDoesNotHold: the runtime and its
// sections are already written when the CAS reports zero rows; everything must
// roll back and nothing may be published or invalidated.
func TestStartFailsClosedWhenTheScheduleFenceDoesNotHold(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, rec := runtimeServiceWithOutbox(db)
	invalidated := 0
	svc.SetSnapshotInvalidator(func(string) { invalidated++ })

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectScheduleLock(mock, "scheduled", "ver-1", 3)
	mock.ExpectQuery("FROM student_attempts WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("provider_key FROM exam_entities").
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("sat"))
	mock.ExpectExec("INSERT INTO exam_session_runtimes").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO exam_session_runtime_sections").WillReturnResult(sqlmock.NewResult(0, 1))
	// The row moved underneath us (a writer that bypassed the lock): no match.
	mock.ExpectExec("UPDATE exam_schedules SET status = 'live'").
		WithArgs("sched-1", "ver-1", int64(3)).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	runtimeID, err := svc.Start(context.Background(), "sched-1", "admin-1", staticPlanner(startPlan(), TimingModelCohortSection))
	conflictStatus(t, err)
	if runtimeID != "" {
		t.Fatalf("a rolled-back start must return no runtime id, got %q", runtimeID)
	}
	if rec.calls != 0 {
		t.Fatalf("a rolled-back start must publish no wakeup, got %d", rec.calls)
	}
	if invalidated != 0 {
		t.Fatalf("a rolled-back start must not invalidate a committed snapshot, got %d", invalidated)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestStartRefusesToOpenANonScheduledSession: with no runtime row, only a
// `scheduled` schedule may be opened. A cancelled (or completed) one used to be
// quietly resurrected as live; now it is a 409 before anything is planned or
// written.
func TestStartRefusesToOpenANonScheduledSession(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, rec := runtimeServiceWithOutbox(db)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectScheduleLock(mock, "cancelled", "ver-1", 5)
	mock.ExpectQuery("FROM student_attempts WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	planned := 0
	_, err = svc.Start(context.Background(), "sched-1", "admin-1", func(context.Context, tx.Tx, StartSchedule) ([]PlanEntry, string, error) {
		planned++
		return startPlan(), TimingModelCohortSection, nil
	})
	conflictStatus(t, err)
	if planned != 0 {
		t.Fatalf("a refused start must not plan, planned %d times", planned)
	}
	if rec.calls != 0 {
		t.Fatalf("a refused start must publish no wakeup, got %d", rec.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestStartRequiresAPlanner: a nil planner is a wiring bug, refused before any
// transaction is opened.
func TestStartRequiresAPlanner(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, _ := runtimeServiceWithOutbox(db)
	if _, err := svc.Start(context.Background(), "sched-1", "admin-1", nil); err == nil {
		t.Fatal("a nil planner must be refused")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestCompleteLocksTheScheduleBeforeTheRuntime: Complete writes the schedule
// row last (CompleteInTx), so it must take that row first — the same order
// check-in uses — or it re-opens the lock cycle Start just closed.
func TestCompleteLocksTheScheduleBeforeTheRuntime(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, rec := runtimeServiceWithOutbox(db)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectScheduleLock(mock, "live", "ver-1", 4)
	mock.ExpectQuery("FROM student_attempts WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "exam_id", "status", "active_section_key", "revision", "timing_model"}).
			AddRow("rt-1", "sched-1", "exam-1", StatusLive, "reading-writing", int64(6), TimingModelCohortSection))
	mock.ExpectExec("UPDATE exam_session_runtimes SET status = 'completed'").
		WithArgs("rt-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE exam_session_runtime_sections SET status = 'completed'").
		WithArgs("proctor_complete", "rt-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE exam_schedules SET status = 'completed'").
		WithArgs("sched-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO cohort_control_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO outbox_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := svc.Complete(context.Background(), "sched-1", "", "admin-1"); err != nil {
		t.Fatalf("complete must commit: %v", err)
	}
	if rec.calls != 1 || rec.revision != 7 {
		t.Fatalf("complete publishes one wakeup at the runtime's next revision, got %d calls at revision %d", rec.calls, rec.revision)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

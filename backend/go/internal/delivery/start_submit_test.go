package delivery

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// deliveryReconcileDrained stages the reconcile-then-write prologue
// (Rust start_module:402 / submit_module:730): attempt + runtime rows exist
// (legacy timing model) and the open-module loop drains immediately with no
// terminal modules, so the drained-at-entry missing-result backstop stays a
// no-op (one terminal-module existence probe, then commit).
func deliveryReconcileDrained(mock sqlmock.Sqlmock) {
	deliverySaveBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key"}).
			AddRow("rt-1", "live", "legacy", nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('submitted', 'locked')")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectCommit()
}

// deliveryReconcileDrainedStranded stages the drained-at-entry retry case: no
// open modules, terminal modules present, but the SAT result row is still
// missing, so the missing-result backstop re-arms completion.
func deliveryReconcileDrainedStranded(mock sqlmock.Sqlmock) {
	deliverySaveBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key"}).
			AddRow("rt-1", "live", "legacy", nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('submitted', 'locked')")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(2))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectCommit()
}

func deliveryModuleWorkableTx(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"proctor_status", "delivery_status", "submitted_at", "phase"}).
			AddRow("active", "running", nil, "exam"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
}

func deliveryModuleRow(mock sqlmock.Sqlmock, state string, at time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE")).
		WithArgs("att-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}).
			AddRow("ma-1", "mod-1", state, 3600, at, at, nil, 0, 0, nil))
}

func deliveryLegacyGate(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
}

func deliveryMaxRevision(mock sqlmock.Sqlmock, rev int64) {
	mock.ExpectQuery(regexp.QuoteMeta("COALESCE(MAX(revision), 0) FROM assessment_module_attempts")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"rev"}).AddRow(rev))
}

func deliveryBusInsert(mock sqlmock.Sqlmock, kind, target, name string, rev int64) {
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO live_update_events")).
		WithArgs(sqlmock.AnyArg(), kind, target, rev, name, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
}

func deliveryBootstrapLoads(mock sqlmock.Sqlmock, at time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id")).
		WithArgs("pv-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_module_attempts WHERE attempt_id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("ma-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason", "raw_correct", "operational_question_count", "tool_state", "revision"}).
			AddRow("ma-1", "mod-1", "active", 3600, at, at, nil, 0, 0, nil, nil, nil, "{}", 7))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses ar JOIN")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_attempt_id", "exam_question_id", "response", "marked_for_review", "eliminated_options", "annotations", "revision"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"candidate_name", "proctor_status", "proctor_note", "delivery_status", "submitted_at", "phase"}).
			AddRow("Jane", "active", nil, "running", nil, "exam"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_sessions WHERE attempt_id")).
		WithArgs("att-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ?")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
}

// An already-active started module short-circuits idempotently: no state
// write, bus rows inside the commit tx, bootstrap payload after commit.
func TestDeliveryStartModuleIdempotent(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	deliverySaveBinding(mock)
	deliveryReconcileDrained(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	deliveryModuleRow(mock, "active", now.Add(-time.Minute))
	deliveryLegacyGate(mock)
	deliveryMaxRevision(mock, 7)
	deliveryBusInsert(mock, "attempt", "att-1", "sat_module_started", 7)
	deliveryBusInsert(mock, "schedule_roster", "sched-1", "sat_module_started", 7)
	mock.ExpectCommit()
	deliveryBootstrapLoads(mock, now.Add(-time.Minute))
	out, err := svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1")
	if err != nil {
		t.Fatalf("expected idempotent start to succeed, got %v", err)
	}
	if out == nil || out.Attempt.ID != "att-1" || out.ScheduleID != "sched-1" {
		t.Fatalf("unexpected bootstrap payload %+v", out)
	}
	if len(out.Attempt.ModuleAttempts) != 1 || out.Attempt.ModuleAttempts[0].Revision != 7 {
		t.Fatalf("unexpected module attempts %+v", out.Attempt.ModuleAttempts)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A paused module is not submittable: Rust rejects it with Conflict and the
// tx rolls back (no bus rows, no commit).
func TestDeliverySubmitModuleNotActive(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	deliverySaveBinding(mock)
	deliveryReconcileDrained(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	deliveryModuleRow(mock, "paused", now.Add(-time.Minute))
	mock.ExpectRollback()
	_, err = svc.SubmitModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1")
	if deliveryCodeOf(err) != apperrors.CodeAssessmentConflict {
		t.Fatalf("expected CONFLICT on paused submit, got %v", err)
	}
	if appErr, ok := apperrors.As(err); ok {
		if appErr.Message != "This SAT module is not active." {
			t.Fatalf("unexpected conflict message %q", appErr.Message)
		}
	} else {
		t.Fatalf("expected *apperrors.Error, got %T", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

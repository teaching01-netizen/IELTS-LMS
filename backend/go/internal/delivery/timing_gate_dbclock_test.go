package delivery

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// SAT-006 acceptance seam: the module deadline is judged on the DB instant
// read AFTER the runtime/section rows are locked — not on a wall-clock
// timestamp captured before the request waited for authority. Schedule:
//
//	12:00:59.900 the request captures its pre-tx wall clock (before deadline)
//	12:01:00.000 the official section deadline expires while it waits
//	12:01:01.000 it acquires its locks; the in-tx UTC_TIMESTAMP(6) is past
//	             the deadline and the gate must reject
func TestModuleTimingGateRejectsWhenInTxTimePassedDeadline(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)

	started := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	deadline := started.Add(60 * time.Second)

	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"timing_model", "active_section_key"}).
			AddRow("cohort_stage_v2", "math:m1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s")).
		WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "adaptive_role", "duration_seconds"}).AddRow("math", "base", 2100))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections rs JOIN exam_session_runtimes r")).
		WithArgs("sched-1", "math:m1").
		WillReturnRows(sqlmock.NewRows([]string{"status", "actual_start_at", "paused_at", "planned_duration_minutes", "extension_minutes", "accumulated_paused_seconds"}).
			AddRow("live", started, nil, 1, 0, 0))
	// The locks waited past the deadline; the authoritative instant says so.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(deadline.Add(time.Second)))
	mock.ExpectRollback()

	gated, err := svc.moduleTimingGateTx(context.Background(), tx, "sched-1", "mod-1")
	_ = tx.Rollback()
	if deliveryCodeOf(err) != apperrors.CodeAssessmentConflict {
		t.Fatalf("post-lock deadline must reject with ASSESSMENT_CONFLICT, got %v", err)
	}
	if appErr, ok := apperrors.As(err); !ok || appErr.Details["reason"] != "DEADLINE_EXPIRED" {
		t.Fatalf("expected reason DEADLINE_EXPIRED, got %v", err)
	}
	if gated.gate != timingGate(0) || !gated.now.IsZero() {
		t.Fatalf("rejected gate must return zero values, got gate=%v now=%v", gated.gate, gated.now)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Inverse schedule: lock wait ends before the deadline, so the in-tx instant
// admits the request and is returned as the authoritative operation time.
func TestModuleTimingGateAdmitsWhenInTxTimeBeforeDeadline(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)

	started := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	inTx := started.Add(59 * time.Second)

	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"timing_model", "active_section_key"}).
			AddRow("cohort_stage_v2", "math:m1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s")).
		WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "adaptive_role", "duration_seconds"}).AddRow("math", "base", 2100))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections rs JOIN exam_session_runtimes r")).
		WithArgs("sched-1", "math:m1").
		WillReturnRows(sqlmock.NewRows([]string{"status", "actual_start_at", "paused_at", "planned_duration_minutes", "extension_minutes", "accumulated_paused_seconds"}).
			AddRow("live", started, nil, 1, 0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(inTx))
	mock.ExpectCommit()

	gated, err := svc.moduleTimingGateTx(context.Background(), tx, "sched-1", "mod-1")
	if err != nil {
		t.Fatalf("pre-deadline in-tx instant must admit, got %v", err)
	}
	if gated.gate != timingGateCohortStage {
		t.Fatalf("expected cohort-stage gate, got %v", gated.gate)
	}
	if !gated.now.Equal(inTx.UTC()) {
		t.Fatalf("gate must return the in-tx authoritative time: got %v want %v", gated.now, inTx.UTC())
	}
	if gated.roomWindowKnown {
		t.Fatal("a stage-keyed cohort runtime has no shared module window to project")
	}
	_ = tx.Commit()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

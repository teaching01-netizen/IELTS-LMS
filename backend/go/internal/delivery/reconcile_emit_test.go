package delivery

// Plan E-exam-day: a failing assessment completion must count on
// worker_job_failures_total{job=reconcile_complete_assessment} AND stay
// retryable (CodeRecoveryFailed) — the finalize tx already committed, only
// completion is outstanding. A silent failure strands the attempt with
// finalized modules and no result. RED: failure emits + signals retry.
import (
	"context"
	"errors"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestReconcileCompleterFailureEmitsAndRetries(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db)).SetCompleter(func(ctx context.Context, scheduleID, attemptID string) error {
		return errors.New("completion backend down")
	})
	startedAt := time.Now().UTC().Add(-time.Hour)
	// Steady probes fall through (1 open module).
	mock.ExpectQuery("FROM assessment_module_attempts WHERE attempt_id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"open_modules", "terminal_modules"}).AddRow(1, 0))
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key"}).
			AddRow("rt-1", "completed", "legacy_section_v1", nil))
	// One active expired module (runtime completed expires everything).
	mock.ExpectQuery("FROM assessment_module_attempts WHERE attempt_id = ").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}).
			AddRow("mrow-1", "mod-1", "active", 60, nil, startedAt, nil, 0, 0, nil))
	// finalizeModuleTx: scoring rows (none), UPDATE 1 row, section lookup,
	// next module none (last open -> arms completion).
	mock.ExpectQuery("FROM assessment_exam_questions eq").
		WillReturnRows(sqlmock.NewRows([]string{"is_pretest", "answer_definition", "response", "response_v2"}))
	mock.ExpectExec("UPDATE assessment_module_attempts SET state").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM assessment_modules m JOIN assessment_sections").
		WillReturnRows(sqlmock.NewRows([]string{"id", "break_after_seconds"}).AddRow("sec-1", 0))
	// nextModuleTx section/adaptive lookup for mod-1: not found row
	// would 404; return a terminal (non-base) section so next == nil.
	mock.ExpectQuery("FROM assessment_modules m JOIN assessment_sections s ON").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"}).
			AddRow("sec-1", "rw", 1, "terminal", "v-1"))
	// Non-base path looks up the next section by display order; empty
	// set means no follow-up (assessment complete -> arms completion).
	mock.ExpectQuery("FROM assessment_sections WHERE exam_version_id").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectCommit()
	changed, rerr := svc.ReconcileAttemptTimeout(context.Background(), "sched-1", "att-1", time.Now().UTC())
	if rerr == nil {
		t.Fatalf("completer failure must surface an error")
	}
	if e, ok := apperrors.As(rerr); !ok || e.Code != apperrors.CodeRecoveryFailed {
		t.Fatalf("must be retryable CodeRecoveryFailed, got %v", rerr)
	}
	if !changed {
		t.Fatalf("finalized modules must report changed (retry re-runs completion)")
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MJobFailures, "job", "reconcile_complete_assessment"); got != 1 {
		t.Fatalf("job failure must count 1, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

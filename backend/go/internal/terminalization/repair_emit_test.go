package terminalization

// Plan E-exam-day: the repair series (missing_receipt_repair_total) is
// the operator's self-healing proof. Each manufactured legacy_unknown
// receipt counts exactly one; a clean sweep counts zero. RED: repair
// emits per receipt, empty sweep silent.
import (
	"context"
	"database/sql"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestRepairMissingReceiptEmits(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	submittedAt := time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts a WHERE a.submitted_at IS NOT NULL").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "organization_id", "exam_id", "answer_revision", "submitted_at", "proctor_status"}).
			AddRow("att-1", "sched-1", nil, "exam-1", int64(9), submittedAt, "active"))
	mock.ExpectQuery("FROM student_attempts WHERE id").
		WillReturnRows(sqlmock.NewRows([]string{"snap"}).AddRow(`{}`))
	mock.ExpectExec("INSERT INTO attempt_terminalizations").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	n, err := RepairMissingReceipts(context.Background(), db, 100)
	if err != nil {
		t.Fatalf("repair: %v", err)
	}
	if n != 1 {
		t.Fatalf("must repair 1, got %d", n)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MRepairMissing); got != 1 {
		t.Fatalf("repair must count 1, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	_ = sql.ErrNoRows
}

func TestRepairMissingReceiptEmptySilent(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts a WHERE a.submitted_at IS NOT NULL").
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id", "organization_id", "exam_id", "answer_revision", "submitted_at", "proctor_status"}))
	mock.ExpectCommit()
	n, err := RepairMissingReceipts(context.Background(), db, 100)
	if err != nil {
		t.Fatalf("empty repair: %v", err)
	}
	if n != 0 {
		t.Fatalf("empty sweep must repair 0, got %d", n)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MRepairMissing); got != 0 {
		t.Fatalf("empty sweep must count 0, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package terminalization

// Round 166 (TDD RED): the game-day rehearsal proved a NULL
// organization_id scan is a submit-path 500 — `sql: Scan error on column
// index 3, name "organization_id": converting NULL to string is
// unsupported` on POST /api/v2/student/attempts/{id}/submit (r166: 5 of
// them, all fresh entry-minted attempts whose organization_id is NULL).
// Every organization_id scan on the submit/seal path must tolerate NULL.
import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/platform/tx"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestFindByAttemptIDToleratesNullOrg(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Drive the tx through the runner so the QueryRow flows over a real
	// transaction (the repo takes tx.Tx, not *sql.DB). Expectation order
	// is Begin -> tz -> query: sqlmock matches strictly in order.
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM attempt_terminalizations WHERE").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"attempt_id", "organization_id", "terminalization_id", "schedule_id",
			"outcome", "reason", "actor_kind", "actor_id", "effective_at",
			"recorded_at", "answer_revision", "final_snapshot", "request_id",
		}).AddRow("att-1", nil, "term-1", "sched-1", "submitted", "r", "student", "u-1", "2026-09-08 10:00:00", "2026-09-08 10:00:01", 3, "{}", "req-1"))
	mock.ExpectCommit()
	runner := tx.NewRunner(db)
	var got *Receipt
	if err := runner.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		var ferr error
		got, ferr = SQLTerminalizationRepository{}.FindByAttemptID(ctx, q, "att-1")
		return ferr
	}); err != nil {
		t.Fatalf("NULL organization_id must scan cleanly, got: %v", err)
	}
	if got == nil || got.OrganizationID != nil {
		t.Fatalf("NULL org must decode to nil pointer, got: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

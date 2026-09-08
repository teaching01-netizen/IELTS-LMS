package liveupdates

// The DB lease path (LeaseRepository.Acquire) must emit the same
// MWSLeaseFailures{reason} series as the memory admission path — the soak
// dashboard must not go blind when WS_ADMISSION=db. RED: total_cap
// rejection on the DB path counts.
import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestDBLeaseEmitsTotalCap(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewLeaseRepository(db)
	mock.ExpectBegin()
	mock.ExpectQuery("SELECT id FROM websocket_lease_admission_lock").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(1))
	mock.ExpectExec("DELETE FROM websocket_connection_leases").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT COUNT").
		WillReturnRows(sqlmock.NewRows([]string{"c"}).AddRow(int64(500)))
	mock.ExpectRollback()
	if _, ok, err := repo.Acquire(context.Background(), "i-1", "u-1", nil, 500, 5, 50); err != nil || ok {
		t.Fatalf("at cap must reject: ok=%v err=%v", ok, err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MWSLeaseFailures, "reason", "total_cap"); got != 1 {
		t.Fatalf("db total_cap must count 1, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

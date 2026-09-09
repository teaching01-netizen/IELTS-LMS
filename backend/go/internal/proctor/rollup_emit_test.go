package proctor

// Plan D4/E-exam-day: the rollup slice (refresh batches) is the
// operator's proctor-dashboard proof. Each successful refresh counts
// exactly one; failed refreshes count zero (no phantom freshness).
// RED: RefreshRollup emits MRollupRefresh exactly on success.
import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestRollupEmitsRefresh(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(nil, db, nil, nil, nil)
	refresh := func() {
		mock.ExpectQuery("GROUP BY").
			WithArgs("sched-1").
			WillReturnRows(sqlmock.NewRows([]string{"delivery_status", "n"}).
				AddRow("running", 120).
				AddRow("submitted", 30))
		mock.ExpectQuery("SELECT revision FROM shared_cache_entries").
			WithArgs("proctor-rollup:sched-1").
			WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(8))
		mock.ExpectExec("INTO shared_cache_entries").
			WithArgs("proctor-rollup:sched-1", sqlmock.AnyArg(), sqlmock.AnyArg()).
			WillReturnResult(sqlmock.NewResult(1, 1))
		if _, err := svc.RefreshRollup(context.Background(), "sched-1"); err != nil {
			t.Fatalf("refresh: %v", err)
		}
	}
	refresh()
	refresh()
	if got := telemetry.CounterValueForTest(reg, telemetry.MRollupRefresh); got != 2 {
		t.Fatalf("two refreshes must count 2, got %v", got)
	}
	// LoadRollup serves the staleness signal operators alert on: lag gauge
	// must move on a row whose updated_at is 4s old.
	mock.ExpectQuery("FROM shared_cache_entries WHERE cache_key").
		WithArgs("proctor-rollup:sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"payload", "revision", "updated_at"}).
			AddRow(`{"running":120}`, 9, time.Now().UTC().Add(-4*time.Second)))
	if _, err := svc.LoadRollup(context.Background(), "sched-1"); err != nil {
		t.Fatalf("load: %v", err)
	}
	if got := telemetry.GaugeValueForTest(reg, telemetry.MRollupLag); got < 3 || got > 30 {
		t.Fatalf("lag gauge must read ~4s, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package proctor

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// D4 RED: RefreshRollup aggregates one GROUP BY into the shared-cache row
// (no migration: shared_cache_entries keyed proctor-rollup:{schedule}).
func TestRefreshRollupWritesRow(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(nil, db, nil, nil, nil)
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
	rollup, err := svc.RefreshRollup(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("refresh: %v", err)
	}
	if rollup.Total != 150 || rollup.ByStatus["running"] != 120 {
		t.Fatalf("wrong rollup: %+v", rollup)
	}
	if rollup.Revision != 9 {
		t.Fatalf("revision must bump 8->9, got %d", rollup.Revision)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// D4 RED: LoadRollup reads the 1-row header (dashboard poll fast path).
func TestLoadRollupReadsRow(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(nil, db, nil, nil, nil)
	mock.ExpectQuery("FROM shared_cache_entries WHERE cache_key").
		WithArgs("proctor-rollup:sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"payload", "revision", "updated_at"}).
			AddRow(`{"running":120,"submitted":30}`, 9, time.Now().UTC().Add(-4*time.Second)))
	rollup, err := svc.LoadRollup(context.Background(), "sched-1")
	if err != nil {
		t.Fatalf("load: %v", err)
	}
	if rollup.Total != 150 || rollup.Revision != 9 {
		t.Fatalf("wrong rollup: %+v", rollup)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// D4 RED: missing row = not-found (caller falls back to the full roster).
func TestLoadRollupMiss(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(nil, db, nil, nil, nil)
	mock.ExpectQuery("FROM shared_cache_entries WHERE cache_key").
		WithArgs("proctor-rollup:sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"payload", "revision", "updated_at"}))
	if _, err := svc.LoadRollup(context.Background(), "sched-1"); err == nil {
		t.Fatalf("miss must surface")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

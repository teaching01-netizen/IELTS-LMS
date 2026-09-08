package delivery

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// C1 RED: direct mode skips the live-bus INSERTs in-tx (zero live SQL) but
// still returns the revision for post-commit Hub fanout.
func TestAppendModuleEventsDirectSkipsBusSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db)).SetLive("origin-1", liveupdates.NewHub()).SetLiveDirect(true)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"COALESCE(MAX(revision), 0)"}).AddRow(7))
	// NO INSERT INTO live_update_events expectations: any bus INSERT fails.
	rev, err := svc.appendModuleEventsTx(context.Background(), db, "sched-1", "att-1", "module_started")
	if err != nil {
		t.Fatalf("direct append: %v", err)
	}
	if rev != 7 {
		t.Fatalf("rev = %d, want 7", rev)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// C1 RED: db mode keeps both bus INSERTs (behavior-preserving ship state).
func TestAppendModuleEventsDBKeepsBusSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db)).SetLive("origin-1", liveupdates.NewHub())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"COALESCE(MAX(revision), 0)"}).AddRow(7))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO live_update_events")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO live_update_events")).
		WillReturnResult(sqlmock.NewResult(2, 1))
	if _, err := svc.appendModuleEventsTx(context.Background(), db, "sched-1", "att-1", "module_started"); err != nil {
		t.Fatalf("db append: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

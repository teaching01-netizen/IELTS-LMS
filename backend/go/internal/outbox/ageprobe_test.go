package outbox

// Plan E-exam-day: the outbox-lag gauges (pending age) are the worker
// backlog signal. The probe returns the oldest unclaimed pending age;
// empty outbox returns 0 without error (NULL-safe). RED: both shapes.
import (
	"context"
	"database/sql"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestOldestPendingAgeSeconds(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db)
	mock.ExpectQuery("FROM outbox_events WHERE published_at").
		WillReturnRows(sqlmock.NewRows([]string{"age"}).AddRow(int64(187)))
	if got, err := repo.OldestPendingAgeSeconds(context.Background()); err != nil || got != 187 {
		t.Fatalf("age = %d, err = %v; want 187, nil", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOldestPendingAgeEmpty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db)
	// Real MySQL returns one row with COALESCE 0 (never NULL); a NULL
	// scan must still map to 0 without error (defensive).
	mock.ExpectQuery("FROM outbox_events WHERE published_at").
		WillReturnRows(sqlmock.NewRows([]string{"age"}).AddRow(sql.NullInt64{}))
	if got, err := repo.OldestPendingAgeSeconds(context.Background()); err != nil || got != 0 {
		t.Fatalf("empty age = %d, err = %v; want 0, nil", got, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

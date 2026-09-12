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

// WS-09c: the backlog gauge reuses duePredicate semantics for the
// failed/retry dimensions (NOT the lease clause — the gauge measures the
// unclaimed backlog, so it keeps claim_token IS NULL). Terminal corpses
// (failed_at set) and not-yet-due retries (next_attempt_at in the future)
// must never pin MOutboxOldestAge. sqlmock matches ExpectQuery as a regexp
// against the emitted SQL: naming both new predicates here pins them —
// deleting either from the gauge query fails this test (no-match) instead
// of silently re-poisoning. Predicate order mirrors duePredicate
// (failed/retry first, claim state last).
func TestOldestPendingAgeExcludesTerminalAndFutureRetry(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db)
	// Three-row behavioral case: a terminal corpse (failed_at set, age
	// 9000) + a future-retry row (next_attempt_at ahead, age 5000) + the
	// due row (age 42). The gauge's MAX over due-only rows resolves to the
	// due-row age — the corpses contribute nothing (sqlmock the due-only
	// MAX the fixed WHERE would compute on MySQL).
	mock.ExpectQuery("FROM outbox_events WHERE published_at IS NULL AND failed_at IS NULL AND \\(next_attempt_at IS NULL OR next_attempt_at <= NOW\\(6\\)\\) AND claim_token IS NULL").
		WillReturnRows(sqlmock.NewRows([]string{"age"}).AddRow(int64(42)))
	if got, err := repo.OldestPendingAgeSeconds(context.Background()); err != nil || got != 42 {
		t.Fatalf("due-only age = %d, err = %v; want 42, nil", got, err)
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

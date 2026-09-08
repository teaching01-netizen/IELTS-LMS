package tx

import (
	"context"
	"database/sql"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func errDeadlockForTest() error { return errors.New("Deadlock found when trying to get lock") }

func errBusinessForTest() error { return errors.New("validation: bad input") }

// recordingDB captures the isolation level of the last BeginTx.
type recordingDB struct {
	inner     *sql.DB
	lastLevel sql.IsolationLevel
	calls     int
}

func (r *recordingDB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	r.calls++
	if opts != nil {
		r.lastLevel = opts.Isolation
	}
	return r.inner.BeginTx(ctx, opts)
}

func newRecordingDB(t *testing.T) (*recordingDB, sqlmock.Sqlmock, func()) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	return &recordingDB{inner: db}, mock, func() { db.Close() }
}

// B1 RED: WithTxRC begins READ COMMITTED (gap-lock-free hot path).
func TestWithTxRCUsesReadCommitted(t *testing.T) {
	rdb, mock, close := newRecordingDB(t)
	defer close()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	r := NewRunner(rdb)
	if err := r.WithTxRC(context.Background(), func(ctx context.Context, tx Tx) error { return nil }); err != nil {
		t.Fatalf("WithTxRC: %v", err)
	}
	if rdb.lastLevel != sql.LevelReadCommitted {
		t.Fatalf("WithTxRC isolation = %v, want READ COMMITTED", rdb.lastLevel)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B1 RED: WithTx keeps REPEATABLE READ (seal/mint/projection unchanged).
func TestWithTxKeepsRepeatableRead(t *testing.T) {
	rdb, mock, close := newRecordingDB(t)
	defer close()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	r := NewRunner(rdb)
	if err := r.WithTx(context.Background(), func(ctx context.Context, tx Tx) error { return nil }); err != nil {
		t.Fatalf("WithTx: %v", err)
	}
	if rdb.lastLevel != sql.LevelRepeatableRead {
		t.Fatalf("WithTx isolation = %v, want REPEATABLE READ", rdb.lastLevel)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B1 RED: WithTxRCRetry retries transient failures under RC (deadlock
// replays whole tx — same classifier as RR, bounded with jitter).
func TestWithTxRCRetryOnDeadlock(t *testing.T) {
	rdb, mock, close := newRecordingDB(t)
	defer close()
	// First attempt deadlocks; second commits.
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE hot").WillReturnError(errDeadlockForTest())
	mock.ExpectRollback()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE hot").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	r := NewRunner(rdb)
	calls := 0
	err := r.WithTxRCRetry(context.Background(), 3, func(ctx context.Context, tx Tx) error {
		calls++
		_, err := tx.ExecContext(ctx, "UPDATE hot SET n = n + 1")
		return err
	})
	if err != nil {
		t.Fatalf("WithTxRCRetry: %v", err)
	}
	if calls != 2 {
		t.Fatalf("deadlock must replay once, calls=%d", calls)
	}
	if rdb.lastLevel != sql.LevelReadCommitted {
		t.Fatalf("retry isolation = %v, want READ COMMITTED", rdb.lastLevel)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B1 RED: WithTxRCRetry does NOT retry business errors (no replay storms).
func TestWithTxRCRetryNoRetryOnBusinessError(t *testing.T) {
	rdb, mock, close := newRecordingDB(t)
	defer close()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE hot").WillReturnError(errBusinessForTest())
	mock.ExpectRollback()
	r := NewRunner(rdb)
	calls := 0
	err := r.WithTxRCRetry(context.Background(), 3, func(ctx context.Context, tx Tx) error {
		calls++
		_, err := tx.ExecContext(ctx, "UPDATE hot SET n = n + 1")
		return err
	})
	if err == nil {
		t.Fatalf("business error must propagate")
	}
	if calls != 1 {
		t.Fatalf("business error must not retry, calls=%d", calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Package tx owns transaction boundaries. Repositories expose operations
// against a Tx handle; services decide boundaries via WithTx (plan 4.2).
// Only known-transient failures retry, bounded with jitter (plan 54).
package tx

import (
	"context"
	"database/sql"
	"math/rand"
	"strings"
	"time"
)

// Tx is the transactional handle passed to repositories.
type Tx interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	PrepareContext(ctx context.Context, query string) (*sql.Stmt, error)
}

// DB is anything that can begin a Tx (sql.DB).
type DB interface {
	BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
}

// Runner runs application use cases in transactions.
type Runner struct{ db DB }

func NewRunner(db DB) *Runner { return &Runner{db: db} }

// WithTx runs fn in a REPEATABLE READ transaction.
func (r *Runner) WithTx(ctx context.Context, fn func(ctx context.Context, tx Tx) error) error {
	sqlTx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return err
	}
	defer func() { _ = sqlTx.Rollback() }()
	if _, err := sqlTx.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
		return err
	}
	if err := fn(ctx, sqlTx); err != nil {
		return err
	}
	return sqlTx.Commit()
}

// WithTxRetry retries only transient failures (deadlock / lock wait timeout /
// connection-transient before commit certainty), bounded with jitter.
func (r *Runner) WithTxRetry(ctx context.Context, attempts int, fn func(ctx context.Context, tx Tx) error) error {
	if attempts < 1 {
		attempts = 1
	}
	var err error
	for i := 0; i < attempts; i++ {
		err = r.WithTx(ctx, fn)
		if err == nil || !transient(err) {
			return err
		}
		// Bounded backoff with jitter: 25ms * 2^i + [0,25ms).
		backoff := time.Duration(25*(1<<uint(i))) * time.Millisecond
		backoff += time.Duration(rand.Int63n(int64(25 * time.Millisecond)))
		t, cancel := context.WithTimeout(ctx, backoff)
		<-t.Done()
		cancel()
		if ctx.Err() != nil {
			return ctx.Err()
		}
	}
	return err
}

func transient(err error) bool {
	s := strings.ToLower(err.Error())
	return strings.Contains(s, "deadlock") ||
		strings.Contains(s, "lock wait timeout") ||
		strings.Contains(s, "try restarting transaction") ||
		strings.Contains(s, "connection refused") ||
		strings.Contains(s, "broken pipe") ||
		strings.Contains(s, "bad connection")
}

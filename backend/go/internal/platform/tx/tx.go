// Package tx owns transaction boundaries. Repositories expose operations
// against a Tx handle; services decide boundaries via WithTx (plan 4.2).
// Only known-transient failures retry, bounded with jitter (plan 54).
package tx

import (
	"context"
	"database/sql"
	"math/rand"
	"strings"
	"sync/atomic"
	"time"
)

// retryHook reports each retried transient (deadlock/lock-wait/connection
// error absorbed by the bounded retry). Nil = silent. The tx package stays
// dependency-free: services wire the hook to telemetry at startup (api +
// worker mains), tests inject a counter. Sync-atomic: retries happen on
// arbitrary request goroutines.
var retryHook atomic.Pointer[func(error)]

// SetRetryHook installs the retry reporter, returning a restore func.
// Passing nil silences reporting (default). Safe for concurrent use.
func SetRetryHook(hook func(error)) func() {
	if hook == nil {
		retryHook.Store(nil)
		return func() {}
	}
	h := hook
	retryHook.Store(&h)
	return func() { retryHook.Store(nil) }
}

// noteRetry reports one absorbed transient. Unexported so the hook
// fires exactly once per retry decision (inside withTxRetryLevel).
func noteRetry(err error) {
	if err == nil {
		return
	}
	if h := retryHook.Load(); h != nil {
		(*h)(err)
	}
}

// RetriesForTest is intentionally absent: retry counts are observed via
// the hook in tests (each noteRetry = one absorbed transient), never via
// production return values that would widen the Runner API.

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
	return r.withTxLevel(ctx, sql.LevelRepeatableRead, fn)
}

// WithTxRC runs fn in a READ COMMITTED transaction (plan B1 hot path).
// RC takes no gap/next-key locks on FOR UPDATE scans, so cohort-concurrent
// point writes stop deadlocking each other. Safe here because every hot
// caller reads by PK/unique key + explicit FOR UPDATE where it mutates —
// none depends on a repeatable snapshot across multiple reads. Seal, mint,
// and projection paths stay on WithTx (RR).
func (r *Runner) WithTxRC(ctx context.Context, fn func(ctx context.Context, tx Tx) error) error {
	return r.withTxLevel(ctx, sql.LevelReadCommitted, fn)
}

func (r *Runner) withTxLevel(ctx context.Context, level sql.IsolationLevel, fn func(ctx context.Context, tx Tx) error) error {
	sqlTx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: level})
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
	return r.withTxRetryLevel(ctx, sql.LevelRepeatableRead, attempts, fn)
}

// WithTxRCRetry is WithTxRetry under READ COMMITTED (plan B1 hot path).
// Same transient classifier, same bounded jitter — only the isolation
// differs. Hot callers with retry needs use this; seal/mint/projection
// keep WithTxRetry (RR).
func (r *Runner) WithTxRCRetry(ctx context.Context, attempts int, fn func(ctx context.Context, tx Tx) error) error {
	return r.withTxRetryLevel(ctx, sql.LevelReadCommitted, attempts, fn)
}

// Retried reports how many transients withTxRetryLevel absorbed. Callers
// that label outcomes (v2_response_batch_total{outcome}) read it after a
// nil return to distinguish clean accepts from retried_accepted. Zero on
// first-try success and on non-transient failure (no retry happened).
func (r *Runner) withTxRetryLevelCounted(ctx context.Context, level sql.IsolationLevel, attempts int, fn func(ctx context.Context, tx Tx) error) (int, error) {
	if attempts < 1 {
		attempts = 1
	}
	var err error
	retried := 0
	for i := 0; i < attempts; i++ {
		err = r.withTxLevel(ctx, level, fn)
		if err == nil || !transient(err) {
			return retried, err
		}
		retried++
		noteRetry(err)
		// Bounded backoff with jitter: 25ms * 2^i + [0,25ms).
		backoff := time.Duration(25*(1<<uint(i))) * time.Millisecond
		backoff += time.Duration(rand.Int63n(int64(25 * time.Millisecond)))
		t, cancel := context.WithTimeout(ctx, backoff)
		<-t.Done()
		cancel()
		if ctx.Err() != nil {
			return retried, ctx.Err()
		}
	}
	return retried, err
}

func (r *Runner) withTxRetryLevel(ctx context.Context, level sql.IsolationLevel, attempts int, fn func(ctx context.Context, tx Tx) error) error {
	_, err := r.withTxRetryLevelCounted(ctx, level, attempts, fn)
	return err
}

// WithTxRCRetryCounted is WithTxRCRetry reporting absorbed transients
// (plan E3 outcome labeling). Existing callers stay on WithTxRCRetry.
func (r *Runner) WithTxRCRetryCounted(ctx context.Context, attempts int, fn func(ctx context.Context, tx Tx) error) (int, error) {
	return r.withTxRetryLevelCounted(ctx, sql.LevelReadCommitted, attempts, fn)
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

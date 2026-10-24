package main

// Plan E3: the retry hook must be wired in the serving binary - an
// unwired hook keeps db_deadlocks_total blind during the wave.
import (
	"context"
	"errors"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// WS-16: installTxRetryHook wiring - hook-installed counter, not a label
// table. An absorbed InnoDB deadlock flowing through the tx retry loop must
// land on db_deadlocks_total{kind=deadlock} exactly once per retry when the
// serving-binary hook is installed, and stay invisible when it is not. The
// sqlmock legs below mirror the runner's tx shape (Begin + UTC set +
// Rollback); the fn error is the absorbed transient. Load-bearing line:
// main.go defer installTxRetryHook()() (txhook.go installTxRetryHook body).
func TestInstallTxRetryHookWiresDeadlockCounter(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	deadlock := &mysql.MySQLError{Number: 1213, Message: "Deadlock found when trying to get lock"}
	runOneRetry := func(t *testing.T, hook bool) {
		t.Helper()
		pool, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = pool.Close() }()
		if hook {
			defer installTxRetryHook()()
		} else {
			defer tx.SetRetryHook(nil)()
		}
		for i := 0; i < 2; i++ {
			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectRollback()
		}
		runner := tx.NewRunner(pool)
		calls := 0
		err = runner.WithTxRetry(context.Background(), 2, func(_ context.Context, _ tx.Tx) error {
			calls++
			return deadlock
		})
		if err == nil {
			t.Fatalf("retry loop must surface the exhausted transient")
		}
		if calls != 2 {
			t.Fatalf("retry loop must attempt twice, attempted %d", calls)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	}

	runOneRetry(t, false)
	if got := telemetry.CounterValueForTest(reg, telemetry.MDeadlocks, "kind", "deadlock"); got != 0 {
		t.Fatalf("without the hook, absorbed deadlocks must stay invisible, got %v", got)
	}

	runOneRetry(t, true)
	if got := telemetry.CounterValueForTest(reg, telemetry.MDeadlocks, "kind", "deadlock"); got != 1 {
		t.Fatalf("db_deadlocks_total{kind=deadlock} must count the one absorbed retry, got %v", got)
	}
}

func TestInstallTxDurationHookWiresTransactionHistogram(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()
	defer installTxDurationHook()()

	pool, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pool.Close() }()
	runner := tx.NewRunner(pool)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	if err := runner.WithTx(context.Background(), func(context.Context, tx.Tx) error { return nil }); err != nil {
		t.Fatalf("committed transaction: %v", err)
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()
	rollbackErr := errors.New("business operation rejected")
	if err := runner.WithTx(context.Background(), func(context.Context, tx.Tx) error { return rollbackErr }); !errors.Is(err, rollbackErr) {
		t.Fatalf("rolled-back transaction error = %v", err)
	}

	mock.ExpectBegin()
	mock.ExpectRollback()
	if err := runner.WithTxReadOnly(context.Background(), func(context.Context, tx.Tx) error { return nil }); err != nil {
		t.Fatalf("read-only transaction: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	snapshot := reg.Snapshot()
	for _, series := range []string{
		`db_tx_duration_seconds_count{outcome="committed"} 1`,
		`db_tx_duration_seconds_count{outcome="rolled_back"} 1`,
		`db_tx_duration_seconds_count{outcome="read_only"} 1`,
	} {
		if !strings.Contains(snapshot, series) {
			t.Errorf("transaction histogram missing %q:\n%s", series, snapshot)
		}
	}
}

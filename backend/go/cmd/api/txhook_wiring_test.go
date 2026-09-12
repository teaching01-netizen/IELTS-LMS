package main

// Plan E3: the retry hook must be wired in the serving binary - an
// unwired hook keeps db_deadlocks_total blind during the wave.
import (
	"context"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestRetryKindLabels(t *testing.T) {
	if got := retryKind(errors.New("Error 1213: Deadlock found")); got != "deadlock" {
		t.Fatalf("deadlock kind, got %q", got)
	}
	if got := retryKind(errors.New("Lock wait timeout exceeded; try restarting transaction")); got != "lockwait" {
		t.Fatalf("lockwait kind, got %q", got)
	}
	if got := retryKind(errors.New("bad connection")); got != "conntransient" {
		t.Fatalf("conntransient kind, got %q", got)
	}
	if got := retryKind(nil); got != "unknown" {
		t.Fatalf("nil kind, got %q", got)
	}
}

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

	deadlock := errors.New("Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction")
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
	if got := telemetry.CounterValueForTest(reg, telemetry.MDeadlocks, "kind", "deadlock"); got != 2 {
		t.Fatalf("db_deadlocks_total{kind=deadlock} must count one per absorbed retry (2), got %v", got)
	}
}

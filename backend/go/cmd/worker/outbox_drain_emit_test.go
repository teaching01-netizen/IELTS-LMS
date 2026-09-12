package main

// Plan E3: the outbox drain slice (claimed vs acked-by-family) proves
// arrival-vs-drain health beyond the pending gauge. RED: drain emits
// MOutboxClaimed per event and MOutboxAcked{family} per ack.
import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestDrainOutboxEmitsClaimed(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := outbox.NewRepository(db)
	w := &worker{db: db, outbox: repo, workerID: "test-worker"}

	// Claim one wakeup event; without a liveBus publishWakeup fails and
	// the event retries via MarkFailed. Assert claimed counting.
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE outbox_events")).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	cols := []string{"id", "aggregate_kind", "aggregate_id", "revision", "event_family", "payload", "created_at", "publish_attempts", "last_error", "claim_token", "next_attempt_at", "failed_at"}
	mock.ExpectQuery("SELECT id, aggregate_kind").
		WillReturnRows(sqlmock.NewRows(cols).
			AddRow("ev-1", "schedule_runtime", "sched-1", 1, "runtime_changed", `{}`, time.Now().UTC(), 1, nil, "tok-1", nil, nil))
	mock.ExpectCommit()
	mock.ExpectExec("UPDATE outbox_events SET claimed_at").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "ev-1", sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))

	claimed, _, failed, _ := w.drainOutbox(context.Background(), repo, 10)
	if claimed != 1 || failed != 1 {
		t.Fatalf("drain = claimed %d failed %d, want 1/1", claimed, failed)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MOutboxClaimed); got != 1 {
		t.Fatalf("claimed must count 1, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestOutboxAckedCounterExists(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	telemetry.IncCounter(telemetry.MOutboxAcked, "family", "runtime_changed")
	if got := telemetry.CounterValueForTest(reg, telemetry.MOutboxAcked, "family", "runtime_changed"); got != 1 {
		t.Fatalf("acked series must exposition, got %v", got)
	}
}

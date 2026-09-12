package main

// WS-09 per-attempt fan-out pins (sqlmock scope; no live DB needed).
//
//   - TestExecuteOutboxEventReusesID pins the load-bearing identity
//     contract FIRST: every seal in the batch reuses the batch-shared
//     event.ID as the terminalization RequestID (service.go mints a fresh
//     UUID only for non-UUID request ids — event.ID is a UUID, so it is
//     preserved verbatim and reseals replay the same receipt). UUID
//     behavior is pinned, never changed.
//   - TestPoisonAttemptMidBatchCompletes: one poison attempt quarantines
//     to its own DLQ row while good attempts seal; the event still acks
//     (no whole-batch burn).
//   - TestLateArrivalMidFanOutPickedUp: an attempt that becomes eligible
//     mid-seal is sealed by the one-shot rescan in the same claim.
//   - TestRequeueFlagParsing: the operator requeue CLI parses both flag
//     spellings and stays silent without the command.
//   - TestIsTerminalConflictMatrix: settled conflicts are permanent;
//     everything else stays retryable.
import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/terminalization"
)

// captureSealer records every RequestID it receives and fails named
// attempts, so tests assert identity reuse + per-attempt continuation.
type captureSealer struct {
	requestIDs []string
	attemptIDs []string
	fail       map[string]error
}

func (c *captureSealer) Terminalize(_ context.Context, cmd terminalization.SealCommand) (*terminalization.SealResult, error) {
	c.requestIDs = append(c.requestIDs, cmd.RequestID)
	c.attemptIDs = append(c.attemptIDs, cmd.AttemptID)
	if err, ok := c.fail[cmd.AttemptID]; ok {
		return nil, err
	}
	return &terminalization.SealResult{Created: true, TerminalizationID: "term-" + cmd.AttemptID}, nil
}

func fanoutWorker(db *sql.DB, seal *captureSealer) *worker {
	repo := outbox.NewRepository(db)
	return (&worker{db: db, outbox: repo, workerID: "test-worker"}).setTerminalSealer(seal)
}

func loadRow(mock sqlmock.Sqlmock, attempt, provider, proctor string) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a JOIN exam_entities e")).
		WithArgs(attempt, "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "proctor_status"}).AddRow(provider, proctor))
}

func fanoutEvent(ids ...string) outbox.Event {
	raw, _ := json.Marshal(map[string]any{"scheduleId": "sched-1", "attemptIds": ids, "reason": terminalization.ReasonProctorComplete})
	return outbox.Event{
		ID: "ev-batch-1", AggregateKind: "schedule_runtime", AggregateID: "sched-1",
		Revision: 3, Family: outbox.FamilyAutoSubmitScheduleAttempts,
		Payload: raw, CreatedAt: time.Now().UTC(), PublishAttempts: 1,
	}
}

func expectQuarantine(mock sqlmock.Sqlmock, attempt string) {
	mock.ExpectExec(regexp.QuoteMeta("INSERT IGNORE INTO outbox_dead_letters")).
		WithArgs(sqlmock.AnyArg(), "ev-batch-1", attempt, int64(3), outbox.FamilyAutoSubmitScheduleAttempts, sqlmock.AnyArg(), sqlmock.AnyArg(), 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
}

func expectRescanEmpty(mock sqlmock.Sqlmock, maxSeen string) {
	mock.ExpectQuery(regexp.QuoteMeta("AND a.id > ?")+".*"+regexp.QuoteMeta("ORDER BY a.id")).
		WithArgs("sched-1", maxSeen, autoSubmitCursorBatch+1).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
}

func TestExecuteOutboxEventReusesID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seal := &captureSealer{}
	w := fanoutWorker(db, seal)

	loadRow(mock, "att-1", "ielts", "active")
	loadRow(mock, "att-2", "ielts", "active")
	expectRescanEmpty(mock, "att-2")

	if err := w.executeOutboxEvent(context.Background(), fanoutEvent("att-1", "att-2")); err != nil {
		t.Fatalf("fan-out must complete: %v", err)
	}
	if len(seal.requestIDs) != 2 {
		t.Fatalf("expected 2 seals, got %d", len(seal.requestIDs))
	}
	for i, got := range seal.requestIDs {
		if got != "ev-batch-1" {
			t.Fatalf("seal %d RequestID = %q, want batch-shared event.ID %q (service.go preserves UUID request ids verbatim; changing this forks terminal facts)", i, got, "ev-batch-1")
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestPoisonAttemptMidBatchCompletes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seal := &captureSealer{fail: map[string]error{
		"att-bad": fmt.Errorf("auto-submit attempt att-bad: %w", errors.New("seal: boom")),
	}}
	w := fanoutWorker(db, seal)

	loadRow(mock, "att-1", "ielts", "active")
	loadRow(mock, "att-bad", "ielts", "active")
	loadRow(mock, "att-2", "ielts", "active")
	expectQuarantine(mock, "att-bad")
	// Max over the full payload list [att-1 att-bad att-2]: att-bad sorts
	// highest, so the rescan cursor is att-bad (documents the max-id
	// cursor contract).
	expectRescanEmpty(mock, "att-bad")

	// Poison mid-batch: good seals land, poison quarantines, nil error so
	// the drain acks the event (no whole-batch burn, no retry storm).
	if err := w.executeOutboxEvent(context.Background(), fanoutEvent("att-1", "att-bad", "att-2")); err != nil {
		t.Fatalf("poison mid-batch must still complete: %v", err)
	}
	if len(seal.attemptIDs) != 3 {
		t.Fatalf("every attempt must be tried exactly once, got %v", seal.attemptIDs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestLateArrivalMidFanOutPickedUp(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seal := &captureSealer{}
	w := fanoutWorker(db, seal)

	loadRow(mock, "att-1", "ielts", "active")
	loadRow(mock, "att-2", "ielts", "active")
	// Late arrival att-3 appears after max seen id att-2.
	mock.ExpectQuery(regexp.QuoteMeta("AND a.id > ?")+".*"+regexp.QuoteMeta("ORDER BY a.id")).
		WithArgs("sched-1", "att-2", autoSubmitCursorBatch+1).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-3"))
	loadRow(mock, "att-3", "ielts", "active")

	if err := w.executeOutboxEvent(context.Background(), fanoutEvent("att-1", "att-2")); err != nil {
		t.Fatalf("fan-out with late arrival must complete: %v", err)
	}
	found := false
	for _, id := range seal.attemptIDs {
		if id == "att-3" {
			found = true
		}
	}
	if !found {
		t.Fatalf("late arrival att-3 must be sealed by the rescan, tried=%v", seal.attemptIDs)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRequeueFlagParsing(t *testing.T) {
	for _, tc := range []struct {
		name string
		args []string
		want string
	}{
		{"long id", []string{"requeue-dead-letter", "--id", "dlq-1"}, "dlq-1"},
		{"equals", []string{"requeue-dead-letter", "--id=dlq-2"}, "dlq-2"},
		{"alias", []string{"requeue", "--requeue", "dlq-3"}, "dlq-3"},
		{"alias equals", []string{"requeue", "--requeue=dlq-4"}, "dlq-4"},
		{"positional", []string{"requeue-dead-letter", "dlq-5"}, "dlq-5"},
		{"no command", []string{}, ""},
		{"other args", []string{"--verbose"}, ""},
		{"missing value", []string{"requeue-dead-letter"}, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := requeueDeadLetterID(tc.args); got != tc.want {
				t.Fatalf("requeueDeadLetterID(%v) = %q, want %q", tc.args, got, tc.want)
			}
		})
	}
}

func TestIsTerminalConflictMatrix(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want bool
	}{
		{"nil", nil, false},
		{"terminalization conflict", fmt.Errorf("seal: %s", terminalization.ReasonTerminalizationConflict), true},
		{"proctor blocked", fmt.Errorf("claim: %s", terminalization.ReasonAttemptProctorBlocked), true},
		{"load error", errors.New("load auto-submit attempt att-1: connection refused"), false},
		{"validation", errors.New("Terminalization reason is not supported."), false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := isTerminalConflict(tc.err); got != tc.want {
				t.Fatalf("isTerminalConflict(%v) = %v, want %v", tc.err, got, tc.want)
			}
		})
	}
}

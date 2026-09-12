package outbox

// WS-09 dead-letter quarantine pins (sqlmock scope; no live DB needed).
//
//   - TestMarkFailedTerminalInsertsDLQAtomically: attempts>=8 parks the row
//     AND inserts the DLQ evidence row in ONE transaction, then fires
//     outbox_terminal_total{family}. The non-terminal retry path stays
//     single-statement and DLQ-free (backoff matrix pinned separately in
//     outbox_test.go).
//   - TestMarkFailedRetrySchedulesBackoffUnchanged: attempts<8 keeps the
//     byte-identical retry UPDATE (no DLQ, no counter).
//   - TestQuarantineAttemptIdempotentInsert: per-attempt quarantine is
//     single-statement INSERT IGNORE; only the first insert counts + logs.
//   - TestRequeueDeadLetterResolvesOnce: requeue inserts a fresh outbox row
//     and resolves the letter atomically; a resolved letter fails closed.
//   - TestWithRequeueTokenTagsObjectsOnly: object payloads gain the
//     traceability token; non-object payloads pass through untouched.
import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func dlqCols() []string {
	return []string{"id", "aggregate_kind", "aggregate_id", "revision", "event_family", "payload", "created_at", "publish_attempts", "last_error", "claim_token", "next_attempt_at", "failed_at"}
}

func TestMarkFailedTerminalInsertsDLQAtomically(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db)

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM outbox_events")+".*"+regexp.QuoteMeta("claim_token = ?")).
		WithArgs("ev-1", "tok-1").
		WillReturnRows(sqlmock.NewRows([]string{"aggregate_kind", "aggregate_id", "revision", "event_family", "payload"}).
			AddRow("schedule_runtime", "sched-1", int64(3), FamilyAutoSubmitScheduleAttempts, `{"scheduleId":"sched-1"}`))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE outbox_events")+".*"+regexp.QuoteMeta("failed_at = NOW()")).WithArgs("boom", "ev-1", "tok-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO outbox_dead_letters")).
		WithArgs(sqlmock.AnyArg(), "ev-1", "schedule_runtime", "sched-1", int64(3), FamilyAutoSubmitScheduleAttempts, `{"scheduleId":"sched-1"}`, "boom", 8, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	if disp, err := repo.MarkFailed(context.Background(), "tok-1", "ev-1", 8, "boom"); err != nil || disp != Terminal {
		t.Fatalf("MarkFailed terminal = (%v, %v); want (Terminal, nil)", disp, err)
	}
	if got := telemetry.CounterValueForTest(reg, MOutboxTerminalTotal, "family", FamilyAutoSubmitScheduleAttempts); got != 1 {
		t.Fatalf("outbox_terminal_total{family} must fire once, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestMarkFailedRetrySchedulesBackoffUnchanged(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db)

	// Attempts=1 -> 5s backoff, single retry UPDATE, no tx, no DLQ.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE outbox_events")+".*"+regexp.QuoteMeta("next_attempt_at = DATE_ADD")).WithArgs(int64(5), int64(5), "flaky", "ev-9", "tok-9").WillReturnResult(sqlmock.NewResult(0, 1))
	if disp, err := repo.MarkFailed(context.Background(), "tok-9", "ev-9", 1, "flaky"); err != nil || disp != RetryAfter {
		t.Fatalf("MarkFailed retry = (%v, %v); want (RetryAfter, nil)", disp, err)
	}
	if got := telemetry.CounterValueForTest(reg, MOutboxTerminalTotal, "family", FamilyAutoSubmitScheduleAttempts); got != 0 {
		t.Fatalf("retry path must not fire the terminal counter, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestQuarantineAttemptIdempotentInsert(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db)
	src := Event{ID: "ev-1", AggregateKind: "schedule_runtime", AggregateID: "sched-1", Revision: 3, Family: FamilyAutoSubmitScheduleAttempts, PublishAttempts: 2}

	mock.ExpectExec(regexp.QuoteMeta("INSERT IGNORE INTO outbox_dead_letters")).
		WithArgs(sqlmock.AnyArg(), "ev-1", "att-bad", int64(3), FamilyAutoSubmitScheduleAttempts, sqlmock.AnyArg(), "seal: boom", 2, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// Reseal replay: the UNIQUE(source_event_id, aggregate_id) absorbs the
	// duplicate — 0 rows, no second count.
	mock.ExpectExec(regexp.QuoteMeta("INSERT IGNORE INTO outbox_dead_letters")).
		WithArgs(sqlmock.AnyArg(), "ev-1", "att-bad", int64(3), FamilyAutoSubmitScheduleAttempts, sqlmock.AnyArg(), "seal: boom", 2, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 0))

	if err := repo.QuarantineAttempt(context.Background(), src, "att-bad", "seal", errBoom()); err != nil {
		t.Fatalf("first quarantine: %v", err)
	}
	if err := repo.QuarantineAttempt(context.Background(), src, "att-bad", "seal", errBoom()); err != nil {
		t.Fatalf("replay quarantine must stay idempotent: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, MOutboxTerminalTotal, "family", FamilyAutoSubmitScheduleAttempts); got != 1 {
		t.Fatalf("duplicate quarantine must count exactly once, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRequeueDeadLetterResolvesOnce(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db)
	dlqPayload := `{"scheduleId":"sched-1"}`
	token := "tok64-" + "0123456789abcdef0123456789abcdef0123456789abcdef01234567"

	// First requeue: letter open -> fresh event + guarded resolve.
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM outbox_dead_letters") + ".*" + regexp.QuoteMeta("FOR UPDATE")).
		WithArgs("dlq-1").
		WillReturnRows(sqlmock.NewRows([]string{"aggregate_kind", "aggregate_id", "revision", "event_family", "payload", "requeue_token", "resolved_at"}).
			AddRow("schedule_runtime", "sched-1", int64(3), FamilyAutoSubmitScheduleAttempts, dlqPayload, token, nil))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO outbox_events")).
		WithArgs(sqlmock.AnyArg(), "schedule_runtime", "sched-1", int64(3), FamilyAutoSubmitScheduleAttempts, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE outbox_dead_letters SET resolved_at")).
		WithArgs("dlq-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	newID, err := repo.RequeueDeadLetter(context.Background(), "dlq-1")
	if err != nil || newID == "" {
		t.Fatalf("RequeueDeadLetter = (%q, %v); want (non-empty, nil)", newID, err)
	}

	// Second requeue: already resolved -> fail closed, no duplicate event.
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM outbox_dead_letters") + ".*" + regexp.QuoteMeta("FOR UPDATE")).
		WithArgs("dlq-1").
		WillReturnRows(sqlmock.NewRows([]string{"aggregate_kind", "aggregate_id", "revision", "event_family", "payload", "requeue_token", "resolved_at"}).
			AddRow("schedule_runtime", "sched-1", int64(3), FamilyAutoSubmitScheduleAttempts, dlqPayload, token, time.Now().UTC()))
	mock.ExpectRollback()

	if _, err := repo.RequeueDeadLetter(context.Background(), "dlq-1"); err == nil {
		t.Fatal("requeue of a resolved letter must fail closed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestWithRequeueTokenTagsObjectsOnly(t *testing.T) {
	out := withRequeueToken(`{"scheduleId":"sched-1"}`, "tok-abc")
	var obj map[string]any
	if err := json.Unmarshal([]byte(out), &obj); err != nil {
		t.Fatalf("tagged payload must stay valid JSON: %v", err)
	}
	if obj["dlqRequeueToken"] != "tok-abc" || obj["scheduleId"] != "sched-1" {
		t.Fatalf("tag must preserve payload and add token, got %s", out)
	}
	if got := withRequeueToken(`[1,2]`, "tok-abc"); got != `[1,2]` {
		t.Fatalf("non-object payload must pass through, got %q", got)
	}
}

func TestDeadLetterRowShapeDocumentsDLQContract(t *testing.T) {
	// Compile-time shape pin: adding/removing DeadLetter fields breaks
	// callers here loudly (keeps the Go struct aligned with 0055 columns).
	d := DeadLetter{
		ID: "dlq-1", SourceEventID: "ev-1", AggregateKind: "schedule_runtime",
		AggregateID: "sched-1", Revision: 3, Family: FamilyAutoSubmitScheduleAttempts,
		Payload: json.RawMessage(`{}`), Error: "boom", Attempts: 8,
		FailedAt: sql.NullTime{}, RequeueToken: "tok", ResolvedAt: sql.NullTime{},
	}
	if d.SourceEventID != "ev-1" || d.AggregateID != "sched-1" || d.Attempts != 8 {
		t.Fatalf("unexpected DeadLetter shape: %+v", d)
	}
	_ = dlqCols
}

type boomErr struct{}

func (boomErr) Error() string { return "seal: boom" }

func errBoom() error { return boomErr{} }

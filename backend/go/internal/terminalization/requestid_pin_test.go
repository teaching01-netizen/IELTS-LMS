package terminalization

// WS-09 UUID pin: the RequestID boundary in sealAttemptInTx
// (service.go:561-565) is load-bearing for the worker fan-out.
//
//   - A caller-supplied UUID (the worker's batch-shared event.ID) is
//     preserved verbatim as the receipt request_id, so every attempt sealed
//     under one outbox event shares one idempotency key and every reseal
//     replays the same receipt.
//   - A non-UUID request id (legacy "timeout-<attempt>" shape, hand-written
//     callers) mints a fresh UUID so the receipt keeps its CHAR(36) UUID
//     shape and uniqueness.
//
// This test pins the behavior; it never changes the mint logic.
import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// captureRepo delegates reads to "no receipt" and captures the Insert.
type captureRepo struct {
	got *Receipt
}

func (c *captureRepo) FindByAttemptID(_ context.Context, _ tx.Tx, _ string) (*Receipt, error) {
	return nil, nil
}

func (c *captureRepo) Insert(_ context.Context, _ tx.Tx, r *Receipt) error {
	cp := *r
	c.got = &cp
	return nil
}

func pinFreshSeal(t *testing.T, requestID string) string {
	t.Helper()
	db, mock, err := sqlmock.New(sqlmock.QueryMatcherOption(sqlmock.QueryMatcherRegexp))
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.MatchExpectationsInOrder(true)
	repo := &captureRepo{}
	svc := NewService(tx.NewRunner(db), repo, SQLOutboxEnqueuer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("running", "active"))
	sealExpectProvider(mock, "ielts")
	sealExpectRecordedAt(mock)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO outbox_events")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	cmd := baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent)
	cmd.RequestID = requestID
	if _, err := svc.Terminalize(context.Background(), cmd); err != nil {
		t.Fatalf("fresh seal with request %q: %v", requestID, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if repo.got == nil {
		t.Fatal("Insert must have been called")
	}
	return repo.got.RequestID
}

func TestRequestIDPreservesCallerUUID(t *testing.T) {
	const eventID = "11111111-2222-4333-8444-555555555555"
	if _, err := uuid.Parse(eventID); err != nil {
		t.Fatalf("pin event id must be a UUID, got %v", err)
	}
	if got := pinFreshSeal(t, eventID); got != eventID {
		t.Fatalf("UUID request id must be preserved verbatim, got %q want %q (the worker reuses event.ID across the batch; minting here would fork terminal facts)", got, eventID)
	}
}

func TestRequestIDMintsFreshForNonUUID(t *testing.T) {
	got := pinFreshSeal(t, "timeout-att-1")
	if got == "timeout-att-1" {
		t.Fatal("non-UUID request id must not reach the receipt verbatim (CHAR(36) UUID shape)")
	}
	if _, err := uuid.Parse(got); err != nil {
		t.Fatalf("minted request id must be a UUID, got %q (%v)", got, err)
	}
}

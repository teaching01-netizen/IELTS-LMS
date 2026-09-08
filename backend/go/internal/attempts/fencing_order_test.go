package attempts

// Plan invariant I1: the V2 write contract locks the attempt FIRST, then
// fences (lease/control) BEFORE touching runtime state or mutation rows.
// A stale-lease batch must die at the fence without ever locking runtime
// or probing mutations — otherwise a fenced writer still contends on hot
// rows (lock-order violation + wasted work under the entry wave).
// This test pins the decision order: lease-fenced batch issues exactly
// attempt lock -> session verify -> exact-replay probe -> fence fires,
// with NO runtime lock and NO further mutation probes. (The replay probe
// before fencing is plan-21 intent: authorized-at-current-lease replay
// never mutates twice.)
//
// NOTE: passes today — implementation already fences before hot rows.
// The test is the pin: moving rl.Lock() above the fence, or adding a
// version/response probe pre-fence, fails here (strict sqlmock).
import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestFencedBatchTouchesNoHotRows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	// The exact-replay probe runs before fencing (plan 21: replay is
	// authorized at current lease, never mutates twice) — one probe,
	// then the fence fires. NO runtime lock, NO further mutation probes.
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnRows(sqlmock.NewRows([]string{
		"request_hash", "response_hash", "outcome", "server_revision", "canonical_response",
	}))
	mock.ExpectRollback()

	// Attempt is at lease 3, control 7; writer sends stale lease 2.
	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 2, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-fenced", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if codeOf(err) != "LEASE_FENCED" {
		t.Fatalf("expected LEASE_FENCED, got %v", err)
	}
	// Strict: every expectation met AND nothing else issued. If the
	// implementation ever locks runtime or probes version rows before
	// fencing, sqlmock fails here (unexpected query / unmet rollback).
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Revocation fencing for the V2 write path (session-fence hardening).
//
// The service re-verifies the attempt bearer with crypto at the edge, then
// validateTokenSession binds token_id against attempt_sessions in-tx. These
// tests pin the fail-closed edges: revoked/unknown sessions 401 with zero
// writes, empty TokenIDs 401 without any session SELECT, and the optional
// BearerTokenID threading binds the edge-resolved token id (mismatch 401s
// before any tx begins; a match proceeds normally).
//
// Helpers (testService/mintToken/baseClaims/attemptRows/sessionRows/
// liveStubs/codeOf) are reused from concurrency_test.go.
package attempts

import (
	"context"
	"database/sql"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func saveCmdForFence() SaveResponsesCommand {
	return SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
}

// A post-takeover replay presents a valid crypto bearer whose session row is
// revoked. With the revoked_at IS NULL predicate the revoked row no longer
// matches, so the session lookup misses: 401 UNAUTHORIZED with zero further
// writes (no exact-replay probe, no mutation probes after the fence).
func TestRevokedReplayFailsClosedZeroWrites(t *testing.T) {
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
	// Predicate-filtered revoked row surfaces as a session miss.
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, saveCmdForFence(), qr, rl)
	e, ok := apperrors.As(err)
	if !ok || e.Code != apperrors.CodeUnauthorized || e.HTTPStatus != 401 {
		t.Fatalf("expected 401 UNAUTHORIZED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An empty TokenID crypto-verifies fine (the signature covers the empty
// string) but must fail closed explicitly in validateTokenSession before
// any session SELECT is issued.
func TestEmptyTokenIDFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	claims := baseClaims()
	claims.TokenID = ""
	bearer := mintToken(t, secret, claims)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	// No session query: the empty-TokenID check fires first.
	mock.ExpectRollback()

	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, saveCmdForFence(), qr, rl)
	e, ok := apperrors.As(err)
	if !ok || e.Code != apperrors.CodeUnauthorized || e.HTTPStatus != 401 {
		t.Fatalf("expected 401 UNAUTHORIZED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A non-empty BearerTokenID that disagrees with the crypto-resolved
// TokenID fails closed before any tx begins (zero SQL expectations).
func TestBearerTokenIDMismatchFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	cmd := saveCmdForFence()
	cmd.BearerTokenID = "tok-other"
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e, ok := apperrors.As(err)
	if !ok || e.Code != apperrors.CodeAttemptTokenInvalid || e.HTTPStatus != 401 {
		t.Fatalf("expected 401 ATTEMPT_TOKEN_INVALID, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A matching BearerTokenID must not change the decision path: stale lease
// still fences exactly like the unthreaded call (TestTakeoverOldWriterFenced
// shape).
func TestBearerTokenIDMatchProceeds(t *testing.T) {
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
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	// Attempt is at lease 3; writer still sends lease 2.
	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 2, ControlEpoch: 7, BearerTokenID: "tok-1",
		Commands: []ResponseCommand{{WriteID: "w-9", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if codeOf(err) != apperrors.CodeLeaseFenced {
		t.Fatalf("expected LEASE_FENCED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

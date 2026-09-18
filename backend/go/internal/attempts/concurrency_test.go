// Concurrency matrix for the V2 write path (plan 111).
//
// These tests use sqlmock to drive the service through interleavings the
// single-threaded happy path cannot show: duplicate write IDs with
// different hashes, stale client versions, fenced leases, stale control
// epochs, takeover by a new session, and submit-vs-submit replay misuse.
// Real lock contention stays in the DB integration suite (plan 110);
// what is pinned here is the DECISION each interleaving must produce.
package attempts

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

type stubResolver struct{ owner QuestionOwner }

func (s stubResolver) Resolve(_ context.Context, _ tx.Tx, _, _ string) (QuestionOwner, error) {
	return s.owner, nil
}

type stubLocker struct{ gate RuntimeGate }

func (s stubLocker) Lock(_ context.Context, _ tx.Tx, _ string) (RuntimeGate, error) {
	return s.gate, nil
}

// stubProviders implements ProviderResolver: the submit transaction asks for
// the provider on the locked attempt row. Tests pass the value the attempt's
// exam row would carry; calls counts the resolutions so a test can prove the
// decision was taken exactly once, in-tx.
type stubProviders struct {
	provider Provider
	err      error
	calls    int
}

func providerStub(p Provider) *stubProviders { return &stubProviders{provider: p} }

func (s *stubProviders) ResolveProvider(_ context.Context, _ tx.Tx, _ string) (Provider, error) {
	s.calls++
	return s.provider, s.err
}

func testService(db *sql.DB, secret []byte) *Service {
	return NewService(tx.NewRunner(db), clock.FixedAt(time.Now().UTC()), secret)
}

func mintToken(t *testing.T, secret []byte, claims crypto.AttemptClaims) string {
	t.Helper()
	tok, err := crypto.SignAttemptToken(secret, claims)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func baseClaims() crypto.AttemptClaims {
	lease := uint64(3)
	return crypto.AttemptClaims{
		TokenID: "tok-1", UserID: "u-1", ScheduleID: "sched-1",
		AttemptID: "att-1", ClientSessionID: "sess-1", LeaseEpoch: &lease,
		Exp: time.Now().Add(15 * time.Minute).Unix(),
	}
}

func attemptRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "user_id", "organization_id", "protocol_version",
		"delivery_status", "phase", "lease_epoch", "control_epoch",
		"response_revision", "deadline_at", "closing_grace_until",
		"submitted_at", "final_submission", "proctor_status",
	}).AddRow("att-1", "sched-1", "u-1", "", 2, "running", "exam", 3, 7, 9, nil, nil, nil, nil, "active")
}

func sessionRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"attempt_id", "client_session_id", "revoked_at", "expires_at"}).
		AddRow("att-1", "sess-1", nil, nil)
}

func codeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func liveStubs() (stubResolver, stubLocker) {
	qr := stubResolver{owner: QuestionOwner{ModuleID: "m-listening", SectionKey: "*", ModuleState: "active"}}
	rl := stubLocker{gate: RuntimeGate{Status: "live", ActiveSectionKey: "*", SectionLive: true, SectionStarted: true, Now: time.Now().UTC()}}
	return qr, rl
}

// Same write ID reused with different content must conflict, never silently
// overwrite (plan 111: same write concurrently).
func TestConcurrentSameWriteConflicts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	claims := baseClaims()
	bearer := mintToken(t, secret, claims)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	// exactReplay probe: no stored row -> not a replay.
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	// Active-session check passes.
	mock.ExpectQuery("SELECT active_client_session_id").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// Idempotency probe finds the write ID with a DIFFERENT hash.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).AddRow("other-hash", "hash", "applied", 4, `{"answer":null,"markedForReview":false,"eliminatedOptions":[],"annotations":[]}`))
	mock.ExpectRollback()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if codeOf(err) != apperrors.CodeWriteIDConflict {
		t.Fatalf("expected WRITE_ID_CONFLICT, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Same question+version under a different write ID must collide (plan 111:
// same version different write).
func TestConcurrentSameVersionDifferentWriteCollides(t *testing.T) {
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
	mock.ExpectQuery("SELECT active_client_session_id").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// Idempotency probe: write ID unseen.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WillReturnError(sql.ErrNoRows)
	// Version-collision probe: same lease/question/version already taken.
	mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").
		WillReturnRows(sqlmock.NewRows([]string{"client_write_id"}).AddRow("w-other"))
	mock.ExpectRollback()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-new", QuestionID: "q-1", ClientVersion: 2, Response: ResponsePayload{Answer: "B"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if codeOf(err) != apperrors.CodeVersionCollision {
		t.Fatalf("expected VERSION_COLLISION, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Old lease epoch after a takeover must fence (plan 111: takeover vs old
// writer). No DB write may happen after the fence decision.
func TestTakeoverOldWriterFenced(t *testing.T) {
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
	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 2, ControlEpoch: 7,
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

// Pause (control bump) racing an in-flight batch must go stale, not apply
// half the batch (plan 111: pause vs response).
func TestPauseVsResponseGoesStale(t *testing.T) {
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

	// Attempt control is 7; batch was built before the pause (control 6).
	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 6,
		Commands: []ResponseCommand{{WriteID: "w-9", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if codeOf(err) != apperrors.CodeControlEpochStale {
		t.Fatalf("expected CONTROL_EPOCH_STALE, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Submit vs response racing a pause: a submit whose lease is current but
// whose attempt no longer accepts writes (paused by a proctor mid-flight)
// must fail closed with ATTEMPT_NOT_WRITABLE — the runtime gate in
// submitInTx runs before any digest, seal, or receipt write (plan 111:
// submit vs response).
func TestSubmitVsResponseOnPausedAttempt(t *testing.T) {
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
	// Paused delivery status: lease still matches (3), writability fails.
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(
		sqlmock.NewRows([]string{
			"id", "schedule_id", "user_id", "organization_id", "protocol_version",
			"delivery_status", "phase", "lease_epoch", "control_epoch",
			"response_revision", "deadline_at", "closing_grace_until",
			"submitted_at", "final_submission", "proctor_status",
		}).AddRow("att-1", "sched-1", "u-1", "", 2, "paused", "exam", 3, 7, 9, nil, nil, nil, nil, "active"))
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	mock.ExpectQuery("SELECT UTC_TIMESTAMP\\(6\\)").WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectRollback()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-race"}
	_, err = svc.Submit(context.Background(), bearer, cmd, nil, nil, providerStub(ProviderIELTS), nil)
	if codeOf(err) != apperrors.CodeAttemptNotWritable {
		t.Fatalf("expected ATTEMPT_NOT_WRITABLE, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A second submit with a different submission ID while one receipt exists
// is replay misuse, not a second terminal fact (plan 111: submit vs submit).
func TestSubmitVsSubmitReplayMisuse(t *testing.T) {
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
	// Existing receipt with a different submission ID + hash.
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").
		WillReturnRows(sqlmock.NewRows([]string{"submission_id", "request_hash", "final_response_digest", "receipt_json", "submitted_at"}).
			AddRow("sub-old", "hash-old", "digest-old", `{}`, time.Now().UTC()))
	mock.ExpectRollback()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-new"}
	qr, rl := liveStubs()
	_, err = svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderIELTS), nil)
	if codeOf(err) != apperrors.CodeSubmissionReplayMisuse {
		t.Fatalf("expected SUBMISSION_ID_MISUSE, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package attempts

// WP-C1 backend contract hardening (tests only; no prod-logic change).
//
// Pins the server half of the student-answer durability contract the client
// now relies on: version uniqueness, writeId idempotency + exact replay,
// epoch fencing, fence precedence, envelope precedence, and the
// monotonic-projection superseded rule (lease arm included). All
// expectations below encode ACTUAL current behavior in service.go /
// submit.go / validate.go (read-only reference); nothing here changes
// production code.
//
// Harness follows concurrency_test.go / fencing_order_test.go /
// rowfirst_test.go / submit_receipt_compat_test.go: sqlmock drives
// saveInTx/submitInTx through the probe chain with strict ordered
// expectations, so any reordering of fence/probe queries, any
// outcome-label change, or any arg-shape change fails here first.
//
// sqlmock v1.5.2 argument semantics (pinned by every WithArgs below):
// expected args go through the database/sql driver converter and compare
// with reflect.DeepEqual, so integer KIND matters on the wire. Lease
// epochs, client versions and server revisions flow as uint64 and are
// pinned as uint64(...), never as bare int: an int pin would fail the
// expectation even when the numeric value matches. That strictness is the
// point — ledger-vs-ack divergence (wrong rev, wrong outcome, wrong hash
// on the INSERT) fails here instead of silently passing.
import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// durabilityFenceStubs stages the shared prefix every fenced or replayed
// batch walks: tx begin, attempt lock, session binding. WithArgs pins the
// lock to attempt att-1 and the session lookup to token tok-1, so a query
// hitting the wrong row fails here instead of silently passing.
func durabilityFenceStubs(mock sqlmock.Sqlmock, attempt *sqlmock.Rows) {
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(attempt)
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WithArgs("tok-1").WillReturnRows(sessionRows())
}

// durabilityAttemptRowsAs mirrors attemptRows() with an overridden delivery
// status so terminal-state replayability pins without touching the shared
// helper other tests depend on.
func durabilityAttemptRowsAs(status string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "user_id", "organization_id", "protocol_version",
		"delivery_status", "phase", "lease_epoch", "control_epoch",
		"response_revision", "deadline_at", "closing_grace_until",
		"submitted_at", "final_submission", "proctor_status", "provider_key",
	}).AddRow("att-1", "sched-1", "u-1", "", 2, status, "exam", 3, 7, 9, nil, nil, nil, nil, "active", "")
}

func durabilitySATAttemptRows(deadline, grace time.Time) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "user_id", "organization_id", "protocol_version",
		"delivery_status", "phase", "lease_epoch", "control_epoch",
		"response_revision", "deadline_at", "closing_grace_until",
		"submitted_at", "final_submission", "proctor_status", "provider_key",
	}).AddRow("att-1", "sched-1", "u-1", "", 2, "running", "exam", 3, 7, 9,
		deadline, grace, nil, nil, "active", "sat")
}

// durabilityReplayRaw is the stored canonical response backing every replay
// pin below: answer A, unmarked, no eliminations, no annotations.
const durabilityReplayRaw = `{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`

// durabilityErr unwraps the typed envelope so tests pin code + HTTP status
// + details together (the wire contract, not just the code string).
func durabilityErr(t *testing.T, err error) *apperrors.Error {
	t.Helper()
	e, ok := apperrors.As(err)
	if !ok || e == nil {
		t.Fatalf("expected typed apperrors.Error, got %v", err)
	}
	return e
}

// (a) Version reuse with a different writeId on the same lease/question/
// version must collide, never fork the ledger (VERSION_COLLISION, 409 +
// question/clientVersion/existingWriteId details).
func TestDurabilityContractVersionReuseCollides(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	durabilityFenceStubs(mock, attemptRows())
	// exactReplay probe: write ID unseen -> not a replay.
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-new").WillReturnError(sql.ErrNoRows)
	// Active-session check passes.
	mock.ExpectQuery("SELECT active_client_session_id").WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// Idempotency probe: write ID unseen.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-new").WillReturnError(sql.ErrNoRows)
	// Version-collision probe: same lease/question/version already taken by
	// w-other. Lease + version pinned as uint64 (v1.5.2 DeepEqual).
	mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").
		WithArgs("att-1", uint64(3), "q-1", uint64(2)).
		WillReturnRows(sqlmock.NewRows([]string{"client_write_id"}).AddRow("w-other"))
	mock.ExpectRollback()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-new", QuestionID: "q-1", ClientVersion: 2, Response: ResponsePayload{Answer: "B"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeVersionCollision {
		t.Fatalf("expected VERSION_COLLISION, got %v", err)
	}
	if e.HTTPStatus != 409 {
		t.Fatalf("VERSION_COLLISION must be HTTP 409, got %d", e.HTTPStatus)
	}
	if e.Details["questionId"] != "q-1" || e.Details["clientVersion"] != uint64(2) || e.Details["existingWriteId"] != "w-other" {
		t.Fatalf("collision details must carry questionId/clientVersion(existing uint64)/existingWriteId, got %v", e.Details)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (b) Exact writeId replay with identical content must return the stored
// ack as duplicate with batch Replayed=true and issue no further writes
// (strict mock: no INSERT/UPDATE exists to double-apply). The ack pins the
// STORED content (canonical answer A, stored content hash, stored server
// revision) — a replay echoing the request instead of the ledger fails.
func TestDurabilityContractExactReplayIsDuplicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
	reqHash, err := commandHash(cmd.Commands[0])
	if err != nil {
		t.Fatal(err)
	}

	durabilityFenceStubs(mock, attemptRows())
	// exactReplay probe: same write ID with the SAME hash -> replay.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").
		WithArgs("att-1", "w-1").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).
			AddRow(reqHash, "resp-hash-1", "applied", uint64(4), durabilityReplayRaw))
	mock.ExpectQuery("SELECT response_revision FROM student_attempts WHERE id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"response_revision"}).AddRow(uint64(9)))
	mock.ExpectCommit()

	qr, rl := liveStubs()
	res, err := svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if err != nil {
		t.Fatalf("exact replay must succeed, got %v", err)
	}
	if !res.Replayed {
		t.Fatalf("exact replay must set batch Replayed=true")
	}
	if len(res.Acks) != 1 {
		t.Fatalf("expected 1 ack, got %d", len(res.Acks))
	}
	ack := res.Acks[0]
	if ack.Outcome != "duplicate" || !ack.Replayed {
		t.Fatalf("expected duplicate+replayed ack, got %+v", ack)
	}
	if ack.WriteID != "w-1" || ack.QuestionID != "q-1" || ack.ClientVersion != 10 {
		t.Fatalf("replay ack must echo the requested write identity, got %+v", ack)
	}
	if ack.ServerRevision != 4 {
		t.Fatalf("replay must return the stored server revision 4, got %d", ack.ServerRevision)
	}
	if ack.ContentHash != "resp-hash-1" {
		t.Fatalf("replay must return the stored content hash, got %q", ack.ContentHash)
	}
	if ack.CanonicalResponse.Answer != "A" {
		t.Fatalf("replay must return the stored canonical answer A, got %+v", ack.CanonicalResponse)
	}
	if res.ResponseRevision != 9 {
		t.Fatalf("replay must not advance the revision, got %d", res.ResponseRevision)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (b2) Exact duplicates stay replayable post-terminal: the replay fast path
// is authorized at the current lease and skips the writability gate, so a
// retry racing submit still resolves as duplicate instead of failing or
// double-applying (service.go: "duplicates stay replayable post-terminal").
// Same stored-content pins as (b): answer A, resp-hash-1, rev 4 / batch 9.
func TestDurabilityContractExactReplaySurvivesTerminal(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
	reqHash, err := commandHash(cmd.Commands[0])
	if err != nil {
		t.Fatal(err)
	}

	durabilityFenceStubs(mock, durabilityAttemptRowsAs("submitted"))
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").
		WithArgs("att-1", "w-1").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).
			AddRow(reqHash, "resp-hash-1", "applied", uint64(4), durabilityReplayRaw))
	mock.ExpectQuery("SELECT response_revision FROM student_attempts WHERE id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"response_revision"}).AddRow(uint64(9)))
	mock.ExpectCommit()

	qr, rl := liveStubs()
	res, err := svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if err != nil {
		t.Fatalf("post-terminal exact replay must succeed, got %v", err)
	}
	if !res.Replayed || len(res.Acks) != 1 || res.Acks[0].Outcome != "duplicate" {
		t.Fatalf("expected duplicate replay, got %+v", res)
	}
	ack := res.Acks[0]
	if ack.ServerRevision != 4 || ack.ContentHash != "resp-hash-1" || ack.CanonicalResponse.Answer != "A" {
		t.Fatalf("post-terminal replay must return stored rev/hash/content, got %+v", ack)
	}
	if res.ResponseRevision != 9 {
		t.Fatalf("post-terminal replay must not advance the revision, got %d", res.ResponseRevision)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDurabilityContractSATExactReplaySurvivesDeadline(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
	reqHash, err := commandHash(cmd.Commands[0])
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	durabilityFenceStubs(mock, durabilitySATAttemptRows(now.Add(-time.Second), now.Add(29*time.Second)))
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").
		WithArgs("att-1", "w-1").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).
			AddRow(reqHash, "resp-hash-1", "applied", uint64(4), durabilityReplayRaw))
	mock.ExpectQuery("SELECT response_revision FROM student_attempts WHERE id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"response_revision"}).AddRow(uint64(9)))
	mock.ExpectCommit()

	qr, rl := liveStubs()
	res, err := svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if err != nil {
		t.Fatalf("exact replay after the SAT deadline must succeed: %v", err)
	}
	if !res.Replayed || len(res.Acks) != 1 || res.Acks[0].ServerRevision != 4 || res.ResponseRevision != 9 {
		t.Fatalf("deadline replay must return the stored ack without advancing revision: %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDurabilityContractSATFreshWriteRejectedInsideClosingGrace(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	now := time.Now().UTC()
	durabilityFenceStubs(mock, durabilitySATAttemptRows(now.Add(-time.Second), now.Add(29*time.Second)))
	// The unseen id misses the replay probe, then lease/session fencing passes.
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-new").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").
		WithArgs("att-1", "w-new").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-new", QuestionID: "q-1", ClientVersion: 11, Response: ResponsePayload{Answer: "B"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeDeadlineExpired || e.HTTPStatus != 422 {
		t.Fatalf("fresh SAT write during closing grace must be rejected as expired, got %s/%d", e.Code, e.HTTPStatus)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (c1) Stale lease epoch after a takeover must fence with LEASE_FENCED
// (HTTP 403) and touch no hot rows past the replay probe
// (fencing_order_test.go pattern).
func TestDurabilityContractLeaseMismatchFenced(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	durabilityFenceStubs(mock, attemptRows())
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-9").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	// Attempt is at lease 3; writer still sends lease 2.
	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 2, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-9", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeLeaseFenced {
		t.Fatalf("expected LEASE_FENCED, got %v", err)
	}
	if e.HTTPStatus != 403 {
		t.Fatalf("LEASE_FENCED must be HTTP 403, got %d", e.HTTPStatus)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (c2) Stale control epoch after a pause/resume boundary must go stale with
// CONTROL_EPOCH_STALE (HTTP 409 + request/current details). This is a
// TWO-command batch: the replay probe misses on the first write, then the
// fence fires — and the strict mock carries NO INSERT/UPDATE expectations,
// so if either command had applied (ledger INSERT, projection UPSERT,
// revision bump), sqlmock would fail on the unexpected Exec. Atomicity is
// proven by Rollback plus the absence of any write expectation, not by
// comment: neither w-a nor w-b may leave a row behind.
func TestDurabilityContractControlMismatchStale(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	durabilityFenceStubs(mock, attemptRows())
	// exactReplay short-circuits on the first miss: one probe for w-a,
	// none for w-b, then the fence fires before any write.
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-a").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	// Attempt control is 7; batch was built before the pause (control 6).
	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 6,
		Commands: []ResponseCommand{
			{WriteID: "w-a", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}},
			{WriteID: "w-b", QuestionID: "q-2", ClientVersion: 1, Response: ResponsePayload{Answer: "B"}},
		}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeControlEpochStale {
		t.Fatalf("expected CONTROL_EPOCH_STALE, got %v", err)
	}
	if e.HTTPStatus != 409 {
		t.Fatalf("CONTROL_EPOCH_STALE must be HTTP 409, got %d", e.HTTPStatus)
	}
	if e.Details["requestControlEpoch"] != uint64(6) || e.Details["currentControlEpoch"] != uint64(7) {
		t.Fatalf("stale details must carry request/current control epochs (uint64), got %v", e.Details)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (d) A lower UNUSED version (no ledger row for this writeId/version) that
// trails the current projection is accepted into the ledger but acked as
// superseded with the CANONICAL current response: the stored answer wins,
// the stale write never overwrites it, and the revision does not advance.
// This is the actual monotonic-projection rule in service.go (plan 22):
// newer = lease/clientVersion strictly greater; otherwise outcome =
// "superseded", serverRev = current projection rev, ack content = current
// row. Both INSERTs below carry full WithArgs: the ledger row pins
// outcome=superseded, serverRev 9 and the canonical hash, so any
// ledger-vs-ack divergence (ack says superseded@9/hash-current while the
// ledger says otherwise) fails the arg match. No prod-code change was
// needed to pin it.
func TestDurabilityContractLowerUnusedVersionSuperseded(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	const currentRaw = `{"answer":"B","markedForReview":true,"eliminatedOptions":["opt-x"],"annotations":[]}`
	const currentHash = "hash-current"

	durabilityFenceStubs(mock, attemptRows())
	// exactReplay probe: write ID unseen -> not a replay.
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-stale").WillReturnError(sql.ErrNoRows)
	// Active-session check passes.
	mock.ExpectQuery("SELECT active_client_session_id").WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// Idempotency probe: write ID unseen.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-stale").WillReturnError(sql.ErrNoRows)
	// Version probe: version 5 unused by any write (uint64 pins).
	mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").
		WithArgs("att-1", uint64(3), "q-1", uint64(5)).WillReturnError(sql.ErrNoRows)
	// Projection probe: current is lease 3 / version 10 / rev 9, so the
	// incoming version 5 is older -> superseded, not applied.
	mock.ExpectQuery("SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2").
		WithArgs("att-1", "q-1").
		WillReturnRows(sqlmock.NewRows([]string{"lease_epoch", "client_version", "server_revision"}).AddRow(uint64(3), uint64(10), uint64(9)))
	// Canonical-current fetch backing the superseded ack.
	mock.ExpectQuery("response_hash FROM attempt_responses_v2").
		WithArgs("att-1", "q-1").
		WillReturnRows(sqlmock.NewRows([]string{"response", "response_hash"}).AddRow(currentRaw, currentHash))
	// Ledger records the superseded outcome (pinned: outcome, rev, hash
	// must equal the ack); no projection UPDATE and no revision bump follow
	// (changed == 0), then audit + commit.
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").
		WithArgs(sqlmock.AnyArg(), "att-1", "w-stale", uint64(3), uint64(7), "q-1", uint64(5), sqlmock.AnyArg(), currentHash, "superseded", uint64(9), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO session_audit_logs").
		WithArgs(sqlmock.AnyArg(), "sched-1", "u-1", "att-1", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-stale", QuestionID: "q-1", ClientVersion: 5, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	res, err := svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if err != nil {
		t.Fatalf("superseded write must commit, got %v", err)
	}
	if res.Replayed {
		t.Fatalf("superseded write is not a replay")
	}
	if len(res.Acks) != 1 {
		t.Fatalf("expected 1 ack, got %d", len(res.Acks))
	}
	ack := res.Acks[0]
	if ack.Outcome != "superseded" {
		t.Fatalf("expected superseded outcome, got %+v", ack)
	}
	if ack.Replayed {
		t.Fatalf("superseded ack must not be marked replayed")
	}
	if ack.ServerRevision != 9 {
		t.Fatalf("superseded ack must carry the canonical rev 9, got %d", ack.ServerRevision)
	}
	if ack.ContentHash != currentHash {
		t.Fatalf("superseded ack must carry the canonical content hash, got %q", ack.ContentHash)
	}
	if ack.CanonicalResponse.Answer != "B" || !ack.CanonicalResponse.MarkedForReview {
		t.Fatalf("superseded ack must carry the canonical current payload, got %+v", ack.CanonicalResponse)
	}
	if len(ack.CanonicalResponse.EliminatedOptions) != 1 || ack.CanonicalResponse.EliminatedOptions[0] != "opt-x" {
		t.Fatalf("superseded ack must carry the canonical eliminations, got %+v", ack.CanonicalResponse)
	}
	if res.ResponseRevision != 9 {
		t.Fatalf("superseded write must not advance the revision, got %d", res.ResponseRevision)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (d2) Lease dominates version in the monotonic-projection rule: an
// incoming write on an OLDER lease is superseded even when its client
// version is HIGHER than the stored row. Defensive pin: a stray
// higher-lease projection row (visible under READ COMMITTED racing a
// takeover commit) must never be clobbered by a backdated write — the
// stale write lands in the ledger as superseded, the ack carries the
// canonical current content, and the revision does not advance.
func TestDurabilityContractLeaseDominatedSupersede(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	const currentRaw = `{"answer":"B","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`
	const currentHash = "hash-current"

	durabilityFenceStubs(mock, attemptRows())
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-oldlease").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-oldlease").WillReturnError(sql.ErrNoRows)
	// Version 99 unused by any write: the version arm alone would call
	// this write newer — the lease arm overrules it below.
	mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").
		WithArgs("att-1", uint64(3), "q-1", uint64(99)).WillReturnError(sql.ErrNoRows)
	// Projection sits on a NEWER lease (4) at version 1 / rev 9: incoming
	// lease 3 < 4 and 3 != 4, so newer=false despite version 99 > 1.
	mock.ExpectQuery("SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2").
		WithArgs("att-1", "q-1").
		WillReturnRows(sqlmock.NewRows([]string{"lease_epoch", "client_version", "server_revision"}).AddRow(uint64(4), uint64(1), uint64(9)))
	mock.ExpectQuery("response_hash FROM attempt_responses_v2").
		WithArgs("att-1", "q-1").
		WillReturnRows(sqlmock.NewRows([]string{"response", "response_hash"}).AddRow(currentRaw, currentHash))
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").
		WithArgs(sqlmock.AnyArg(), "att-1", "w-oldlease", uint64(3), uint64(7), "q-1", uint64(99), sqlmock.AnyArg(), currentHash, "superseded", uint64(9), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO session_audit_logs").
		WithArgs(sqlmock.AnyArg(), "sched-1", "u-1", "att-1", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-oldlease", QuestionID: "q-1", ClientVersion: 99, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	res, err := svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if err != nil {
		t.Fatalf("lease-dominated supersede must commit, got %v", err)
	}
	if len(res.Acks) != 1 || res.Acks[0].Outcome != "superseded" {
		t.Fatalf("older lease + higher version must supersede, got %+v", res)
	}
	ack := res.Acks[0]
	if ack.ServerRevision != 9 || ack.ContentHash != currentHash || ack.CanonicalResponse.Answer != "B" {
		t.Fatalf("superseded ack must carry canonical rev/hash/content, got %+v", ack)
	}
	if res.ResponseRevision != 9 {
		t.Fatalf("superseded write must not advance the revision, got %d", res.ResponseRevision)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (e1) WRITE_ID_CONFLICT on the exact-replay probe: the write ID is known
// with a DIFFERENT content hash. The conflict fires before fencing and
// before the active-session check (no further probes follow): a reused
// write ID with new content can never overwrite, even across leases.
func TestDurabilityContractWriteIDConflictOnReplayProbe(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	durabilityFenceStubs(mock, attemptRows())
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").
		WithArgs("att-1", "w-1").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).
			AddRow("other-hash", "resp-hash-x", "applied", uint64(4), durabilityReplayRaw))
	mock.ExpectRollback()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeWriteIDConflict {
		t.Fatalf("expected WRITE_ID_CONFLICT, got %v", err)
	}
	if e.HTTPStatus != 409 {
		t.Fatalf("WRITE_ID_CONFLICT must be HTTP 409, got %d", e.HTTPStatus)
	}
	if e.Details["writeId"] != "w-1" {
		t.Fatalf("conflict details must carry the writeId, got %v", e.Details)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (e2) WRITE_ID_CONFLICT on the in-tx idempotency probe: exactReplay misses
// but the per-command probe finds the same write ID with a different hash.
// Realizable under READ COMMITTED when a concurrent batch commits between
// the two SELECTs (TOCTOU) — the second probe must still refuse to
// overwrite. Strict order pins the interleaving: miss, fence pass, active
// pass, then conflict.
func TestDurabilityContractWriteIDConflictInTxProbe(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	durabilityFenceStubs(mock, attemptRows())
	// exactReplay probe misses (row not yet committed at this read) ...
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-1").WillReturnError(sql.ErrNoRows)
	// ... fencing passes (3/7 current) and the session stays active ...
	mock.ExpectQuery("SELECT active_client_session_id").WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// ... then the idempotency probe sees the concurrently committed row
	// with different content -> conflict, never overwrite.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").
		WithArgs("att-1", "w-1").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).
			AddRow("other-hash", "resp-hash-x", "applied", uint64(4), durabilityReplayRaw))
	mock.ExpectRollback()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeWriteIDConflict {
		t.Fatalf("expected WRITE_ID_CONFLICT, got %v", err)
	}
	if e.HTTPStatus != 409 {
		t.Fatalf("WRITE_ID_CONFLICT must be HTTP 409, got %d", e.HTTPStatus)
	}
	if e.Details["writeId"] != "w-1" {
		t.Fatalf("conflict details must carry the writeId, got %v", e.Details)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (e3) WRITE_ID_CONFLICT on the ledger INSERT duplicate race: every probe
// misses, the projection UPSERT lands, then a concurrent committer wins
// the write_id unique key first and our INSERT hits Error 1062 ->
// WRITE_ID_CONFLICT (no Details on this path by design), rollback, and no
// revision bump. The INSERT pins the applied shape (outcome + rev 10) so a
// dup on a malformed row would fail the arg match first.
func TestDurabilityContractWriteIDConflictOnLedgerInsertDup(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	durabilityFenceStubs(mock, attemptRows())
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").
		WithArgs("att-1", uint64(3), "q-1", uint64(10)).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2").
		WithArgs("att-1", "q-1").WillReturnError(sql.ErrNoRows)
	// Legacy projection path (row-first off): blob round trip + cell UPSERT
	// at rev 10 (attempt rev 9 + 1 applied write).
	mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
	mock.ExpectExec("UPDATE student_attempts SET answers=").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_responses_v2").
		WithArgs("att-1", "q-1", "m-listening", uint64(3), uint64(7), uint64(10), "w-1", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), uint64(10), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// The loser of the write_id race: duplicate key on the ledger.
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").
		WithArgs(sqlmock.AnyArg(), "att-1", "w-1", uint64(3), uint64(7), "q-1", uint64(10), sqlmock.AnyArg(), sqlmock.AnyArg(), "applied", uint64(10), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnError(errors.New("Error 1062 (23000): Duplicate entry 'w-1' for key 'uq_write'"))
	mock.ExpectRollback()

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeWriteIDConflict {
		t.Fatalf("expected WRITE_ID_CONFLICT, got %v", err)
	}
	if e.HTTPStatus != 409 {
		t.Fatalf("WRITE_ID_CONFLICT must be HTTP 409, got %d", e.HTTPStatus)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (f) Envelope precedence: malformed batches fail BEFORE any tx begins.
// Zero sqlmock expectations per case, so any Begin/query/Exec fails the
// run — the BAD_REQUEST pin proves the gate fired pre-tx. Covers zero
// lease epoch, zero control epoch, zero clientVersion, and duplicate
// write IDs within one batch (I2: the in-batch dup would otherwise
// insert-or-conflict against itself mid-tx).
func TestDurabilityContractEnvelopePrecedence(t *testing.T) {
	good := func() SaveResponsesCommand {
		return SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
			Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	}
	cases := []struct {
		name string
		mut  func(*SaveResponsesCommand)
	}{
		{"zero lease epoch", func(c *SaveResponsesCommand) { c.LeaseEpoch = 0 }},
		{"zero control epoch", func(c *SaveResponsesCommand) { c.ControlEpoch = 0 }},
		{"zero clientVersion", func(c *SaveResponsesCommand) { c.Commands[0].ClientVersion = 0 }},
		{"duplicate writeIds in batch", func(c *SaveResponsesCommand) { c.Commands = append(c.Commands, c.Commands[0]) }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			// Zero expectations: any SQL (Begin included) fails the test.
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			secret := []byte("test-secret-32-bytes-long--------")
			svc := testService(db, secret)
			bearer := mintToken(t, secret, baseClaims())
			cmd := good()
			tc.mut(&cmd)
			qr, rl := liveStubs()
			_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
			e := durabilityErr(t, err)
			if e.Code != apperrors.CodeBadRequest {
				t.Fatalf("envelope violation must be BAD_REQUEST, got %v", err)
			}
			if e.HTTPStatus != 400 {
				t.Fatalf("envelope violation must be HTTP 400, got %d", e.HTTPStatus)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// (g) Claim-lease-on-replay negative: the replay fast path still requires
// the CURRENT claim lease. Stored content matches (exact replay), but the
// bearer was minted pre-takeover (claim lease 2 vs attempt lease 3) ->
// LEASE_FENCED (403). A stale device must not resurrect its retry as a
// replay after losing the lease.
func TestDurabilityContractReplayRejectsStaleClaimLease(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	claims := baseClaims()
	stale := uint64(2)
	claims.LeaseEpoch = &stale
	bearer := mintToken(t, secret, claims)

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
	reqHash, err := commandHash(cmd.Commands[0])
	if err != nil {
		t.Fatal(err)
	}

	durabilityFenceStubs(mock, attemptRows())
	// Content matches exactly (would replay) ...
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").
		WithArgs("att-1", "w-1").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).
			AddRow(reqHash, "resp-hash-1", "applied", uint64(4), durabilityReplayRaw))
	mock.ExpectQuery("SELECT response_revision FROM student_attempts WHERE id").
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"response_revision"}).AddRow(uint64(9)))
	// ... but the claim lease is stale, so the replay is fenced, never
	// returned: rollback, no commit.
	mock.ExpectRollback()

	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeLeaseFenced {
		t.Fatalf("stale-claim replay must be LEASE_FENCED, got %v", err)
	}
	if e.HTTPStatus != 403 {
		t.Fatalf("LEASE_FENCED must be HTTP 403, got %d", e.HTTPStatus)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (h) Fence precedence: when BOTH epochs are stale, the lease fence fires
// first (service.go checks lease before control). A both-stale batch must
// report LEASE_FENCED (403), never CONTROL_EPOCH_STALE.
func TestDurabilityContractFencePrefersLeaseOverControl(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	durabilityFenceStubs(mock, attemptRows())
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-9").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	// Attempt is at lease 3 / control 7; writer sends lease 2 / control 6.
	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 2, ControlEpoch: 6,
		Commands: []ResponseCommand{{WriteID: "w-9", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeLeaseFenced {
		t.Fatalf("both-stale batch must fence on lease first, got %v", err)
	}
	if e.HTTPStatus != 403 {
		t.Fatalf("LEASE_FENCED must be HTTP 403, got %d", e.HTTPStatus)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (i) Submit envelope gate for FinalCommands: a zero clientVersion in the
// final batch fails BEFORE any tx begins (zero expectations: any Begin
// fails the test). Mirrors submit_envelope_test.go for the version arm.
func TestDurabilityContractSubmitFinalCommandsEnvelopeGate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()

	bad := ResponseCommand{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 0, Response: ResponsePayload{Answer: "A"}}
	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-9", FinalCommands: []ResponseCommand{bad}}
	_, err = svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderIELTS), nil)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeBadRequest {
		t.Fatalf("malformed FinalCommands must 400 at the envelope, got %v", err)
	}
	if e.HTTPStatus != 400 {
		t.Fatalf("envelope violation must be HTTP 400, got %d", e.HTTPStatus)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// (j) Submit FinalCommands control-substitution: ExpectedControlEpoch 0 is
// legal at the Submit envelope (submit.go substitutes 1 purely for the
// shared positive-epoch gate), but the REAL epoch (0) flows into saveInTx
// untouched — so the nested write still fences CONTROL_EPOCH_STALE against
// the live control 7, with request=0/current=7 details. Pins both halves:
// the envelope PASSED (a tx began and probes were issued) and the stale
// epoch still fenced in-tx.
func TestDurabilityContractSubmitFinalCommandsControlSubstitution(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()

	// Submit preamble: lock, session, receipt miss, submission-ID
	// ownership miss, active session. (Runtime gate is stubbed: no SQL.)
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WithArgs("tok-1").WillReturnRows(sessionRows())
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").WithArgs("att-1").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id").WithArgs("sub-9").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// Nested saveInTx for the final batch: re-lock + re-verify, replay
	// probe misses, lease passes (3 == 3), then control 0 vs 7 fences.
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WithArgs("tok-1").WillReturnRows(sessionRows())
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WithArgs("att-1", "w-1").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, ExpectedControlEpoch: 0, SubmissionID: "sub-9",
		FinalCommands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}}}
	_, err = svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderIELTS), nil)
	e := durabilityErr(t, err)
	if e.Code != apperrors.CodeControlEpochStale {
		t.Fatalf("substituted-control submit must fence CONTROL_EPOCH_STALE in-tx, got %v", err)
	}
	if e.HTTPStatus != 409 {
		t.Fatalf("CONTROL_EPOCH_STALE must be HTTP 409, got %d", e.HTTPStatus)
	}
	if e.Details["requestControlEpoch"] != uint64(0) || e.Details["currentControlEpoch"] != uint64(7) {
		t.Fatalf("stale details must carry the REAL epochs request=0/current=7, got %v", e.Details)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

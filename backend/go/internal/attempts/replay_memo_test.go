package attempts

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/go-sql-driver/mysql"
)

// perCommandIO's ledger memo: a verified miss or hit is read once per
// transaction attempt, a failed read is not remembered, and a successful
// insert turns a remembered miss into the stored row.
func TestPerCommandLedgerMemo(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	q, err := db.Begin()
	if err != nil {
		t.Fatal(err)
	}
	io := &perCommandIO{ctx: context.Background(), q: q, attemptID: "att-1"}
	cols := []string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}

	// A transient failure is returned and not cached: the next call re-reads.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-1").WillReturnError(errors.New("boom"))
	if _, err := io.ledgerByWrite("w-1"); err == nil {
		t.Fatal("query failure must be returned")
	}
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-1").WillReturnError(sql.ErrNoRows)
	for i := 0; i < 2; i++ {
		row, err := io.ledgerByWrite("w-1")
		if err != nil || row != nil {
			t.Fatalf("probe %d: want remembered miss, got %+v, %v", i, row, err)
		}
	}

	// A stored row is remembered too.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-2").
		WillReturnRows(sqlmock.NewRows(cols).AddRow("rh", "h", "applied", uint64(4), "{}"))
	for i := 0; i < 2; i++ {
		row, err := io.ledgerByWrite("w-2")
		if err != nil || row == nil || row.RequestHash != "rh" || row.ServerRevision != 4 {
			t.Fatalf("probe %d: want remembered hit, got %+v, %v", i, row, err)
		}
	}

	// Inserting w-1 replaces its remembered miss with the inserted row.
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	if err := io.insertLedger(ledgerWrite{
		AttemptID: "att-1", WriteID: "w-1", LeaseEpoch: 3, ControlEpoch: 7, QuestionID: "q-1", ClientVersion: 10,
		RequestHash: "rq", ResponseHash: "rs", Outcome: "applied", ServerRevision: 10, CanonicalPayload: "{}", Now: time.Now(),
	}); err != nil {
		t.Fatal(err)
	}
	row, err := io.ledgerByWrite("w-1")
	if err != nil || row == nil || row.RequestHash != "rq" || row.ResponseHash != "rs" || row.ServerRevision != 10 || row.CanonicalRaw != "{}" {
		t.Fatalf("inserted write must replace the remembered miss, got %+v, %v", row, err)
	}

	// A failed insert leaves the memo untouched.
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-3").WillReturnError(sql.ErrNoRows)
	if _, err := io.ledgerByWrite("w-3"); err != nil {
		t.Fatal(err)
	}
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").WillReturnError(errors.New("Error 1062 (23000): Duplicate entry"))
	if err := io.insertLedger(ledgerWrite{AttemptID: "att-1", WriteID: "w-3"}); codeOf(err) != apperrors.CodeWriteIDConflict {
		t.Fatalf("duplicate insert must map to WRITE_ID_CONFLICT, got %v", err)
	}
	if row, err := io.ledgerByWrite("w-3"); err != nil || row != nil {
		t.Fatalf("failed insert must not fabricate a stored row, got %+v, %v", row, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A miss remembered by a rolled-back transaction attempt must not survive
// into the retry: the retry builds new I/O state, re-probes, and here finds
// the write committed meanwhile (by the lost-response client's other request),
// so it replays the stored ack at the locked revision instead of applying it.
func TestSaveRetryDoesNotReuseRolledBackLedgerMiss(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	cmd := saveOneCommand()
	reqHash, err := commandHash(cmd.Commands[0])
	if err != nil {
		t.Fatal(err)
	}

	// Attempt 1: miss, apply, then a deadlock on the ledger write -> rollback.
	saveHappyStubs(mock)
	mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
	mock.ExpectExec("UPDATE student_attempts SET answers=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").WillReturnError(&mysql.MySQLError{Number: 1213, Message: "Deadlock found when trying to get lock; try restarting transaction"})
	mock.ExpectRollback()

	// Attempt 2: the probe is issued again and sees the committed row.
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WithArgs("att-1", "w-1").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "response_hash", "outcome", "server_revision", "canonical_response"}).
			AddRow(reqHash, "resp-hash-1", "applied", uint64(4), durabilityReplayRaw))
	mock.ExpectCommit()

	qr, rl := liveStubs()
	res, err := svc.SaveResponses(context.Background(), bearer, cmd, qr, rl)
	if err != nil {
		t.Fatalf("retry must replay the committed write, got %v", err)
	}
	if !res.Replayed || len(res.Acks) != 1 || res.Acks[0].Outcome != "duplicate" || res.Acks[0].ServerRevision != 4 || res.ResponseRevision != 9 {
		t.Fatalf("want stored duplicate at locked revision 9, got %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

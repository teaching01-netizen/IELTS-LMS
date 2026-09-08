package attempts

import (
	"context"
	"database/sql"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// saveHappyStubs stages a successful single-command save through the fencing
// and probe chain: attempt row, session binding, exact-replay miss,
// active-session pass, idempotency miss, version-probe miss, responses
// probe miss (newer write). Caller adds the projection + tail expectations.
func saveHappyStubs(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery("FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	mock.ExpectQuery("SELECT request_hash, response_hash, outcome, server_revision").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT client_write_id FROM attempt_mutations_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT lease_epoch, client_version, server_revision FROM attempt_responses_v2").WillReturnError(sql.ErrNoRows)
}

func saveTailCommit(mock sqlmock.Sqlmock) {
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("UPDATE student_attempts SET response_revision").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
}

func saveOneCommand() SaveResponsesCommand {
	return SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
}

// B3: row-first save issues NO blob SELECT/UPDATE. sqlmock expectations are
// ordered and exhaustive: any `SELECT answers, writing_answers, flags` or
// blob UPDATE is an unexpected query and fails the run — the absence is the
// assertion. Only the responses UPSERT persists the cell.
func TestRowFirstSaveOmitsBlobIO(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret).SetRowFirst(true)
	if !svc.RowFirst() {
		t.Fatalf("SetRowFirst(true) must report on")
	}
	bearer := mintToken(t, secret, baseClaims())
	saveHappyStubs(mock)
	mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	saveTailCommit(mock)
	qr, rl := liveStubs()
	res, err := svc.SaveResponses(context.Background(), bearer, saveOneCommand(), qr, rl)
	if err != nil {
		t.Fatalf("row-first save must succeed, got %v", err)
	}
	if res.ResponseRevision != 10 {
		t.Fatalf("revision must advance 9->10, got %d", res.ResponseRevision)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B3: legacy path keeps the blob round trip (SELECT answers... + blob UPDATE
// + responses UPSERT) so ROW_FIRST_WRITES=off is byte-identical to today.
func TestLegacySaveKeepsBlobIO(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	if svc.RowFirst() {
		t.Fatalf("default service must be legacy (row-first off)")
	}
	bearer := mintToken(t, secret, baseClaims())
	saveHappyStubs(mock)
	mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
	mock.ExpectExec("UPDATE student_attempts SET answers=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	saveTailCommit(mock)
	qr, rl := liveStubs()
	if _, err := svc.SaveResponses(context.Background(), bearer, saveOneCommand(), qr, rl); err != nil {
		t.Fatalf("legacy save must succeed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

var _ = time.Now

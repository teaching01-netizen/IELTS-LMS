package attempts

// Plan single-deploy scale (round 112): the IELTS V2 submit seals the
// attempt and writes the submission receipt with a NULL-able
// expected_attempt_revision. A client that omits expectedAttemptRevision
// (nil ExpectedRevision) submits against a live attempt with stored
// responses — the INSERT must succeed, not 500 on a NOT NULL column.
// RED: nil ExpectedRevision must not produce a nil INSERT arg.
import (
	"context"
	"database/sql"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

type fakeSealer struct{}

func (fakeSealer) SealSubmitted(_ context.Context, _ tx.Tx, _, _, _, _, _, _ string, _ time.Time) error {
	return nil
}

func TestSubmitWithoutExpectedRevisionWritesReceipt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT active_client_session_id").WillReturnRows(sqlmock.NewRows([]string{"active_client_session_id"}).AddRow("sess-1"))
	// Digest: two stored responses.
	mock.ExpectQuery("FROM attempt_responses_v2").WillReturnRows(
		sqlmock.NewRows([]string{"question_id", "response_hash"}).
			AddRow("listening-q1", "h1").AddRow("listening-q2", "h2"))
	// Seal via fake sealer: no SQL expectations. Revision update first,
	// then the receipt INSERT must carry a non-nil expected_attempt_revision
	// (column is NOT NULL) even though ExpectedRevision is nil.
	mock.ExpectExec("UPDATE student_attempts SET response_revision").
		WithArgs(uint64(9), sqlmock.AnyArg(), "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_submissions_v2").
		WithArgs("att-1", "sub-live", uint64(3), uint64(7), sqlmock.AnyArg(), sqlmock.AnyArg(), uint64(9), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-live"}
	_, err = svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderIELTS), fakeSealer{})
	if err != nil {
		t.Fatalf("submit without expected revision must succeed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

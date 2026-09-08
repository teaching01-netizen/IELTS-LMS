package attempts

// Plan E3/B1: hot writes must absorb transient InnoDB failures (deadlock /
// lock-wait under the 500-way wave) via bounded RC retry — never surface a
// retryable storage transient as a 500 to the student. Idempotency-safe:
// write_id UNIQUE + exact-replay make the retried attempt a replay, not a
// duplicate. RED: SaveResponses on a deadlock must retry, not fail.
import (
	"context"
	"database/sql"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestSaveRetriesDeadlockOnce(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())

	// First attempt: full probe chain, then a deadlock on the ledger write.
	saveHappyStubs(mock)
	mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
	mock.ExpectExec("UPDATE student_attempts SET answers=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").WillReturnError(errors.New("Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction"))
	mock.ExpectRollback()

	// Retry: full chain again, then commit.
	saveHappyStubs(mock)
	mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
	mock.ExpectExec("UPDATE student_attempts SET answers=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	saveTailCommit(mock)

	cmd := SaveResponsesCommand{AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7,
		Commands: []ResponseCommand{{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 10, Response: ResponsePayload{Answer: "A"}}}}
	qr, rl := liveStubs()
	if _, err := svc.SaveResponses(context.Background(), bearer, cmd, qr, rl); err != nil {
		t.Fatalf("deadlock must be retried, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	var _ = sql.ErrNoRows
}

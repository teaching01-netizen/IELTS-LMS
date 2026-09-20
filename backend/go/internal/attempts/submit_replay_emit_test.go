package attempts

// Plan E-exam-day: the submit-replay series (v2_submit_replay_total) is
// the operator's client-retry proof. A same-submission+same-hash resubmit
// returns the stored receipt (Replayed=true) and counts exactly one
// replay; a fresh submit counts zero. RED: replay emits, fresh silent.
import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestSubmitReplayEmitsOnce(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()

	// Receipt-replay preamble: lock attempt, validate session, then the
	// stored receipt matches (same submission ID + same request hash).
	// The request hash is computed over the submit shape; reuse the
	// command below for both the hash stub and the call.
	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-1"}
	reqHash, err := HashResponse(submitRequestShape(cmd))
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery("FROM attempt_submissions_v2 WHERE attempt_id").
		WillReturnRows(sqlmock.NewRows([]string{"submission_id", "request_hash", "final_response_digest", "receipt_json", "submitted_at"}).
			AddRow("sub-1", reqHash, "digest-1", `{}`, now))
	mock.ExpectCommit()
	res, err := svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderIELTS), nil)
	if err != nil {
		t.Fatalf("replay submit: %v", err)
	}
	if !res.Replayed {
		t.Fatalf("same submission+hash must replay, got %+v", res)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSubmitReplayTotal); got != 1 {
		t.Fatalf("replay must count 1, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

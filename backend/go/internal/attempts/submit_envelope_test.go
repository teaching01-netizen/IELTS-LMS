package attempts

// Plan I2 (round 55): Submit.FinalCommands ride into saveInTx AFTER the
// attempt lock + receipt probes. Without envelope validation at Submit
// entry, a malformed final batch (dup write IDs, oversize, zero version)
// burns a tx + hot-row locks before failing. This test pins: a submit
// whose FinalCommands carry duplicate write IDs fails BEFORE any SQL
// (strict sqlmock: zero expectations — any query fails the test).
// RED: dup batch rejected with no queries issued.
import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestSubmitRejectsDuplicateFinalWriteIDs(t *testing.T) {
	// Zero expectations: any SQL (Begin/query) fails the test, proving
	// the envelope gate fired before any tx began.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	secret := []byte("test-secret-32-bytes-long--------")
	svc := testService(db, secret)
	bearer := mintToken(t, secret, baseClaims())
	qr, rl := liveStubs()

	dup := ResponseCommand{WriteID: "w-dup", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}}
	cmd := SubmitCommand{AttemptID: "att-1", LeaseEpoch: 3, SubmissionID: "sub-9",
		FinalCommands: []ResponseCommand{dup, dup}}
	// Must be a 400 envelope rejection — not a mock/SQL failure (which
	// would prove the gate did NOT fire and the tx began anyway).
	_, err = svc.Submit(context.Background(), bearer, cmd, qr, rl, providerStub(ProviderIELTS), nil)
	if codeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("submit with duplicate final write IDs must 400 at the envelope, got %v", err)
	}
	// Strict mock: no Begin, no queries — envelope gate fired first.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

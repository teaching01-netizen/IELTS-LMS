package attempts

// The counted retry must reach the wire counter: deadlock once then
// commit emits retried_accepted on v2_response_batch_total (not
// accepted). Registry-level assertion on a fresh registry.
import (
	"context"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestRetriedSaveEmitsRetriedAccepted(t *testing.T) {
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

	saveHappyStubs(mock)
	mock.ExpectQuery("SELECT answers, writing_answers, flags FROM student_attempts").
		WillReturnRows(sqlmock.NewRows([]string{"answers", "writing_answers", "flags"}).AddRow("{}", "{}", "{}"))
	mock.ExpectExec("UPDATE student_attempts SET answers=").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_responses_v2").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").WillReturnError(errors.New("Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction"))
	mock.ExpectRollback()
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
		t.Fatalf("retried save must commit, got %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MV2BatchTotal, "outcome", telemetry.OutcomeRetriedAccepted); got != 1 {
		t.Fatalf("wire retried_accepted must be 1, got %v", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MV2BatchTotal, "outcome", telemetry.OutcomeAccepted); got != 0 {
		t.Fatalf("wire accepted must be 0 after a retried commit, got %v", got)
	}
}

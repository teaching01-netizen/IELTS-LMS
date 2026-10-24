package attempts

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// The prepared request hash reuses the payload bytes; it must stay
// byte-for-byte the historical commandHash (replay compatibility).
func TestPreparedRequestHashMatchesCommandHash(t *testing.T) {
	start, end := 2, 9
	var decoded any
	if err := json.Unmarshal([]byte(`{"rows":[1,2.5,"x"],"b":true,"a":null}`), &decoded); err != nil {
		t.Fatal(err)
	}
	commands := []ResponseCommand{
		{WriteID: "w-1", QuestionID: "q-1", ClientVersion: 1, Response: ResponsePayload{Answer: "A"}},
		{WriteID: "w-<&>\"", QuestionID: "q-ü ", ClientVersion: 1<<63 + 5, Response: ResponsePayload{Answer: decoded, MarkedForReview: true, EliminatedOptions: []string{"B", "C"}}},
		{WriteID: "w-3", QuestionID: "q-3", ClientVersion: 42, Response: ResponsePayload{Answer: "essay <b>&</b>", Annotations: []Annotation{
			{ID: "h-1", Kind: "highlight", Start: &start, End: &end, Text: "note"},
			{ID: "s-1", Kind: "sat_annotations", Version: 2, LegacyQuestionNote: "n", Annotations: []SATTextAnnotation{
				{ID: "a-1", Kind: "highlight", Color: "blue", Anchor: SATTextAnchor{NodeID: "p1", StartOffset: 3, EndOffset: 11}, CreatedAt: "t0", UpdatedAt: "t1"},
			}},
			{ID: "s-2", Kind: "sat_annotations"},
		}}},
		{WriteID: "w-4", QuestionID: "q-4", ClientVersion: 7, Response: ResponsePayload{}},
	}
	prepared := prepareCommands(preparePayloads(commands))
	for i, c := range commands {
		want, err := commandHash(c)
		if err != nil {
			t.Fatal(err)
		}
		got, err := prepared[i].request(c)
		if err != nil {
			t.Fatal(err)
		}
		if got != want {
			t.Fatalf("command %d: prepared hash %s != commandHash %s", i, got, want)
		}
		payloadHash, err := HashResponsePayload(c.Response)
		if err != nil {
			t.Fatal(err)
		}
		if prepared[i].hash != payloadHash {
			t.Fatalf("command %d: prepared payload hash %s != %s", i, prepared[i].hash, payloadHash)
		}
	}
}

// Two commands for one question arriving out of order in one set-based batch
// must resolve as a sequential implementation would: the newer write applies,
// the older one is superseded by the staged projection, and exactly one cell
// row (the newer content) is written.
func TestBatchStagedProjectionSupersedesOlderSameQuestionWrite(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	newer := ResponseCommand{WriteID: "w-new", QuestionID: "q-0", ClientVersion: 5, Response: ResponsePayload{Answer: "B"}}
	older := ResponseCommand{WriteID: "w-old", QuestionID: "q-0", ClientVersion: 3, Response: ResponsePayload{Answer: "A"}}
	newerHash, err := HashResponsePayload(newer.Response)
	if err != nil {
		t.Fatal(err)
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery(regexp.QuoteMeta("client_write_id IN (")).WithArgs("att-1", "w-new", "w-old").WillReturnRows(sqlmock.NewRows(ledgerColumnNames()))
	mock.ExpectQuery(regexp.QuoteMeta("lease_epoch=? AND ((question_id=? AND client_version=?) OR (question_id=? AND client_version=?))")).
		WithArgs("att-1", uint64(3), "q-0", uint64(5), "q-0", uint64(3)).WillReturnRows(sqlmock.NewRows(ledgerColumnNames()))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_responses_v2 WHERE attempt_id=? AND question_id IN (")).WithArgs("att-1", "q-0").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "lease_epoch", "client_version", "server_revision", "response", "response_hash"}))
	mock.ExpectExec("INSERT INTO attempt_responses_v2").WithArgs(
		"att-1", "q-0", "m-listening", uint64(3), uint64(7), uint64(5), "w-new",
		sqlmock.AnyArg(), sqlmock.AnyArg(), newerHash, uint64(10), sqlmock.AnyArg(),
	).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO attempt_mutations_v2").WithArgs(
		sqlmock.AnyArg(), "att-1", "w-new", uint64(3), uint64(7), "q-0", uint64(5), sqlmock.AnyArg(), newerHash, "applied", uint64(10), sqlmock.AnyArg(), sqlmock.AnyArg(),
		sqlmock.AnyArg(), "att-1", "w-old", uint64(3), uint64(7), "q-0", uint64(3), sqlmock.AnyArg(), newerHash, "superseded", uint64(10), sqlmock.AnyArg(), sqlmock.AnyArg(),
	).WillReturnResult(sqlmock.NewResult(1, 2))
	mock.ExpectExec("UPDATE student_attempts SET response_revision").WithArgs(uint64(10), 1, "att-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := testService(db, []byte(batchSecret)).SetRowFirst(true).SetBulkThresholdForTest(batchStrategyThreshold)
	qr, rl := liveStubs()
	res, err := svc.SaveResponses(context.Background(), mintToken(t, []byte(batchSecret), baseClaims()), SaveResponsesCommand{
		AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7, Commands: []ResponseCommand{newer, older},
	}, qr, rl)
	if err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if len(res.Acks) != 2 || res.Acks[0].Outcome != "applied" || res.Acks[1].Outcome != "superseded" {
		t.Fatalf("acks = %+v", res.Acks)
	}
	if res.Acks[1].ServerRevision != 10 || res.Acks[1].ContentHash != newerHash || res.Acks[1].CanonicalResponse.Answer != "B" {
		t.Fatalf("superseded ack must carry the staged projection: %+v", res.Acks[1])
	}
	if res.ResponseRevision != 10 {
		t.Fatalf("revision = %d", res.ResponseRevision)
	}
}

// A later command reusing an earlier command's (question, clientVersion) in
// the same batch collides with the staged ledger row.
func TestBatchPendingVersionCollision(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	first := ResponseCommand{WriteID: "w-a", QuestionID: "q-0", ClientVersion: 4, Response: ResponsePayload{Answer: "A"}}
	second := ResponseCommand{WriteID: "w-b", QuestionID: "q-0", ClientVersion: 4, Response: ResponsePayload{Answer: "B"}}
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FROM student_attempts WHERE id").WithArgs("att-1").WillReturnRows(attemptRows())
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnRows(sessionRows())
	mock.ExpectQuery(regexp.QuoteMeta("client_write_id IN (")).WithArgs("att-1", "w-a", "w-b").WillReturnRows(sqlmock.NewRows(ledgerColumnNames()))
	mock.ExpectQuery(regexp.QuoteMeta("lease_epoch=? AND ((question_id=? AND client_version=?))")).
		WithArgs("att-1", uint64(3), "q-0", uint64(4)).WillReturnRows(sqlmock.NewRows(ledgerColumnNames()))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_responses_v2 WHERE attempt_id=? AND question_id IN (")).WithArgs("att-1", "q-0").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "lease_epoch", "client_version", "server_revision", "response", "response_hash"}))
	mock.ExpectRollback()

	svc := testService(db, []byte(batchSecret)).SetRowFirst(true).SetBulkThresholdForTest(batchStrategyThreshold)
	qr, rl := liveStubs()
	_, err = svc.SaveResponses(context.Background(), mintToken(t, []byte(batchSecret), baseClaims()), SaveResponsesCommand{
		AttemptID: "att-1", LeaseEpoch: 3, ControlEpoch: 7, Commands: []ResponseCommand{first, second},
	}, qr, rl)
	e, ok := apperrors.As(err)
	if !ok || e.Code != apperrors.CodeVersionCollision || e.Details["existingWriteId"] != "w-a" {
		t.Fatalf("want version collision with w-a, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package terminalization

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// stubACTScorer stands in for the real ACT scorer.
type stubACTScorer struct{}

func (stubACTScorer) ScoreAttempt(_ context.Context, q tx.Tx, _, _ string, _ json.RawMessage) (map[string]any, error) {
	return map[string]any{"score": map[string]any{"totalScore": 1}, "providerKey": "act", "section": "science"}, nil
}

// A forged client score is rejected before the scorer runs: no receipt
// INSERT, no claim UPDATE, no result write (Phase 02 AT02-07). The seal
// fails with BAD_REQUEST naming server authority.
func TestSealLegacyACTRejectsForgedClientScore(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	svc.SetAttemptScorer(mustFailScorer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("running", "active"))
	sealExpectProviderForExam(mock, "ielts", "ACT")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sqlmock.NewRows([]string{
			"attempt_id", "organization_id", "terminalization_id", "schedule_id",
			"outcome", "reason", "actor_kind", "actor_id",
			"effective_at", "recorded_at", "answer_revision", "final_snapshot", "request_id",
		}))
	sealExpectRecordedAt(mock)
	mock.ExpectRollback()
	cmd := baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent)
	cmd.FinalSubmission = json.RawMessage(`{"score":{"totalScore":999}}`)
	_, err = svc.Terminalize(context.Background(), cmd)
	if sealCodeOf(err) != apperrors.CodeBadRequest {
		t.Fatalf("forged client score must be rejected with BAD_REQUEST, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// mustFailScorer panics if the seal invokes scoring: the forged-score
// rejection must fire before the scorer runs.
type mustFailScorer struct{}

func (mustFailScorer) ScoreAttempt(_ context.Context, _ tx.Tx, _, _ string, _ json.RawMessage) (map[string]any, error) {
	panic("scorer must not run when a client score is present")
}

// A legacy ACT row seals through the ACT scorer and materializer.
func TestSealLegacyACTRowUsesACTScorer(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	svc.SetAttemptScorer(stubACTScorer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRow("running", "active"))
	sealExpectProviderForExam(mock, "ielts", "ACT")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sqlmock.NewRows([]string{
			"attempt_id", "organization_id", "terminalization_id", "schedule_id",
			"outcome", "reason", "actor_kind", "actor_id",
			"effective_at", "recorded_at", "answer_revision", "final_snapshot", "request_id",
		}))
	sealExpectRecordedAt(mock)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "outcome_status"}))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO outbox_events")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	res, err := svc.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent))
	if err != nil {
		t.Fatal(err)
	}
	if !res.Created {
		t.Fatal("legacy ACT seal must create")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

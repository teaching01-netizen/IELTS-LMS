package terminalization

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// lockAttemptRowV2 stages a protocol-2 attempt whose blob columns are stale
// (empty) while row cells exist — the seal must materialize before snapshot.
func lockAttemptRowV2() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "organization_id", "exam_id", "published_version_id",
		"phase", "delivery_status", "proctor_status", "revision", "answer_revision",
		"answers", "writing_answers", "flags", "protocol_version",
	}).AddRow("att-1", "sched-1", nil, "exam-1", "pv-1", "exam",
		"running", "active", int64(4), int64(9), []byte("{}"), []byte("{}"), []byte("{}"), 2)
}

// B3 RED: seal on a V2 attempt materializes blobs from rows synchronously
// (grading never sees staleness): rows SELECT + blob UPDATE precede the
// provider/snapshot reads, and the snapshot carries the materialized triple.
func TestSealMaterializesBlobsForV2(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRowV2())
	// Row-first materialization: cells SELECT then blob UPDATE.
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_responses_v2 WHERE attempt_id")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id", "response"}).
			AddRow("q-1", "mod-reading", `{"answer":"A","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?")).
		WithArgs(`{"q-1":"A"}`, "{}", "{}", "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	sealExpectProvider(mock, "ielts")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sqlmock.NewRows([]string{
			"attempt_id", "organization_id", "terminalization_id", "schedule_id",
			"outcome", "reason", "actor_kind", "actor_id",
			"effective_at", "recorded_at", "answer_revision", "final_snapshot", "request_id",
		}))
	sealExpectRecordedAt(mock)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'post-exam'")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO outbox_events")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	res, err := svc.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent))
	if err != nil {
		t.Fatalf("seal must succeed: %v", err)
	}
	if !res.Created {
		t.Fatalf("seal must create")
	}
	_ = time.Now
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B3 RED: V1 attempts never touch the rows table at seal (their blobs are
// authoritative; an empty rows table must not wipe them).
func TestSealSkipsMaterializeForV1(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), SQLTerminalizationRepository{}, SQLOutboxEnqueuer{})
	sealBeginUTC(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).
		WillReturnRows(lockAttemptRowV2V1())
	sealExpectProvider(mock, "ielts")
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).
		WillReturnRows(sqlmock.NewRows([]string{
			"attempt_id", "organization_id", "terminalization_id", "schedule_id",
			"outcome", "reason", "actor_kind", "actor_id",
			"effective_at", "recorded_at", "answer_revision", "final_snapshot", "request_id",
		}))
	sealExpectRecordedAt(mock)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'post-exam'")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO outbox_events")).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()
	if _, err := svc.Terminalize(context.Background(), baseSealCmd(OutcomeSubmitted, ReasonStudentSubmit, ActorStudent)); err != nil {
		t.Fatalf("V1 seal must succeed without rows access: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func lockAttemptRowV2V1() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "organization_id", "exam_id", "published_version_id",
		"phase", "delivery_status", "proctor_status", "revision", "answer_revision",
		"answers", "writing_answers", "flags", "protocol_version",
	}).AddRow("att-1", "sched-1", nil, "exam-1", "pv-1", "exam",
		"running", "active", int64(4), int64(9), []byte(`{"q-0":"kept"}`), []byte("{}"), []byte("{}"), 1)
}

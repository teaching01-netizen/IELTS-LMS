package proctor

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
	terminalization "example.com/ielts-proctoring/internal/terminalization"
)

type captureOutbox struct {
	families  []string
	payloads  []string
	revisions []int64
}

func (c *captureOutbox) EnqueueInTx(ctx context.Context, q tx.Tx, aggregateKind, aggregateID string, revision int64, eventFamily string, payload json.RawMessage) error {
	c.families = append(c.families, eventFamily)
	c.payloads = append(c.payloads, string(payload))
	c.revisions = append(c.revisions, revision)
	return nil
}

// revisionFor returns the revision the first event of the given family was
// enqueued with, so a test can pin where that revision came from.
func (c *captureOutbox) revisionFor(family string) (int64, bool) {
	for i, f := range c.families {
		if f == family {
			return c.revisions[i], true
		}
	}
	return 0, false
}

// newMockService builds a Service over sqlmock with a capturing outbox, for
// tests that assert on the durable effects (audit rows, outbox families,
// revision bumps) rather than on the SQL text.
func newMockService(t *testing.T) (*Service, sqlmock.Sqlmock, *captureOutbox) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	outbx := &captureOutbox{}
	return NewService(tx.NewRunner(db), db, nil, outbx, nil), mock, outbx
}

// CompleteExam with a custom free-text reason must still enqueue the fixed
// terminalization vocabulary reason (proctor_complete): the worker seals with
// the payload verbatim, and an arbitrary string fails validation on every
// retry until the outbox event goes terminal with students unsubmitted.
func TestCompleteExamCustomReasonKeepsVocabularyPayload(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	outbx := &captureOutbox{}
	svc := NewService(tx.NewRunner(db), db, nil, outbx, nil)
	actor := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}
	custom := "end of day \u2014 extended session 42"

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	// lockScheduleScope (B2 narrowed): runtime id + sections only — no
	// schedule-wide attempt sweep.
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("rt-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE")).
		WithArgs("rt-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	// CompleteExam runtime row.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, status, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "revision"}).AddRow("rt-1", "live", 7))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes SET status = 'completed'")).
		WithArgs("rt-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections SET status = 'completed'")).
		WithArgs("rt-1").WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET status = 'completed'")).
		WithArgs("sched-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO cohort_control_events")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "rt-1", "sched-1", "admin-1", "complete_runtime", nil, nil, &custom).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "admin-1", "SESSION_END", nil, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// enqueueAutoSubmitForSchedule writable-attempt scan.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectCommit()

	if err := svc.CompleteExam(context.Background(), actor, "sched-1", CompleteExamCommand{Reason: &custom}); err != nil {
		t.Fatalf("CompleteExam must succeed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	// The auto-submit payload must carry vocabulary, not the free text.
	found := false
	for i, fam := range outbx.families {
		if fam != "auto_submit_schedule_attempts_requested" {
			continue
		}
		found = true
		var payload struct {
			Reason string `json:"reason"`
		}
		if err := json.Unmarshal([]byte(outbx.payloads[i]), &payload); err != nil {
			t.Fatalf("auto-submit payload must decode: %v", err)
		}
		if payload.Reason != terminalization.ReasonProctorComplete {
			t.Fatalf("auto-submit reason = %q, want %q", payload.Reason, terminalization.ReasonProctorComplete)
		}
	}
	if !found {
		t.Fatal("CompleteExam must enqueue an auto-submit job")
	}
}

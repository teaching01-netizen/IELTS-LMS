package proctor

import (
	"context"
	"database/sql"
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

type captureTerminalizer struct {
	attemptIDs []string
	reasons    []string
}

func (c *captureTerminalizer) Terminalize(_ context.Context, cmd terminalization.SealCommand) (*terminalization.SealResult, error) {
	c.attemptIDs = append(c.attemptIDs, cmd.AttemptID)
	c.reasons = append(c.reasons, cmd.Reason)
	return &terminalization.SealResult{}, nil
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
	// Global lock order: the schedule row is taken BEFORE the runtime scope,
	// because CompleteInTx writes the schedule last and check-in holds it while
	// waiting for the runtime. Ordered expectations pin that order.
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "sat_timing_model", "ielts_timing_model", "sat_start_mode", "published_version_id", "status", "revision", "planned_duration_minutes"}).
			AddRow("sched-1", "exam-1", "sat", "", "", "proctor", "ver-1", "live", 4, 154))
	// lockScheduleScope (B2 narrowed): runtime id + sections only — no
	// schedule-wide attempt sweep.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM student_attempts WHERE schedule_id = ? ORDER BY id FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("rt-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE")).
		WithArgs("rt-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_lifecycle_receipts WHERE scope_kind = ? AND scope_id = ? AND operation_id = ?")).
		WillReturnError(sql.ErrNoRows)
	// Explicit End Exam closes Eva SIM before the runtime read.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET eva_sim_closed_at")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// CompleteExam runtime row.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, status, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "revision"}).AddRow("rt-1", "live", 7))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes SET status = 'completed'")).
		WithArgs(terminalization.ReasonProctorComplete, "rt-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections SET status = 'completed'")).
		WithArgs(terminalization.ReasonProctorComplete, "rt-1").WillReturnResult(sqlmock.NewResult(0, 2))
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
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_lifecycle_receipts")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	if err := svc.CompleteExam(context.Background(), actor, "sched-1", CompleteExamCommand{OperationID: "op-complete-1", Reason: &custom}); err != nil {
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

func TestAutoSubmitACTAfterCompleteSealsWritableACTAttemptsSynchronously(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seal := &captureTerminalizer{}
	svc := NewService(tx.NewRunner(db), db, seal, nil, nil)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))

	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a")).
		WithArgs("sched-act").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("attempt-act-1").AddRow("attempt-act-2"))
	mock.ExpectCommit()

	if err := svc.AutoSubmitACTAfterComplete(context.Background(), Actor{ID: "admin-1"}, "sched-act"); err != nil {
		t.Fatalf("synchronous ACT auto-submit must succeed: %v", err)
	}
	if got := seal.attemptIDs; len(got) != 2 || got[0] != "attempt-act-1" || got[1] != "attempt-act-2" {
		t.Fatalf("sealed attempts = %#v, want both ACT attempts", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAutoSubmitScheduleAfterCompleteSealsWritableIELTSAttemptsSynchronously(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seal := &captureTerminalizer{}
	svc := NewService(tx.NewRunner(db), db, seal, nil, nil)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT a.id")).
		WithArgs("sched-ielts").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("attempt-ielts-1"))
	mock.ExpectCommit()

	if err := svc.AutoSubmitScheduleAfterComplete(context.Background(), Actor{ID: "admin-1"}, "sched-ielts"); err != nil {
		t.Fatalf("synchronous IELTS auto-submit must succeed: %v", err)
	}
	if got := seal.attemptIDs; len(got) != 1 || got[0] != "attempt-ielts-1" {
		t.Fatalf("sealed attempts = %#v, want the IELTS attempt", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAutoSubmitScheduleAfterEndSectionUsesProctorEndReason(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	seal := &captureTerminalizer{}
	svc := NewService(tx.NewRunner(db), db, seal, nil, nil)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT a.id")).
		WithArgs("sched-ielts").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("attempt-ielts-1"))
	mock.ExpectCommit()

	if err := svc.AutoSubmitScheduleAfterEndSection(context.Background(), Actor{ID: "admin-1"}, "sched-ielts"); err != nil {
		t.Fatalf("synchronous end-section auto-submit must succeed: %v", err)
	}
	if got := seal.attemptIDs; len(got) != 1 || got[0] != "attempt-ielts-1" {
		t.Fatalf("sealed attempts = %#v, want the IELTS attempt", got)
	}
	if got := seal.reasons; len(got) != 1 || got[0] != terminalization.ReasonProctorEnd {
		t.Fatalf("seal reasons = %#v, want %q", got, terminalization.ReasonProctorEnd)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A room that never started has no runtime row (the proctor list synthesizes a
// not-started runtime on read). End Exam must still close it: the schedule is
// the terminal entity in that case: completing it writes the terminal runtime
// row plus the schedule status, with the same audit and outbox wakeups the
// runtime path emits.
func TestCompleteExamEndsScheduleThatNeverStarted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	outbx := &captureOutbox{}
	svc := NewService(tx.NewRunner(db), db, nil, outbx, nil)
	actor := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "sat_timing_model", "ielts_timing_model", "sat_start_mode", "published_version_id", "status", "revision", "planned_duration_minutes"}).
			AddRow("sched-1", "exam-1", "ielts", "", "", "proctor", "ver-1", "scheduled", 4, 180))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM student_attempts WHERE schedule_id = ? ORDER BY id FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	// lockScheduleScope tolerates a missing runtime: this is the never-started room.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_lifecycle_receipts WHERE scope_kind = ? AND scope_id = ? AND operation_id = ?")).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET eva_sim_closed_at")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, status, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	// The room gets its terminal runtime row: every reader keys off it, so a
	// schedule-only write would leave the room reporting not_started.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model, actual_end_at, revision) VALUES (?, ?, ?, ?, 'completed', '[]', ?, UTC_TIMESTAMP(6), 1)")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "exam-1", "ielts", "legacy_section_v1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET status = 'completed', updated_at = UTC_TIMESTAMP(6), revision = revision + 1 WHERE id = ?")).
		WithArgs("sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).
		WithArgs(sqlmock.AnyArg(), "sched-1", "admin-1", "SESSION_END", nil, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// enqueueAutoSubmitForSchedule: no writable attempts in a never-started room.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_lifecycle_receipts")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	if err := svc.CompleteExam(context.Background(), actor, "sched-1", CompleteExamCommand{OperationID: "op-complete-never-started"}); err != nil {
		t.Fatalf("CompleteExam must end a never-started room, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if len(outbx.families) != 1 || outbx.families[0] != "runtime_changed" {
		t.Fatalf("outbox families = %#v, want one runtime_changed wakeup", outbx.families)
	}
	if got, _ := outbx.revisionFor("runtime_changed"); got != 5 {
		t.Fatalf("wakeup revision = %d, want the bumped schedule revision 5", got)
	}
}

// Repeated End Exam on an already-closed runtime-less room stays idempotent:
// no second revision bump, no duplicate audit row, still a success.
func TestCompleteExamWithoutRuntimeIsIdempotentOnceTerminal(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	outbx := &captureOutbox{}
	svc := NewService(tx.NewRunner(db), db, nil, outbx, nil)
	actor := Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "sat_timing_model", "ielts_timing_model", "sat_start_mode", "published_version_id", "status", "revision", "planned_duration_minutes"}).
			AddRow("sched-1", "exam-1", "ielts", "", "", "proctor", "ver-1", "completed", 9, 180))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM student_attempts WHERE schedule_id = ? ORDER BY id FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_lifecycle_receipts WHERE scope_kind = ? AND scope_id = ? AND operation_id = ?")).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules SET eva_sim_closed_at")).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, status, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_lifecycle_receipts")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	if err := svc.CompleteExam(context.Background(), actor, "sched-1", CompleteExamCommand{OperationID: "op-complete-repeat"}); err != nil {
		t.Fatalf("repeated CompleteExam on a terminal room must succeed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if len(outbx.families) != 0 {
		t.Fatalf("terminal no-op must not emit outbox events, got %#v", outbx.families)
	}
}

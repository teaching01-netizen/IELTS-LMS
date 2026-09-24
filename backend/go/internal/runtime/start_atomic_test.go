package runtime

// Start is the cohort clock's single writer of "the exam is open". Its
// correctness envelope is transactional: the runtime/section/schedule rows, the
// control event, and the wakeup that tells every waiting student to come back
// must commit together or not at all. A state/event split-brain is exactly the
// bug class this work exists to remove — a runtime that goes live with no
// wakeup leaves waiting students polling blind, and a wakeup with no committed
// runtime invites a start-module storm against a not-started projection.
//
// sqlmock's expectations are ORDERED, so "the wakeup INSERT ran inside the
// transaction, before COMMIT" is not asserted by inspection: moving the enqueue
// after Commit (or into its own transaction) makes this suite fail, because the
// statement set no longer matches and a post-commit statement is rejected.
//
// The real enqueuer writes the real outbox row through the tx handle the state
// writes use, so the recording wrapper below observes the payload AND keeps the
// ordering proof.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/outbox"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// recordingOutbox captures what a command enqueued while delegating the actual
// row write to the production enqueuer on the same tx handle.
type recordingOutbox struct {
	calls    int
	kind     string
	id       string
	family   string
	revision int64
	payload  json.RawMessage
}

func (r *recordingOutbox) EnqueueInTx(ctx context.Context, q tx.Tx, kind, id string, revision int64, family string, payload json.RawMessage) error {
	r.calls++
	r.kind, r.id, r.family, r.revision, r.payload = kind, id, family, revision, payload
	return SQLOutboxEnqueuer{}.EnqueueInTx(ctx, q, kind, id, revision, family, payload)
}

// scheduleLockColumns mirrors LockScheduleRow's SELECT list.
var scheduleLockColumns = []string{"id", "exam_id", "provider_key", "sat_timing_model", "published_version_id", "status", "revision", "planned_duration_minutes"}

// expectScheduleLock stages the schedule row lock that opens every Start and
// Complete transaction. sqlmock's expectations are ORDERED, so staging it first
// asserts the global lock order (schedule before attempts before runtime):
// a Start that locked attempts first would fail every test that uses this.
func expectScheduleLock(mock sqlmock.Sqlmock, status, versionID string, revision int64) {
	mock.ExpectQuery("FROM exam_schedules WHERE id = \\? FOR UPDATE").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows(scheduleLockColumns).AddRow("sched-1", "exam-1", "sat", "", versionID, status, revision, 154))
}

// staticPlanner is the injected planner for tests that do not exercise plan
// derivation itself: it hands back a fixed plan for whatever row Start locked.
func staticPlanner(plan []PlanEntry, timingModel string) StartPlanner {
	return func(context.Context, tx.Tx, StartSchedule) ([]PlanEntry, string, error) {
		return plan, timingModel, nil
	}
}

// startStubs stages the exact statement sequence of a one-section Start up to
// (but not including) the wakeup INSERT and COMMIT, so each test can decide how
// the event leg behaves.
func startStubs(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	// Lock order: the schedule row, then its attempts, then the runtime row.
	expectScheduleLock(mock, "scheduled", "ver-1", 3)
	mock.ExpectQuery("FROM student_attempts WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	// No runtime yet: this Start is the one that creates it.
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("provider_key FROM exam_entities").
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("sat"))
	mock.ExpectExec("INSERT INTO exam_session_runtimes").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO exam_session_runtime_sections").
		WillReturnResult(sqlmock.NewResult(0, 1))
	// The live transition is fenced on exactly the row the plan came from.
	mock.ExpectExec("UPDATE exam_schedules SET status = 'live'").
		WithArgs("sched-1", "ver-1", int64(3)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// V2 deadline projection for the section that just went live.
	mock.ExpectExec("UPDATE student_attempts sa JOIN").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("INSERT INTO cohort_control_events").
		WillReturnResult(sqlmock.NewResult(0, 1))
}

func startPlan() []PlanEntry {
	return []PlanEntry{{SectionKey: "reading-writing", Label: "Reading and Writing", Order: 0, DurationMinutes: 32}}
}

func runtimeServiceWithOutbox(db *sql.DB) (*Service, *recordingOutbox) {
	rec := &recordingOutbox{}
	return NewService(tx.NewRunner(db), rec), rec
}

// TestStartCommitsRuntimeAndWakeupTogether pins the atomic happy path: the
// ordered statement set is state writes -> control event -> wakeup INSERT ->
// COMMIT, and the wakeup names revision 1 of the runtime it just created.
func TestStartCommitsRuntimeAndWakeupTogether(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, rec := runtimeServiceWithOutbox(db)
	invalidated := 0
	svc.SetSnapshotInvalidator(func(string) { invalidated++ })

	startStubs(mock)
	mock.ExpectExec("INSERT INTO outbox_events").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	runtimeID, err := svc.Start(context.Background(), "sched-1", "admin-1", staticPlanner(startPlan(), TimingModelCohortSection))
	if err != nil {
		t.Fatalf("start must commit: %v", err)
	}
	if runtimeID == "" {
		t.Fatal("start must return the created runtime id")
	}
	if rec.calls != 1 {
		t.Fatalf("start must publish exactly one wakeup, got %d", rec.calls)
	}
	if rec.kind != "schedule_runtime" || rec.id != "sched-1" || rec.family != outbox.FamilyRuntimeChanged {
		t.Fatalf("wakeup must address the schedule runtime topic, got %s/%s/%s", rec.kind, rec.id, rec.family)
	}
	if rec.revision != 1 {
		t.Fatalf("a fresh runtime's wakeup is revision 1, got %d", rec.revision)
	}
	if !containsJSONField(rec.payload, "event", "start_runtime") || !containsJSONField(rec.payload, "scheduleId", "sched-1") {
		t.Fatalf("wakeup payload must name the transition and its schedule, got %s", rec.payload)
	}
	// The B2 snapshot cache is invalidated only after a committed command.
	if invalidated != 1 {
		t.Fatalf("a committed start must invalidate the schedule snapshot once, got %d", invalidated)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestStartRollsBackWhenTheWakeupCannotBeWritten pins the other half: if the
// event cannot be written, the runtime must NOT be live. State without its
// wakeup is a split brain — the cohort never learns the exam opened.
func TestStartRollsBackWhenTheWakeupCannotBeWritten(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, _ := runtimeServiceWithOutbox(db)
	invalidated := 0
	svc.SetSnapshotInvalidator(func(string) { invalidated++ })

	startStubs(mock)
	mock.ExpectExec("INSERT INTO outbox_events").WillReturnError(errors.New("outbox unavailable"))
	mock.ExpectRollback()

	runtimeID, err := svc.Start(context.Background(), "sched-1", "admin-1", staticPlanner(startPlan(), TimingModelCohortSection))
	if err == nil {
		t.Fatal("a failed wakeup write must fail Start, not leave a live runtime behind")
	}
	if runtimeID != "" {
		t.Fatalf("a rolled-back start must return no runtime id, got %q", runtimeID)
	}
	if invalidated != 0 {
		t.Fatalf("a rolled-back start must not invalidate a committed snapshot, got %d", invalidated)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestStartIsIdempotentForALiveRuntime pins the proctor double-click: the second
// Start returns the existing runtime and publishes no second wakeup, so a
// duplicate command cannot create a second state transition for students.
func TestStartIsIdempotentForALiveRuntime(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc, rec := runtimeServiceWithOutbox(db)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	// The schedule is already live: the idempotent path still locks it first.
	expectScheduleLock(mock, "live", "ver-1", 4)
	mock.ExpectQuery("FROM student_attempts WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status"}).AddRow("rt-1", StatusLive))
	mock.ExpectCommit()

	planned := 0
	runtimeID, err := svc.Start(context.Background(), "sched-1", "admin-1", func(context.Context, tx.Tx, StartSchedule) ([]PlanEntry, string, error) {
		planned++
		return startPlan(), TimingModelCohortSection, nil
	})
	if err != nil {
		t.Fatalf("a second start on a live runtime must be a no-op: %v", err)
	}
	if planned != 0 {
		t.Fatalf("an idempotent start must not re-plan the runtime, planned %d times", planned)
	}
	if runtimeID != "rt-1" {
		t.Fatalf("idempotent start must return the existing runtime, got %q", runtimeID)
	}
	if rec.calls != 0 {
		t.Fatalf("an idempotent start must publish no wakeup, got %d", rec.calls)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func containsJSONField(payload json.RawMessage, field, value string) bool {
	var decoded map[string]any
	if err := json.Unmarshal(payload, &decoded); err != nil {
		return false
	}
	got, _ := decoded[field].(string)
	return got == value
}

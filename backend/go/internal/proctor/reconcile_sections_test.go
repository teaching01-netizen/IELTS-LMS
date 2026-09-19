package proctor

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/outbox"
)

// The section auto-advance path had no test before this file: ReconcileExpiredSections
// was referenced only by its own definition and the worker. These cases pin the
// authored-gap semantics (decision D3), the between-sections window (D1), the
// overrun signal, and the 30-second closing grace.

var (
	candidateQuery = regexp.QuoteMeta("SELECT r.schedule_id, COALESCE")
	attemptsLock   = regexp.QuoteMeta("SELECT id FROM student_attempts WHERE schedule_id = ? ORDER BY id FOR UPDATE")
	runtimeLock    = regexp.QuoteMeta("SELECT id, status, active_section_key, waiting_for_next_section, is_overrun, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")
	// commandRuntimeLock is the proctor-command runtime lock: the same row
	// without the overrun column.
	commandRuntimeLock = regexp.QuoteMeta("SELECT id, status, active_section_key, waiting_for_next_section, revision FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")
	sectionsLock       = regexp.QuoteMeta("FROM exam_session_runtime_sections WHERE runtime_id = ? ORDER BY section_order ASC FOR UPDATE")
	setTimeZone        = regexp.QuoteMeta("SET time_zone")
	// runtimeRevisionRead is the row re-read every effect performs after bumping
	// the runtime revision. The revision it names is the row's real value, never
	// a count the caller predicted.
	runtimeRevisionRead = regexp.QuoteMeta("SELECT revision FROM exam_session_runtimes WHERE id = ?")
)

// expectRuntimeRevisionRead queues one post-bump revision re-read.
func expectRuntimeRevisionRead(mock sqlmock.Sqlmock, revision int64) {
	mock.ExpectQuery(runtimeRevisionRead).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(revision))
}

type sectionSeed struct {
	key       string
	order     int64
	planned   int64
	gap       int64
	status    string
	startedAt *time.Time
	endedAt   *time.Time
	pausedAt  *time.Time
	extension int64
	paused    int64
}

func runtimeSectionRows(seeds []sectionSeed) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{
		"section_key", "section_order", "planned_duration_minutes", "gap_after_minutes", "status",
		"actual_start_at", "actual_end_at", "paused_at", "extension_minutes", "accumulated_paused_seconds",
	})
	for _, seed := range seeds {
		rows.AddRow(seed.key, seed.order, seed.planned, seed.gap, seed.status,
			seed.startedAt, seed.endedAt, seed.pausedAt, seed.extension, seed.paused)
	}
	return rows
}

// expectCandidateScan programmes the out-of-band candidate transaction: one
// schedule with the given auto-submit posture.
func expectCandidateScan(mock sqlmock.Sqlmock, asOf time.Time, scheduleID string, autoSubmit bool, limit int64) {
	mock.ExpectBegin()
	mock.ExpectExec(setTimeZone).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(candidateQuery).
		WithArgs(asOf, asOf, asOf, limit).
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "auto_submit"}).AddRow(scheduleID, autoSubmit))
	mock.ExpectCommit()
}

// expectScheduleTxOpen programmes the per-schedule opening: the attempt lock
// sweep, the runtime row lock, and the section row lock.
func expectScheduleTxOpen(mock sqlmock.Sqlmock, scheduleID, runtimeID, status, activeKey string, waiting, overrun bool, revision int64, seeds []sectionSeed) {
	mock.ExpectBegin()
	mock.ExpectExec(setTimeZone).WillReturnResult(sqlmock.NewResult(0, 0))
	// Schedule row first (global lock order: schedule -> attempts -> runtime).
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules WHERE id = ? FOR UPDATE")).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "published_version_id", "status", "revision", "planned_duration_minutes"}).
			AddRow(scheduleID, "exam-1", "sat", "ver-1", "live", 3, 64))
	mock.ExpectQuery(attemptsLock).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectQuery(runtimeLock).
		WithArgs(scheduleID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "active_section_key", "waiting_for_next_section", "is_overrun", "revision"}).
			AddRow(runtimeID, status, activeKey, waiting, overrun, revision))
	mock.ExpectQuery(sectionsLock).
		WithArgs(runtimeID).
		WillReturnRows(runtimeSectionRows(seeds))
}

// Gap N -> N+1 not yet elapsed: the section completes, the runtime enters the
// between-sections window, no next section starts, and the finished section's
// open modules are handed to delivery through the outbox.
func TestReconcileExpiredSectionsEntersWaitingWindowDuringGap(t *testing.T) {
	svc, mock, outbx := newMockService(t)

	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	deadline := base.Add(64 * time.Minute)
	asOf := deadline.Add(40 * time.Second)

	expectCandidateScan(mock, asOf, "sched-1", true, 10)
	expectScheduleTxOpen(mock, "sched-1", "rt-1", "live", "reading-writing", false, false, 7, []sectionSeed{
		{key: "reading-writing", order: 1, planned: 64, gap: 10, status: "live", startedAt: &base},
		{key: "math", order: 2, planned: 35, status: "locked"},
	})
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections")).
		WithArgs(deadline, "time_expired", "rt-1", "reading-writing").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).WillReturnResult(sqlmock.NewResult(0, 1))
	// The handover runs before the runtime bump, so it names the current value.
	expectRuntimeRevisionRead(mock, 7)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT ma.attempt_id")).
		WithArgs("sched-1", "reading-writing").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}).AddRow("att-1"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes")).
		WithArgs("rt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	// Opening the window bumps the revision, and the wakeup names that value.
	expectRuntimeRevisionRead(mock, 8)
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).WillReturnResult(sqlmock.NewResult(0, 1))
	// The reconciler reads once more to report the outcome it observed.
	expectRuntimeRevisionRead(mock, 8)
	mock.ExpectCommit()

	outcomes, err := svc.ReconcileExpiredSections(context.Background(), asOf, 10, "test")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].RuntimeRevision != 8 {
		t.Fatalf("expected one runtime revision bump (7 -> 8), got %+v", outcomes)
	}
	if !contains(outbx.families, outbox.FamilySectionAttemptsReconcile) {
		t.Fatalf("finished section must enqueue module reconcile, got families %v", outbx.families)
	}
	if !contains(outbx.families, outbox.FamilyRuntimeChanged) {
		t.Fatalf("waiting transition must wake the runtime, got families %v", outbx.families)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Gap elapsed: the next locked section goes live at previous end + gap, the
// waiting flag clears, and the runtime revision bumps once.
func TestReconcileExpiredSectionsStartsNextSectionWhenGapElapsed(t *testing.T) {
	svc, mock, _ := newMockService(t)

	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	endedAt := base.Add(64 * time.Minute)
	startAt := endedAt.Add(10 * time.Minute)
	asOf := endedAt.Add(12 * time.Minute)

	expectCandidateScan(mock, asOf, "sched-1", true, 10)
	expectScheduleTxOpen(mock, "sched-1", "rt-1", "live", "reading-writing", true, false, 7, []sectionSeed{
		{key: "reading-writing", order: 1, planned: 64, gap: 10, status: "completed", startedAt: &base, endedAt: &endedAt},
		{key: "math", order: 2, planned: 35, status: "locked"},
	})
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections")).
		WithArgs(startAt, startAt, "rt-1", "math").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes")).
		WithArgs("math", "math", int64(35*60), "rt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	// The start bumps the revision; both the wakeup and the reported outcome
	// name the value read back from the row.
	expectRuntimeRevisionRead(mock, 8)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts sa")).
		WithArgs("rt-1", "math", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, 8)
	mock.ExpectCommit()

	outcomes, err := svc.ReconcileExpiredSections(context.Background(), asOf, 10, "test")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].RuntimeRevision != 8 {
		t.Fatalf("expected one advance to revision 8, got %+v", outcomes)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A sweep far behind the schedule catches up through every expired section and
// completes the runtime exactly once.
func TestReconcileExpiredSectionsCatchesUpAcrossSections(t *testing.T) {
	svc, mock, outbx := newMockService(t)

	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	deadline1 := base.Add(64 * time.Minute)
	deadline2 := deadline1.Add(35 * time.Minute)
	asOf := deadline2.Add(6 * time.Minute)

	expectCandidateScan(mock, asOf, "sched-1", true, 10)
	expectScheduleTxOpen(mock, "sched-1", "rt-1", "live", "reading-writing", false, false, 7, []sectionSeed{
		{key: "reading-writing", order: 1, planned: 64, status: "live", startedAt: &base},
		{key: "math", order: 2, planned: 35, status: "locked"},
	})
	// Section 1 completes at its deadline.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections")).
		WithArgs(deadline1, "time_expired", "rt-1", "reading-writing").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, 7)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT ma.attempt_id")).
		WithArgs("sched-1", "reading-writing").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}).AddRow("att-1"))
	// Section 2 starts backdated at section 1's deadline.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections")).
		WithArgs(deadline1, deadline1, "rt-1", "math").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes")).
		WithArgs("math", "math", int64(35*60), "rt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, 8)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts sa")).
		WithArgs("rt-1", "math", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).WillReturnResult(sqlmock.NewResult(0, 1))
	// Section 2 is itself expired: complete it and end the runtime.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtime_sections")).
		WithArgs(deadline2, "time_expired", "rt-1", "math").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, 8)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT ma.attempt_id")).
		WithArgs("sched-1", "math").
		WillReturnRows(sqlmock.NewRows([]string{"attempt_id"}).AddRow("att-1"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes")).
		WithArgs(asOf, "rt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, 9)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_schedules")).
		WithArgs("sched-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM student_attempts")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("att-1"))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO session_audit_logs")).WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, 9)
	mock.ExpectCommit()

	outcomes, err := svc.ReconcileExpiredSections(context.Background(), asOf, 10, "test")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].RuntimeRevision != 9 {
		t.Fatalf("expected two runtime revision bumps (7 -> 9), got %+v", outcomes)
	}
	if !contains(outbx.families, outbox.FamilyAutoSubmitScheduleAttempts) {
		t.Fatalf("schedule completion must enqueue auto-submit, got %v", outbx.families)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A section the worker will not advance (paused clock) is flagged as overrun
// so the proctor sees it: the state machine decides this, the SQL wiring is
// pinned here.
func TestReconcileExpiredSectionsFlagsOverrunOnPausedSection(t *testing.T) {
	svc, mock, _ := newMockService(t)

	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	deadline := base.Add(64 * time.Minute)
	pausedAt := base.Add(30 * time.Minute)
	asOf := deadline.Add(5 * time.Minute)

	expectCandidateScan(mock, asOf, "sched-1", true, 10)
	expectScheduleTxOpen(mock, "sched-1", "rt-1", "live", "reading-writing", false, false, 7, []sectionSeed{
		{key: "reading-writing", order: 1, planned: 64, status: "live", startedAt: &base, pausedAt: &pausedAt},
		{key: "math", order: 2, planned: 35, status: "locked"},
	})
	mock.ExpectExec(regexp.QuoteMeta("UPDATE exam_session_runtimes")).
		WithArgs("rt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectRuntimeRevisionRead(mock, 8)
	mock.ExpectCommit()

	outcomes, err := svc.ReconcileExpiredSections(context.Background(), asOf, 10, "test")
	if err != nil {
		t.Fatalf("reconcile: %v", err)
	}
	if len(outcomes) != 1 || outcomes[0].RuntimeRevision != 8 {
		t.Fatalf("overrun flag must bump the runtime revision, got %+v", outcomes)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The between-sections projection: a completed active section must not be
// recomputed into a 0:00 overrun clock, and it must expose the next section's
// authoritative start so the client can count the break down.
func TestHydrateSessionRuntimeBetweenSections(t *testing.T) {
	now := time.Date(2026, 9, 14, 9, 40, 0, 0, time.UTC)
	base := time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)
	endedAt := base.Add(64 * time.Minute)
	start := sql.NullString{String: "reading-writing", Valid: true}
	row := sessionRuntimeRow{
		id: "rt-1", scheduleID: "sched-1", examID: "exam-1", providerKey: "sat",
		status: "live", timingModel: "cohort_section_v3",
		activeSectionKey: start, currentSectionKey: start,
		remaining: 0, waiting: sql.NullBool{Bool: true, Valid: true},
		overrun:   sql.NullBool{Bool: false, Valid: true},
		createdAt: base, updatedAt: base, revision: 9,
	}
	sections := []SessionRuntimeSection{
		{
			ID: "sec-1", RuntimeID: "rt-1", SectionKey: "reading-writing",
			SectionOrder: 1, PlannedDurationMinutes: 64, GapAfterMinutes: 10,
			Status: "completed", ActualStartAt: &base, ActualEndAt: &endedAt,
		},
		{ID: "sec-2", RuntimeID: "rt-1", SectionKey: "math", SectionOrder: 2, PlannedDurationMinutes: 35, Status: "locked"},
	}

	got := hydrateSessionRuntime(row, sections, now)
	if got.WaitingForNextSection != true {
		t.Fatalf("waiting flag must round-trip")
	}
	if got.IsOverrun {
		t.Fatalf("a completed section must not project as overrun")
	}
	if got.CurrentSectionDeadlineAt != nil {
		t.Fatalf("a completed section has no live deadline, got %v", got.CurrentSectionDeadlineAt)
	}
	want := endedAt.Add(10 * time.Minute)
	if got.NextSectionStartAt == nil || !got.NextSectionStartAt.Equal(want) {
		t.Fatalf("next section start must be end+gap (%v), got %v", want, got.NextSectionStartAt)
	}
	if got.CurrentSectionRemainingSeconds != 0 {
		t.Fatalf("between sections must project 0 remaining, got %d", got.CurrentSectionRemainingSeconds)
	}
}

func contains(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}

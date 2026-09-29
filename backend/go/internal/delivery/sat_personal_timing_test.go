package delivery

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// SAT full-entry-time acceptance contract (plan 2026-09-24).
//
// These drive the REAL service over the REAL statements, so they fail for the
// behaviour the plan is about rather than for arithmetic on a helper:
//
//   - the authored window is anchored to the server-issued offer start, never to
//     request/render time (the arm writes
//     `entry_starts_at = DATE_ADD(UTC_TIMESTAMP(6), INTERVAL ? SECOND)` and
//     enterModule writes `started_at = entry_starts_at`, from which
//     computeModuleTiming derives deadlineAt = started_at + allocated_seconds);
//   - arming leaves the authored allotment untouched (no allocated_seconds /
//     started_at write while an offer is only armed);
//   - a reload resumes the same offer instead of allocating a second window;
//   - rearming is bounded by admission closure and a retry budget, and refuses a
//     module that already has an accepted response;
//   - a stale offer conflicts.
//
// Every case pins the error code a candidate can actually hit.

// The enter statement: started_at must come from the offer, never from now().
const personalEnterAnchorsStartedAtToTheOffer = "(?s)UPDATE assessment_module_attempts.*" +
	"SET state = 'active', started_at = entry_starts_at,.*" +
	"WHERE id = \\? AND state = 'not_started' AND entry_generation = \\?.*" +
	"entry_starts_at = \\? AND entry_confirmed_at IS NULL AND entry_entered_at IS NULL"

// The break enter statement: deadline = offer start + authored duration.
const personalBreakEnterSetsTheOwnedDeadline = "(?s)UPDATE assessment_attempt_breaks.*" +
	"state = 'active', starts_at = entry_starts_at,.*" +
	"deadline_at = DATE_ADD\\(entry_starts_at, INTERVAL duration_seconds SECOND\\).*" +
	"state = 'armed' AND entry_generation = \\?"

// personalReconcileDrained stages StartModule's reconcile-then-write prologue for
// a sat_personal_v1 runtime: the break sweep runs first (its own deadline, no
// save grace), then the server-driven break→next-M1 activation check, and the
// open-module loop drains.
func personalReconcileDrained(mock sqlmock.Sqlmock) {
	deliverySaveBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WithArgs("att-1", "sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "provider_key"}).AddRow("att-1", "sat"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "status", "timing_model", "active_section_key"}).
			AddRow("rt-1", "live", examruntime.TimingModelPersonal, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_attempt_breaks")).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"exists"}).AddRow(false))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts")).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason", "entry_confirmed_at", "entry_entered_at"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND state IN ('submitted', 'locked')")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)"}).AddRow(0))
	mock.ExpectCommit()
}

// personalTimingGate stages moduleTimingGateTx on a live personal runtime: the
// model and the in-tx instant, with no stage/room window.
func personalTimingGate(mock sqlmock.Sqlmock, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT timing_model, active_section_key FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"timing_model", "active_section_key"}).
			AddRow(examruntime.TimingModelPersonal, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT status FROM exam_session_runtimes WHERE schedule_id = ?")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
}

// personalModuleRow stages the locked module attempt with the authored allotment.
func personalModuleRow(mock sqlmock.Sqlmock, state string, allocated int, startedAt any) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE")).
		WithArgs("att-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}).
			AddRow("ma-1", "mod-1", state, allocated, nil, startedAt, nil, 0, 0, nil))
}

// personalEntryRow stages the locked offer metadata for the ENTER and VISIBLE
// reads, which never look at the proctor grant.
func personalEntryRow(mock sqlmock.Sqlmock, generation int, startsAt, confirmedAt, enteredAt any) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT entry_generation, entry_starts_at, entry_confirmed_at, entry_entered_at FROM assessment_module_attempts WHERE id = ? FOR UPDATE")).
		WithArgs("ma-1").
		WillReturnRows(sqlmock.NewRows([]string{"entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at"}).
			AddRow(generation, startsAt, confirmedAt, enteredAt))
}

func personalBreakPendingLookup(mock sqlmock.Sqlmock, pending bool) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(pending))
}

func personalAdmissionRow(mock sqlmock.Sqlmock, endTime any) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT s.end_time FROM exam_schedules s JOIN student_attempts sa ON sa.schedule_id = s.id WHERE sa.id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"end_time"}).AddRow(endTime))
}

// personalModuleAwaitingStartProbe stages the entry-seed probe: the state of
// the module attempt a transition was asked for.
func personalModuleAwaitingStartProbe(mock sqlmock.Sqlmock, state string) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?")).
		WithArgs("att-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"state"}).AddRow(state))
}

// personalStartModulePrologue stages everything up to (not including) the timing
// gate for a personal StartModule/EnterModule call on an unstarted (seeded)
// module.
//
// The seeded row means entry has no timeout work to do, so NO reconciliation is
// staged: sqlmock fails on an unexpected statement, which is what pins the
// entry-reliability fast path — a transition that pays for attempt + runtime +
// module FOR UPDATE locks on every entry (plan 2026-09-24) fails here.
func personalStartModulePrologue(mock sqlmock.Sqlmock) {
	deliverySaveBinding(mock)
	personalModuleAwaitingStartProbe(mock, "not_started")
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
}

// personalStartModulePrologueReconciling is the same prologue for a module that
// is already active: a reload whose expired clock may still need finalizing, so
// reconciliation must run before the transition transaction.
func personalStartModulePrologueReconciling(mock sqlmock.Sqlmock) {
	deliverySaveBinding(mock)
	personalModuleAwaitingStartProbe(mock, "active")
	personalReconcileDrained(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
}

// A personal StartModule activates immediately at DATABASE time (single
// operation): state=active with started_at=DB NOW. No future offer, no lead,
// no Enter/Visible dance — the browser renders the exam on this response.
func TestStartModulePersonalArmsTheOfferAtDatabaseTimePlusTheLead(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	personalStartModulePrologue(mock)
	personalModuleRow(mock, "not_started", 120, nil)
	personalTimingGate(mock, now)
	personalBreakPendingLookup(mock, false)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = 'active'")).
		WithArgs(120, sqlmock.AnyArg(), sqlmock.AnyArg(), "ma-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'exam'")).
		WithArgs("att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	deliveryMaxRevision(mock, 7)
	deliveryBusInsert(mock, "attempt", "att-1", "sat_module_started", 7)
	deliveryBusInsert(mock, "schedule_roster", "sched-1", "sat_module_started", 7)
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal, "active")

	out, err := svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1")
	if err != nil {
		t.Fatalf("personal start module: %v", err)
	}
	if out == nil || len(out.Attempt.ModuleAttempts) != 1 {
		t.Fatalf("bootstrap missing the active module attempt: %+v", out)
	}
	active := out.Attempt.ModuleAttempts[0]
	if active.State != "active" {
		t.Fatalf("single-op start must leave the module active: %+v", active)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestStartModuleOfferAckAvoidsAttemptProjection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	personalStartModulePrologue(mock)
	personalModuleRow(mock, "not_started", 120, nil)
	personalTimingGate(mock, now)
	personalBreakPendingLookup(mock, false)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = 'active'")).
		WithArgs(120, sqlmock.AnyArg(), sqlmock.AnyArg(), "ma-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'exam'")).
		WithArgs("att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	deliveryMaxRevision(mock, 7)
	deliveryBusInsert(mock, "attempt", "att-1", "sat_module_started", 7)
	deliveryBusInsert(mock, "schedule_roster", "sched-1", "sat_module_started", 7)
	mock.ExpectCommit()
	entryStateRow(mock, "active", 0, nil, nil, nil, now, examruntime.TimingModelPersonal, now)
	ack, err := svc.StartModuleOfferAck(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", nil, nil, false, "sess-test", "tok-1")
	if err != nil {
		t.Fatal(err)
	}
	if ack.State != "active" || ack.StartedAt == nil {
		t.Fatalf("unexpected compact active ack: %+v", ack)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnterModuleAckAvoidsAttemptProjection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	startsAt := now.Add(2 * time.Second)
	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalModuleRow(mock, "not_started", 120, nil)
	personalTimingGate(mock, now)
	personalEntryRow(mock, 1, startsAt, nil, nil)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
	mock.ExpectExec(personalEnterAnchorsStartedAtToTheOffer).
		WithArgs("ma-1", 1, startsAt).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'exam'")).
		WithArgs("att-1").WillReturnResult(sqlmock.NewResult(0, 1))
	deliveryMaxRevision(mock, 7)
	deliveryBusInsert(mock, "attempt", "att-1", "sat_module_started", 7)
	deliveryBusInsert(mock, "schedule_roster", "sched-1", "sat_module_started", 7)
	mock.ExpectCommit()
	entryStateRow(mock, "active", 1, startsAt, now, nil, startsAt, examruntime.TimingModelPersonal, now)
	ack, err := svc.EnterModuleAck(context.Background(), "sched-1", "att-1", "sched-1", ModuleEntryRequest{ModuleID: "mod-1", Generation: 1}, "sess-test", "tok-1")
	if err != nil {
		t.Fatal(err)
	}
	if ack.EntryState != "confirmed" || ack.StartedAt == nil || !ack.StartedAt.Equal(startsAt) {
		t.Fatalf("unexpected compact confirmation: %+v", ack)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A reload mid-module resumes the active module: no second allocation may be
// written. StartModule is idempotent for already-active modules.
func TestStartModulePersonalReloadKeepsTheSameOffer(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	startedAt := now.Add(-time.Minute)

	personalStartModulePrologueReconciling(mock)
	personalModuleRow(mock, "active", 120, startedAt)
	personalTimingGate(mock, now)
	personalBreakPendingLookup(mock, false)
	// No UPDATE is staged: sqlmock fails on any unexpected statement, so a
	// reallocation would surface as an error rather than a silent reset.
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal, "active")

	out, err := svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1")
	if err != nil {
		t.Fatalf("reload must resume the active module, got %v", err)
	}
	if out == nil || len(out.Attempt.ModuleAttempts) != 1 {
		t.Fatalf("bootstrap missing the resumed module attempt: %+v", out)
	}
	if out.Attempt.ModuleAttempts[0].State != "active" {
		t.Fatalf("reload must keep the module active, got %+v", out.Attempt.ModuleAttempts[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Single-op entry ignores stale offer columns: a missed offer, an exhausted
// retry budget, or a prior admission window never blocks the one immediate
// activation. Rearm bounds now live only in the deprecated arm path (covered
// by personal_offer_test.go); the normal StartModule is idempotent.
func TestStartModulePersonalIgnoresStaleOfferColumnsAndActivates(t *testing.T) {
	for _, name := range []string{"missed-offer", "exhausted-budget", "accepted-response"} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := deliverySvc(db)
			now := time.Now().UTC()

			personalStartModulePrologue(mock)
			personalModuleRow(mock, "not_started", 120, nil)
			personalTimingGate(mock, now)
			personalBreakPendingLookup(mock, false)
			mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = 'active'")).
				WithArgs(120, sqlmock.AnyArg(), sqlmock.AnyArg(), "ma-1").
				WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'exam'")).
				WithArgs("att-1").
				WillReturnResult(sqlmock.NewResult(0, 1))
			deliveryMaxRevision(mock, 7)
			deliveryBusInsert(mock, "attempt", "att-1", "sat_module_started", 7)
			deliveryBusInsert(mock, "schedule_roster", "sched-1", "sat_module_started", 7)
			mock.ExpectCommit()
			deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal, "active")

			out, err := svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1")
			if err != nil {
				t.Fatalf("stale offer columns must not block single-op start, got %v", err)
			}
			if out == nil || len(out.Attempt.ModuleAttempts) != 1 || out.Attempt.ModuleAttempts[0].State != "active" {
				t.Fatalf("expected an active module, got %+v", out)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// The attempt-owned break owns the hand-off: the next module cannot be armed
// until the scheduled break completes.
func TestStartModulePersonalRefusesWhileTheScheduledBreakIsPending(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	personalStartModulePrologue(mock)
	personalModuleRow(mock, "not_started", 120, nil)
	personalTimingGate(mock, now)
	personalBreakPendingLookup(mock, true)
	mock.ExpectRollback()

	_, err = svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details["reason"] != "PERSONAL_BREAK_PENDING" {
		t.Fatalf("expected PERSONAL_BREAK_PENDING, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// EnterModule is the confirmation that STARTS the clock: started_at becomes the
// server-issued offer start (so the deadline is starts_at + authored seconds),
// not the moment the response was processed.
func TestEnterModuleAnchorsTheAuthoredWindowToTheOfferStart(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	startsAt := now.Add(2 * time.Second)

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalModuleRow(mock, "not_started", 120, nil)
	personalTimingGate(mock, now)
	personalEntryRow(mock, 1, startsAt, nil, nil)
	// The confirmation reads the DB instant just before the CAS.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
	mock.ExpectExec(personalEnterAnchorsStartedAtToTheOffer).
		WithArgs("ma-1", 1, startsAt).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'exam'")).
		WithArgs("att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	deliveryMaxRevision(mock, 7)
	deliveryBusInsert(mock, "attempt", "att-1", "sat_module_started", 7)
	deliveryBusInsert(mock, "schedule_roster", "sched-1", "sat_module_started", 7)
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, startsAt, examruntime.TimingModelPersonal, "active")

	out, err := svc.EnterModule(context.Background(), "sched-1", "att-1", "sched-1",
		ModuleEntryRequest{ModuleID: "mod-1", Generation: 1}, "sess-test", "tok-1")
	if err != nil {
		t.Fatalf("enter module: %v", err)
	}
	if out == nil || len(out.Attempt.ModuleAttempts) != 1 {
		t.Fatalf("bootstrap missing the confirmed module attempt: %+v", out)
	}
	confirmed := out.Attempt.ModuleAttempts[0]
	if confirmed.StartedAt == nil || !confirmed.StartedAt.Equal(startsAt) {
		t.Fatalf("started_at must be the offer start %v, got %v", startsAt, confirmed.StartedAt)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A confirmation that arrives at or after the offer's start cannot enter: there
// is no lead left to paint the active frame, so the client must rearm.
func TestEnterModuleRejectsAConfirmationAfterTheOfferStarted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalModuleRow(mock, "not_started", 120, nil)
	personalTimingGate(mock, now)
	personalEntryRow(mock, 1, now.Add(-time.Second), nil, nil)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
	mock.ExpectRollback()

	_, err = svc.EnterModule(context.Background(), "sched-1", "att-1", "sched-1",
		ModuleEntryRequest{ModuleID: "mod-1", Generation: 1}, "sess-test", "tok-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details["reason"] != "ENTRY_OFFER_MISSED" {
		t.Fatalf("expected ENTRY_OFFER_MISSED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A stale offer generation conflicts instead of confirming the wrong window.
func TestEnterModuleRejectsAStaleOfferGeneration(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalModuleRow(mock, "not_started", 120, nil)
	personalTimingGate(mock, now)
	personalEntryRow(mock, 2, now.Add(2*time.Second), nil, nil)
	mock.ExpectRollback()

	_, err = svc.EnterModule(context.Background(), "sched-1", "att-1", "sched-1",
		ModuleEntryRequest{ModuleID: "mod-1", Generation: 1}, "sess-test", "tok-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details["reason"] != "STALE_ENTRY_GENERATION" {
		t.Fatalf("expected STALE_ENTRY_GENERATION, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The first-paint acknowledgment is what closes the rearm window, so it cannot
// fire before the authored start.
func TestMarkStageVisibleRejectsAFirstFrameBeforeTheAuthoredStart(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	startsAt := now.Add(3 * time.Second)

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalModuleRow(mock, "active", 120, startsAt)
	personalTimingGate(mock, now)
	personalEntryRow(mock, 1, startsAt, now, nil)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
	mock.ExpectRollback()

	_, err = svc.MarkStageVisible(context.Background(), "sched-1", "att-1", "sched-1",
		ModuleEntryRequest{ModuleID: "mod-1", Generation: 1}, "sess-test", "tok-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details["reason"] != "ENTRY_NOT_STARTED" {
		t.Fatalf("expected ENTRY_NOT_STARTED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The acknowledgment is idempotent: a repeated first-paint must not write
// another revision or resurrect the rearm window.
func TestMarkStageVisibleIsIdempotentAfterTheFirstPaint(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	startsAt := now.Add(-time.Second)

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalModuleRow(mock, "active", 120, startsAt)
	personalTimingGate(mock, now)
	personalEntryRow(mock, 1, startsAt, now, now)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
	mock.ExpectCommit()

	// Entry reliability: the acknowledgment answers with a compact ack, not an
	// attempt projection — no bootstrap load may run here.
	ack, err := svc.MarkStageVisible(context.Background(), "sched-1", "att-1", "sched-1",
		ModuleEntryRequest{ModuleID: "mod-1", Generation: 1}, "sess-test", "tok-1")
	if err != nil {
		t.Fatalf("repeated acknowledgment must be a no-op, got %v", err)
	}
	if ack == nil || !ack.Acknowledged || ack.EntryGeneration != 1 || ack.ModuleID != "mod-1" {
		t.Fatalf("acknowledgment must report the idempotent entry, got %+v", ack)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// ---- Breaks -------------------------------------------------------------

// personalBreakRuntimeNow stages personalRuntimeNowTx: the runtime lock plus the
// authoritative in-tx instant the break arm/entry decision is made against.
func personalBreakRuntimeNow(mock sqlmock.Sqlmock, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT timing_model, status FROM exam_session_runtimes WHERE schedule_id = ? FOR UPDATE")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"timing_model", "status"}).
			AddRow(examruntime.TimingModelPersonal, "live"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(now))
}

func personalBreakRow(mock sqlmock.Sqlmock, state string, generation int, entryStartsAt, confirmedAt, enteredAt, startsAt any) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("br-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"duration_seconds", "state", "entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "starts_at"}).
			AddRow(120, state, generation, entryStartsAt, confirmedAt, enteredAt, startsAt))
}

// personalBreakArmRow stages the ARM path's own read of the break row — six
// columns, including the proctor grant. `personalBreakRow` above is the wider
// enter/visible read and is not the same query.
func personalBreakArmRow(mock sqlmock.Sqlmock, state string, generation int, entryStartsAt, startsAt, enteredAt, proctorRearmAt any) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("br-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"state", "entry_generation", "entry_starts_at", "starts_at", "entry_entered_at", "entry_proctor_rearm_at"}).
			AddRow(state, generation, entryStartsAt, startsAt, enteredAt, proctorRearmAt))
}

// The break is armed at database time plus the lead too, so a slow transition
// cannot consume the authored break.
func TestStartBreakArmsTheAttemptOwnedBreakAtDatabaseTimePlusTheLead(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalBreakRuntimeNow(mock, time.Now().UTC())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("br-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"state", "entry_generation", "entry_starts_at", "starts_at", "entry_entered_at", "entry_proctor_rearm_at"}).
			AddRow("pending", 0, nil, nil, nil, nil))
	mock.ExpectExec("(?s)UPDATE assessment_attempt_breaks.*"+
		"entry_starts_at = DATE_ADD\\(UTC_TIMESTAMP\\(6\\), INTERVAL \\? SECOND\\).*"+
		"WHERE id = \\? AND attempt_id = \\? AND state IN \\('pending', 'armed'\\) AND entry_entered_at IS NULL").
		WithArgs(personalOfferLeadSeconds, "br-1", "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, time.Now().UTC(), examruntime.TimingModelPersonal)

	if _, err := svc.StartBreak(context.Background(), "sched-1", "att-1", "sched-1", "br-1", nil, "sess-test", "tok-1"); err != nil {
		t.Fatalf("start break: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A lost arm race must conflict: reporting success would leave the client
// believing it holds an offer the server never wrote.
func TestStartBreakConflictsWhenTheArmRaceWasLost(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalBreakRuntimeNow(mock, time.Now().UTC())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("br-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"state", "entry_generation", "entry_starts_at", "starts_at", "entry_entered_at", "entry_proctor_rearm_at"}).
			AddRow("pending", 0, nil, nil, nil, nil))
	mock.ExpectExec("(?s)UPDATE assessment_attempt_breaks").
		WithArgs(personalOfferLeadSeconds, "br-1", "att-1").
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	_, err = svc.StartBreak(context.Background(), "sched-1", "att-1", "sched-1", "br-1", nil, "sess-test", "tok-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details["reason"] != "STALE_ENTRY_GENERATION" {
		t.Fatalf("expected STALE_ENTRY_GENERATION on a lost arm race, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Confirmed break entry sets the owned deadline from the offer start, so the
// candidate gets the whole authored break.
func TestEnterBreakSetsTheOwnedDeadlineFromTheOfferStart(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	entryStartsAt := now.Add(2 * time.Second)

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalBreakRuntimeNow(mock, now)
	personalBreakRow(mock, "armed", 1, entryStartsAt, nil, nil, nil)
	mock.ExpectExec(personalBreakEnterSetsTheOwnedDeadline).
		WithArgs("br-1", "att-1", 1).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal)

	if _, err := svc.EnterBreak(context.Background(), "sched-1", "att-1", "sched-1",
		BreakEntryRequest{BreakID: "br-1", Generation: 1}, "sess-test", "tok-1"); err != nil {
		t.Fatalf("enter break: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A break confirmation that arrives after the offer started leaves no lead to
// paint the break frame, so it must not consume the break.
func TestEnterBreakRejectsAConfirmationAfterTheOfferStarted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalBreakRuntimeNow(mock, now)
	personalBreakRow(mock, "armed", 1, now.Add(-time.Second), nil, nil, nil)
	mock.ExpectRollback()

	_, err = svc.EnterBreak(context.Background(), "sched-1", "att-1", "sched-1",
		BreakEntryRequest{BreakID: "br-1", Generation: 1}, "sess-test", "tok-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details["reason"] != "ENTRY_OFFER_MISSED" {
		t.Fatalf("expected ENTRY_OFFER_MISSED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A retried confirmation for an active break is an idempotent replay: it must
// not move the deadline a second time.
func TestEnterBreakIsAnIdempotentReplayForAnActiveBreak(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()
	startsAt := now.Add(-time.Minute)

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalBreakRuntimeNow(mock, now)
	personalBreakRow(mock, "active", 1, startsAt, startsAt, startsAt, startsAt)
	// No UPDATE is staged: a replay that rewrote starts_at or deadline_at
	// would fail here.
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal)

	if _, err := svc.EnterBreak(context.Background(), "sched-1", "att-1", "sched-1",
		BreakEntryRequest{BreakID: "br-1", Generation: 1}, "sess-test", "tok-1"); err != nil {
		t.Fatalf("replay must be a no-op, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Single-op entry needs no proctor grant: stale grants and budgets are ignored
// and the module activates immediately. Grant-gated rearm lives only in the
// deprecated arm path (personal_offer_test.go).
func TestStartModulePersonalActivatesWithoutProctorGrant(t *testing.T) {
	for _, name := range []string{"admission-closed", "spent-budget"} {
		t.Run(name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := deliverySvc(db)
			now := time.Now().UTC()

			personalStartModulePrologue(mock)
			personalModuleRow(mock, "not_started", 120, nil)
			personalTimingGate(mock, now)
			personalBreakPendingLookup(mock, false)
			mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = 'active'")).
				WithArgs(120, sqlmock.AnyArg(), sqlmock.AnyArg(), "ma-1").
				WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'exam'")).
				WithArgs("att-1").
				WillReturnResult(sqlmock.NewResult(0, 1))
			deliveryMaxRevision(mock, 7)
			deliveryBusInsert(mock, "attempt", "att-1", "sat_module_started", 7)
			deliveryBusInsert(mock, "schedule_roster", "sched-1", "sat_module_started", 7)
			mock.ExpectCommit()
			deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal, "active")

			out, err := svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1")
			if err != nil {
				t.Fatalf("single-op start must not need a grant, got %v", err)
			}
			if out == nil || len(out.Attempt.ModuleAttempts) != 1 || out.Attempt.ModuleAttempts[0].State != "active" {
				t.Fatalf("expected an active module, got %+v", out)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// The same grant lifts the break's admission bound: a break the proctor has
// re-armed arms even though the room's admission closed, which is the other
// half of "ask the proctor to re-arm the break".
func TestStartBreakArmsAfterTheProctorGrantLiftsAdmissionClosure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalBreakRuntimeNow(mock, now)
	personalBreakArmRow(mock, "armed", 1, now.Add(-time.Second), nil, nil, now.Add(-time.Minute))
	personalAdmissionRow(mock, now.Add(-time.Minute))
	mock.ExpectExec("(?s)UPDATE assessment_attempt_breaks.*"+
		"entry_starts_at = DATE_ADD\\(UTC_TIMESTAMP\\(6\\), INTERVAL \\? SECOND\\).*"+
		"WHERE id = \\? AND attempt_id = \\? AND state IN \\('pending', 'armed'\\) AND entry_entered_at IS NULL").
		WithArgs(personalOfferLeadSeconds, "br-1", "att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal, "armed")

	if _, err := svc.StartBreak(context.Background(), "sched-1", "att-1", "sched-1", "br-1", nil, "sess-test", "tok-1"); err != nil {
		t.Fatalf("a granted break must still arm after admission closed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A completed break is terminal: the sweep owns it, so another entry conflicts
// and the authored break is not handed out twice.
func TestEnterBreakRejectsACompletedBreak(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	now := time.Now().UTC()

	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalBreakRuntimeNow(mock, now)
	personalBreakRow(mock, "completed", 1, now.Add(-time.Hour), now.Add(-time.Hour), now.Add(-time.Hour), now.Add(-time.Hour))
	mock.ExpectRollback()

	_, err = svc.EnterBreak(context.Background(), "sched-1", "att-1", "sched-1",
		BreakEntryRequest{BreakID: "br-1", Generation: 1}, "sess-test", "tok-1")
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details["reason"] != "BREAK_NOT_ARMED" {
		t.Fatalf("expected BREAK_NOT_ARMED for a completed break, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

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

// SAT entry recovery contract (plan 2026-09-24, entry reliability).
//
// The reported failure was two-sided: a synchronized cohort overloaded the
// transition path, and "Retry now" could not tell "the server never committed"
// apart from "the server committed and the response was lost", so it replayed
// the expensive command while a full page refresh — which reads authoritative
// state — succeeded. These tests drive the real service over the real
// statements: the recovery read must answer from one indexed row, and a module
// that is already seeded must not make entry pay for reconciliation.

// entryStateRow stages the single-row entry read for (att-1, mod-1).
func entryStateRow(mock sqlmock.Sqlmock, state string, generation int, startsAt, confirmedAt, enteredAt, startedAt any, model string, now time.Time) {
	mock.ExpectQuery(regexp.QuoteMeta(satEntryStateQuery)).
		WithArgs("sched-1", "sched-1", "att-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "module_id", "state", "revision", "allocated_seconds", "available_at", "started_at",
			"paused_at", "accumulated_paused_seconds", "extension_seconds",
			"entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at",
			"control_epoch", "timing_model", "revision", "now",
		}).AddRow("ma-1", "mod-1", state, 4, 120, nil, startedAt, nil, 0, 0,
			generation, startsAt, confirmedAt, enteredAt, 7, model, 3, now))
}

// A committed entry the client never heard about must read back as committed.
// This is the lost-response case: the browser must discover it here instead of
// replaying the transition command.
func TestEntryStateReportsACommittedConfirmation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	startsAt := now.Add(2 * time.Second)
	confirmedAt := now.Add(-time.Second)

	deliverySaveBinding(mock)
	entryStateRow(mock, "active", 2, startsAt, confirmedAt, nil, startsAt, examruntime.TimingModelPersonal, now)

	ack, err := deliverySvc(db).EntryState(context.Background(), "sched-1", "att-1", "sched-1", "mod-1")
	if err != nil {
		t.Fatalf("entry state: %v", err)
	}
	if ack.EntryState != "confirmed" {
		t.Fatalf("a confirmed offer must read back as confirmed, got %q", ack.EntryState)
	}
	if ack.EntryGeneration != 2 || ack.EntryStartsAt == nil || !ack.EntryStartsAt.Equal(startsAt) {
		t.Fatalf("the offer generation and start must survive the recovery read: %+v", ack)
	}
	if ack.ControlEpoch != 7 || ack.RuntimeRevision != 3 {
		t.Fatalf("the epoch fences must survive the recovery read: %+v", ack)
	}
	if !ack.ServerNow.Equal(now) {
		t.Fatalf("the client clocks off serverNow, got %v want %v", ack.ServerNow, now)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An unconfirmed future offer is still usable: the client continues the offer
// it already has instead of asking for another one.
func TestEntryStateReportsAnArmedOffer(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	startsAt := now.Add(3 * time.Second)

	deliverySaveBinding(mock)
	entryStateRow(mock, "not_started", 1, startsAt, nil, nil, nil, examruntime.TimingModelPersonal, now)

	ack, err := deliverySvc(db).EntryState(context.Background(), "sched-1", "att-1", "sched-1", "mod-1")
	if err != nil {
		t.Fatalf("entry state: %v", err)
	}
	if ack.EntryState != "armed" {
		t.Fatalf("an unconfirmed future offer must read back as armed, got %q", ack.EntryState)
	}
	if ack.DeadlineAt != nil || ack.RemainingSeconds != nil {
		t.Fatalf("an unstarted module has no clock to quote: %+v", ack)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEntryStateDoesNotCallAnExpiredOfferArmed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	deliverySaveBinding(mock)
	entryStateRow(mock, "not_started", 2, now.Add(-time.Second), nil, nil, nil, examruntime.TimingModelPersonal, now)
	ack, err := deliverySvc(db).EntryState(context.Background(), "sched-1", "att-1", "sched-1", "mod-1")
	if err != nil {
		t.Fatal(err)
	}
	if ack.EntryState != "none" {
		t.Fatalf("expired offer must rearm, got %+v", ack)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An acknowledged first frame closes the offer: a replay can only resume, never
// rearm, which is why the verdict outranks the raw row state.
func TestEntryStateReportsAnEnteredOffer(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	startsAt := now.Add(-30 * time.Second)

	deliverySaveBinding(mock)
	entryStateRow(mock, "active", 1, startsAt, startsAt, now.Add(-29*time.Second), startsAt, examruntime.TimingModelPersonal, now)

	ack, err := deliverySvc(db).EntryState(context.Background(), "sched-1", "att-1", "sched-1", "mod-1")
	if err != nil {
		t.Fatalf("entry state: %v", err)
	}
	if ack.EntryState != "entered" {
		t.Fatalf("an acknowledged first frame must read back as entered, got %q", ack.EntryState)
	}
	if ack.DeadlineAt == nil || !ack.DeadlineAt.Equal(startsAt.Add(120*time.Second)) {
		t.Fatalf("an entered module must quote its immutable deadline: %+v", ack)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A cohort-timed module has no offer, so the recovery read must not invent one:
// the client keeps its existing path.
func TestEntryStateReportsNoOfferForACohortModule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()
	startsAt := now.Add(2 * time.Second)

	deliverySaveBinding(mock)
	entryStateRow(mock, "not_started", 3, startsAt, nil, nil, nil, examruntime.TimingModelCohortSection, now)

	ack, err := deliverySvc(db).EntryState(context.Background(), "sched-1", "att-1", "sched-1", "mod-1")
	if err != nil {
		t.Fatalf("entry state: %v", err)
	}
	if ack.EntryState != "none" || ack.EntryGeneration != 0 || ack.EntryStartsAt != nil {
		t.Fatalf("a cohort module must report no offer: %+v", ack)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The recovery read is an attempt-state read: a URL schedule id that does not
// match the bearer is forbidden before any database access.
func TestEntryStateRejectsScheduleMismatch(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	_, err = deliverySvc(db).EntryState(context.Background(), "sched-bearer", "att-1", "sched-url", "mod-1")
	if deliveryCodeOf(err) != apperrors.CodeForbidden {
		t.Fatalf("expected FORBIDDEN on schedule mismatch, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A missing module attempt is an honest NOT_FOUND: the client asked about a
// module this attempt has no row for.
func TestEntryStateReportsAMissingModuleAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	deliverySaveBinding(mock)
	mock.ExpectQuery(regexp.QuoteMeta(satEntryStateQuery)).
		WithArgs("sched-1", "sched-1", "att-1", "mod-1").
		WillReturnError(sqlmock.ErrCancelled)
	// ErrCancelled stands in for "no row": the assertion below is only that the
	// read surfaces an error rather than a fabricated verdict.
	if _, err := deliverySvc(db).EntryState(context.Background(), "sched-1", "att-1", "sched-1", "mod-1"); err == nil {
		t.Fatal("a failed entry read must surface an error, never an invented verdict")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The adaptive branch the server has not created yet is exactly the case that
// still has to reconcile: no row means the timed-out predecessor may still need
// finalizing before this module can exist at all.
func TestStartModuleReconcilesWhenTheModuleRowDoesNotExistYet(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC()

	deliverySaveBinding(mock)
	// The probe finds nothing: the branch has not been routed yet.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?")).
		WithArgs("att-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"state"}))
	// ... so reconciliation must run (it is the only thing that can create the
	// row), and its drained shape is staged as usual.
	personalReconcileDrained(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalModuleRow(mock, "not_started", 120, nil)
	personalTimingGate(mock, now)
	personalBreakPendingLookup(mock, false)
	personalEntryArmRow(mock, 0, nil, nil, nil, nil)
	mock.ExpectExec(personalArmAnchorsDatabaseTimeAndLead).
		WithArgs(personalOfferLeadSeconds, "ma-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal, "not_started")

	if _, err := deliverySvc(db).StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1"); err != nil {
		t.Fatalf("a missing module row must fall back to reconciliation, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

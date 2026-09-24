package delivery

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestArmPersonalModuleOfferLeavesModuleUnstarted(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	module := saveActiveModule{id: "ma-1", moduleID: "mod-1", state: "not_started", allocatedSeconds: 120}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(false))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT entry_generation, entry_starts_at, entry_confirmed_at, entry_entered_at, entry_proctor_rearm_at FROM assessment_module_attempts WHERE id = ? FOR UPDATE")).
		WithArgs("ma-1").WillReturnRows(sqlmock.NewRows([]string{"entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "entry_proctor_rearm_at"}).AddRow(0, nil, nil, nil, nil))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts")).
		WithArgs(personalOfferLeadSeconds, "ma-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return deliverySvc(db).armPersonalModuleOfferTx(ctx, q, "att-1", module, time.Date(2026, 9, 24, 2, 0, 0, 0, time.UTC), nil)
	})
	if err != nil {
		t.Fatalf("arm offer: %v", err)
	}
	if module.state != "not_started" || module.startedAt != nil {
		t.Fatalf("arming must leave the module unstarted: %+v", module)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestArmPersonalModuleOfferRearmsMissedUnenteredOffer(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	module := saveActiveModule{id: "ma-1", moduleID: "mod-1", state: "not_started", allocatedSeconds: 120}
	now := time.Date(2026, 9, 24, 2, 0, 10, 0, time.UTC)
	missedStart := now.Add(-time.Second)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(false))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT entry_generation, entry_starts_at, entry_confirmed_at, entry_entered_at, entry_proctor_rearm_at FROM assessment_module_attempts WHERE id = ? FOR UPDATE")).
		WithArgs("ma-1").WillReturnRows(sqlmock.NewRows([]string{"entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "entry_proctor_rearm_at"}).AddRow(1, missedStart, now.Add(-2*time.Second), nil, nil))
	// A missed offer is still inside the schedule's admission window.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT s.end_time FROM exam_schedules s JOIN student_attempts sa ON sa.schedule_id = s.id WHERE sa.id = ?")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"end_time"}).AddRow(now.Add(time.Hour)))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_question_responses WHERE module_attempt_id = ?)")).
		WithArgs("ma-1", "att-1", "mod-1").WillReturnRows(sqlmock.NewRows([]string{"has_response"}).AddRow(false))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts")).
		WithArgs(personalOfferLeadSeconds, "ma-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		generation := 1
		return deliverySvc(db).armPersonalModuleOfferTx(ctx, q, "att-1", module, now, &generation)
	})
	if err != nil {
		t.Fatalf("rearm missed offer: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestArmPersonalModuleOfferRearmsLateConfirmationBeforeVisibility(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 9, 24, 2, 0, 10, 0, time.UTC)
	missedStart := now.Add(-time.Second)
	module := saveActiveModule{id: "ma-1", moduleID: "mod-1", state: "active", startedAt: &missedStart, allocatedSeconds: 120}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(false))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT entry_generation, entry_starts_at, entry_confirmed_at, entry_entered_at, entry_proctor_rearm_at FROM assessment_module_attempts WHERE id = ? FOR UPDATE")).
		WithArgs("ma-1").WillReturnRows(sqlmock.NewRows([]string{"entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "entry_proctor_rearm_at"}).AddRow(1, missedStart, now.Add(-2*time.Second), nil, nil))
	// A missed offer is still inside the schedule's admission window.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT s.end_time FROM exam_schedules s JOIN student_attempts sa ON sa.schedule_id = s.id WHERE sa.id = ?")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"end_time"}).AddRow(now.Add(time.Hour)))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_question_responses WHERE module_attempt_id = ?)")).
		WithArgs("ma-1", "att-1", "mod-1").WillReturnRows(sqlmock.NewRows([]string{"has_response"}).AddRow(false))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts")).
		WithArgs(personalOfferLeadSeconds, "ma-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		generation := 1
		return deliverySvc(db).armPersonalModuleOfferTx(ctx, q, "att-1", module, now, &generation)
	})
	if err != nil {
		t.Fatalf("late confirmation should rearm before visible entry: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Plan 2026-09-24 (3.2): rearming is bounded by schedule admission closure.
// Once exam_schedules.end_time has passed, a missed offer must surface as a
// recoverable conflict instead of arming a fresh window the room would not
// honor — and must not touch the module row.
func TestArmPersonalModuleOfferRefusesRearmAfterAdmissionClosure(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	module := saveActiveModule{id: "ma-1", moduleID: "mod-1", state: "not_started", allocatedSeconds: 120}
	now := time.Date(2026, 9, 24, 2, 0, 10, 0, time.UTC)
	missedStart := now.Add(-time.Second)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(false))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT entry_generation, entry_starts_at, entry_confirmed_at, entry_entered_at, entry_proctor_rearm_at FROM assessment_module_attempts WHERE id = ? FOR UPDATE")).
		WithArgs("ma-1").WillReturnRows(sqlmock.NewRows([]string{"entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "entry_proctor_rearm_at"}).AddRow(1, missedStart, nil, nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT s.end_time FROM exam_schedules s JOIN student_attempts sa ON sa.schedule_id = s.id WHERE sa.id = ?")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"end_time"}).AddRow(now.Add(-time.Minute)))
	mock.ExpectRollback()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		generation := 1
		return deliverySvc(db).armPersonalModuleOfferTx(ctx, q, "att-1", module, now, &generation)
	})
	if err == nil {
		t.Fatal("a closed admission window must refuse to rearm a missed offer")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestArmPersonalModuleOfferRejectsStaleGeneration(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	module := saveActiveModule{id: "ma-1", moduleID: "mod-1", state: "not_started"}
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(false))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT entry_generation, entry_starts_at, entry_confirmed_at, entry_entered_at, entry_proctor_rearm_at FROM assessment_module_attempts WHERE id = ? FOR UPDATE")).
		WithArgs("ma-1").WillReturnRows(sqlmock.NewRows([]string{"entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "entry_proctor_rearm_at"}).AddRow(2, nil, nil, nil, nil))
	mock.ExpectRollback()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		generation := 1
		return deliverySvc(db).armPersonalModuleOfferTx(ctx, q, "att-1", module, time.Now().UTC(), &generation)
	})
	if err == nil {
		t.Fatal("stale generation must conflict")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

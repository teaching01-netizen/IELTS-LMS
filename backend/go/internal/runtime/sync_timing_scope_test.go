package runtime

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// A candidate admitted after Start receives the active section's projected
// deadline for THEIR attempt only. The schedule-wide form bumped
// control_epoch on every attempt in the schedule, so each late check-in
// refused every other student's next save as CONTROL_EPOCH_STALE.
func TestSyncV2TimingForAttemptScopesToOneAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("AND COALESCE(sa.delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled') AND sa.id = ?")).
		WithArgs("rt-1", "reading-writing", "sched-1", "att-late").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	running := "running"
	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return SyncV2TimingForAttemptInTx(ctx, q, "sched-1", "rt-1", "reading-writing", "att-late", &running)
	})
	if err != nil {
		t.Fatalf("attempt-scoped sync must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSyncV2TimingForAttemptRequiresAnAttemptID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectRollback()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return SyncV2TimingForAttemptInTx(ctx, q, "sched-1", "rt-1", "reading-writing", "  ", nil)
	})
	if err == nil {
		t.Fatal("a blank attempt id must be refused rather than silently widening to the whole schedule")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The schedule-wide form (runtime commands: start/pause/resume/extend/advance)
// is unchanged: no attempt predicate, three arguments.
func TestSyncV2TimingInTxStaysScheduleWide(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("AND COALESCE(sa.delivery_status, 'running') NOT IN ('submitted', 'terminated', 'locked', 'cancelled')")+"$").
		WithArgs("rt-1", "reading-writing", "sched-1").
		WillReturnResult(sqlmock.NewResult(0, 4))
	mock.ExpectCommit()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return SyncV2TimingInTx(ctx, q, "sched-1", "rt-1", "reading-writing", nil)
	})
	if err != nil {
		t.Fatalf("schedule-wide sync must succeed: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

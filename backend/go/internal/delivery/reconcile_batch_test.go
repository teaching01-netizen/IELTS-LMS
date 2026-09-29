package delivery

import (
	"context"
	"errors"
	"reflect"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

func TestReconcileTimeoutCandidateBatchContinuesAfterFailure(t *testing.T) {
	firstErr := errors.New("first attempt failed")
	var visited []string
	candidates := []timeoutCandidate{
		{attemptID: "att-bad", scheduleID: "sched-1"},
		{attemptID: "att-good", scheduleID: "sched-2"},
	}

	changed, err := reconcileTimeoutCandidateBatch(
		context.Background(), candidates, time.Now(),
		func(_ context.Context, scheduleID, attemptID string, _ time.Time) (bool, error) {
			visited = append(visited, scheduleID+":"+attemptID)
			if attemptID == "att-bad" {
				return false, firstErr
			}
			return true, nil
		},
	)
	if !errors.Is(err, firstErr) {
		t.Fatalf("batch error = %v, want first candidate error", err)
	}
	if changed != 1 {
		t.Fatalf("changed = %d, want healthy candidate counted", changed)
	}
	want := []string{"sched-1:att-bad", "sched-2:att-good"}
	if !reflect.DeepEqual(visited, want) {
		t.Fatalf("visited candidates = %v, want %v", visited, want)
	}
}

func TestReconcileTimeoutsRunsGeneralSweepAfterPersonalSweepError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	personalErr := errors.New("personal candidate scan failed")
	mock.ExpectQuery("FROM assessment_module_attempts m").WillReturnError(personalErr)
	mock.ExpectQuery("FROM student_attempts a").WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id"}))

	svc := NewService(db, tx.NewRunner(db))
	changed, err := svc.ReconcileTimeouts(context.Background(), time.Now().UTC(), 10)
	if changed != 0 || !errors.Is(err, personalErr) {
		t.Fatalf("general sweep should run and personal error should remain visible; changed=%d err=%v", changed, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTimeoutSweepAdvancesPastFailedOldestAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, tx.NewRunner(db))
	mock.ExpectQuery("FROM student_attempts a").WithArgs("", int64(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id"}).AddRow("att-bad", "sched-1"))
	first, err := svc.timeoutCandidates(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	failed := errors.New("permanent attempt failure")
	_, err = reconcileTimeoutCandidateBatch(context.Background(), first, time.Now(),
		func(context.Context, string, string, time.Time) (bool, error) { return false, failed })
	if !errors.Is(err, failed) {
		t.Fatalf("first batch error = %v", err)
	}
	mock.ExpectQuery("FROM student_attempts a").WithArgs("att-bad", int64(1)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id"}).AddRow("att-good", "sched-2"))
	second, err := svc.timeoutCandidates(context.Background(), 1)
	if err != nil {
		t.Fatal(err)
	}
	var visited string
	changed, err := reconcileTimeoutCandidateBatch(context.Background(), second, time.Now(),
		func(_ context.Context, _, attemptID string, _ time.Time) (bool, error) {
			visited = attemptID
			return true, nil
		})
	if err != nil || changed != 1 || visited != "att-good" {
		t.Fatalf("healthy attempt must run after poison candidate: changed=%d visited=%q err=%v", changed, visited, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

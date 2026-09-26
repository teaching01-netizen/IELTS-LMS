package sat

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func expectRepairPrefix(mock sqlmock.Sqlmock) {
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT submitted_at IS NULL, final_submission IS NULL FROM student_attempts WHERE id = ? FOR UPDATE")).
		WillReturnRows(sqlmock.NewRows([]string{"submitted_at", "final_submission"}).AddRow(true, true))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id = ? AND provider_key = 'sat' FOR UPDATE")).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat' FOR UPDATE")).
		WillReturnError(sql.ErrNoRows)
	satUnscopedRun(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(s.section_key, ''), ma.state")).
		WillReturnRows(satCompleteTopologyRows())
}

func TestSATWatchdogRepairsOldProvisionalAttemptWithoutScoring(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	expectRepairPrefix(mock)
	mock.ExpectCommit()

	done, err := svc.repairOne(context.Background(), "att-1", "sched-1")
	if err != nil {
		t.Fatalf("old provisional attempt should be sealed without scoring, got %v", err)
	}
	if !done {
		t.Fatal("repair must report a newly created terminalization")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATWatchdogLeavesExistingResultForDedicatedRepair(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE")).
		WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT submitted_at IS NULL, final_submission IS NULL FROM student_attempts WHERE id = ? FOR UPDATE")).
		WillReturnRows(sqlmock.NewRows([]string{"submitted_at", "final_submission"}).AddRow(true, true))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id = ? AND provider_key = 'sat' FOR UPDATE")).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat' FOR UPDATE")).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("existing-result"))
	mock.ExpectCommit()

	done, err := svc.repairOne(context.Background(), "att-1", "sched-1")
	if err != nil {
		t.Fatal(err)
	}
	if done {
		t.Fatal("existing assessment result requires the dedicated repair path")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestReconcileProvisionalBatchUsesNoScoreRepair(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT a.id, a.schedule_id")).
		WithArgs("submitted", "locked", int64(10)).
		WillReturnRows(sqlmock.NewRows([]string{"id", "schedule_id"}).AddRow("att-1", "sched-1"))
	expectRepairPrefix(mock)
	mock.ExpectCommit()

	count, err := svc.ReconcileProvisionalBatch(context.Background(), 10)
	if err != nil {
		t.Fatal(err)
	}
	if count != 1 {
		t.Fatalf("repaired %d attempts, want 1", count)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

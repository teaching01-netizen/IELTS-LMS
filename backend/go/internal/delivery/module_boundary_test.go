package delivery

import (
	"context"
	"testing"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/tx"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func testSATDeliveryPolicy(t *testing.T) *attempts.SATDeliveryPolicy {
	t.Helper()
	policy, err := attempts.ParseSATDeliveryPolicy([]byte(`{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`), attempts.SATPersonalTimingModelV1)
	if err != nil {
		t.Fatal(err)
	}
	return policy
}

func satBoundaryRow() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"module_attempt_id", "attempt_id", "phase", "policy_version", "work_deadline_at",
		"entry_deadline_at", "recovery_deadline_at", "revision",
	}).AddRow("module-attempt-1", "attempt-1", "working", attempts.SATRecoveryPolicyV1, nil, nil, nil, 1)
}

func TestEnsureSatModuleBoundaryAndLockReusesExistingBoundaryLock(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("(?s)SELECT module_attempt_id, attempt_id.*FOR UPDATE").
		WithArgs("module-attempt-1").WillReturnRows(satBoundaryRow())
	mock.ExpectCommit()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		boundary, err := ensureSatModuleBoundaryAndLockTx(ctx, q, "attempt-1", "module-attempt-1", testSATDeliveryPolicy(t))
		if err != nil {
			return err
		}
		if boundary == nil || boundary.attemptID != "attempt-1" || boundary.phase != "working" {
			t.Fatalf("unexpected existing boundary: %+v", boundary)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("lock existing boundary: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureSatModuleBoundaryAndLockCreatesMissingBoundary(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	policy := testSATDeliveryPolicy(t)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("(?s)SELECT module_attempt_id, attempt_id.*FOR UPDATE").
		WithArgs("module-attempt-1").WillReturnRows(sqlmock.NewRows([]string{
		"module_attempt_id", "attempt_id", "phase", "policy_version", "work_deadline_at",
		"entry_deadline_at", "recovery_deadline_at", "revision",
	}))
	mock.ExpectExec("INSERT INTO assessment_module_boundaries").
		WithArgs(policy.Version, policy.EntryRecoverySeconds, policy.RecoverySeconds,
			policy.EntryRecoverySeconds, "module-attempt-1", "attempt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("(?s)SELECT module_attempt_id, attempt_id.*FOR UPDATE").
		WithArgs("module-attempt-1").WillReturnRows(satBoundaryRow())
	mock.ExpectCommit()

	err = tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		boundary, err := ensureSatModuleBoundaryAndLockTx(ctx, q, "attempt-1", "module-attempt-1", policy)
		if err != nil {
			return err
		}
		if boundary == nil || boundary.attemptID != "attempt-1" {
			t.Fatalf("missing boundary must be created and locked: %+v", boundary)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("create missing boundary: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package main

import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func resolveWithMockDB(t *testing.T, prepare func(mock sqlmock.Sqlmock), attemptID, questionID string) (string, error) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	prepare(mock)
	owner, err := (v2Resolver{}).Resolve(context.Background(), tx, attemptID, questionID)
	if err != nil {
		_ = tx.Rollback()
		return "", err
	}
	_ = tx.Rollback()
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return owner.ModuleState, nil
}

func resolverNormalizedRow(mock sqlmock.Sqlmock, moduleID, sectionKey, state string) {
	resolverNormalizedRowForProvider(mock, moduleID, sectionKey, state, "sat")
}

func resolverNormalizedRowForProvider(mock sqlmock.Sqlmock, moduleID, sectionKey, state, provider string) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).
		WithArgs("att-1", "q-1", "q-1", "att-1", "q-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "state", "provider_key"}).
			AddRow(moduleID, sectionKey, state, provider))
}

func resolverSnapshotExpectations(mock sqlmock.Sqlmock, attemptID, questionID, snapshot, provider string) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).
		WithArgs(attemptID, questionID, questionID, attemptID, questionID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "state", "provider_key"}))
	// Provider gate (defect 6): the snapshot fallback first checks whether
	// the attempt belongs to a SAT exam.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules")).
		WithArgs(attemptID).
		WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow(provider))
	if provider != "sat" {
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a JOIN exam_versions v")).
			WithArgs(attemptID).
			WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(snapshot))
	}
}

// Assigned modules keep their state: the write gate admits active/review.
func TestV2ResolverAssignedModuleStates(t *testing.T) {
	for _, state := range []string{"active", "review", "submitted", "locked"} {
		got, err := resolveWithMockDB(t, func(mock sqlmock.Sqlmock) {
			resolverNormalizedRow(mock, "mod-a", "reading-writing", state)
		}, "att-1", "q-1")
		if err != nil {
			t.Fatalf("state %q must resolve, got %v", state, err)
		}
		if got != state {
			t.Fatalf("state %q must pass through, got %q", state, got)
		}
	}
}

// P1: a normalized question without an assigned module attempt (unassigned
// adaptive branch) must NOT resolve as active.
func TestV2ResolverUnassignedBranchIsNotActive(t *testing.T) {
	got, err := resolveWithMockDB(t, func(mock sqlmock.Sqlmock) {
		resolverNormalizedRow(mock, "mod-b", "reading-writing", "")
	}, "att-1", "q-1")
	if err != nil {
		t.Fatalf("unassigned branch must resolve (write gate rejects), got %v", err)
	}
	if got == "active" {
		t.Fatal("unassigned SAT branch must not resolve as active")
	}
}

// Snapshot-backed questions (no normalized row) still resolve active for
// non-SAT providers (IELTS/ACT legacy drain path preserved).
func TestV2ResolverSnapshotFallbackStaysActive(t *testing.T) {
	snapshot := `{"sections":{"reading":[{"questionId":"q-snap"}]}}`
	got, err := resolveWithMockDB(t, func(mock sqlmock.Sqlmock) {
		resolverSnapshotExpectations(mock, "att-1", "q-snap", snapshot, "ielts")
	}, "att-1", "q-snap")
	if err != nil {
		t.Fatalf("snapshot question must resolve, got %v", err)
	}
	if got != "active" {
		t.Fatalf("snapshot question must stay active, got %q", got)
	}
}

// Exam-day re-audit defect 6: a SAT question id present only in the snapshot
// tree (stale snapshot / version skew / forged branch id) must NOT resolve
// active — SAT writes require a normalized row + assigned module attempt.
func TestV2ResolverSATSnapshotFallbackRejected(t *testing.T) {
	snapshot := `{"sections":{"reading":[{"questionId":"q-sat-branch"}]}}`
	_, err := resolveWithMockDB(t, func(mock sqlmock.Sqlmock) {
		resolverSnapshotExpectations(mock, "att-1", "q-sat-branch", snapshot, "sat")
	}, "att-1", "q-sat-branch")
	if err == nil {
		t.Fatal("SAT snapshot-only question must not resolve")
	}
	if err == sql.ErrNoRows {
		t.Fatalf("SAT snapshot-only question must map to a typed error, got %v", err)
	}
}

// Unknown questions (no normalized row, absent from snapshot) stay NOT_FOUND.
func TestV2ResolverUnknownQuestionNotFound(t *testing.T) {
	snapshot := `{"sections":{"reading":[{"questionId":"q-other"}]}}`
	_, err := resolveWithMockDB(t, func(mock sqlmock.Sqlmock) {
		resolverSnapshotExpectations(mock, "att-1", "q-nope", snapshot, "ielts")
	}, "att-1", "q-nope")
	if err == nil {
		t.Fatal("unknown question must not resolve")
	}
	if err == sql.ErrNoRows {
		t.Fatalf("unknown question must map to a typed error, got %v", err)
	}
}

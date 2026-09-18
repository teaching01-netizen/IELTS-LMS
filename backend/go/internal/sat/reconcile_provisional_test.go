package sat

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// SAT-001 acceptance seam: a committed V2 provisional receipt (delivery
// submitted, submitted_at NULL) with no scoring result must be repairable by
// the watchdog, and the repair must reuse the receipt's submission id so a
// retry replays idempotently instead of minting a fresh identity.
//
// Schedule under test:
//
//	A1 submitModule commits the provisional claim + attempt_submissions_v2
//	A2 the browser dies before POST .../submit (CompleteAssessment)
//	A3 the worker's ReconcileProvisional pass repairs the attempt
func TestSATWatchdogRepairsProvisionalReceiptAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("submitted_at IS NULL, final_submission IS NULL")).WillReturnRows(
		sqlmock.NewRows([]string{"submitted_null", "final_null"}).AddRow(true, true))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	// The locked receipt is the authority: its submission id anchors scoring.
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_submissions_v2 WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"submission_id"}).AddRow("sub-receipt"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	// repairOne's own terminal-module check, then scoreAndPersist's reload.
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	satTimeSpent(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).
			AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	// The INSERT must bind the RECEIPT's submission id, not a fresh UUID.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).
		WithArgs("sub-receipt", "att-1", "sched-1", "exam-sat", "pv-sat", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sub-receipt", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	done, err := svc.repairOne(context.Background(), "att-1", "sched-1", "sub-candidate")
	if err != nil {
		t.Fatalf("receipt-present provisional repair must succeed, got %v", err)
	}
	if !done {
		t.Fatal("watchdog must report the attempt repaired")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The V2 receipt accepts submission ids up to attempts.MaxSubmissionIDLen
// (64), but the scoring boundary persists them into VARCHAR(36) columns and
// CompleteAssessment rejects anything longer. Reusing an oversized receipt id
// would fail the first INSERT on every pass, leaving the attempt orphaned
// forever; the repair must fall back to the reconcile anchor (attempt id).
func TestSATWatchdogFallsBackFromOversizedReceiptSubmissionID(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	oversized := strings.Repeat("r", 40) // legal on the V2 path, illegal here
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("submitted_at IS NULL, final_submission IS NULL")).WillReturnRows(
		sqlmock.NewRows([]string{"submitted_null", "final_null"}).AddRow(true, true))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_submissions_v2 WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"submission_id"}).AddRow(oversized))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	satTimeSpent(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).
			AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	// Both scoring rows must bind the attempt id — the only identity the
	// VARCHAR(36) boundary can persist.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).
		WithArgs("att-1", "att-1", "sched-1", "exam-sat", "pv-sat", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WithArgs(sqlmock.AnyArg(), "att-1", "att-1", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	done, err := svc.repairOne(context.Background(), "att-1", "sched-1", oversized)
	if err != nil {
		t.Fatalf("oversized receipt id must not break the repair, got %v", err)
	}
	if !done {
		t.Fatal("watchdog must report the attempt repaired")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A repair whose result already exists must not score a second time — the
// continuation is exactly-once even when two watchdog passes overlap.
func TestSATWatchdogSkipsProvisionalAttemptWithResult(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("submitted_at IS NULL, final_submission IS NULL")).WillReturnRows(
		sqlmock.NewRows([]string{"submitted_null", "final_null"}).AddRow(true, true))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_submissions_v2 WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"submission_id"}).AddRow("sub-receipt"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"id"}).AddRow("res-existing"))
	mock.ExpectCommit()

	done, err := svc.repairOne(context.Background(), "att-1", "sched-1", "")
	if err != nil {
		t.Fatalf("already-scored attempt must skip cleanly, got %v", err)
	}
	if done {
		t.Fatal("a scored attempt is not a repair")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Batch sweep shape: receipt-present provisional attempts are candidates now
// (the old NOT EXISTS attempt_submissions_v2 exclusion is gone), and the
// receipt id rides the candidate row into the repair.
func TestReconcileProvisionalBatchIncludesReceiptCandidates(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	mock.ExpectQuery(regexp.QuoteMeta("LEFT JOIN attempt_submissions_v2 r ON r.attempt_id = a.id")).WillReturnRows(
		sqlmock.NewRows([]string{"id", "schedule_id", "submission_id"}).AddRow("att-1", "sched-1", "sub-receipt"))
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("submitted_at IS NULL, final_submission IS NULL")).WillReturnRows(
		sqlmock.NewRows([]string{"submitted_null", "final_null"}).AddRow(true, true))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_submissions_v2 WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"submission_id"}).AddRow("sub-receipt"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	satTimeSpent(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).
			AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).
		WithArgs("sub-receipt", "att-1", "sched-1", "exam-sat", "pv-sat", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sub-receipt", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	repaired, err := svc.ReconcileProvisionalBatch(context.Background(), 250)
	if err != nil {
		t.Fatalf("batch pass must succeed, got %v", err)
	}
	if repaired != 1 {
		t.Fatalf("expected exactly one repaired attempt, got %d", repaired)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// satTimeSpent answers the audit-finding-4 derivation query (active exam time
// from authoritative module timing). 45 minutes of module time here.
func satTimeSpent(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("WHERE attempt_id = ? AND started_at IS NOT NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"seconds"}).AddRow(int64(2700)))
}

// satTerminalModules is the REAL terminal shape: per section, the base module
// plus the adaptive branch the router opened. The audit-finding-5 topology gate
// requires a recorded route per section, so the old fictitious "routing" role
// (which no delivery path writes) is no longer a valid fixture.
func satTerminalModules() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).
		AddRow("reading-writing", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)).
		AddRow("reading-writing", "rw-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)).
		AddRow("math", "math-m1", "base", "submitted", int64(20), int64(27), int64(27)).
		AddRow("math", "math-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27))
}

package sat

// Audit finding 4: student_submissions.time_spent_seconds was hardcoded to 0,
// so every completed SAT silently claimed the student spent no time. It is now
// derived from authoritative module timing (active wall time minus accumulated
// pause time). These tests pin the value onto the INSERT itself.
import (
	"context"
	"database/sql"
	"math"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// inTx runs one helper inside a sqlmock-backed transaction. Callers register
// satBegin(mock) first so the expectations stay in execution order.
func inTx(db *sql.DB, fn func(ctx context.Context, q tx.Tx) error) error {
	return tx.NewRunner(db).WithTxRCRetry(context.Background(), 1, fn)
}

// The duration must ride the INSERT at the time_spent_seconds position
// (11th arg: after submitted_at), replacing the old literal 0.
func TestSATResultPersistsDerivedTimeSpent(t *testing.T) {
	const spent = int64(2700) // 45 minutes
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	satUnscopedRun(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	expectCanonicalRouteDecisions(mock)
	mock.ExpectQuery(regexp.QuoteMeta("WHERE attempt_id = ? AND started_at IS NOT NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"seconds"}).AddRow(spent))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).
			AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	// Argument capture: the duration must be the real elapsed value.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).
		WithArgs("sub-time", "att-1", "sched-1", "exam-sat", "pv-sat",
			"cand-1", "Cand Name", "cand@example.com", sqlmock.AnyArg(), sqlmock.AnyArg(),
			spent, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if _, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-time", ActorKind: "student"}); err != nil {
		t.Fatalf("finalize must succeed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A degenerate timing row (no module ever started) must not invent a duration;
// it falls to the truthful floor rather than failing the whole finalization.
func TestSATResultTimeSpentFallsBackWhenTimingMissing(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	satUnscopedRun(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	expectCanonicalRouteDecisions(mock)
	// SUM(...) over no started modules is NULL, not an error.
	mock.ExpectQuery(regexp.QuoteMeta("WHERE attempt_id = ? AND started_at IS NOT NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"seconds"}).AddRow(nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).
			AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).
		WithArgs("sub-none", "att-1", "sched-1", "exam-sat", "pv-sat",
			"cand-1", "Cand Name", "cand@example.com", sqlmock.AnyArg(), sqlmock.AnyArg(),
			int64(0), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if _, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-none", ActorKind: "student"}); err != nil {
		t.Fatalf("finalize must succeed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The derivation query must ask the database for the pause-aware expression —
// a plain TIMESTAMPDIFF would over-report every paused-student attempt.
func TestTimeSpentDerivationUsesAuthoritativeModuleTiming(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	satBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("SUM(GREATEST(TIMESTAMPDIFF(SECOND, started_at, COALESCE(submitted_at, paused_at, UTC_TIMESTAMP(6))) - accumulated_paused_seconds, 0)) FROM assessment_module_attempts WHERE attempt_id = ? AND started_at IS NOT NULL")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"seconds"}).AddRow(int64(600)))
	mock.ExpectCommit()

	var got int64
	if err := inTx(db, func(ctx context.Context, q tx.Tx) error {
		value, err := loadTimeSpentSeconds(ctx, q, "att-1")
		got = value
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if got != 600 {
		t.Fatalf("time spent = %d, want 600", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A negative aggregate (clock skew between modules) clamps to zero instead of
// persisting a nonsensical negative duration into a signed INT column.
func TestTimeSpentClampsNegativeAggregate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	satBegin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("started_at IS NOT NULL")).
		WillReturnRows(sqlmock.NewRows([]string{"seconds"}).AddRow(int64(-90)))
	mock.ExpectCommit()

	var got int64
	if err := inTx(db, func(ctx context.Context, q tx.Tx) error {
		value, err := loadTimeSpentSeconds(ctx, q, "att-1")
		got = value
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if got != 0 {
		t.Fatalf("negative aggregate must clamp to 0, got %d", got)
	}
	if math.Signbit(float64(got)) {
		t.Fatal("duration must never be negative")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

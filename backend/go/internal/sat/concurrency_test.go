package sat

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// testDupKeyError fakes an InnoDB 1062 duplicate-key failure on INSERT.
// isDupSubmissionKey matches on the message text ("duplicate"/"1062"),
// so a plain error with that text exercises the twin-race handler.
func testDupKeyError() error {
	return errors.New("Error 1062 (23000): Duplicate entry 'sub-twin' for key 'PRIMARY'")
}

func satCodeOf(err error) apperrors.Code {
	if e, ok := apperrors.As(err); ok {
		return e.Code
	}
	return ""
}

func satService(db *sql.DB) *Service {
	return NewService(db, tx.NewRunner(db), clock.System{}, nil)
}

// twinTestScorer scores any section without a policy table: the twin-race
// tests exercise the submission-ownership handler (INSERT 1062 → converge),
// not the conversion table, so scoring must not depend on policy rows.
type twinTestScorer struct{}

func (twinTestScorer) ScoreSection(sectionKey, _ string, normalized, _ int, _ PolicyConfig) (int, error) {
	return 200 + normalized, nil
}

func satTwinService(db *sql.DB) *Service {
	return NewService(db, tx.NewRunner(db), clock.System{}, twinTestScorer{})
}

func satBegin(mock sqlmock.Sqlmock) {
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone")).WillReturnResult(sqlmock.NewResult(0, 0))
}

func satAttemptRow(delivery, phase, proctor string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "organization_id", "exam_id", "published_version_id",
		"proctor_status", "delivery_status", "phase", "answer_revision",
	}).AddRow("att-1", "sched-1", nil, "exam-sat", "pv-sat", proctor, delivery, phase, int64(3))
}

func satDBTime(mock sqlmock.Sqlmock) {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(
		sqlmock.NewRows([]string{"ts"}).AddRow(now))
}

func satNoReceipt(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
}

// satUnscopedRun stages the Student Access section-scope read as "no link":
// the run declares the full SAT pair, which is the pre-feature behaviour every
// existing scoring case pins. scoreAndPersist reads it before loadModules.
func satUnscopedRun(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT l.enabled_sections FROM assessment_access_links")).
		WillReturnError(sql.ErrNoRows)
}

func TestSATProvisionalSubmitVsTerminate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"outcome"}).AddRow("terminated"))
	mock.ExpectRollback()
	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-1", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeAttemptProctorBlocked {
		t.Fatalf("expected ATTEMPT_PROCTOR_BLOCKED, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATWatchdogVsDirectCompletion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("submitted", "post-exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"id"}).AddRow("sub-direct"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE submission_id")).WillReturnRows(
		sqlmock.NewRows([]string{"id", "attempt_id", "provider_key", "outcome_status", "total_score", "score_payload", "release_status"}).AddRow("res-1", "att-1", "sat", "scored", int64(1200), "{}", "ready_to_release"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_section_results WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"section_key", "route", "raw_correct", "operational_question_count", "scaled_score", "details"}))
	// Idempotent replay returns the bound result with NO re-seal: the first
	// completion already terminalized (final_submission non-NULL), so a
	// re-seal UPDATE would match 0 rows and 409. No terminalization
	// INSERT or attempt UPDATE is expected here.
	mock.ExpectCommit()
	res, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-watchdog", ActorKind: "system"})
	if err != nil {
		t.Fatalf("idempotent replay must return the bound result: %v", err)
	}
	if res == nil || res.ID != "res-1" {
		t.Fatalf("must return the direct-completion result, got %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Twin-race matrix (P1-2): the :608-648 dup-key handler converges
// same-attempt twins to the winner's result instead of 500/double-score.
// A 1062 on INSERT with the winner's row + result visible => idempotent
// success; cross-attempt ownership => stable 409 SUBMISSION_ID_MISUSE.
func TestSATTwinRaceConvergesToWinnerResult(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(
		sqlmock.NewRows([]string{"module_id", "section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).AddRow("mod-rw-m1", "reading-writing", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-rw-m2-lower", "reading-writing", "rw-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-math-m1", "math", "math-m1", "base", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-math-m2-lower", "math", "math-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	expectCanonicalRouteDecisions(mock)
	// First ownership probe: no row yet (this tx is the loser).
	satTimeSpent(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	// Candidate identity for the loser's INSERT attempt.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	// INSERT loses the race: duplicate key (winner committed first).
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).WillReturnError(
		testDupKeyError())
	// Re-check sees the winner's row belongs to us; winner already scored.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"attempt_id"}).AddRow("att-1"))
	// loadResultTx uses selectSubmissionID=false: 7 columns, no
	// submission_id (it is implied by the predicate).
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE submission_id")).WillReturnRows(
		sqlmock.NewRows([]string{"id", "attempt_id", "provider_key", "outcome_status", "total_score", "score_payload", "release_status"}).AddRow("res-win", "att-1", "sat", "scored", int64(1200), "{}", "ready_to_release"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_section_results WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"section_key", "route", "raw_correct", "operational_question_count", "scaled_score", "details"}))
	mock.ExpectCommit()
	res, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-twin", ActorKind: "student"})
	if err != nil {
		t.Fatalf("same-attempt twin must converge to winner result, got %v", err)
	}
	if res == nil || res.ID != "res-win" {
		t.Fatalf("must return the winner result, got %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATTwinRaceCrossAttemptIsMisuse(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	// Bound to another attempt: stable 409, never the foreign result.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnRows(
		sqlmock.NewRows([]string{"id"}).AddRow("sub-other"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE submission_id")).WillReturnRows(
		sqlmock.NewRows([]string{"id", "attempt_id", "provider_key", "outcome_status", "total_score", "score_payload", "release_status"}).AddRow("res-other", "att-9", "sat", "scored", int64(1200), "{}", "ready_to_release"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_section_results WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"section_key", "route", "raw_correct", "operational_question_count", "scaled_score", "details"}))
	mock.ExpectCommit()
	res, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-mine", ActorKind: "student"})
	if err != nil {
		t.Fatalf("cross-attempt replay must return bound result, got %v", err)
	}
	if res == nil || res.ID != "res-other" {
		t.Fatalf("bound-submission-wins: must return the bound result, got %+v", res)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// PII binding: attemptCandidate returns (id, name, email, cohort) and the
// INSERT binds positionally student_id, student_name, student_email. A
// prior swap wrote email->student_name; this pins the correct order with
// argument capture on the happy-path INSERT.
func TestSATSubmissionPersistsCandidateNameAndEmail(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(
		sqlmock.NewRows([]string{"module_id", "section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).AddRow("mod-rw-m1", "reading-writing", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-rw-m2-lower", "reading-writing", "rw-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-math-m1", "math", "math-m1", "base", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-math-m2-lower", "math", "math-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	expectCanonicalRouteDecisions(mock)
	satTimeSpent(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	// Capture INSERT args: positions 6,7,8 after (id, attempt, schedule,
	// exam, version) are student_id, student_name, student_email.
	// WithArgs is the assertion: sqlmock fails the test if the actual
	// args differ, pinning the PII order.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).
		WithArgs("sub-pii", "att-1", "sched-1", "exam-sat", "pv-sat",
			"cand-1", "Cand Name", "cand@example.com", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sub-pii", sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// Two sections (reading-writing + math) => two section-row INSERTs.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if _, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-pii", ActorKind: "student"}); err != nil {
		t.Fatalf("happy-path finalize must succeed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("INSERT must bind student_name=Cand Name, student_email=cand@example.com: %v", err)
	}
}

// Winner-persisting twin: same-attempt dup where the winner's submission
// row is visible but its result is not yet persisted (still scoring) =>
// 409 retry, never double-score, never MISUSE.
func TestSATTwinRaceWinnerPersistingRetries(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(
		sqlmock.NewRows([]string{"module_id", "section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).AddRow("mod-rw-m1", "reading-writing", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-rw-m2-lower", "reading-writing", "rw-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-math-m1", "math", "math-m1", "base", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-math-m2-lower", "math", "math-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	expectCanonicalRouteDecisions(mock)
	satTimeSpent(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).WillReturnError(
		testDupKeyError())
	// Winner row belongs to us but no result yet => retry.
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"attempt_id"}).AddRow("att-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results WHERE submission_id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-twin", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("winner-persisting twin must 409-retry, got %v", err)
	}
	if err != nil && err.Error() == "" {
		t.Fatal("retry error must carry a message")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATCompletionVsTimeoutUnsealed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satService(db)
	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	satUnscopedRun(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(
		sqlmock.NewRows([]string{"module_id", "section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).AddRow("mod-rw-m1", "rw", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-rw-m2-lower", "rw", "rw-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)).AddRow("mod-math-m1", "math", "math-m1", "base", "active", nil, nil, int64(27)))
	mock.ExpectRollback()
	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-race", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeConflict {
		t.Fatalf("expected CONFLICT when a module is still active, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

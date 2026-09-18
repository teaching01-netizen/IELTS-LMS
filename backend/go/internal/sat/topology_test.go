package sat

// Audit finding 5 (scoring half): totalScore tolerates a nil section, so a
// partial terminal topology used to persist a legitimate-looking total. These
// tests pin the fail-closed behaviour at the final scoring boundary.
import (
	"context"
	"database/sql"
	"database/sql/driver"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func satModules(rows ...[]driver.Value) *sqlmock.Rows {
	out := sqlmock.NewRows([]string{"section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"})
	for _, row := range rows {
		out.AddRow(row...)
	}
	return out
}

// A math-only terminal set must never become a SAT score.
func TestScoringRejectsMathOnlyTopology(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satModules(
		[]driver.Value{"math", "math-m1", "base", "submitted", int64(20), int64(27), int64(27)},
		[]driver.Value{"math", "math-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)},
	))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	mock.ExpectRollback()

	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-partial", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeInvalidAssessment {
		t.Fatalf("math-only topology must fail closed with INVALID_ASSESSMENT, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A section whose adaptive route was never recorded (base-only) must not be
// scored off the silent "lower" default either.
func TestScoringRejectsSectionWithoutARecordedRoute(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satModules(
		[]driver.Value{"reading-writing", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)},
		[]driver.Value{"math", "math-m1", "base", "submitted", int64(20), int64(27), int64(27)},
		[]driver.Value{"math", "math-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)},
	))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	mock.ExpectRollback()

	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-noroute", ActorKind: "student"})
	if satCodeOf(err) != apperrors.CodeInvalidAssessment {
		t.Fatalf("a section without a recorded route must fail closed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The complete blueprint topology still scores: the gate must not block a
// legitimate result.
func TestScoringAcceptsCompleteTopology(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	satTimeSpent(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).
			AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-full", ActorKind: "student"})
	if err != nil {
		t.Fatalf("complete topology must score, got %v", err)
	}
	if result == nil || len(result.Sections) != 2 {
		t.Fatalf("complete topology must produce two section results, got %+v", result)
	}
	for _, section := range result.Sections {
		if section.Route == nil {
			t.Fatalf("section %s must carry its adaptive route", section.SectionKey)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

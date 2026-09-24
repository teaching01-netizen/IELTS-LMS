package sat

// The headline behaviour of a scoped Student Access link: a run narrowed to
// Reading & Writing scores its one section (200–800) and persists NO composite
// total. The 400–1600 scale is defined over Reading & Writing + Math, so a lone
// section score published as totalScore would be a plausible-looking wrong
// number — the exact failure mode audit finding 5 was about.

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestScoringOneSectionRunHasNoCompositeTotal(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id =")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	// The link scopes the run to Reading & Writing only.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT l.enabled_sections FROM assessment_access_links")).
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections"}).AddRow(`["reading-writing"]`))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(
		sqlmock.NewRows([]string{"module_id", "section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).
			AddRow("mod-rw-m1", "reading-writing", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)).
			AddRow("mod-rw-m2-lower", "reading-writing", "rw-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	expectRouteDecisions(mock, [3]string{"reading-writing", "mod-rw-m2-lower", "lower"})
	satTimeSpent(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE id")).WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(
		sqlmock.NewRows([]string{"candidate_id", "candidate_name", "candidate_email", "student_key"}).
			AddRow("cand-1", "Cand Name", "cand@example.com", ""))
	// student_submissions.section_statuses must name the sections this run
	// actually took, never the hardcoded pair.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO student_submissions")).
		WithArgs("sub-verbal", "att-1", "sched-1", "exam-sat", "pv-sat", sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), `{"reading-writing":"auto_graded"}`).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// assessment_results.total_score must be NULL for a one-section sitting.
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_results")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sub-verbal", nil, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_section_results")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO attempt_terminalizations")).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CompleteAssessment(context.Background(), CompleteRequest{
		AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-verbal", ActorKind: "student",
	})
	if err != nil {
		t.Fatalf("a one-section run must score, got %v", err)
	}
	if result == nil || len(result.Sections) != 1 || result.Sections[0].SectionKey != SectionReadingWriting {
		t.Fatalf("expected one Reading & Writing section result, got %+v", result)
	}
	if result.Sections[0].ScaledScore == nil {
		t.Fatal("the section score must survive a one-section run")
	}
	if result.TotalScore != nil {
		t.Fatalf("a one-section run must not publish a composite total, got %d", *result.TotalScore)
	}
	// The wire shape is what the student client renders: assert the encoded
	// payload, not the Go value (a typed nil *int is non-nil as an interface).
	payloadJSON, err := json.Marshal(result.ScorePayload)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(payloadJSON), `"totalScore":null`) {
		t.Fatalf("scorePayload.totalScore must encode as null, got %s", payloadJSON)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The mirror case: with no link the run still demands both sections, so the
// scoping feature cannot quietly weaken the full SAT gate.
func TestScoringFullRunStillRequiresBothSections(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)

	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id =")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	satUnscopedRun(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(
		sqlmock.NewRows([]string{"module_id", "section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).
			AddRow("mod-rw-m1", "reading-writing", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)).
			AddRow("mod-rw-m2-lower", "reading-writing", "rw-m2-lower", "lower_branch", "submitted", int64(20), int64(27), int64(27)))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	mock.ExpectRollback()

	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{
		AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-partial", ActorKind: "student",
	})
	if satCodeOf(err) != apperrors.CodeInvalidAssessment {
		t.Fatalf("an unscoped one-section run must still fail closed, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

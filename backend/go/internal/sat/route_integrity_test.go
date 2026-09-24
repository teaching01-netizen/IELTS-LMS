package sat

// Result integrity fence (plan Phase 10, rigorous test 14).
//
// CompleteAssessment must verify the recorded route decision against the
// administered terminal branch before persisting: selected_module_id must
// equal the branch module id, and selected_route must match its adaptive
// slot. A corrupt attempt (decision HIGH, terminal LOW) fails loudly with
// SAT_ADAPTIVE_ROUTE_INTEGRITY and persists nothing — it must never become
// a confident wrong result.
import (
	"context"
	"database/sql"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// satRouteDecisionRows builds route-decision rows: one
// (section_key, selected_module_id, selected_route) triple per section.
func satRouteDecisionRows(pairs ...[3]string) *sqlmock.Rows {
	out := sqlmock.NewRows([]string{"section_key", "selected_module_id", "selected_route"})
	for _, pair := range pairs {
		out.AddRow(pair[0], pair[1], pair[2])
	}
	return out
}

func expectRouteDecisions(mock sqlmock.Sqlmock, pairs ...[3]string) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_route_decisions")).WillReturnRows(satRouteDecisionRows(pairs...))
}

// expectCanonicalRouteDecisions stages the decision read for the canonical
// terminal fixture (both sections administered their lower branch).
func expectCanonicalRouteDecisions(mock sqlmock.Sqlmock) {
	expectRouteDecisions(mock,
		[3]string{"reading-writing", "mod-rw-m2-lower", "lower"},
		[3]string{"math", "mod-math-m2-lower", "lower"})
}

func satHighModules() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"module_id", "section_key", "module_key", "adaptive_role", "state", "raw_correct", "operational_question_count", "target_question_count"}).
		AddRow("mod-rw-m1", "reading-writing", "rw-m1", "base", "submitted", int64(20), int64(27), int64(27)).
		AddRow("mod-rw-m2-higher", "reading-writing", "rw-m2-higher", "higher_branch", "submitted", int64(20), int64(27), int64(27)).
		AddRow("mod-math-m1", "math", "math-m1", "base", "submitted", int64(20), int64(27), int64(27)).
		AddRow("mod-math-m2-higher", "math", "math-m2-higher", "higher_branch", "submitted", int64(20), int64(27), int64(27))
}

func satPersistHappyPath(mock sqlmock.Sqlmock, submissionID string) {
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
}

// A Higher decision with a Higher terminal branch scores route=higher.
func TestResultIntegrityMatchingHigherDecisionScoresHigher(t *testing.T) {
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
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satHighModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	expectRouteDecisions(mock,
		[3]string{"reading-writing", "mod-rw-m2-higher", "higher"},
		[3]string{"math", "mod-math-m2-higher", "higher"})
	satPersistHappyPath(mock, "sub-high")

	result, err := svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-high", ActorKind: "student"})
	if err != nil {
		t.Fatalf("matching higher decision must score, got %v", err)
	}
	for _, section := range result.Sections {
		if section.Route == nil || *section.Route != "higher" {
			t.Fatalf("section %s route must be higher, got %+v", section.SectionKey, section.Route)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Corrupt data — decision HIGH, terminal LOW — must be rejected with
// SAT_ADAPTIVE_ROUTE_INTEGRITY and persist nothing.
func TestResultIntegrityMismatchFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := satTwinService(db)
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	satBegin(mock)
	satDBTime(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id")).WillReturnRows(satAttemptRow("running", "exam", "active"))
	satNoReceipt(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_submissions WHERE attempt_id")).WillReturnError(sql.ErrNoRows)
	satUnscopedRun(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WillReturnRows(satTerminalModules())
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_scoring_policies WHERE")).WillReturnRows(
		sqlmock.NewRows([]string{"policy_config"}).AddRow(`{}`))
	// The terminal branches are LOW but the decisions claim HIGH.
	expectRouteDecisions(mock,
		[3]string{"reading-writing", "mod-rw-m2-higher", "higher"},
		[3]string{"math", "mod-math-m2-higher", "higher"})
	mock.ExpectRollback()

	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-corrupt", ActorKind: "student"})
	if err == nil {
		t.Fatal("a decision/terminal mismatch must fail closed")
	}
	typed, ok := err.(*apperrors.Error)
	if !ok {
		t.Fatalf("the refusal must be a typed app error, got %T", err)
	}
	if typed.Code != apperrors.CodeAssessmentConflict {
		t.Fatalf("code = %q, want %q", typed.Code, apperrors.CodeAssessmentConflict)
	}
	if typed.Details["reason"] != "SAT_ADAPTIVE_ROUTE_INTEGRITY" {
		t.Fatalf("reason = %v, want SAT_ADAPTIVE_ROUTE_INTEGRITY", typed.Details["reason"])
	}
	if _, leaks := typed.Details["response"]; leaks {
		t.Fatalf("integrity details must not carry answers: %#v", typed.Details)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATAdaptiveIntegrityViolation, "reason", "route_module_mismatch"); got != 1 {
		t.Fatalf("integrity violation counter = %v, want 1", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A terminal branch with no recorded decision must also fail closed —
// an unrecorded route is not a result.
func TestResultIntegrityMissingDecisionFailsClosed(t *testing.T) {
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
	expectRouteDecisions(mock)
	mock.ExpectRollback()

	_, err = svc.CompleteAssessment(context.Background(), CompleteRequest{AttemptID: "att-1", ScheduleID: "sched-1", SubmissionID: "sub-nodecision", ActorKind: "student"})
	if err == nil {
		t.Fatal("a terminal branch without a recorded decision must fail closed")
	}
	if typed, ok := err.(*apperrors.Error); !ok || typed.Details["reason"] != "SAT_ADAPTIVE_ROUTE_INTEGRITY" {
		t.Fatalf("must fail with SAT_ADAPTIVE_ROUTE_INTEGRITY, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Pure fence coverage: id match, id mismatch, route mismatch, missing.
func TestAssertResultRouteIntegrity(t *testing.T) {
	ctx := context.Background()
	higher := "higher"
	sections := map[string]*resultAccum{
		"reading-writing": {route: &higher, branchModuleID: "mod-higher"},
	}
	decisions := map[string]routeDecision{
		"reading-writing": {SelectedModuleID: "mod-higher", SelectedRoute: "higher"},
	}
	if err := assertResultRouteIntegrity(ctx, "att-1", decisions, sections); err != nil {
		t.Fatalf("matching decision must pass, got %v", err)
	}
	wrongID := map[string]routeDecision{
		"reading-writing": {SelectedModuleID: "mod-lower", SelectedRoute: "higher"},
	}
	if err := assertResultRouteIntegrity(ctx, "att-1", wrongID, sections); err == nil {
		t.Fatal("a different selected module id must fail")
	}
	wrongRoute := map[string]routeDecision{
		"reading-writing": {SelectedModuleID: "mod-higher", SelectedRoute: "lower"},
	}
	if err := assertResultRouteIntegrity(ctx, "att-1", wrongRoute, sections); err == nil {
		t.Fatal("a contradicting selected route must fail")
	}
	if err := assertResultRouteIntegrity(ctx, "att-1", map[string]routeDecision{}, sections); err == nil {
		t.Fatal("a missing decision must fail")
	}
	// Sections without an administered branch are not the fence's business.
	branchless := map[string]*resultAccum{"math": {route: nil}}
	if err := assertResultRouteIntegrity(ctx, "att-1", map[string]routeDecision{}, branchless); err != nil {
		t.Fatalf("branchless sections must pass the fence, got %v", err)
	}
}

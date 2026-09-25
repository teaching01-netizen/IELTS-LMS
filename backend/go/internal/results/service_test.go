package results

import (
	"context"
	"database/sql"
	"errors"
	"regexp"
	"strconv"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestListDashboardRejectsUnknownProviderBeforeDatabaseAccess(t *testing.T) {
	svc := NewService(nil)

	_, err := svc.ListDashboard(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "toefl", 25)
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("expected VALIDATION_ERROR, got %v", err)
	}
}

func TestListDashboardTrimsProviderBeforeDispatch(t *testing.T) {
	// The normalized provider is validated and dispatched consistently. The
	// query expectation proves the trimmed value is bound instead of silently
	// returning an empty result set.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	queryErr := errors.New("query reached")
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results ar")).
		WithArgs("act", 25).
		WillReturnError(queryErr)
	svc := NewService(db)

	_, err = svc.ListDashboard(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), " act ", 25)
	if !errors.Is(err, queryErr) {
		t.Fatalf("expected dispatch to reach the database with the trimmed provider, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestResultScopeFailsClosedWithoutTenant(t *testing.T) {
	scope, args := resultScope("sch", auth.NewActorContext("grader-1", auth.RoleGrader))
	if scope != " AND 1 = 0" {
		t.Fatalf("expected fail-closed scope, got %q", scope)
	}
	if args != nil {
		t.Fatalf("expected no bind arguments for fail-closed scope, got %#v", args)
	}
}

func TestResultScopeUsesPlatformReadWithoutPredicate(t *testing.T) {
	scope, args := resultScope("sch", auth.NewActorContext("observer-1", auth.RoleAdminObserver))
	if scope != "" || args != nil {
		t.Fatalf("expected platform read to avoid tenant predicate, got %q %#v", scope, args)
	}
}

func TestResultScopeBindsTenantAndAssignment(t *testing.T) {
	actor := auth.NewActorContext("grader-1", auth.RoleGrader).WithOrgID("org-1")
	scope, args := resultScope("sch", actor)
	if !strings.Contains(scope, "sch.organization_id = ?") {
		t.Fatalf("expected organization predicate, got %q", scope)
	}
	if !strings.Contains(scope, "assignment.user_id = ?") || !strings.Contains(scope, "assignment.role = ?") {
		t.Fatalf("expected assignment predicate, got %q", scope)
	}
	if len(args) != 3 || args[0] != "org-1" || args[1] != "grader-1" || args[2] != auth.RoleGrader {
		t.Fatalf("unexpected scope arguments: %#v", args)
	}
}

func TestListSATResultsIncludesVersionsBeyondLegacyLimitAndAllSupportedOutcomes(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	columns := []string{"id", "submission_id", "attempt_id", "provider_key", "outcome_status", "total_score", "release_status", "schedule_id", "exam_id", "exam_title", "version_number", "candidate_id", "candidate_name", "candidate_email", "cohort_name", "submitted_at"}
	rows := sqlmock.NewRows(columns)
	for i := 0; i < 100; i++ {
		rows.AddRow("old-"+strconv.Itoa(i), nil, "attempt-old-"+strconv.Itoa(i), "sat", OutcomeScored, int64(1200), ReleaseReady, "schedule-old", "exam-1", "SAT", 12, "student", "Student", nil, "Cohort", nil)
	}
	for version := 13; version <= 20; version++ {
		rows.AddRow("version-"+strconv.Itoa(version), nil, "attempt-"+strconv.Itoa(version), "sat", OutcomeScored, int64(1300), ReleaseReady, "schedule-"+strconv.Itoa(version), "exam-1", "SAT", version, "student", "Student", nil, "Cohort", nil)
	}
	rows.AddRow("pending", nil, "attempt-pending", "sat", OutcomePending, nil, ReleaseDraft, "schedule-20", "exam-1", "SAT", 20, "student", "Student", nil, "Cohort", nil)
	rows.AddRow("invalid-proctor", nil, "attempt-invalid-proctor", "sat", OutcomeInvalidatedProctor, nil, ReleaseInvalidated, "schedule-20", "exam-1", "SAT", 20, "student", "Student", nil, "Cohort", nil)
	rows.AddRow("invalid-timeout", nil, "attempt-invalid-timeout", "sat", OutcomeInvalidatedTimeout, nil, ReleaseInvalidated, "schedule-20", "exam-1", "SAT", 20, "student", "Student", nil, "Cohort", nil)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results ar")).WillReturnRows(rows)

	out, err := NewService(db).ListSATResults(context.Background(), auth.NewActorContext("observer-1", auth.RoleAdminObserver))
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 111 {
		t.Fatalf("expected all 111 SAT rows, got %d", len(out))
	}
	for version := 13; version <= 20; version++ {
		found := false
		for _, row := range out {
			if row.VersionNumber == version {
				found = true
				break
			}
		}
		if !found {
			t.Errorf("version %d missing from SAT results", version)
		}
	}
	if out[108].Outcome != OutcomePending || out[109].Outcome != OutcomeInvalidatedProctor || out[110].Outcome != OutcomeInvalidatedTimeout {
		t.Fatalf("supported non-scored outcomes missing: %#v", out[108:])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListSATAccessGroupsRetainsDeletedLinkScheduleAndPinnedVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_schedules sch")).WillReturnRows(sqlmock.NewRows([]string{
		"schedule_id", "link_id", "link_name", "link_state", "exam_id", "exam_title", "version_number", "cohort_name", "attempt_count", "submitted_count", "scored_count", "pending_count", "invalidated_count", "latest_submitted_at",
	}).AddRow("schedule-live", "link-1", "Saturday 9 AM", "active", "exam-1", "SAT", 20, "Morning", 2, 2, 1, 1, 0, nil).
		AddRow("schedule-deleted", nil, nil, nil, "exam-1", "SAT", 12, "Cohort A", 1, 1, 1, 0, 0, nil))
	groups, err := NewService(db).ListSATAccessGroups(context.Background(), auth.NewActorContext("observer-1", auth.RoleAdminObserver))
	if err != nil {
		t.Fatal(err)
	}
	if len(groups) != 2 {
		t.Fatalf("expected 2 schedule groups, got %d", len(groups))
	}
	if groups[0].VersionNumber != 20 || groups[0].AccessLinkName != "Saturday 9 AM" || groups[0].ScoredCount != 1 {
		t.Fatalf("unexpected live access group: %#v", groups[0])
	}
	if groups[1].ScheduleID != "schedule-deleted" || groups[1].VersionNumber != 12 || groups[1].AccessLinkName != "Cohort A" || groups[1].AccessLinkID != nil {
		t.Fatalf("deleted access metadata should fall back to its durable schedule: %#v", groups[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestListSATAttemptsPagesAndIncludesAttemptWithoutResult(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*) FROM student_attempts a")).WithArgs("exam-1", "schedule-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(51))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT ar.id, a.id, a.delivery_status, COALESCE(ar.outcome_status, 'unscored')")).WithArgs("exam-1", "schedule-1", 50, 50).WillReturnRows(sqlmock.NewRows([]string{
		"result_id", "attempt_id", "attempt_status", "outcome_status", "release_status", "total_score", "schedule_id", "exam_id", "exam_title", "version_number", "student_id", "student_name", "student_email", "cohort_name", "submitted_at", "created_at",
	}).AddRow(nil, "attempt-51", "running", "unscored", "", nil, "schedule-1", "exam-1", "SAT", 20, "student-51", "Student 51", nil, "Cohort", nil, time.Date(2026, 9, 1, 0, 0, 0, 0, time.UTC)))
	page, err := NewService(db).ListSATAttempts(context.Background(), auth.NewActorContext("observer-1", auth.RoleAdminObserver), "exam-1", "schedule-1", 50, 50, "", "all")
	if err != nil {
		t.Fatal(err)
	}
	if page.Total != 51 || page.Offset != 50 || page.HasMore {
		t.Fatalf("unexpected page metadata: %#v", page)
	}
	if len(page.Items) != 1 || page.Items[0].ResultID != nil || page.Items[0].Outcome != "unscored" || page.Items[0].AttemptStatus != "running" || page.Items[0].VersionNumber != 20 {
		t.Fatalf("unscored administered attempt should remain visible with its attempt version: %#v", page.Items)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetSATResultNarrowsTenantToAssignment(t *testing.T) {
	actor := auth.NewActorContext("grader-1", auth.RoleGrader).WithOrgID("org-1")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Scoped miss (wrong schedule for this grader) must surface NOT_FOUND
	// through the same envelope as a missing id, never cross-schedule state.
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results ar")).
		WithArgs("result-9", "org-1", "grader-1", auth.RoleGrader).
		WillReturnError(sql.ErrNoRows)
	svc := NewService(db)
	if _, err := svc.GetSATResult(context.Background(), actor, "result-9"); err == nil {
		t.Fatal("expected scoped miss to surface, not cross-schedule state")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func expectScoredSATResultBase(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_results ar")).
		WithArgs("result-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "attempt_id", "submission_id", "provider_key", "outcome_status", "total_score", "score_payload", "release_status",
			"schedule_id", "exam_id", "exam_title", "version_number", "candidate_id", "candidate_name", "candidate_email", "cohort_name", "submitted_at",
		}).AddRow("result-1", "attempt-1", nil, "sat", OutcomeScored, int64(1200), `{}`, ReleaseReady, "schedule-1", "exam-1", "Practice SAT", 1, "candidate-1", "Student", nil, "Cohort", nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_section_results WHERE assessment_result_id = ?")).
		WithArgs("result-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "route", "raw_correct", "operational_question_count", "scaled_score", "details"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"section_key", "module_key", "adaptive_role", "display_order", "state", "raw_correct", "operational_question_count",
		}))
}

func TestGetSATResultQuestionQueryFailureIsNotAnEmptyResult(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	queryErr := errors.New("database unavailable")
	expectScoredSATResultBase(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnError(queryErr)

	svc := NewService(db)
	_, err = svc.GetSATResult(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "result-1")
	if !errors.Is(err, queryErr) || !strings.Contains(err.Error(), "load SAT question responses") {
		t.Fatalf("expected wrapped question-detail error, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetSATResultReturnsEmptyQuestionsOnlyAfterSuccessfulQuery(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	expectScoredSATResultBase(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"section_key", "module_key", "module_display_order", "question_display_order", "exam_question_id", "question_id",
			"is_pretest", "marked_for_review", "response", "answer_definition", "response_v2", "v2_present", "v_question_id",
		}))

	svc := NewService(db)
	detail, err := svc.GetSATResult(context.Background(), auth.NewActorContext("admin-1", auth.RoleAdmin), "result-1")
	if err != nil {
		t.Fatalf("expected successful empty detail query, got %v", err)
	}
	if detail == nil || detail.Questions == nil || len(detail.Questions) != 0 {
		t.Fatalf("expected an explicitly empty question list, got %+v", detail)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATDetailTypesDefaultToEmptyDetail(t *testing.T) {
	// A zero SATDetail must serialize additive detail fields as empty
	// arrays (not null) so older section-only clients keep working and new
	// table UIs can map without nil guards.
	detail := SATDetail{Summary: ResultSummary{}, Sections: []SATSection{}}
	if len(detail.Questions) != 0 {
		t.Fatalf("expected nil questions on zero detail, got %#v", detail.Questions)
	}
	for _, section := range detail.Sections {
		if len(section.Modules) != 0 {
			t.Fatalf("expected nil modules on zero section, got %#v", section.Modules)
		}
	}
}

func TestSATQuestionNullVerdictRule(t *testing.T) {
	// The null-verdict contract: only answered + keyed + operational rows
	// carry true/false. Everything else stays nil and must never render
	// as incorrect.
	correct := true
	pretest := SATQuestion{QuestionID: "q-pre", IsPretest: true, IsCorrect: nil}
	if pretest.IsCorrect != nil {
		t.Fatal("pretest rows must keep a nil verdict")
	}
	unanswered := SATQuestion{QuestionID: "q-blank", CorrectAnswer: "A", IsCorrect: nil}
	if unanswered.IsCorrect != nil {
		t.Fatal("unanswered rows must keep a nil verdict")
	}
	keyless := SATQuestion{QuestionID: "q-nokey", Response: "A", IsCorrect: nil}
	if keyless.IsCorrect != nil {
		t.Fatal("key-less rows must keep a nil verdict")
	}
	scored := SATQuestion{QuestionID: "q-ok", Response: "A", CorrectAnswer: "A", IsCorrect: &correct}
	if scored.IsCorrect == nil || !*scored.IsCorrect {
		t.Fatal("answered keyed rows must carry their verdict")
	}
}

func TestAttachSATModulesNestsBySection(t *testing.T) {
	sections := []SATSection{{SectionKey: "reading-writing"}, {SectionKey: "math"}}
	modules := []SATModule{
		{ModuleKey: "rw-base", AdaptiveRole: "base", RawCorrect: 12, Operational: 20, State: "submitted", IsAdministered: true},
		{ModuleKey: "rw-higher", AdaptiveRole: "higher_branch", RawCorrect: 8, Operational: 14, State: "submitted", IsAdministered: true},
	}
	byModule := map[string]string{"rw-base": "reading-writing", "rw-higher": "reading-writing"}
	attachSATModules(sections, modules, byModule)
	if len(sections[0].Modules) != 2 || len(sections[1].Modules) != 0 {
		t.Fatalf("expected modules nested under reading-writing only: %+v", sections)
	}
	// Unknown section mappings never create phantom sections.
	attachSATModules(sections, []SATModule{{ModuleKey: "ghost"}}, map[string]string{"ghost": "nope"})
	if len(sections) != 2 {
		t.Fatalf("expected no phantom sections, got %+v", sections)
	}
}

func TestSATModulesQueryOrdersBySectionThenModule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"section_key", "module_key", "adaptive_role", "display_order",
			"state", "raw_correct", "operational_question_count",
		}).AddRow("reading-writing", "rw-base", "base", 1, "submitted", int64(12), int64(20)).
			AddRow("math", "m-base", "base", 1, "submitted", int64(9), int64(20)))
	svc := NewService(db)
	modules, byModule, err := svc.satModules(context.Background(), "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(modules) != 2 || modules[0].ModuleKey != "rw-base" || byModule["m-base"] != "math" {
		t.Fatalf("unexpected module rows: %+v %#v", modules, byModule)
	}
	if modules[0].RawCorrect != 12 || modules[0].Operational != 20 || !modules[0].IsAdministered {
		t.Fatalf("expected administered raw counts, got %+v", modules[0])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATQuestionsApplyNullVerdictRule(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	singleChoice := `{"kind":"single_choice","correctOptionId":"B"}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"section_key", "module_key", "module_display_order", "question_display_order",
			"exam_question_id", "question_id", "is_pretest", "marked_for_review", "response", "answer_definition",
			"response_v2", "v2_present", "v_question_id",
		}).
			AddRow("reading-writing", "rw-base", 1, 1, "eq-1", "q-scored", false, false, `"B"`, singleChoice, nil, false, nil).
			AddRow("reading-writing", "rw-base", 1, 2, "eq-2", "q-wrong", false, true, `"A"`, singleChoice, nil, false, nil).
			AddRow("reading-writing", "rw-base", 1, 3, "eq-3", "q-blank", false, false, nil, singleChoice, nil, false, nil).
			AddRow("math", "m-base", 1, 1, "eq-4", "q-pre", true, false, `"B"`, singleChoice, nil, false, nil).
			AddRow("math", "m-base", 1, 2, "eq-5", "q-nokey", false, false, `"B"`, `{"kind":"single_choice"}`, nil, false, nil))
	svc := NewService(db)
	questions, err := svc.satQuestions(context.Background(), "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(questions) != 5 {
		t.Fatalf("expected 5 question rows, got %+v", questions)
	}
	byID := map[string]SATQuestion{}
	for _, question := range questions {
		byID[question.QuestionID] = question
	}
	if byID["q-scored"].IsCorrect == nil || !*byID["q-scored"].IsCorrect {
		t.Fatalf("expected q-scored true, got %+v", byID["q-scored"])
	}
	if byID["q-wrong"].IsCorrect == nil || *byID["q-wrong"].IsCorrect {
		t.Fatalf("expected q-wrong false, got %+v", byID["q-wrong"])
	}
	if !byID["q-wrong"].MarkedForReview {
		t.Fatal("expected marked_for_review to survive")
	}
	for _, id := range []string{"q-blank", "q-pre", "q-nokey"} {
		if byID[id].IsCorrect != nil {
			t.Fatalf("expected %s verdict null, got %+v", id, byID[id])
		}
	}
	if byID["q-nokey"].CorrectAnswer != nil {
		t.Fatalf("expected key-less row without correct answer, got %+v", byID["q-nokey"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATQuestionsV2WinsOverLegacy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	singleChoice := `{"kind":"single_choice","correctOptionId":"B"}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"section_key", "module_key", "module_display_order", "question_display_order",
			"exam_question_id", "question_id", "is_pretest", "marked_for_review", "response", "answer_definition",
			"response_v2", "v2_present", "v_question_id",
		}).
			AddRow("reading-writing", "rw-base", 1, 1, "eq-v2-1", "q-v2correct", false, false, `"A"`, singleChoice, `{"answer":"B","markedForReview":true}`, true, "q-v2correct").
			AddRow("reading-writing", "rw-base", 1, 2, "eq-v2-2", "q-v2stale", false, false, `"B"`, singleChoice, `{"answer":null}`, true, "q-v2stale"))
	svc := NewService(db)
	questions, err := svc.satQuestions(context.Background(), "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(questions) != 2 {
		t.Fatalf("expected 2 question rows, got %d", len(questions))
	}
	byID := map[string]SATQuestion{}
	for _, question := range questions {
		byID[question.QuestionID] = question
	}
	if byID["q-v2correct"].IsCorrect == nil || !*byID["q-v2correct"].IsCorrect {
		t.Fatalf("expected V2-correct verdict true, got %+v", byID["q-v2correct"])
	}
	if !byID["q-v2correct"].MarkedForReview {
		t.Fatal("expected marked_for_review from V2 envelope")
	}
	if resp, _ := byID["q-v2correct"].Response.(string); resp != "B" {
		t.Fatalf("expected V2 response B, got %#v", byID["q-v2correct"].Response)
	}
	if byID["q-v2stale"].IsCorrect != nil {
		t.Fatalf("expected null verdict when V2 owns with unusable answer, got %+v", byID["q-v2stale"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATQuestionsDeduplicateByAdministeredQuestion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	singleChoice := `{"kind":"single_choice","correctOptionId":"B"}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"section_key", "module_key", "module_display_order", "question_display_order", "exam_question_id", "question_id",
			"is_pretest", "marked_for_review", "response", "answer_definition", "response_v2", "v2_present", "v_question_id",
		}).
			AddRow("reading-writing", "rw-base", 1, 1, "exam-q-1", "shared-bank-q", false, false, `"B"`, singleChoice, nil, false, nil).
			AddRow("math", "m-higher", 2, 1, "exam-q-2", "shared-bank-q", false, false, `"A"`, singleChoice, nil, false, nil))

	questions, err := NewService(db).satQuestions(context.Background(), "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	if len(questions) != 2 {
		t.Fatalf("expected both administered placements for the reused question, got %+v", questions)
	}
	if questions[0].QuestionID != "shared-bank-q" || questions[1].QuestionID != "shared-bank-q" {
		t.Fatalf("expected public question identity to remain the bank id, got %+v", questions)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestResultValueDecoders(t *testing.T) {
	if got := parseIntPtr(" 40 "); got == nil || *got != 40 {
		t.Fatalf("expected integer decoder to return 40, got %v", got)
	}
	if got := parseIntPtr("not-a-number"); got != nil {
		t.Fatalf("expected invalid integer to return nil, got %v", *got)
	}
	if got := parseFloatPtr(" 82.5 "); got == nil || *got != 82.5 {
		t.Fatalf("expected float decoder to return 82.5, got %v", got)
	}
	if got := parseFloatPtr("not-a-number"); got != nil {
		t.Fatalf("expected invalid float to return nil, got %v", *got)
	}

	sectionBands := decodeSectionBands(sql.NullString{String: `{"reading":7.5}`, Valid: true})
	if sectionBands["reading"] != 7.5 {
		t.Fatalf("expected decoded reading band, got %#v", sectionBands)
	}
	if decodeSectionBands(sql.NullString{String: "not-json", Valid: true}) != nil {
		t.Fatal("expected invalid section bands JSON to fail closed")
	}
}

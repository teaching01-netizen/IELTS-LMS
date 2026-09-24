package delivery

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func TestFinalizeModuleRejectsStudentCompletionReasonBeforeDatabaseWork(t *testing.T) {
	var svc Service
	for _, reason := range []string{"student_submit", "unknown_reason"} {
		t.Run(reason, func(t *testing.T) {
			_, err := svc.finalizeModuleTx(context.Background(), nil, "att-1", saveActiveModule{}, reason)
			appErr, ok := apperrors.As(err)
			if !ok || appErr.Code != apperrors.CodeAssessmentConflict || appErr.HTTPStatus != 409 {
				t.Fatalf("expected typed 409 conflict for completion reason %q, got %v", reason, err)
			}
			wantReason := "INVALID_MODULE_COMPLETION_REASON"
			if reason == "student_submit" {
				wantReason = "STUDENT_MODULE_SUBMIT_DISABLED"
			}
			if appErr.Details["reason"] != wantReason {
				t.Fatalf("expected reason %q, got %v", wantReason, appErr.Details["reason"])
			}
		})
	}
}

// P0: a V2-saved correct answer scores despite zero legacy response rows.
// finalizeModuleTx must read attempt_responses_v2, count the correct answer,
// and route through the adaptive policy.
func TestFinalizeModuleScoresV2AnswersWithoutLegacyRows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	now := time.Now().UTC()
	started := now.Add(-time.Minute)
	// finalizeModuleTx internals: scoring query, CAS update, section lookup,
	// adaptive routing to the higher branch.
	singleChoice := `{"kind":"single_choice","correctOptionId":"B"}`
	v2correct := `{"answer":"B","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions")).
		WithArgs("ma-base", "ma-base", "mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"eq_id", "is_pretest", "answer_definition", "response", "response_v2", "v_question_id"}).
			AddRow("eq-1", false, singleChoice, nil, v2correct, "eq-1"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = ?")).
		WithArgs("locked", true, "time_expired", 1, 1, "ma-base").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "break_after_seconds"}).AddRow("sec-1", 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"}).
			AddRow("sec-1", "reading-writing", 0, "base", "pv-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "policy_revision"}).
			AddRow("sec-1", "mod-base", "mod-lower", "mod-higher", "threshold", `{"minimumCorrectForHigher":1}`, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_route_decisions")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sec-1", "ma-base", "mod-base", "mod-higher", "higher", 1, 1, "threshold", 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-higher").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "section_key", "module_key", "duration_seconds", "adaptive_role", "tool_policy"}).
			AddRow("mod-higher", "sec-1", "reading-writing", "rw-hard", 3600, "higher_branch", nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM student_attempts sa JOIN exam_session_runtimes")).
		WithArgs("att-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"cohort", "personal"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_module_attempts")).
		WithArgs(sqlmock.AnyArg(), "att-1", "mod-higher", 3600, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	tx, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	next, err := svc.finalizeModuleTx(context.Background(), tx, "att-1", saveActiveModule{
		id: "ma-base", moduleID: "mod-base",
		state: "active", allocatedSeconds: 3600,
		availableAt:              &started,
		startedAt:                &started,
		accumulatedPausedSeconds: 0,
	}, "time_expired")
	if err != nil {
		t.Fatalf("V2-scored finalize must succeed, got %v", err)
	}
	if next == nil || next.id != "mod-higher" {
		t.Fatalf("correct V2 answer must route higher, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Legacy fallback: no V2 rows anywhere still scores legacy answers (history
// preserved) and emits the legacy source metric path without error.
func TestFinalizeModuleLegacyFallbackWithoutV2Rows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	now := time.Now().UTC()
	started := now.Add(-time.Minute)
	singleChoice := `{"kind":"single_choice","correctOptionId":"B"}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions")).
		WithArgs("ma-base", "ma-base", "mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"eq_id", "is_pretest", "answer_definition", "response", "response_v2", "v_question_id"}).
			AddRow("eq-1", false, singleChoice, `"B"`, nil, nil))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = ?")).
		WithArgs("locked", true, "time_expired", 1, 1, "ma-base").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "break_after_seconds"}).AddRow("sec-1", 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"}).
			AddRow("sec-1", "reading-writing", 0, "base", "pv-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "policy_revision"}).
			AddRow("sec-1", "mod-base", "mod-lower", "mod-higher", "threshold", `{"minimumCorrectForHigher":1}`, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_route_decisions")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sec-1", "ma-base", "mod-base", "mod-higher", "higher", 1, 1, "threshold", 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-higher").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "section_key", "module_key", "duration_seconds", "adaptive_role", "tool_policy"}).
			AddRow("mod-higher", "sec-1", "reading-writing", "rw-hard", 3600, "higher_branch", nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM student_attempts sa JOIN exam_session_runtimes")).
		WithArgs("att-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"cohort", "personal"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_module_attempts")).
		WithArgs(sqlmock.AnyArg(), "att-1", "mod-higher", 3600, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	tx, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	next, err := svc.finalizeModuleTx(context.Background(), tx, "att-1", saveActiveModule{
		id: "ma-base", moduleID: "mod-base",
		state: "active", allocatedSeconds: 3600,
		availableAt:              &started,
		startedAt:                &started,
		accumulatedPausedSeconds: 0,
	}, "time_expired")
	if err != nil {
		t.Fatalf("legacy fallback finalize must succeed, got %v", err)
	}
	if next == nil || next.id != "mod-higher" {
		t.Fatalf("legacy correct answer must still route higher, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Exam-day re-audit defect 1: a V2 write keyed by eq.question_id must score
// exactly once — the IN-join can return the eq.id row plus the
// eq.question_id variant, and both must collapse to one operational row.
// The module fence (v.module_id = eq.module_id) additionally keeps a reused
// question_id in another module from leaking into this module's score.
func TestFinalizeModuleDedupsDualV2IdentityRows(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	now := time.Now().UTC()
	started := now.Add(-time.Minute)
	singleChoice := `{"kind":"single_choice","correctOptionId":"B"}`
	v2correct := `{"answer":"B","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions")).
		WithArgs("ma-base", "ma-base", "mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"eq_id", "is_pretest", "answer_definition", "response", "response_v2", "v_question_id"}).
			AddRow("eq-1", false, singleChoice, nil, v2correct, "eq-1").
			AddRow("eq-1", false, singleChoice, nil, v2correct, "q-stable-1"))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = ?")).
		WithArgs("locked", true, "time_expired", 1, 1, "ma-base").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "break_after_seconds"}).AddRow("sec-1", 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"}).
			AddRow("sec-1", "reading-writing", 0, "base", "pv-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "policy_revision"}).
			AddRow("sec-1", "mod-base", "mod-lower", "mod-higher", "threshold", `{"minimumCorrectForHigher":1}`, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_route_decisions")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sec-1", "ma-base", "mod-base", "mod-higher", "higher", 1, 1, "threshold", 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-higher").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "section_key", "module_key", "duration_seconds", "adaptive_role", "tool_policy"}).
			AddRow("mod-higher", "sec-1", "reading-writing", "rw-hard", 3600, "higher_branch", nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM student_attempts sa JOIN exam_session_runtimes")).
		WithArgs("att-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"cohort", "personal"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_module_attempts")).
		WithArgs(sqlmock.AnyArg(), "att-1", "mod-higher", 3600, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	tx, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	next, err := svc.finalizeModuleTx(context.Background(), tx, "att-1", saveActiveModule{
		id: "ma-base", moduleID: "mod-base",
		state: "active", allocatedSeconds: 3600,
		availableAt:              &started,
		startedAt:                &started,
		accumulatedPausedSeconds: 0,
	}, "time_expired")
	if err != nil {
		t.Fatalf("dedup finalize must succeed, got %v", err)
	}
	if next == nil || next.id != "mod-higher" {
		t.Fatalf("single correct answer must route higher once, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Exam-day re-audit defect 5: a zero-answer pass (questions exist, no V2 and
// no legacy response anywhere) routes lower on 0/2 — the CAS still persists
// the score; the page signal (not the state flip) is what the loader pins
// via the zero-source counter. A pure-legacy pass stays source=legacy only.
func TestFinalizeModuleZeroAnswerPassRoutesLower(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	now := time.Now().UTC()
	started := now.Add(-time.Minute)
	singleChoice := `{"kind":"single_choice","correctOptionId":"B"}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions")).
		WithArgs("ma-base", "ma-base", "mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"eq_id", "is_pretest", "answer_definition", "response", "response_v2", "v_question_id"}).
			AddRow("eq-1", false, singleChoice, nil, nil, nil).
			AddRow("eq-2", false, singleChoice, nil, nil, nil))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = ?")).
		WithArgs("locked", true, "time_expired", 0, 2, "ma-base").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "break_after_seconds"}).AddRow("sec-1", 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"}).
			AddRow("sec-1", "reading-writing", 0, "base", "pv-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "policy_revision"}).
			AddRow("sec-1", "mod-base", "mod-lower", "mod-higher", "threshold", `{"minimumCorrectForHigher":1}`, 1))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_route_decisions")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sec-1", "ma-base", "mod-base", "mod-lower", "lower", 0, 2, "threshold", 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-lower").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "section_key", "module_key", "duration_seconds", "adaptive_role", "tool_policy"}).
			AddRow("mod-lower", "sec-1", "reading-writing", "rw-easy", 3600, "lower_branch", nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM student_attempts sa JOIN exam_session_runtimes")).
		WithArgs("att-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"cohort", "personal"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_module_attempts")).
		WithArgs(sqlmock.AnyArg(), "att-1", "mod-lower", 3600, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	tx, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	next, err := svc.finalizeModuleTx(context.Background(), tx, "att-1", saveActiveModule{
		id: "ma-base", moduleID: "mod-base",
		state: "active", allocatedSeconds: 3600,
		availableAt:              &started,
		startedAt:                &started,
		accumulatedPausedSeconds: 0,
	}, "time_expired")
	if err != nil {
		t.Fatalf("zero-answer finalize must succeed, got %v", err)
	}
	if next == nil || next.id != "mod-lower" {
		t.Fatalf("zero correct must route lower, got %+v", next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

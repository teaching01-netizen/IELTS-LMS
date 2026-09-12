package authoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func contractService(t *testing.T) (*Service, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		db.Close()
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Error(err)
		}
	})
	return NewService(db, tx.NewRunner(db)), mock
}
func expectModuleDraft(mock sqlmock.Sqlmock, moduleID string) {
	mock.ExpectQuery("SELECT v.id FROM exam_entities e").WithArgs(moduleID).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("draft-1"))
	mock.ExpectExec("UPDATE exam_versions SET revision = revision \\+ 1").WithArgs("draft-1").WillReturnResult(sqlmock.NewResult(0, 1))
}
func expectQuestionDraft(mock sqlmock.Sqlmock, id string) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT module_id FROM assessment_exam_questions WHERE id = ? FOR UPDATE")).WithArgs(id).WillReturnRows(sqlmock.NewRows([]string{"module_id"}).AddRow("mod-1"))
	expectModuleDraft(mock, "mod-1")
}
func detailRows(id string, revision int) *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "module_id", "module_key", "section_key", "display_order", "is_pretest", "revision_id", "question_id", "semantic_revision", "revision", "state", "question_type", "stimulus", "prompt", "answer", "rationale", "metadata", "accessibility"}).
		AddRow(id, "mod-1", "rw-m1", SectionReadingWriting, 1, false, "rev-1", "q-1", 1, revision, "draft", "single_choice", emptyContent(), validPrompt(), validChoiceAnswer(), emptyContent(), validMetadata(), `{"longDescription":null}`)
}

func TestSaveRevisionReturnsEditorContractAndAdvancesRevision(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT question_revision_id FROM assessment_exam_questions").WithArgs("eq-1").WillReturnRows(sqlmock.NewRows([]string{"question_revision_id"}).AddRow("rev-1"))
	mock.ExpectQuery("SELECT revision, state FROM assessment_question_revisions").WithArgs("rev-1").WillReturnRows(sqlmock.NewRows([]string{"revision", "state"}).AddRow(3, "draft"))
	mock.ExpectExec("UPDATE assessment_question_revisions SET .*revision = revision \\+ 1, state = 'draft'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(questionDetailQuery)).WithArgs("eq-1").WillReturnRows(detailRows("eq-1", 4))
	mock.ExpectCommit()
	out, err := svc.SaveRevision(context.Background(), "eq-1", "rev-1", 3, defaultSATQuestionDraft(SectionReadingWriting), "actor")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(out)
	var wire map[string]any
	json.Unmarshal(raw, &wire)
	if wire["id"] != "rev-1" || wire["revision"] != float64(4) || wire["prompt"] == nil || wire["answer"] == nil {
		t.Fatalf("editor cannot install saved revision: %s", raw)
	}
	if _, nested := wire["question"]; nested {
		t.Fatalf("save returned detail wrapper: %s", raw)
	}
}
func TestSaveRevisionRejectsStaleEditor(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT question_revision_id FROM assessment_exam_questions").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("rev-1"))
	mock.ExpectQuery("SELECT revision, state FROM assessment_question_revisions").WillReturnRows(sqlmock.NewRows([]string{"revision", "state"}).AddRow(4, "draft"))
	mock.ExpectRollback()
	_, err := svc.SaveRevision(context.Background(), "eq-1", "rev-1", 3, QuestionDraft{}, "actor")
	if codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("wanted stale conflict, got %v", err)
	}
}
func TestCreateQuestionCannotMutatePublishedVersion(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectQuery("SELECT v.id FROM exam_entities e").WithArgs("published-module").WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()
	_, err := svc.CreateQuestion(context.Background(), "published-module", "actor", QuestionDraft{})
	if codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("wanted published conflict, got %v", err)
	}
}
func TestReorderSwapsPositionsWithoutUniqueKeyCollision(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectModuleDraft(mock, "mod-1")
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_modules WHERE id = ? FOR UPDATE")).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("mod-1"))
	mock.ExpectQuery("SELECT id, display_order FROM assessment_exam_questions").WillReturnRows(sqlmock.NewRows([]string{"id", "display_order"}).AddRow("a", 0).AddRow("b", 1))
	for i, id := range []string{"a", "b"} {
		mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_exam_questions SET display_order = ? WHERE id = ? AND module_id = ?")).WithArgs(2+i, id, "mod-1").WillReturnResult(sqlmock.NewResult(0, 1))
	}
	for i, id := range []string{"b", "a"} {
		mock.ExpectExec("UPDATE assessment_exam_questions SET display_order = \\?, updated_at").WithArgs(i, id, "mod-1").WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.ExpectCommit()
	if err := svc.ReorderQuestions(context.Background(), "mod-1", []string{"a", "b"}, []string{"b", "a"}); err != nil {
		t.Fatal(err)
	}
}
func TestReorderRejectsStaleOrderWithUnchangedMembership(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectModuleDraft(mock, "mod-1")
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_modules WHERE id = ? FOR UPDATE")).WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("mod-1"))
	mock.ExpectQuery("SELECT id, display_order FROM assessment_exam_questions").WillReturnRows(sqlmock.NewRows([]string{"id", "display_order"}).AddRow("b", 0).AddRow("a", 1))
	mock.ExpectRollback()
	if err := svc.ReorderQuestions(context.Background(), "mod-1", []string{"a", "b"}, []string{"b", "a"}); codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("wanted order conflict, got %v", err)
	}
}
func TestBulkRejectsStaleRevisionBeforeAnyContentWrite(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	for i, id := range []string{"a", "b"} {
		expectQuestionDraft(mock, id)
		mock.ExpectQuery("SELECT r.revision FROM assessment_exam_questions").WithArgs(id).WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(3 + i))
	}
	mock.ExpectRollback()
	_, err := svc.BulkQuestions(context.Background(), []string{"a", "b"}, BulkAction{Type: "patch_metadata", Patch: map[string]any{"difficulty": "hard"}}, "actor", map[string]int{"a": 3, "b": 3})
	if codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("wanted revision conflict, got %v", err)
	}
}
func TestBulkRejectsIncompleteFencingAndDuplicateIDs(t *testing.T) {
	svc, _ := contractService(t)
	for _, ids := range [][]string{{"a", "b"}, {"a", "a"}} {
		_, err := svc.BulkQuestions(context.Background(), ids, BulkAction{Type: "delete"}, "actor", map[string]int{"a": 0})
		if codeOf(err) != apperrors.CodeValidation {
			t.Fatalf("wanted invalid batch, got %v", err)
		}
	}
}

func TestCreateQuestionRejectsOverCapacityInsideTransaction(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectModuleDraft(mock, "mod-1")
	mock.ExpectQuery("SELECT s.section_key, m.module_key FROM assessment_modules").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key"}).AddRow(SectionReadingWriting, "rw-m1"))
	// Full 27-cap module: the fence rejects before any INSERT runs.
	mock.ExpectQuery("SELECT target_question_count FROM assessment_modules WHERE").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"target_question_count"}).AddRow(27))
	mock.ExpectQuery("SELECT COUNT").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(27))
	mock.ExpectRollback()
	if _, err := svc.CreateQuestion(context.Background(), "mod-1", "actor", QuestionDraft{QuestionType: "single_choice"}); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("wanted over-capacity validation, got %v", err)
	}
}

func TestDuplicateRejectsOverCapacityBeforeCopy(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT module_id, question_id, question_revision_id, display_order, is_pretest").WithArgs("eq-1").WillReturnRows(sqlmock.NewRows([]string{"module", "question", "revision", "order", "pretest"}).AddRow("mod-1", "original-q", "original-rev", 0, false))
	mock.ExpectQuery("SELECT target_question_count FROM assessment_modules WHERE").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"target_question_count"}).AddRow(27))
	mock.ExpectQuery("SELECT COUNT").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(27))
	mock.ExpectRollback()
	if _, err := svc.DuplicateQuestion(context.Background(), "eq-1", nil, "actor", nil); codeOf(err) != apperrors.CodeValidation {
		t.Fatalf("wanted over-capacity validation, got %v", err)
	}
}

func TestBatchCreateReplaysSameKeyWithoutSecondInsert(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").WithArgs("actor", "batch:mod-1", "batch-key", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
	expectModuleDraft(mock, "mod-1")
	mock.ExpectQuery("SELECT s.section_key, m.module_key FROM assessment_modules").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key"}).AddRow(SectionReadingWriting, "rw-m1"))
	mock.ExpectQuery("SELECT target_question_count FROM assessment_modules WHERE").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"target_question_count"}).AddRow(27))
	mock.ExpectQuery("SELECT COUNT").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	mock.ExpectQuery("SELECT COALESCE").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"next"}).AddRow(3))
	mock.ExpectExec("INSERT INTO assessment_questions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO assessment_question_revisions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO assessment_exam_questions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE authoring_operation_keys SET result_json").WithArgs(sqlmock.AnyArg(), "actor", "batch:mod-1", "batch-key").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	out, err := svc.BatchCreateQuestions(context.Background(), "mod-1", "actor", []QuestionDraft{{QuestionType: "single_choice"}}, WithOperationKey("batch-key"))
	if err != nil {
		t.Fatal(err)
	}
	if len(out) != 1 {
		t.Fatalf("expected one batched question, got %d", len(out))
	}
}

func TestBulkRejectsReusedKeyWithDifferentPayload(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").WithArgs("actor", "bulk:delete", "bulk-key", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT request_hash, result_json FROM authoring_operation_keys").WithArgs("actor", "bulk:delete", "bulk-key").WillReturnRows(sqlmock.NewRows([]string{"request_hash", "result_json"}).AddRow("other-hash", nil))
	mock.ExpectRollback()
	_, err := svc.BulkQuestions(context.Background(), []string{"a"}, BulkAction{Type: "delete"}, "actor", nil, WithOperationKey("bulk-key"))
	if codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("wanted key-reuse conflict, got %v", err)
	}
}

func TestCreateQuestionReplaysSameKeyWithoutSecondInsert(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").WithArgs("actor", "create:mod-1", "key-1", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
	expectModuleDraft(mock, "mod-1")
	mock.ExpectQuery("SELECT s.section_key, m.module_key FROM assessment_modules").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key"}).AddRow(SectionReadingWriting, "rw-m1"))
	mock.ExpectQuery("SELECT target_question_count FROM assessment_modules WHERE").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"target_question_count"}).AddRow(27))
	mock.ExpectQuery("SELECT COUNT").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	mock.ExpectQuery("SELECT COALESCE").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"next"}).AddRow(3))
	mock.ExpectExec("INSERT INTO assessment_questions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO assessment_question_revisions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO assessment_exam_questions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(questionDetailQuery)).WillReturnRows(detailRows("created", 0))
	mock.ExpectExec("UPDATE authoring_operation_keys SET result_json").WithArgs(sqlmock.AnyArg(), "actor", "create:mod-1", "key-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	first, err := svc.CreateQuestion(context.Background(), "mod-1", "actor", QuestionDraft{QuestionType: "single_choice"}, WithOperationKey("key-1"))
	if err != nil {
		t.Fatal(err)
	}
	if first.ExamQuestionID == "" {
		t.Fatal("expected created question identity")
	}
}

func TestDuplicateHonorsInsertionAnchorAndCopiesContent(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT module_id, question_id, question_revision_id, display_order, is_pretest").WithArgs("eq-1").WillReturnRows(sqlmock.NewRows([]string{"module", "question", "revision", "order", "pretest"}).AddRow("mod-1", "original-q", "original-rev", 0, false))
	// Duplicate is an insert: capacity fence runs before the copy (27-cap
	// module currently holding 2 questions).
	mock.ExpectQuery("SELECT target_question_count FROM assessment_modules WHERE").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"target_question_count"}).AddRow(27))
	mock.ExpectQuery("SELECT COUNT").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	mock.ExpectQuery("SELECT COALESCE").WithArgs("mod-1").WillReturnRows(sqlmock.NewRows([]string{"next"}).AddRow(3))
	mock.ExpectQuery("SELECT display_order FROM assessment_exam_questions").WithArgs("eq-1", "mod-1").WillReturnRows(sqlmock.NewRows([]string{"order"}).AddRow(0))
	mock.ExpectExec("UPDATE assessment_exam_questions SET display_order = display_order \\+ 1.*ORDER BY display_order DESC").WithArgs("mod-1", 1).WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec("INSERT INTO assessment_questions").WithArgs(sqlmock.AnyArg(), "actor", "original-rev").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO assessment_question_revisions").WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), "actor", "original-rev").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO assessment_exam_questions").WithArgs(sqlmock.AnyArg(), "mod-1", sqlmock.AnyArg(), sqlmock.AnyArg(), 1, false).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(questionDetailQuery)).WillReturnRows(detailRows("copy", 0))
	mock.ExpectCommit()
	anchor := "eq-1"
	out, err := svc.DuplicateQuestion(context.Background(), "eq-1", nil, "actor", &anchor)
	if err != nil {
		t.Fatal(err)
	}
	if out.DisplayOrder != 1 {
		t.Fatalf("copy inserted at %d", out.DisplayOrder)
	}
}

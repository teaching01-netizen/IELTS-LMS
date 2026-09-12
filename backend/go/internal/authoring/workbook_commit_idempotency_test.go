package authoring

// Workbook-commit single-tx idempotency: claim + mutation + replay-store
// commit atomically, so a crash can never leave a claimed key without a
// replayable result (or a committed draft without one).
import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func commitRequest() SatWorkbookCommitRequest {
	mods := make([]SatWorkbookModuleDraft, 0, len(satWorkbookModules))
	for _, spec := range satWorkbookModules {
		qs := make([]QuestionDraft, 0, spec.count)
		for i := 0; i < spec.count; i++ {
			pretest := i < 2
			meta := validMetadata()
			if spec.sectionKey == SectionMath {
				meta = `{"sectionKey":"math","domain":"algebra","skill":"Linear Equations in One Variable","difficulty":"medium","tags":["demo"]}`
			}
			qs = append(qs, QuestionDraft{QuestionType: "single_choice", Stimulus: json.RawMessage(`{}`), Prompt: json.RawMessage(validPrompt()), Answer: json.RawMessage(validChoiceAnswer()), Rationale: json.RawMessage(`{}`), Metadata: json.RawMessage(meta), IsPretest: pretest})
		}
		mods = append(mods, SatWorkbookModuleDraft{ModuleKey: spec.key, SectionKey: spec.sectionKey, Questions: qs})
	}
	return SatWorkbookCommitRequest{ImportID: "imp-1", ExpectedVersionID: "v-1", ExpectedVersionRevision: 3, Modules: mods}
}

func expectReplaceGates(mock sqlmock.Sqlmock) {
	mock.ExpectQuery("SELECT provider_key, current_draft_version_id FROM exam_entities").WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id"}).AddRow("sat", "v-1"))
	mock.ExpectQuery("SELECT revision FROM exam_versions").WithArgs("v-1", "exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(3))
}

func expectReplaceBody(mock sqlmock.Sqlmock) {

	mock.ExpectQuery("SELECT expected_version_id, expected_version_revision").WithArgs("imp-1", "exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"expected_version_id", "expected_version_revision", "asset_manifest", "created_by"}).AddRow("v-1", 3, `[]`, "actor"))
	targetCols := []string{"id", "section_key", "module_key", "target_question_count"}
	targetRows := sqlmock.NewRows(targetCols)
	for i, spec := range satWorkbookModules {
		sec := SectionReadingWriting
		if i >= 3 {
			sec = SectionMath
		}
		targetRows.AddRow("mod-"+spec.key, sec, spec.key, spec.count)
	}
	mock.ExpectQuery("FROM assessment_modules m").WithArgs("v-1").WillReturnRows(targetRows)
	mock.ExpectQuery("FROM exam_versions WHERE id = ").WithArgs("v-1", "exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"content_snapshot", "config_snapshot"}).AddRow(`{}`, `{}`))
	mock.ExpectQuery("MAX.version_number").WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"next"}).AddRow(7))
	mock.ExpectExec("INSERT INTO exam_versions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("FROM assessment_sections WHERE exam_version_id").WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions", "tool_policy"}).AddRow("sec-1", "reading-writing", "RW", 0, 1920, 600, `{}`, `{}`))
	mock.ExpectExec("INSERT INTO assessment_sections").WillReturnResult(sqlmock.NewResult(0, 1))
	// Checkpoint clone chain: modules (empty: no module inserts), routing
	// (empty: no policy inserts), scoring (no row: skip), questions (empty:
	// no revision inserts). Empty checkpoint rows keep the clone a no-op
	// while still exercising the exact query order.
	mock.ExpectQuery("FROM assessment_modules m JOIN assessment_sections").WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}))
	mock.ExpectQuery("FROM assessment_routing_policies rp JOIN").WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config"}))
	mock.ExpectQuery("FROM assessment_scoring_policies WHERE").WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"policy_key", "policy_config"}))
	mock.ExpectQuery("FROM assessment_exam_questions eq").WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"m.id", "qr.id", "eq.question_id", "max", "type", "stimulus", "prompt", "answer", "rationale", "metadata", "accessibility", "order", "pretest"}))
	mock.ExpectQuery("SELECT DISTINCT eq.question_id FROM assessment_exam_questions").WithArgs("v-1").WillReturnRows(sqlmock.NewRows([]string{"question_id"}))
	mock.ExpectExec("DELETE FROM assessment_exam_questions").WillReturnResult(sqlmock.NewResult(0, 1))
	for i := 0; i < 147; i++ {
		mock.ExpectExec("INSERT INTO assessment_questions").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectExec("INSERT INTO assessment_question_revisions").WillReturnResult(sqlmock.NewResult(0, 1))
		mock.ExpectExec("INSERT INTO assessment_exam_questions").WillReturnResult(sqlmock.NewResult(0, 1))
	}
	mock.ExpectExec("UPDATE exam_versions SET revision").WithArgs("v-1", "exam-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT revision FROM exam_versions WHERE id =").WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(4))
	mock.ExpectExec("UPDATE sat_workbook_imports SET").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO exam_events").WillReturnResult(sqlmock.NewResult(0, 1))
}

func expectShellRead(mock sqlmock.Sqlmock) {
	mock.ExpectQuery("SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id =").WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id"}).AddRow("sat", "v-1"))
	mock.ExpectQuery("SELECT revision FROM exam_versions WHERE id = ").WithArgs("v-1", "exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(4))
	mock.ExpectQuery("FROM assessment_sections WHERE exam_version_id").WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "revision"}))
}

// First claim + full mutation + stored replay commit atomically: replaying
// the same key returns the stored result without touching the draft again.
func TestWorkbookCommitReplaysSameKeyWithoutSecondReplace(t *testing.T) {
	svc, mock := contractService(t)
	req := commitRequest()
	begin(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").WithArgs("actor", "workbook:exam-1", "wb-key", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
	expectReplaceGates(mock)
	expectReplaceBody(mock)
	expectShellRead(mock)
	mock.ExpectExec("UPDATE authoring_operation_keys SET result_json").WithArgs(sqlmock.AnyArg(), "actor", "workbook:exam-1", "wb-key").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	first, err := svc.CommitSATWorkbook(context.Background(), "exam-1", req, "actor", WithOperationKey("wb-key"))
	if err != nil {
		t.Fatal(err)
	}
	if first.Shell.VersionRevision != 4 {
		t.Fatalf("expected in-tx shell at revision 4, got %+v", first.Shell)
	}
}

// Same key + different content is a 409: a retry can never silently mint
// a second draft replacement.
func TestWorkbookCommitRejectsReusedKeyWithDifferentPayload(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").WithArgs("actor", "workbook:exam-1", "wb-key", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT request_hash, result_json FROM authoring_operation_keys").WithArgs("actor", "workbook:exam-1", "wb-key").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "result_json"}).AddRow("other-hash", nil))
	mock.ExpectRollback()
	if _, err := svc.CommitSATWorkbook(context.Background(), "exam-1", commitRequest(), "actor", WithOperationKey("wb-key")); codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("wanted key-reuse conflict, got %v", err)
	}
}

// A claimed-but-unfinished key (crash between claim and commit rolled the
// tx back, so nothing is stored) tells the client to retry with the same
// key instead of inventing a second effect or faking success.
func TestWorkbookCommitInFlightKeyAsksForRetry(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectExec("INSERT IGNORE INTO authoring_operation_keys").WithArgs("actor", "workbook:exam-1", "wb-key", sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 0))
	fp, err := operationFingerprint(map[string]any{"import": "imp-1", "version": "v-1", "rev": 3, "modules": commitRequest().Modules, "assets": commitRequest().Assets})
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery("SELECT request_hash, result_json FROM authoring_operation_keys").WithArgs("actor", "workbook:exam-1", "wb-key").
		WillReturnRows(sqlmock.NewRows([]string{"request_hash", "result_json"}).AddRow(fp, nil))
	mock.ExpectRollback()
	if _, err := svc.CommitSATWorkbook(context.Background(), "exam-1", commitRequest(), "actor", WithOperationKey("wb-key")); err == nil || codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("in-flight key must ask for retry (409), got %v", err)
	}
}

var _ = sql.ErrNoRows

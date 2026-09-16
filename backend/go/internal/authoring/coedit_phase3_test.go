package authoring

import (
	"context"
	"database/sql"
	"encoding/hex"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/authoringcoedit"
)

const phase3FreezeOperation = "phase3-freeze-operation"

func phase3DocumentRow(state string, materialized int, hash []byte, epoch, sequence uint64, owner any, expiry any) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"id", "organization_id", "exam_id", "draft_version_id", "exam_question_id",
		"question_revision_id", "schema_version", "field_set", "lifecycle_state", "seed_revision",
		"materialized_revision", "ydoc_state", "state_vector", "state_hash", "previous_state_hash",
		"closed_reason", "last_actor_id", "updated_at", "state_epoch", "commit_sequence",
		"freeze_operation_id", "freeze_expires_at"})
	var ydoc any
	if len(hash) > 0 {
		ydoc = []byte("committed-state")
	}
	rows.AddRow(coeditDocID, "org-1", coeditExamID, coeditDraftID, coeditQuestionID,
		coeditRevisionID, authoringcoedit.SchemaVersion, authoringcoedit.FieldSetPrompt, state, 4,
		materialized, ydoc, []byte("vector"), hash, nil, nil, coeditLastActorID, time.Now(),
		epoch, sequence, owner, expiry)
	return rows
}

func phase3WorkspaceRow(state string, materialized int, hash []byte, epoch, sequence uint64, owner any, expiry any) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"id", "organization_id", "exam_id", "draft_version_id",
		"schema_version", "field_set", "lifecycle_state", "ydoc_state", "state_vector",
		"state_hash", "previous_state_hash", "workspace_json", "materialized_revision",
		"last_actor_id", "closed_reason", "state_epoch", "commit_sequence",
		"freeze_operation_id", "freeze_expires_at"})
	var ydoc any
	if len(hash) > 0 {
		ydoc = []byte("committed-state")
	}
	rows.AddRow("workspace-1", "org-1", coeditExamID, coeditDraftID,
		authoringcoedit.WorkspaceSchemaVersion, authoringcoedit.FieldSetWorkspace, state,
		ydoc, []byte("vector"), hash, nil, []byte(`{"ui/page":1}`), materialized,
		coeditLastActorID, nil, epoch, sequence, owner, expiry)
	return rows
}

func phase3WorkspaceName(t *testing.T) string {
	t.Helper()
	name, err := authoringcoedit.NewWorkspaceDocumentName("workspace-1")
	if err != nil {
		t.Fatal(err)
	}
	return string(name)
}

func TestCoeditFinalStoreRequiresOwnedFreezingRowAndLeavesFence(t *testing.T) {
	svc, mock := contractService(t)
	oldHash := coeditHash(strings.Repeat("ab", 32))
	newHash := strings.Repeat("cd", 32)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditDocID).
		WillReturnRows(phase3DocumentRow(string(authoringcoedit.StateFreezing), 4, oldHash, 2, 8, phase3FreezeOperation, time.Now().Add(time.Minute)))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	expectQuestionDraft(mock, coeditQuestionID)
	mock.ExpectExec("UPDATE assessment_question_revisions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT revision FROM assessment_question_revisions WHERE id = ?")).
		WithArgs(coeditRevisionID).
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(5))
	mock.ExpectExec("UPDATE authoring_coedit_documents").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "freezing", 5, coeditLastActorID, coeditDocID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CoeditFinalStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		PreviousStateHash: hex.EncodeToString(oldHash),
		StateHash:         newHash,
		YdocState:         []byte("final-state"),
		StateVector:       []byte("final-vector"),
		Prompt:            []byte(validPrompt()),
		FreezeOperationID: phase3FreezeOperation,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.StateEpoch != "2" || result.CommitSequence != "9" || result.FreezeOperationID != phase3FreezeOperation {
		t.Fatalf("final store must return the fenced durability metadata, got %+v", result)
	}
	if result.MaterializedRevision != 5 || !result.Committed || result.Duplicate {
		t.Fatalf("final store must commit the prompt projection once, got %+v", result)
	}
}

func TestCoeditFinalStoreRejectsDifferentOwner(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditDocID).
		WillReturnRows(phase3DocumentRow(string(authoringcoedit.StateFreezing), 4,
			coeditHash(strings.Repeat("ab", 32)), 1, 1, "other-operation", time.Now().Add(time.Minute)))
	mock.ExpectRollback()

	_, err := svc.CoeditFinalStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		StateHash:         strings.Repeat("cd", 32),
		YdocState:         []byte("state"),
		StateVector:       []byte("vector"),
		Prompt:            []byte(validPrompt()),
		FreezeOperationID: phase3FreezeOperation,
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeFreezeConflict {
		t.Fatalf("expected owner conflict, got %s", code)
	}
}

func TestCoeditFinalStoreRejectsExpiredLease(t *testing.T) {
	svc, mock := contractService(t)
	oldHash := coeditHash(strings.Repeat("ab", 32))
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditDocID).
		WillReturnRows(phase3DocumentRow(string(authoringcoedit.StateFreezing), 4, oldHash, 1, 8,
			phase3FreezeOperation, time.Now().Add(-time.Minute)))
	mock.ExpectRollback()

	_, err := svc.CoeditFinalStore(context.Background(), CoeditStoreRequest{
		DocumentName: coeditName(t, coeditDocID), PreviousStateHash: hex.EncodeToString(oldHash),
		StateHash: strings.Repeat("cd", 32), YdocState: []byte("state"), StateVector: []byte("vector"),
		Prompt: []byte(validPrompt()), FreezeOperationID: phase3FreezeOperation,
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeFreezeConflict {
		t.Fatalf("expected expired-lease conflict, got %s", code)
	}
}

func TestCoeditAbortFreezePreservesClosedRows(t *testing.T) {
	svc, mock := contractService(t)
	operation := authoringcoedit.CoeditLifecycleOperation{FreezeOperationID: phase3FreezeOperation, FreezeExpiresAt: time.Now().Add(time.Minute).Unix()}
	begin(mock)
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT lifecycle_state, freeze_operation_id").
		WithArgs(coeditDocID).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_state", "freeze_operation_id"}).AddRow("closed", operation.FreezeOperationID))
	mock.ExpectCommit()

	if err := svc.CoeditAbortFreeze(context.Background(), []string{coeditDocID}, operation); err != nil {
		t.Fatal(err)
	}
}

func TestCoeditWorkspaceInitializeRejectsFrozenRoomBeforeDuplicateCheck(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_workspaces WHERE id = ?")).
		WithArgs("workspace-1").
		WillReturnRows(phase3WorkspaceRow(string(authoringcoedit.StateFrozen), 7,
			coeditHash(strings.Repeat("ab", 32)), 0, 3, phase3FreezeOperation, time.Now().Add(time.Minute)))
	mock.ExpectRollback()

	_, err := svc.CoeditWorkspaceInitialize(context.Background(), CoeditInitializeRequest{
		DocumentName: phase3WorkspaceName(t), StateHash: strings.Repeat("cd", 32),
		YdocState: []byte("state"), StateVector: []byte("vector"), Workspace: []byte(`{"ui/page":2}`),
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeDocumentFrozen {
		t.Fatalf("expected frozen initialization refusal, got %s", code)
	}
}

func TestCoeditInitializeRejectsFrozenRoomBeforeBindingCheck(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditDocID).
		WillReturnRows(phase3DocumentRow(string(authoringcoedit.StateFrozen), 4,
			coeditHash(strings.Repeat("ab", 32)), 0, 3, phase3FreezeOperation, time.Now().Add(time.Minute)))
	mock.ExpectRollback()

	_, err := svc.CoeditInitialize(context.Background(), CoeditInitializeRequest{
		DocumentName: coeditName(t, coeditDocID), StateHash: strings.Repeat("cd", 32),
		YdocState: []byte("state"), StateVector: []byte("vector"), Prompt: []byte(validPrompt()),
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeDocumentFrozen {
		t.Fatalf("expected frozen initialization refusal, got %s", code)
	}
}

func TestCoeditWorkspaceUIOnlyStoreKeepsMaterializedRevisionAndAdvancesSequence(t *testing.T) {
	svc, mock := contractService(t)
	oldHash := coeditHash(strings.Repeat("ab", 32))
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_workspaces WHERE id = ?")).
		WithArgs("workspace-1").
		WillReturnRows(phase3WorkspaceRow(string(authoringcoedit.StateActive), 12, oldHash, 3, 9, nil, nil))
	mock.ExpectExec("UPDATE authoring_coedit_workspaces").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "active", 12, coeditLastActorID, "workspace-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CoeditWorkspaceStore(context.Background(), CoeditStoreRequest{
		DocumentName:      phase3WorkspaceName(t),
		PreviousStateHash: hex.EncodeToString(oldHash),
		StateHash:         strings.Repeat("cd", 32),
		YdocState:         []byte("state-2"),
		StateVector:       []byte("vector-2"),
		Workspace:         []byte(`{"ui/page":2}`),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.WorkspaceRevision != 12 || result.MaterializedRevision != 12 || result.CommitSequence != "10" {
		t.Fatalf("UI-only store changed the wrong counters: %+v", result)
	}
}

func TestCoeditWorkspaceFinalStoreRequiresOwnedFreezingRowAndLeavesFence(t *testing.T) {
	svc, mock := contractService(t)
	oldHash := coeditHash(strings.Repeat("ab", 32))
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_workspaces WHERE id = ?")).
		WithArgs("workspace-1").
		WillReturnRows(phase3WorkspaceRow(string(authoringcoedit.StateFreezing), 12, oldHash, 3, 9,
			phase3FreezeOperation, time.Now().Add(time.Minute)))
	mock.ExpectExec("UPDATE authoring_coedit_workspaces").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "freezing", 12,
			coeditLastActorID, "workspace-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CoeditWorkspaceFinalStore(context.Background(), CoeditStoreRequest{
		DocumentName: phase3WorkspaceName(t), PreviousStateHash: hex.EncodeToString(oldHash),
		StateHash: strings.Repeat("cd", 32), YdocState: []byte("final-state"), StateVector: []byte("final-vector"),
		Workspace: []byte(`{"ui/page":2}`), FreezeOperationID: phase3FreezeOperation,
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.WorkspaceRevision != 12 || result.CommitSequence != "10" || result.FreezeOperationID != phase3FreezeOperation {
		t.Fatalf("workspace final store changed the wrong state: %+v", result)
	}
}

func TestCoeditRebaseAdvancesEpochAndSequenceWithoutProjectionRevision(t *testing.T) {
	svc, mock := contractService(t)
	oldHash := coeditHash(strings.Repeat("ab", 32))
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditDocID).
		WillReturnRows(phase3DocumentRow(string(authoringcoedit.StateActive), 17, oldHash, 4, 21, nil, nil))
	mock.ExpectExec("UPDATE authoring_coedit_documents").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), coeditDocID, uint64(4), oldHash).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CoeditRebase(context.Background(), CoeditRebaseRequest{
		DocumentName:       coeditName(t, coeditDocID),
		ExpectedStateHash:  hex.EncodeToString(oldHash),
		ExpectedStateEpoch: "4",
		StateHash:          strings.Repeat("cd", 32),
		YdocState:          []byte("compacted-state"),
		StateVector:        []byte("compacted-vector"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.StateEpoch != "5" || result.CommitSequence != "22" || result.MaterializedRevision != 17 {
		t.Fatalf("rebase changed the wrong counters: %+v", result)
	}
}

func TestCoeditRebaseRejectsStaleEpochBeforeWrite(t *testing.T) {
	svc, mock := contractService(t)
	oldHash := coeditHash(strings.Repeat("ab", 32))
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditDocID).
		WillReturnRows(phase3DocumentRow(string(authoringcoedit.StateActive), 17, oldHash, 5, 22, nil, nil))
	mock.ExpectRollback()

	_, err := svc.CoeditRebase(context.Background(), CoeditRebaseRequest{
		DocumentName:       coeditName(t, coeditDocID),
		ExpectedStateHash:  hex.EncodeToString(oldHash),
		ExpectedStateEpoch: "4",
		StateHash:          strings.Repeat("cd", 32),
		YdocState:          []byte("compacted-state"), StateVector: []byte("compacted-vector"),
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeEpochMismatch {
		t.Fatalf("expected stale epoch, got %s", code)
	}
}

func TestCoeditWorkspaceRebasePreservesWorkspaceRevision(t *testing.T) {
	svc, mock := contractService(t)
	oldHash := coeditHash(strings.Repeat("ab", 32))
	begin(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_workspaces WHERE id = ?")).
		WithArgs("workspace-1").
		WillReturnRows(phase3WorkspaceRow(string(authoringcoedit.StateActive), 17, oldHash, 6, 10, nil, nil))
	mock.ExpectExec("UPDATE authoring_coedit_workspaces").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), "workspace-1", uint64(6), oldHash).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CoeditWorkspaceRebase(context.Background(), CoeditRebaseRequest{
		DocumentName: phase3WorkspaceName(t), ExpectedStateHash: hex.EncodeToString(oldHash),
		ExpectedStateEpoch: "6", StateHash: strings.Repeat("cd", 32),
		YdocState: []byte("compacted-state"), StateVector: []byte("compacted-vector"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if result.StateEpoch != "7" || result.CommitSequence != "11" || result.WorkspaceRevision != 17 {
		t.Fatalf("workspace rebase changed domain revision semantics: %+v", result)
	}
}

func TestCoeditRecoverExpiredFreezesExcludesFrozenRows(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectQuery("SELECT id FROM authoring_coedit_documents").
		WithArgs(string(authoringcoedit.StateFreezing)).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(coeditDocID))
	mock.ExpectExec("UPDATE authoring_coedit_documents").
		WithArgs("active", coeditDocID, "freezing").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	ids, err := svc.CoeditRecoverExpiredFreezes(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != coeditDocID {
		t.Fatalf("expected only the expired freezing row to recover, got %v", ids)
	}
}

func TestCoeditMarkFreezingMissingRowIsNotSilentlyIgnored(t *testing.T) {
	svc, mock := contractService(t)
	operation := authoringcoedit.CoeditLifecycleOperation{FreezeOperationID: phase3FreezeOperation, FreezeExpiresAt: time.Now().Add(time.Minute).Unix()}
	begin(mock)
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT lifecycle_state, freeze_operation_id").
		WithArgs(coeditDocID).
		WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	err := svc.CoeditMarkFreezing(context.Background(), []string{coeditDocID}, operation)
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeNotEditableDraft {
		t.Fatalf("expected missing-row error, got %s", code)
	}
}

func TestCoeditMarkFreezingDoesNotReopenOrReassertAnAmbiguousFrozenRow(t *testing.T) {
	svc, mock := contractService(t)
	operation := authoringcoedit.CoeditLifecycleOperation{FreezeOperationID: phase3FreezeOperation, FreezeExpiresAt: time.Now().Add(time.Minute).Unix()}
	begin(mock)
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("SELECT lifecycle_state, freeze_operation_id").
		WithArgs(coeditDocID).
		WillReturnRows(sqlmock.NewRows([]string{"lifecycle_state", "freeze_operation_id"}).AddRow("frozen", operation.FreezeOperationID))
	mock.ExpectRollback()

	err := svc.CoeditMarkFreezing(context.Background(), []string{coeditDocID}, operation)
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeFreezeConflict {
		t.Fatalf("expected ambiguous frozen-row conflict, got %s", code)
	}
}

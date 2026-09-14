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
	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// These tests pin the Go half of prompt co-editing: document creation and its
// uniqueness race, initialization compare-and-set, the atomic store (binary
// state + prompt + revision bump + event), the idempotent and previous-hash
// fenced replay paths, the partial non-prompt patch, freeze-manifest
// verification, lifecycle closure, and the legacy prompt-write guard.
//
// Every case drives the real SQL through sqlmock, so a changed query, argument
// order, or transaction boundary fails here rather than in production.

const (
	coeditDraftID    = "draft-1"
	coeditExamID     = "exam-1"
	coeditQuestionID = "eq-1"
	coeditRevisionID = "rev-1"
	coeditDocID      = "coedit-doc-1"
	// The staff user the room last resolved. A lifecycle flush carries no
	// actor, so the store attributes to this instead of losing the write.
	coeditLastActorID = "actor-last"
)

func coeditHash(hexValue string) []byte {
	decoded, err := hex.DecodeString(hexValue)
	if err != nil {
		panic(err)
	}
	return decoded
}

func coeditName(t *testing.T, id string) string {
	t.Helper()
	name, err := authoringcoedit.NewDocumentName(id)
	if err != nil {
		t.Fatal(err)
	}
	return string(name)
}

// coeditCodeOf extracts the typed co-edit domain code from a returned error.
func coeditCodeOf(t *testing.T, err error) authoringcoedit.DomainCode {
	t.Helper()
	if err == nil {
		t.Fatal("expected an error, got nil")
	}
	typed, ok := authoringcoedit.As(err)
	if !ok {
		t.Fatalf("expected a typed co-edit error, got %v", err)
	}
	return typed.Code
}

func coeditDocRow(state string, seed, materialized int, hash []byte, closedReason *string) *sqlmock.Rows {
	return coeditDocRowWithLastActor(state, seed, materialized, hash, closedReason, coeditLastActorID)
}

func coeditDocRowWithLastActor(
	state string,
	seed, materialized int,
	hash []byte,
	closedReason *string,
	lastActor any,
) *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{"id", "organization_id", "exam_id", "draft_version_id", "exam_question_id",
		"question_revision_id", "schema_version", "field_set", "lifecycle_state", "seed_revision",
		"materialized_revision", "ydoc_state", "state_vector", "state_hash", "previous_state_hash",
		"closed_reason", "last_actor_id", "updated_at"})
	var closed any
	if closedReason != nil {
		closed = *closedReason
	}
	var ydoc any
	if len(hash) > 0 {
		ydoc = []byte("committed-state")
	}
	rows.AddRow(coeditDocID, "org-1", coeditExamID, coeditDraftID, coeditQuestionID,
		coeditRevisionID, authoringcoedit.SchemaVersion, authoringcoedit.FieldSetPrompt, state, seed,
		materialized, ydoc, []byte("vector"), hash, nil, closed, lastActor, time.Now())
	return rows
}

// expectCoeditBinding answers resolveCoeditQuestionContext: the editable-draft
// binding read that locks the question, revision, module, section, version, and
// exam rows.
func expectCoeditBinding(mock sqlmock.Sqlmock, revision int, prompt string) {
	// `CAST(r.prompt AS CHAR)` arrives as raw bytes from the MySQL driver, so
	// the fake rows must carry []byte rather than a string.
	mock.ExpectQuery("FROM assessment_exam_questions eq").
		WithArgs(coeditQuestionID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "question_id", "question_revision_id", "module_id",
			"revision", "prompt", "id", "id", "organization_id"}).
			AddRow(coeditQuestionID, "q-1", coeditRevisionID, "mod-1", revision, []byte(prompt),
				coeditDraftID, coeditExamID, "org-1"))
}

// expectCoeditBindingCheck answers assertCoeditBindingLocked.
func expectCoeditBindingCheck(mock sqlmock.Sqlmock, draftVersionID, revisionID string, isDraft bool) {
	var revision any = revisionID
	if revisionID == "" {
		revision = nil
	}
	mock.ExpectQuery("SELECT e.current_draft_version_id, v.is_draft, eq.question_revision_id").
		WithArgs(coeditQuestionID).
		WillReturnRows(sqlmock.NewRows([]string{"current_draft_version_id", "is_draft", "question_revision_id"}).
			AddRow(draftVersionID, isDraft, revision))
}

func expectCoeditDocByID(mock sqlmock.Sqlmock, rows *sqlmock.Rows) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditDocID).
		WillReturnRows(rows)
}

func expectCoeditDocForScope(mock sqlmock.Sqlmock, rows *sqlmock.Rows) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents")).
		WithArgs(coeditDraftID, coeditQuestionID, authoringcoedit.SchemaVersion).
		WillReturnRows(rows)
}

func expectNoCoeditDocForScope(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents")).
		WithArgs(coeditDraftID, coeditQuestionID, authoringcoedit.SchemaVersion).
		WillReturnError(sql.ErrNoRows)
}

func expectNoCoeditDocByID(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM authoring_coedit_documents WHERE id = ?")).
		WithArgs(coeditDocID).
		WillReturnError(sql.ErrNoRows)
}

type duplicateKeyError struct{}

func (duplicateKeyError) Error() string {
	return "Error 1062: Duplicate entry for key 'uq_authoring_coedit_scope'"
}

// --- document creation -----------------------------------------------------

func TestCoeditEnsureDocumentCreatesRowForEditableDraft(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditBinding(mock, 4, validPrompt())
	expectNoCoeditDocForScope(mock)
	mock.ExpectExec("INSERT INTO authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	identity, err := svc.CoeditEnsureDocument(context.Background(), coeditQuestionID, "actor-1")
	if err != nil {
		t.Fatal(err)
	}
	if identity.LifecycleState != authoringcoedit.StateInitializing {
		t.Fatalf("a new document must start initializing, got %s", identity.LifecycleState)
	}
	if identity.SeedRevision != 4 || identity.MaterializedRevision != 4 {
		t.Fatalf("seed and materialized revision start at the seed revision, got %d/%d",
			identity.SeedRevision, identity.MaterializedRevision)
	}
	if identity.FieldSet != authoringcoedit.FieldSetPrompt || identity.SchemaVersion != authoringcoedit.SchemaVersion {
		t.Fatalf("unexpected identity: %+v", identity)
	}
	if _, _, err := authoringcoedit.ParseDocumentName(string(identity.DocumentName)); err != nil {
		t.Fatalf("document name must be an opaque coedit:v1 name, got %q", identity.DocumentName)
	}
}

func TestCoeditEnsureDocumentReturnsExistingDocumentWithoutRekey(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditBinding(mock, 4, validPrompt())
	expectCoeditDocForScope(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 7, coeditHash(strings.Repeat("ab", 32)), nil))
	mock.ExpectCommit()

	identity, err := svc.CoeditEnsureDocument(context.Background(), coeditQuestionID, "actor-1")
	if err != nil {
		t.Fatal(err)
	}
	if identity.MaterializedRevision != 7 {
		t.Fatalf("an existing document keeps its materialized revision, got %d", identity.MaterializedRevision)
	}
	if identity.DraftVersionID != coeditDraftID || identity.ExamQuestionID != coeditQuestionID {
		t.Fatalf("identity must carry the frozen scope, got %+v", identity)
	}
}

// A question outside the current editable draft can never be co-edited.
func TestCoeditEnsureDocumentRefusesQuestionOutsideEditableDraft(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectQuery("FROM assessment_exam_questions eq").WithArgs(coeditQuestionID).WillReturnError(sql.ErrNoRows)
	mock.ExpectRollback()

	_, err := svc.CoeditEnsureDocument(context.Background(), coeditQuestionID, "actor-1")
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeNotEditableDraft {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeNotEditableDraft, code)
	}
}

// The uniqueness race resolves by re-reading the winner: no second row, no
// second seed, no error surfaced to the author.
func TestCoeditEnsureDocumentResolvesInsertRace(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditBinding(mock, 4, validPrompt())
	expectNoCoeditDocForScope(mock)
	mock.ExpectExec("INSERT INTO authoring_coedit_documents").WillReturnError(duplicateKeyError{})
	expectCoeditDocForScope(mock, coeditDocRow(string(authoringcoedit.StateInitializing), 4, 4, nil, nil))
	mock.ExpectCommit()

	identity, err := svc.CoeditEnsureDocument(context.Background(), coeditQuestionID, "actor-1")
	if err != nil {
		t.Fatal(err)
	}
	if identity.LifecycleState != authoringcoedit.StateInitializing {
		t.Fatalf("the winner's row must be returned, got %s", identity.LifecycleState)
	}
}

func TestCoeditEnsureDocumentRefusesClosedDocument(t *testing.T) {
	reason := string(authoringcoedit.CloseQuestionDeleted)
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditBinding(mock, 4, validPrompt())
	expectCoeditDocForScope(mock, coeditDocRow(string(authoringcoedit.StateClosed), 4, 4, coeditHash(strings.Repeat("ab", 32)), &reason))
	mock.ExpectRollback()

	_, err := svc.CoeditEnsureDocument(context.Background(), coeditQuestionID, "actor-1")
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeDocumentClosed {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeDocumentClosed, code)
	}
}

func TestCoeditIdentityCarriesClosedReason(t *testing.T) {
	reason := authoringcoedit.CloseDraftReplaced
	document := CoeditDocument{
		ID:             coeditDocID,
		ExamID:         coeditExamID,
		DraftVersionID: coeditDraftID,
		ExamQuestionID: coeditQuestionID,
		SchemaVersion:  authoringcoedit.SchemaVersion,
		FieldSet:       authoringcoedit.FieldSetPrompt,
		LifecycleState: authoringcoedit.StateClosed,
		ClosedReason:   strPtr(string(reason)),
	}
	identity := coeditIdentityFromDocument(document)
	if identity.LifecycleState != authoringcoedit.StateClosed {
		t.Fatalf("expected closed state, got %s", identity.LifecycleState)
	}
	if identity.ClosedReason == nil || *identity.ClosedReason != reason {
		t.Fatalf("closed reason must round-trip, got %+v", identity.ClosedReason)
	}
	if identity.DocumentName != authoringcoedit.DocumentName(coeditName(t, coeditDocID)) {
		t.Fatalf("unexpected document name %q", identity.DocumentName)
	}
}

// --- load ------------------------------------------------------------------

func TestCoeditLoadReturnsSeedWhenNoBinaryStateExists(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateInitializing), 4, 4, nil, nil))
	mock.ExpectCommit()
	begin(mock)
	expectCoeditBinding(mock, 4, validPrompt())
	mock.ExpectCommit()

	result, err := svc.CoeditLoad(context.Background(), coeditName(t, coeditDocID))
	if err != nil {
		t.Fatal(err)
	}
	if result.Seed == nil {
		t.Fatal("a document without binary state must seed from the current prompt")
	}
	if string(result.Seed.Prompt) != validPrompt() {
		t.Fatalf("seed prompt mismatch: %s", result.Seed.Prompt)
	}
	if result.Seed.SeedRevision != 4 || result.Seed.QuestionRevision != 4 {
		t.Fatalf("unexpected seed revisions: %+v", result.Seed)
	}
	if len(result.YdocState) != 0 {
		t.Fatalf("expected no binary state, got %d bytes", len(result.YdocState))
	}
}

func TestCoeditLoadReturnsCommittedStateWithoutSeeding(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 6, coeditHash(strings.Repeat("ab", 32)), nil))
	mock.ExpectCommit()

	result, err := svc.CoeditLoad(context.Background(), coeditName(t, coeditDocID))
	if err != nil {
		t.Fatal(err)
	}
	if result.Seed != nil {
		t.Fatal("an existing document must never be re-seeded")
	}
	if result.StateHash != strings.Repeat("ab", 32) || result.MaterializedRevision != 6 {
		t.Fatalf("unexpected load result: %+v", result)
	}
}

func TestCoeditLoadRefusesClosedDocument(t *testing.T) {
	reason := string(authoringcoedit.CloseExamPublished)
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateClosed), 4, 4, coeditHash(strings.Repeat("ab", 32)), &reason))
	mock.ExpectCommit()

	_, err := svc.CoeditLoad(context.Background(), coeditName(t, coeditDocID))
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeDocumentClosed {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeDocumentClosed, code)
	}
}

func TestCoeditLoadRejectsClientInventedDocumentName(t *testing.T) {
	svc, _ := contractService(t)
	_, err := svc.CoeditLoad(context.Background(), "coedit:v1:not/a/name")
	if coeditCodeOf(t, err) != authoringcoedit.CodeNotEditableDraft {
		t.Fatalf("expected a refusal for an unparseable room name, got %v", err)
	}
}

// --- initialize ------------------------------------------------------------

// Seeding stores binary state and hash WITHOUT bumping the question revision:
// the materialized prompt is unchanged by seeding.
func TestCoeditInitializeStoresSeedWithoutRevisionBump(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateInitializing), 4, 4, nil, nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	expectCoeditBinding(mock, 4, validPrompt())
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CoeditInitialize(context.Background(), CoeditInitializeRequest{
		DocumentName: coeditName(t, coeditDocID),
		YdocState:    []byte("state"),
		StateVector:  []byte("vector"),
		StateHash:    strings.Repeat("ab", 32),
		Prompt:       []byte(validPrompt()),
		ActorID:      "actor-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Committed || result.Duplicate {
		t.Fatalf("a first seed commits exactly once, got %+v", result)
	}
	if result.MaterializedRevision != 4 {
		t.Fatalf("seeding must not bump the revision, got %d", result.MaterializedRevision)
	}
}

// Compare-and-set: an existing binary state means another seed won.
func TestCoeditInitializeOnExistingStateIsIdempotent(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 5, coeditHash(strings.Repeat("cd", 32)), nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	mock.ExpectCommit()

	result, err := svc.CoeditInitialize(context.Background(), CoeditInitializeRequest{
		DocumentName: coeditName(t, coeditDocID),
		YdocState:    []byte("state"),
		StateVector:  []byte("vector"),
		StateHash:    strings.Repeat("ab", 32),
		Prompt:       []byte(validPrompt()),
		ActorID:      "actor-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Duplicate || result.Committed {
		t.Fatalf("an existing binary state must win, got %+v", result)
	}
}

func TestCoeditInitializeRefusesSeedWhenRevisionMoved(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateInitializing), 4, 4, nil, nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	expectCoeditBinding(mock, 9, validPrompt())
	mock.ExpectRollback()

	_, err := svc.CoeditInitialize(context.Background(), CoeditInitializeRequest{
		DocumentName: coeditName(t, coeditDocID),
		YdocState:    []byte("state"),
		StateVector:  []byte("vector"),
		StateHash:    strings.Repeat("ab", 32),
		Prompt:       []byte(validPrompt()),
		ActorID:      "actor-1",
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeSeedConflict {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeSeedConflict, code)
	}
}

func TestCoeditInitializeRefusesUnknownDocument(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectNoCoeditDocByID(mock)
	mock.ExpectRollback()

	_, err := svc.CoeditInitialize(context.Background(), CoeditInitializeRequest{
		DocumentName: coeditName(t, coeditDocID),
		YdocState:    []byte("state"),
		StateHash:    strings.Repeat("ab", 32),
		Prompt:       []byte(validPrompt()),
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeNotEditableDraft {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeNotEditableDraft, code)
	}
}

// --- store -----------------------------------------------------------------

// The store commits binary state, the prompt projection, the question revision
// bump, and the content-free event in ONE transaction.
func TestCoeditStoreCommitsStatePromptRevisionAndEventTogether(t *testing.T) {
	svc, mock := contractService(t)
	svc = svc.SetLive("origin-test").SetEventsEnabled(true)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 4, coeditHash(strings.Repeat("ab", 32)), nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	expectQuestionDraft(mock, coeditQuestionID)
	mock.ExpectExec("UPDATE assessment_question_revisions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT revision FROM assessment_question_revisions WHERE id = ?").WithArgs(coeditRevisionID).
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(5))
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.organization_id, e.id, v.id, v.revision")).WithArgs(coeditQuestionID).
		WillReturnRows(sqlmock.NewRows([]string{"organization_id", "id", "id", "revision"}).AddRow("org-1", coeditExamID, coeditDraftID, 8))
	mock.ExpectQuery("SELECT question_id, module_id FROM assessment_exam_questions WHERE id = ?").WithArgs(coeditQuestionID).
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id"}).AddRow("q-1", "mod-1"))
	expectEventInsert(mock, "origin-test", coeditExamID, 8, string(authoringrealtime.KindQuestionChanged))
	mock.ExpectCommit()

	result, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		PreviousStateHash: strings.Repeat("ab", 32),
		StateHash:         strings.Repeat("cd", 32),
		YdocState:         []byte("state"),
		StateVector:       []byte("vector"),
		Prompt:            []byte(validPrompt()),
		ActorID:           "actor-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Committed || result.Duplicate {
		t.Fatalf("a fenced store commits, got %+v", result)
	}
	if result.MaterializedRevision != 5 {
		t.Fatalf("the acknowledgement carries the post-bump revision, got %d", result.MaterializedRevision)
	}
}

// Store is idempotent for a state hash that is already current: clients retry
// freely and a replayed ack never bumps a revision twice.
func TestCoeditStoreSameHashIsIdempotentWithoutRevisionBump(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	hash := strings.Repeat("ab", 32)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 7, coeditHash(hash), nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	mock.ExpectCommit()

	result, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		PreviousStateHash: hash,
		StateHash:         hash,
		YdocState:         []byte("state"),
		StateVector:       []byte("vector"),
		Prompt:            []byte(validPrompt()),
		ActorID:           "actor-1",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !result.Duplicate || result.Committed {
		t.Fatalf("a replay of the current hash must not commit again, got %+v", result)
	}
	if result.MaterializedRevision != 7 {
		t.Fatalf("an idempotent replay must not move the revision, got %d", result.MaterializedRevision)
	}
}

// A lifecycle flush (freeze/close) can store after the editor's connection
// context is gone, so the service sends no actor. That store must still commit
// and acknowledge: losing a durable write — or failing it because the authoring
// event needs an actor — is exactly the regression this pins.
func TestCoeditStoreWithoutActorAttributesToLastResolvedActor(t *testing.T) {
	svc, mock := contractService(t)
	svc = svc.SetLive("origin-test").SetEventsEnabled(true)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 4, coeditHash(strings.Repeat("ab", 32)), nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	expectQuestionDraft(mock, coeditQuestionID)
	mock.ExpectExec("UPDATE assessment_question_revisions").
		WithArgs(sqlmock.AnyArg(), coeditLastActorID, coeditRevisionID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT revision FROM assessment_question_revisions WHERE id = ?").WithArgs(coeditRevisionID).
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(5))
	mock.ExpectExec("UPDATE authoring_coedit_documents").
		WithArgs(sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), sqlmock.AnyArg(), 5, coeditLastActorID, coeditDocID).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.organization_id, e.id, v.id, v.revision")).WithArgs(coeditQuestionID).
		WillReturnRows(sqlmock.NewRows([]string{"organization_id", "id", "id", "revision"}).AddRow("org-1", coeditExamID, coeditDraftID, 8))
	mock.ExpectQuery("SELECT question_id, module_id FROM assessment_exam_questions WHERE id = ?").WithArgs(coeditQuestionID).
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id"}).AddRow("q-1", "mod-1"))
	expectEventInsert(mock, "origin-test", coeditExamID, 8, string(authoringrealtime.KindQuestionChanged))
	mock.ExpectCommit()

	result, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		PreviousStateHash: strings.Repeat("ab", 32),
		StateHash:         strings.Repeat("cd", 32),
		YdocState:         []byte("state"),
		StateVector:       []byte("vector"),
		Prompt:            []byte(validPrompt()),
		// No ActorID: a service-initiated flush has no connection context.
	})
	if err != nil {
		t.Fatalf("a store with no actor must commit, got %v", err)
	}
	if !result.Committed {
		t.Fatalf("expected a commit, got %+v", result)
	}
	if result.MaterializedRevision != 5 {
		t.Fatalf("the acknowledgement carries the post-bump revision, got %d", result.MaterializedRevision)
	}
}

// The degenerate case: a room no client ever authenticated has no authorship to
// publish. The store still commits and acknowledges; only the event is skipped,
// because an authoring event without a resolved staff actor cannot exist.
func TestCoeditStoreWithoutAnyKnownActorCommitsWithoutAnEvent(t *testing.T) {
	svc, mock := contractService(t)
	svc = svc.SetLive("origin-test").SetEventsEnabled(true)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRowWithLastActor(string(authoringcoedit.StateActive), 4, 4, coeditHash(strings.Repeat("ab", 32)), nil, nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	expectQuestionDraft(mock, coeditQuestionID)
	mock.ExpectExec("UPDATE assessment_question_revisions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery("SELECT revision FROM assessment_question_revisions WHERE id = ?").WithArgs(coeditRevisionID).
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(5))
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	result, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		PreviousStateHash: strings.Repeat("ab", 32),
		StateHash:         strings.Repeat("cd", 32),
		YdocState:         []byte("state"),
		StateVector:       []byte("vector"),
		Prompt:            []byte(validPrompt()),
	})
	if err != nil {
		t.Fatalf("an unattributable store must still commit, got %v", err)
	}
	if !result.Committed {
		t.Fatalf("expected a commit, got %+v", result)
	}
}

func TestCoeditStorePreviousHashMismatchIsRefused(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 7, coeditHash(strings.Repeat("ab", 32)), nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	mock.ExpectRollback()

	_, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		PreviousStateHash: strings.Repeat("ff", 32),
		StateHash:         strings.Repeat("cd", 32),
		YdocState:         []byte("state"),
		StateVector:       []byte("vector"),
		Prompt:            []byte(validPrompt()),
		ActorID:           "actor-1",
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodePreviousHashMismatch {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodePreviousHashMismatch, code)
	}
}

func TestCoeditStoreRefusesFrozenAndClosedDocuments(t *testing.T) {
	cases := []struct {
		state string
		code  authoringcoedit.DomainCode
	}{
		{string(authoringcoedit.StateFreezing), authoringcoedit.CodeDocumentFrozen},
		{string(authoringcoedit.StateFrozen), authoringcoedit.CodeDocumentFrozen},
		{string(authoringcoedit.StateClosed), authoringcoedit.CodeDocumentClosed},
	}
	for _, testCase := range cases {
		svc, mock := contractService(t)
		begin(mock)
		expectCoeditDocByID(mock, coeditDocRow(testCase.state, 4, 4, coeditHash(strings.Repeat("ab", 32)), nil))
		mock.ExpectRollback()

		_, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
			DocumentName:      coeditName(t, coeditDocID),
			PreviousStateHash: strings.Repeat("ab", 32),
			StateHash:         strings.Repeat("cd", 32),
			YdocState:         []byte("state"),
			StateVector:       []byte("vector"),
			Prompt:            []byte(validPrompt()),
			ActorID:           "actor-1",
		})
		if code := coeditCodeOf(t, err); code != testCase.code {
			t.Fatalf("state %s: expected %s, got %s", testCase.state, testCase.code, code)
		}
	}
}

// A draft that is no longer the current draft, or a question whose revision
// moved on, cannot accept collaborative state.
func TestCoeditStoreRefusesReplacedDraft(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 4, coeditHash(strings.Repeat("ab", 32)), nil))
	expectCoeditBindingCheck(mock, "draft-2", coeditRevisionID, true)
	mock.ExpectRollback()

	_, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		PreviousStateHash: strings.Repeat("ab", 32),
		StateHash:         strings.Repeat("cd", 32),
		YdocState:         []byte("state"),
		StateVector:       []byte("vector"),
		Prompt:            []byte(validPrompt()),
		ActorID:           "actor-1",
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeRevisionConflict {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeRevisionConflict, code)
	}
}

func TestCoeditStoreRefusesChangedRevisionMapping(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 4, coeditHash(strings.Repeat("ab", 32)), nil))
	expectCoeditBindingCheck(mock, coeditDraftID, "rev-2", true)
	mock.ExpectRollback()

	_, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName:      coeditName(t, coeditDocID),
		PreviousStateHash: strings.Repeat("ab", 32),
		StateHash:         strings.Repeat("cd", 32),
		YdocState:         []byte("state"),
		StateVector:       []byte("vector"),
		Prompt:            []byte(validPrompt()),
		ActorID:           "actor-1",
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeRevisionConflict {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeRevisionConflict, code)
	}
}

func TestCoeditStoreRejectsOversizedPayloadsBeforeAnyQuery(t *testing.T) {
	svc, _ := contractService(t)
	_, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName: coeditName(t, coeditDocID),
		StateHash:    strings.Repeat("ab", 32),
		YdocState:    make([]byte, authoringcoedit.MaxYdocStateBytes+1),
		Prompt:       []byte(validPrompt()),
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeOversized {
		t.Fatalf("expected %s for oversized binary state, got %s", authoringcoedit.CodeOversized, code)
	}

	_, err = svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName: coeditName(t, coeditDocID),
		StateHash:    strings.Repeat("ab", 32),
		YdocState:    []byte("state"),
		Prompt:       make([]byte, authoringcoedit.MaxPromptJSONBytes+1),
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeOversized {
		t.Fatalf("expected %s for an oversized materialized prompt, got %s", authoringcoedit.CodeOversized, code)
	}
}

func TestCoeditSizesRejectStateVectorBeyondColumn(t *testing.T) {
	err := validateCoeditSizes([]byte("state"), make([]byte, authoringcoedit.MaxStateVectorBytes+1), []byte("{}"))
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeOversized {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeOversized, code)
	}
}

func TestCoeditStoreRejectsMalformedStateHash(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateActive), 4, 4, nil, nil))
	expectCoeditBindingCheck(mock, coeditDraftID, coeditRevisionID, true)
	mock.ExpectRollback()

	_, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName: coeditName(t, coeditDocID),
		StateHash:    "not-a-hash",
		YdocState:    []byte("state"),
		Prompt:       []byte(validPrompt()),
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeRevisionConflict {
		t.Fatalf("expected %s for an invalid hash, got %s", authoringcoedit.CodeRevisionConflict, code)
	}
}

func TestCoeditStoreRejectsClientInventedDocumentName(t *testing.T) {
	svc, _ := contractService(t)
	_, err := svc.CoeditStore(context.Background(), CoeditStoreRequest{
		DocumentName: "exam-question:1",
		StateHash:    strings.Repeat("ab", 32),
		YdocState:    []byte("state"),
		Prompt:       []byte(validPrompt()),
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeNotEditableDraft {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeNotEditableDraft, code)
	}
}

func TestCoeditCausationIDIsBoundedAndContentFree(t *testing.T) {
	hash := coeditHash(strings.Repeat("ab", 32))
	causation := coeditCausationID(hash)
	if !strings.HasPrefix(causation, "coedit:") {
		t.Fatalf("unexpected causation id: %s", causation)
	}
	if len(causation) != len("coedit:")+16 {
		t.Fatalf("causation id must be a bounded prefix correlation value, got %q", causation)
	}
	if strings.Contains(causation, string(hash)) {
		t.Fatal("the full state hash must never reach the event payload")
	}
}

// --- freeze manifest and lifecycle -----------------------------------------

func TestCoeditVerifyManifestAcceptsMatchingHashes(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateFrozen), 4, 6, coeditHash(strings.Repeat("ab", 32)), nil))
	mock.ExpectCommit()

	err := svc.CoeditVerifyManifest(context.Background(), []authoringcoedit.FreezeManifestEntry{{
		DocumentName:         coeditName(t, coeditDocID),
		StateHash:            strings.Repeat("AB", 32),
		MaterializedRevision: 6,
	}})
	if err != nil {
		t.Fatal(err)
	}
}

// A manifest claiming a state MySQL never committed is the split-room
// condition: publish must halt.
func TestCoeditVerifyManifestRejectsMismatchedHash(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateFrozen), 4, 6, coeditHash(strings.Repeat("ab", 32)), nil))
	mock.ExpectCommit()

	err := svc.CoeditVerifyManifest(context.Background(), []authoringcoedit.FreezeManifestEntry{{
		DocumentName: coeditName(t, coeditDocID),
		StateHash:    strings.Repeat("ff", 32),
	}})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeRevisionConflict {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeRevisionConflict, code)
	}
}

func TestCoeditVerifyManifestRejectsStaleMaterializedRevision(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	expectCoeditDocByID(mock, coeditDocRow(string(authoringcoedit.StateFrozen), 4, 6, coeditHash(strings.Repeat("ab", 32)), nil))
	mock.ExpectCommit()

	err := svc.CoeditVerifyManifest(context.Background(), []authoringcoedit.FreezeManifestEntry{{
		DocumentName:         coeditName(t, coeditDocID),
		StateHash:            strings.Repeat("ab", 32),
		MaterializedRevision: 9,
	}})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeRevisionConflict {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeRevisionConflict, code)
	}
}

func TestCoeditVerifyManifestRejectsUnknownDocumentName(t *testing.T) {
	svc, _ := contractService(t)
	err := svc.CoeditVerifyManifest(context.Background(), []authoringcoedit.FreezeManifestEntry{{
		DocumentName: "coedit:v1:",
		StateHash:    strings.Repeat("ab", 32),
	}})
	if coeditCodeOf(t, err) != authoringcoedit.CodeSignatureInvalid {
		t.Fatalf("expected %s, got %v", authoringcoedit.CodeSignatureInvalid, err)
	}
}

func TestCoeditMarkFreezingAndReopenAreIdempotent(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	if err := svc.CoeditMarkFreezing(context.Background(), []string{coeditDocID, "other"}); err != nil {
		t.Fatal(err)
	}

	begin(mock)
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	if err := svc.CoeditReopenActive(context.Background(), []string{coeditDocID}); err != nil {
		t.Fatal(err)
	}

	if svc.CoeditMarkFreezing(context.Background(), nil) != nil {
		t.Fatal("an empty freeze set must be a no-op")
	}
}

func TestCoeditCloseDocumentsRequiresClosedVocabulary(t *testing.T) {
	svc, _ := contractService(t)
	err := svc.CoeditCloseDocuments(context.Background(), []string{coeditDocID}, authoringcoedit.CloseReason("nonsense"))
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeDisabled {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeDisabled, code)
	}
}

func TestCoeditCloseDocumentsWritesReasonAndTimestamp(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectExec(regexp.QuoteMeta("SET lifecycle_state = ?, closed_reason = ?, closed_at = NOW(6), updated_at = NOW(6)")).
		WithArgs(string(authoringcoedit.StateClosed), string(authoringcoedit.CloseQuestionDeleted),
			coeditDocID, string(authoringcoedit.StateClosed)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := svc.CoeditCloseDocuments(context.Background(), []string{coeditDocID}, authoringcoedit.CloseQuestionDeleted); err != nil {
		t.Fatal(err)
	}
}

func TestCoeditActiveForQuestionIgnoresClosedRows(t *testing.T) {
	svc, mock := contractService(t)
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(coeditQuestionID, string(authoringcoedit.StateClosed), coeditQuestionID, string(authoringcoedit.StateClosed)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	active, err := svc.CoeditActiveForQuestion(context.Background(), coeditQuestionID)
	if err != nil {
		t.Fatal(err)
	}
	if !active {
		t.Fatal("an unclosed row means the question is actively co-edited")
	}
}

func TestCoeditActiveDocumentsListsUnclosedRowsForDraft(t *testing.T) {
	svc, mock := contractService(t)
	mock.ExpectQuery("FROM authoring_coedit_documents").
		WithArgs(coeditDraftID, string(authoringcoedit.StateClosed)).
		WillReturnRows(coeditDocRow(string(authoringcoedit.StateActive), 4, 4, nil, nil))
	docs, err := svc.CoeditActiveDocuments(context.Background(), coeditDraftID)
	if err != nil {
		t.Fatal(err)
	}
	if len(docs) != 1 || docs[0].ID != coeditDocID {
		t.Fatalf("expected the unclosed document, got %+v", docs)
	}
}

func TestCoeditCloseByScopeClosesEveryUnclosedDocument(t *testing.T) {
	svc, mock := contractService(t)
	mock.ExpectQuery("FROM authoring_coedit_documents").
		WithArgs(coeditDraftID, string(authoringcoedit.StateClosed)).
		WillReturnRows(coeditDocRow(string(authoringcoedit.StateActive), 4, 4, nil, nil))
	begin(mock)
	mock.ExpectExec("UPDATE authoring_coedit_documents").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	ids, err := svc.CoeditCloseByScope(context.Background(), coeditDraftID, authoringcoedit.CloseDraftReplaced)
	if err != nil {
		t.Fatal(err)
	}
	if len(ids) != 1 || ids[0] != coeditDocID {
		t.Fatalf("expected the closed document id, got %v", ids)
	}
}

// --- partial non-prompt patch ----------------------------------------------

func TestPatchRevisionFieldsWritesOnlyAllowListedFields(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectQuery("SELECT eq.id FROM assessment_exam_questions eq").WithArgs(coeditRevisionID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(coeditQuestionID))
	expectQuestionDraft(mock, coeditQuestionID)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT revision FROM assessment_question_revisions WHERE id = ? FOR UPDATE")).WithArgs(coeditRevisionID).
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(3))
	// `prompt` is structurally absent from the patch, so the generated UPDATE
	// cannot carry it even if a caller wanted one.
	mock.ExpectExec("UPDATE assessment_question_revisions SET stimulus = \\?").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(questionDetailQuery)).WithArgs(coeditQuestionID).
		WillReturnRows(detailRows(coeditQuestionID, 4))
	mock.ExpectCommit()

	stimulus := `{"version":1,"nodes":[{"type":"paragraph","id":"s1","text":"New stimulus"}]}`
	if _, err := svc.PatchRevisionFields(context.Background(), coeditRevisionID, "actor-1", 3,
		CoeditFieldPatchFromRequest(nil, []byte(stimulus), nil, nil, nil, nil)); err != nil {
		t.Fatal(err)
	}
}

func TestPatchRevisionFieldsRejectsStaleRevision(t *testing.T) {
	svc, mock := contractService(t)
	begin(mock)
	mock.ExpectQuery("SELECT eq.id FROM assessment_exam_questions eq").WithArgs(coeditRevisionID).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow(coeditQuestionID))
	expectQuestionDraft(mock, coeditQuestionID)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT revision FROM assessment_question_revisions WHERE id = ? FOR UPDATE")).WithArgs(coeditRevisionID).
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(9))
	mock.ExpectRollback()

	stimulus := `{"version":1,"nodes":[{"type":"paragraph","id":"s1","text":"New stimulus"}]}`
	_, err := svc.PatchRevisionFields(context.Background(), coeditRevisionID, "actor-1", 3,
		CoeditFieldPatchFromRequest(nil, []byte(stimulus), nil, nil, nil, nil))
	if code := codeOf(err); code == "" {
		t.Fatalf("expected a typed conflict on a stale revision, got %v", err)
	}
}

func TestPatchRevisionFieldsRequiresAtLeastOneField(t *testing.T) {
	svc, _ := contractService(t)
	_, err := svc.PatchRevisionFields(context.Background(), coeditRevisionID, "actor-1", 3, CoeditFieldPatch{})
	if code := codeOf(err); code == "" {
		t.Fatalf("expected a validation error for an empty patch, got %v", err)
	}
}

func TestCoeditFieldPatchPresenceIsAllowListDriven(t *testing.T) {
	if (CoeditFieldPatch{}).Present() {
		t.Fatal("an empty patch must not be present")
	}
	questionType := "student_produced_response"
	patch := CoeditFieldPatchFromRequest(&questionType, nil, nil, nil, nil, nil)
	if !patch.Present() || patch.QuestionType == nil || *patch.QuestionType != questionType {
		t.Fatalf("questionType alone is a present field, got %+v", patch)
	}
}

// --- legacy prompt-write guard --------------------------------------------

func TestLegacyPromptWriteGuardRefusesWhileCoeditIsActive(t *testing.T) {
	svc, mock := contractService(t)
	svc = svc.SetCoeditEnabled(true)
	begin(mock)
	mock.ExpectQuery("SELECT COUNT\\(\\*\\) FROM authoring_coedit_documents").
		WithArgs(coeditQuestionID, string(authoringcoedit.StateClosed)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	mock.ExpectRollback()

	err := svc.runner.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return svc.coeditGuardTx(ctx, q, coeditQuestionID, defaultSATQuestionDraft(SectionReadingWriting))
	})
	if code := coeditCodeOf(t, err); code != authoringcoedit.CodeActiveConflict {
		t.Fatalf("expected %s, got %s", authoringcoedit.CodeActiveConflict, code)
	}
}

func TestLegacyPromptWriteGuardIsSkippedWhenGatedOff(t *testing.T) {
	svc, mock := contractService(t)
	draft := defaultSATQuestionDraft(SectionReadingWriting)
	if err := svc.CoeditGuardLegacyPromptWrite(context.Background(), coeditQuestionID, draft); err != nil {
		t.Fatalf("flag-off must issue no query and never refuse: %v", err)
	}
	begin(mock)
	mock.ExpectCommit()
	if err := svc.runner.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return svc.coeditGuardTx(ctx, q, coeditQuestionID, draft)
	}); err != nil {
		t.Fatalf("flag-off in-tx guard must be a no-op: %v", err)
	}
	if svc.CoeditEnabled() {
		t.Fatal("co-editing must default to disabled")
	}
}

func TestLegacyPromptWriteGuardAllowsNonPromptDraft(t *testing.T) {
	svc, mock := contractService(t)
	svc = svc.SetCoeditEnabled(true)
	draft := defaultSATQuestionDraft(SectionReadingWriting)
	draft.Prompt = nil
	begin(mock)
	mock.ExpectCommit()
	if err := svc.runner.WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		return svc.coeditGuardTx(ctx, q, coeditQuestionID, draft)
	}); err != nil {
		t.Fatalf("a non-prompt write must not consult the co-edit row: %v", err)
	}
}

func TestCoeditGuardPreCheckAcceptsWhenNoRowExists(t *testing.T) {
	svc, mock := contractService(t)
	svc = svc.SetCoeditEnabled(true)
	mock.ExpectQuery("SELECT COUNT").
		WithArgs(coeditQuestionID, string(authoringcoedit.StateClosed), coeditQuestionID, string(authoringcoedit.StateClosed)).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	if err := svc.CoeditGuardLegacyPromptWrite(context.Background(), coeditQuestionID, defaultSATQuestionDraft(SectionReadingWriting)); err != nil {
		t.Fatal(err)
	}
}

// --- wire contract ---------------------------------------------------------

// Every domain code maps to a stable HTTP status and a stable app code: the
// service and the browser both branch on these.
func coeditCodeIsRegistered(code authoringcoedit.DomainCode) bool {
	for _, registered := range authoringcoedit.AllDomainCodes {
		if registered == code {
			return true
		}
	}
	return false
}

func TestCoeditErrorCodesMapToStableHTTPStatuses(t *testing.T) {
	cases := []struct {
		code   authoringcoedit.DomainCode
		status int
	}{
		{authoringcoedit.CodeDocumentClosed, 410},
		{authoringcoedit.CodeDocumentFrozen, 409},
		{authoringcoedit.CodePreviousHashMismatch, 409},
		{authoringcoedit.CodeSeedConflict, 409},
		{authoringcoedit.CodeActiveConflict, 409},
		{authoringcoedit.CodeRevisionConflict, 409},
		{authoringcoedit.CodeOversized, 413},
		{authoringcoedit.CodeNotEditableDraft, 404},
		{authoringcoedit.CodeSignatureInvalid, 404},
		{authoringcoedit.CodePermissionDenied, 403},
		{authoringcoedit.CodeServiceUnavailable, 503},
		{authoringcoedit.CodeDisabled, 503},
	}
	for _, testCase := range cases {
		appErr := authoringcoedit.New(testCase.code, "test").ToAppError()
		if appErr.HTTPStatus != testCase.status {
			t.Fatalf("%s: expected HTTP %d, got %d", testCase.code, testCase.status, appErr.HTTPStatus)
		}
		if reason, _ := appErr.Details["coeditReason"].(string); reason != string(testCase.code) {
			t.Fatalf("%s: expected details.coeditReason, got %v", testCase.code, appErr.Details)
		}
		if !coeditCodeIsRegistered(testCase.code) {
			t.Fatalf("%s must be part of the frozen code vocabulary", testCase.code)
		}
	}
}

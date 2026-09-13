package authoring

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/authoringrealtime"
	"example.com/ielts-proctoring/internal/platform/apperrors"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// eventService builds a service with events ENABLED and a live origin so the
// Phase 02 append paths run. Flag-off parity is covered separately.
func eventService(t *testing.T) (*Service, sqlmock.Sqlmock) {
	t.Helper()
	svc, mock := contractService(t)
	return svc.SetLive("origin-test").SetEventsEnabled(true), mock
}

// expectEventInsert asserts exactly one authoring bus row. The mapping under
// test is EXAM-scoped: target = examId, revision = draftRevision, name = kind.
func expectEventInsert(mock sqlmock.Sqlmock, origin, examID string, draftRev int, kind string) {
	mock.ExpectExec("INSERT INTO live_update_events").WithArgs(
		origin, authoringrealtime.BusEventKind, examID, draftRev, kind, sqlmock.AnyArg(),
	).WillReturnResult(sqlmock.NewResult(1, 1))
}

// --- transactional atomicity: the bus row must participate in the SAME tx ---

func TestSaveRevisionAppendsExactlyOneEvent(t *testing.T) {
	svc, mock := eventService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT question_revision_id FROM assessment_exam_questions").WithArgs("eq-1").WillReturnRows(sqlmock.NewRows([]string{"question_revision_id"}).AddRow("rev-1"))
	mock.ExpectQuery("SELECT revision, state FROM assessment_question_revisions").WithArgs("rev-1").WillReturnRows(sqlmock.NewRows([]string{"revision", "state"}).AddRow(3, "draft"))
	mock.ExpectExec("UPDATE assessment_question_revisions SET .*revision = revision \\+ 1, state = 'draft'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(questionDetailQuery)).WithArgs("eq-1").WillReturnRows(detailRows("eq-1", 4))
	// Scope resolution runs after touchQuestionDraft bumped the draft to 8.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.organization_id, e.id, v.id, v.revision")).WithArgs("eq-1").
		WillReturnRows(sqlmock.NewRows([]string{"organization_id", "id", "id", "revision"}).AddRow("org-1", "exam-1", "draft-1", 8))
	expectEventInsert(mock, "origin-test", "exam-1", 8, string(authoringrealtime.KindQuestionChanged))
	mock.ExpectCommit()
	if _, err := svc.SaveRevision(context.Background(), "eq-1", "rev-1", 3, defaultSATQuestionDraft(SectionReadingWriting), "actor-1"); err != nil {
		t.Fatal(err)
	}
}

// TestAppendThenLaterFailureRollsBackTheEvent is the test that actually proves
// the bus row is in the same transaction: the domain writes AND the event
// INSERT all succeed, a LATER statement fails, and the whole tx rolls back.
// A failure BEFORE the append would prove nothing about atomicity.
//
// CreateQuestion with an operation key is the natural carrier: the append
// happens in-tx and storeOperationResult (UPDATE authoring_operation_keys)
// is the statement that fails after it.
func TestAppendThenLaterFailureRollsBackTheEvent(t *testing.T) {
	svc, mock := eventService(t)
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
	// 1. the event INSERT SUCCEEDS (scope read, then the bus row).
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.organization_id, e.id, v.id, v.revision")).WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"organization_id", "id", "id", "revision"}).AddRow("org-1", "exam-1", "draft-1", 8))
	expectEventInsert(mock, "origin-test", "exam-1", 8, string(authoringrealtime.KindQuestionCreated))
	// 2. a LATER statement in the same tx fails.
	mock.ExpectExec("UPDATE authoring_operation_keys SET result_json").WillReturnError(errBusDown())
	// 3. therefore the tx ROLLS BACK and the bus row must not survive.
	mock.ExpectRollback()
	_, err := svc.CreateQuestion(context.Background(), "mod-1", "actor", QuestionDraft{QuestionType: "single_choice"}, WithOperationKey("key-1"))
	if err == nil {
		t.Fatal("a later failure must fail the mutation")
	}
}

func TestCommitFailureLeavesNoEvent(t *testing.T) {
	svc, mock := eventService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT question_revision_id FROM assessment_exam_questions").WithArgs("eq-1").WillReturnRows(sqlmock.NewRows([]string{"question_revision_id"}).AddRow("rev-1"))
	mock.ExpectQuery("SELECT revision, state FROM assessment_question_revisions").WithArgs("rev-1").WillReturnRows(sqlmock.NewRows([]string{"revision", "state"}).AddRow(3, "draft"))
	mock.ExpectExec("UPDATE assessment_question_revisions SET .*revision = revision \\+ 1, state = 'draft'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(questionDetailQuery)).WithArgs("eq-1").WillReturnRows(detailRows("eq-1", 4))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.organization_id, e.id, v.id, v.revision")).WithArgs("eq-1").
		WillReturnRows(sqlmock.NewRows([]string{"organization_id", "id", "id", "revision"}).AddRow("org-1", "exam-1", "draft-1", 8))
	expectEventInsert(mock, "origin-test", "exam-1", 8, string(authoringrealtime.KindQuestionChanged))
	mock.ExpectCommit().WillReturnError(errBusDown())
	if _, err := svc.SaveRevision(context.Background(), "eq-1", "rev-1", 3, defaultSATQuestionDraft(SectionReadingWriting), "actor-1"); err == nil {
		t.Fatal("a COMMIT failure must surface: the event row did not durably commit")
	}
}

func TestFencedSaveAppendsNoEvent(t *testing.T) {
	svc, mock := eventService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT question_revision_id FROM assessment_exam_questions").WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("rev-1"))
	mock.ExpectQuery("SELECT revision, state FROM assessment_question_revisions").WillReturnRows(sqlmock.NewRows([]string{"revision", "state"}).AddRow(4, "draft"))
	mock.ExpectRollback()
	// No bus expectation is set: any INSERT attempt would fail the test.
	if _, err := svc.SaveRevision(context.Background(), "eq-1", "rev-1", 3, QuestionDraft{}, "actor-1"); codeOf(err) != apperrors.CodeConflict {
		t.Fatalf("wanted stale conflict, got %v", err)
	}
}

func TestPublishFailureRollsBackTheMutation(t *testing.T) {
	svc, mock := eventService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT question_revision_id FROM assessment_exam_questions").WithArgs("eq-1").WillReturnRows(sqlmock.NewRows([]string{"question_revision_id"}).AddRow("rev-1"))
	mock.ExpectQuery("SELECT revision, state FROM assessment_question_revisions").WithArgs("rev-1").WillReturnRows(sqlmock.NewRows([]string{"revision", "state"}).AddRow(3, "draft"))
	mock.ExpectExec("UPDATE assessment_question_revisions SET .*revision = revision \\+ 1, state = 'draft'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(questionDetailQuery)).WithArgs("eq-1").WillReturnRows(detailRows("eq-1", 4))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.organization_id, e.id, v.id, v.revision")).WithArgs("eq-1").
		WillReturnRows(sqlmock.NewRows([]string{"organization_id", "id", "id", "revision"}).AddRow("org-1", "exam-1", "draft-1", 8))
	mock.ExpectExec("INSERT INTO live_update_events").WillReturnError(errBusDown())
	mock.ExpectRollback()
	_, err := svc.SaveRevision(context.Background(), "eq-1", "rev-1", 3, defaultSATQuestionDraft(SectionReadingWriting), "actor-1")
	if err == nil {
		t.Fatal("an append failure must fail the mutation")
	}
	if !authoringrealtime.IsPublishError(err) {
		t.Fatalf("append failure must classify as publish error, got %v", err)
	}
}

// --- flag semantics ---

func TestFlagOffIsByteIdenticalLegacyBehavior(t *testing.T) {
	// No SetLive/SetEventsEnabled: the append path and its extra scope read
	// must never run, so only the legacy statements are expected.
	svc, mock := contractService(t)
	begin(mock)
	expectQuestionDraft(mock, "eq-1")
	mock.ExpectQuery("SELECT question_revision_id FROM assessment_exam_questions").WithArgs("eq-1").WillReturnRows(sqlmock.NewRows([]string{"question_revision_id"}).AddRow("rev-1"))
	mock.ExpectQuery("SELECT revision, state FROM assessment_question_revisions").WithArgs("rev-1").WillReturnRows(sqlmock.NewRows([]string{"revision", "state"}).AddRow(3, "draft"))
	mock.ExpectExec("UPDATE assessment_question_revisions SET .*revision = revision \\+ 1, state = 'draft'").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta(questionDetailQuery)).WithArgs("eq-1").WillReturnRows(detailRows("eq-1", 4))
	mock.ExpectCommit()
	if _, err := svc.SaveRevision(context.Background(), "eq-1", "rev-1", 3, defaultSATQuestionDraft(SectionReadingWriting), "actor-1"); err != nil {
		t.Fatal(err)
	}
}

// TestFlagOnWithoutBusFailsStartup pins the fail-closed wiring rule: a flag-on
// process with no live bus must refuse to boot rather than silently degrade.
func TestFlagOnWithoutBusFailsStartup(t *testing.T) {
	if err := authoringrealtime.ValidateEmitterConfig(true, "  "); err == nil {
		t.Fatal("flag on + no bus origin must be a startup error")
	}
	if err := authoringrealtime.ValidateEmitterConfig(false, ""); err != nil {
		t.Fatalf("flag off is a safe legacy posture, got %v", err)
	}
	if err := authoringrealtime.ValidateEmitterConfig(true, "origin-1"); err != nil {
		t.Fatalf("flag on + a valid origin must boot, got %v", err)
	}
}

// --- payload guarantees ---

func TestPayloadCarriesNoContent(t *testing.T) {
	evt, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
		Kind:           authoringrealtime.KindQuestionChanged,
		OrganizationID: strPtr("org-1"),
		ExamID:         "exam-1",
		DraftVersionID: "draft-1",
		DraftRevision:  194,
		Revision:       8,
		ActorID:        "actor-1",
		Entity: authoringrealtime.Entity{
			Kind:           authoringrealtime.EntityQuestion,
			ExamQuestionID: "eq-1",
			QuestionID:     strPtr("q-1"),
			ModuleID:       strPtr("mod-1"),
		},
		ChangedFields: authoringrealtime.NewChangedFields("prompt", "answer"),
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(evt)
	var wire map[string]any
	if err := json.Unmarshal(raw, &wire); err != nil {
		t.Fatal(err)
	}
	for _, banned := range []string{"stimulus", "prompt", "answer", "answer_definition", "rationale", "metadata", "accessibility", "dataBase64", "displayName", "email"} {
		if _, present := wire[banned]; present {
			t.Fatalf("payload must not carry a %s key: %s", banned, raw)
		}
	}
	if len(raw) > authoringrealtime.MaxPayloadBytes {
		t.Fatalf("payload %d exceeds cap %d", len(raw), authoringrealtime.MaxPayloadBytes)
	}
	if !strings.Contains(string(raw), "\"draftVersionId\":\"draft-1\"") {
		t.Fatal("payload must carry the draft scope")
	}
	if !strings.Contains(string(raw), "\"draftRevision\":194") {
		t.Fatal("payload must carry draftRevision separately from revision")
	}
}

// TestTwoRevisionsStaySeparate pins the review's distinction: an entity fence
// and a working-draft generation are different numbers on the same envelope.
func TestTwoRevisionsStaySeparate(t *testing.T) {
	evt, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
		Kind:           authoringrealtime.KindQuestionChanged,
		ExamID:         "exam-1",
		DraftVersionID: "draft-1",
		Revision:       8,   // Question 14 revision 8
		DraftRevision:  194, // whole working draft generation 194
		ActorID:        "actor-1",
		Entity:         authoringrealtime.Entity{Kind: authoringrealtime.EntityQuestion, ExamQuestionID: "eq-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if evt.Revision != 8 || evt.DraftRevision != 194 {
		t.Fatalf("revisions collapsed: %+v", evt)
	}
}

// TestPlatformScopeIsNullNotEmpty pins the explicit modeling rule: platform
// exams serialize organizationId as null, never as an empty string.
func TestPlatformScopeIsNullNotEmpty(t *testing.T) {
	evt, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
		Kind:           authoringrealtime.KindDraftOpened,
		OrganizationID: nil, // platform scope
		ExamID:         "exam-1",
		DraftVersionID: "draft-1",
		DraftRevision:  1,
		ActorID:        "actor-1",
		Entity:         authoringrealtime.Entity{Kind: authoringrealtime.EntityDraft, ExamID: "exam-1", DraftVersionID: "draft-1"},
	})
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(evt)
	if !strings.Contains(string(raw), "\"organizationId\":null") {
		t.Fatalf("platform scope must serialize as null: %s", raw)
	}
}

// TestProducerRejectsUnknownKindWhileReaderToleratesIt pins the split:
// producers emit only current vocabulary; readers survive vocabulary growth.
func TestProducerRejectsUnknownKindWhileReaderToleratesIt(t *testing.T) {
	_, err := authoringrealtime.NewEvent(authoringrealtime.EventInput{
		Kind:           authoringrealtime.Kind("question.teleported"),
		ExamID:         "exam-1",
		DraftVersionID: "draft-1",
		ActorID:        "actor-1",
		Entity:         authoringrealtime.Entity{Kind: authoringrealtime.EntityQuestion, ExamQuestionID: "eq-1"},
	})
	if err == nil {
		t.Fatal("a producer must reject an unknown kind")
	}
	// The same envelope read by a client is structurally valid and unknown.
	reader := authoringrealtime.Event{
		Version:    authoringrealtime.Version,
		Kind:       authoringrealtime.Kind("question.teleported"),
		EventID:    "evt-1",
		OccurredAt: time.Unix(0, 0).UTC(),
		Actor:      authoringrealtime.Actor{ID: "actor-1", Kind: "staff"},
		Scope:      authoringrealtime.Scope{ExamID: "exam-1", DraftVersionID: "draft-1"},
		Entity:     authoringrealtime.Entity{Kind: authoringrealtime.EntityQuestion, ExamQuestionID: "eq-1"},
	}
	if err := reader.ValidateEnvelope(); err != nil {
		t.Fatalf("a reader must tolerate an unknown future kind: %v", err)
	}
}

// TestChangedFieldsAreNamesOnly pins the producer allow-list: content can
// never ride along in the hint list.
func TestChangedFieldsAreNamesOnly(t *testing.T) {
	got := authoringrealtime.NewChangedFields("prompt", "SECRET ANSWER TEXT", "answer")
	if len(got) != 2 || got[0] != "prompt" || got[1] != "answer" {
		t.Fatalf("unknown names must be dropped, got %v", got)
	}
}

// TestDraftRevisionIsNotMonotonicAcrossUndo documents the invariant that
// makes sequence_id the only ordering key: Undo restores an older generation.
func TestDraftRevisionIsNotMonotonicAcrossUndo(t *testing.T) {
	before := authoringrealtime.Event{DraftRevision: 93}
	afterUndo := authoringrealtime.Event{DraftRevision: 41}
	if afterUndo.DraftRevision >= before.DraftRevision {
		t.Fatal("this test documents that Undo moves draftRevision BACKWARDS")
	}
	// Ordering must therefore come from the transport cursor alone.
	if !authoringrealtime.ShouldProcessCursor(40, 900) {
		t.Fatal("any cursor greater than the last processed one must be accepted")
	}
}

// errBusDown simulates an infrastructure failure inside the tx.
func errBusDown() error { return errors.New("bus unavailable") }

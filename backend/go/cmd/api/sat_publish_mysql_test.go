package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/objectstore"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

type satPublishModuleFixture struct {
	id, sectionKey, moduleKey string
	questions                 []string
}

type satPublishFixture struct {
	h             *concurrencyHarness
	draftID       string
	draftRevision int
	examRevision  int
	modules       []satPublishModuleFixture
}

func newSATPublishFixture(t *testing.T, customTarget bool) *satPublishFixture {
	t.Helper()
	h := newConcurrencyHarness(t)
	ctx := context.Background()
	shell, err := h.authors.Shell(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	rows, err := h.db.QueryContext(ctx, `
		SELECT m.id, s.section_key, m.module_key
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order, m.display_order, m.id`, shell.VersionID)
	if err != nil {
		t.Fatal(err)
	}
	modules := make([]satPublishModuleFixture, 0, 6)
	for rows.Next() {
		var module satPublishModuleFixture
		if err := rows.Scan(&module.id, &module.sectionKey, &module.moduleKey); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		modules = append(modules, module)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	if len(modules) == 0 {
		t.Fatal("SAT draft has no normalized modules")
	}

	for index := range modules {
		target := 1
		if customTarget && index == 0 {
			target = 2
		}
		if _, err := h.db.ExecContext(ctx, "UPDATE assessment_modules SET target_question_count = ? WHERE id = ?", target, modules[index].id); err != nil {
			t.Fatal(err)
		}
		questionCount := target
		for questionIndex := 0; questionIndex < questionCount; questionIndex++ {
			draft := validSATPublishQuestion()
			if customTarget && index == 0 && questionIndex == 1 {
				draft = validSATPublishSPR()
			}
			created, err := h.authors.CreateQuestion(ctx, modules[index].id, h.actor, draft)
			if err != nil {
				t.Fatalf("create valid SAT question in %s.%s: %v", modules[index].sectionKey, modules[index].moduleKey, err)
			}
			modules[index].questions = append(modules[index].questions, created.ExamQuestionID)
		}
	}

	shell, err = h.authors.Shell(ctx, h.examID)
	if err != nil {
		t.Fatal(err)
	}
	var examRevision int
	if err := h.db.QueryRowContext(ctx, "SELECT revision FROM exam_entities WHERE id = ?", h.examID).Scan(&examRevision); err != nil {
		t.Fatal(err)
	}
	return &satPublishFixture{
		h:             h,
		draftID:       shell.VersionID,
		draftRevision: shell.VersionRevision,
		examRevision:  examRevision,
		modules:       modules,
	}
}

func validSATPublishQuestion() authoring.QuestionDraft {
	return authoring.QuestionDraft{
		QuestionType: "single_choice",
		Prompt:       json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","text":"Choose the correct answer."}]}`),
		Answer: json.RawMessage(`{"kind":"single_choice","options":[` +
			`{"id":"A","content":{"version":1,"nodes":[{"type":"paragraph","text":"Choice A"}]}},` +
			`{"id":"B","content":{"version":1,"nodes":[{"type":"paragraph","text":"Choice B"}]}},` +
			`{"id":"C","content":{"version":1,"nodes":[{"type":"paragraph","text":"Choice C"}]}},` +
			`{"id":"D","content":{"version":1,"nodes":[{"type":"paragraph","text":"Choice D"}]}}],"correctOptionId":"A"}`),
	}
}

func validSATPublishSPR() authoring.QuestionDraft {
	return authoring.QuestionDraft{
		QuestionType: "student_produced_response",
		Prompt:       json.RawMessage(`{"version":1,"nodes":[{"type":"paragraph","text":"What is 6 times 7?"}]}`),
		Answer:       json.RawMessage(`{"kind":"student_produced_response","acceptedResponses":["42"]}`),
	}
}

// makeSATDraftPublishable gives every module in the draft one valid question and
// lowers that module's target to the count it now carries, so the exam can be
// published without authoring the blueprint's full 27/22 questions per module.
//
// This is what lets a proof that is not about question content — lock order, a
// route projection — publish a real SAT version at all: SAT publish validation
// requires each module's authored count to match its target
// (satpublish.ValidateModule), and the targets are draft metadata. The published
// version keeps the real SAT sections, their authored lengths, gaps and module
// rows, so the plan and the room clock a caller reads are production values.
//
// Same approach as newSATPublishFixture. The returned modules carry their
// published-draft ids, so a caller that needs a second distinct version can
// reopen the draft and add a question to one of them (raising that module's
// target to match).
func makeSATDraftPublishable(t *testing.T, ctx context.Context, db *sql.DB, authors *authoring.Service, actorID, examID string) []satPublishModuleFixture {
	t.Helper()
	shell, err := authors.Shell(ctx, examID)
	if err != nil {
		t.Fatalf("authoring shell: %v", err)
	}
	rows, err := db.QueryContext(ctx, `
		SELECT m.id, s.section_key, m.module_key
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order, m.display_order, m.id`, shell.VersionID)
	if err != nil {
		t.Fatalf("list draft modules: %v", err)
	}
	modules := make([]satPublishModuleFixture, 0, 6)
	for rows.Next() {
		var module satPublishModuleFixture
		if err := rows.Scan(&module.id, &module.sectionKey, &module.moduleKey); err != nil {
			rows.Close()
			t.Fatalf("scan draft module: %v", err)
		}
		modules = append(modules, module)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatalf("read draft modules: %v", err)
	}
	if err := rows.Close(); err != nil {
		t.Fatalf("close draft modules: %v", err)
	}
	if len(modules) == 0 {
		t.Fatal("SAT draft has no normalized modules")
	}
	for index := range modules {
		if _, err := db.ExecContext(ctx, "UPDATE assessment_modules SET target_question_count = 1 WHERE id = ?", modules[index].id); err != nil {
			t.Fatalf("lower %s.%s target: %v", modules[index].sectionKey, modules[index].moduleKey, err)
		}
		created, err := authors.CreateQuestion(ctx, modules[index].id, actorID, validSATPublishQuestion())
		if err != nil {
			t.Fatalf("create valid SAT question in %s.%s: %v", modules[index].sectionKey, modules[index].moduleKey, err)
		}
		modules[index].questions = append(modules[index].questions, created.ExamQuestionID)
	}
	return modules
}

func (f *satPublishFixture) publishRequest() exams.PublishRequest {
	draftID := f.draftID
	draftRevision := f.draftRevision
	return exams.PublishRequest{
		Revision:               f.examRevision,
		ExpectedDraftVersionID: &draftID,
		ExpectedDraftRevision:  &draftRevision,
	}
}

type satPublishPersistedState struct {
	draftID, publishedID sql.NullString
	publishScope         sql.NullString
	status               string
	examRevision         int
	isDraft, isPublished bool
	draftRevision        int
	publishedEvents      int
}

func (f *satPublishFixture) persistedState(t *testing.T) satPublishPersistedState {
	t.Helper()
	ctx := context.Background()
	state := satPublishPersistedState{}
	if err := f.h.db.QueryRowContext(ctx, `
		SELECT current_draft_version_id, current_published_version_id, status, revision
		FROM exam_entities WHERE id = ?`, f.h.examID).Scan(
		&state.draftID, &state.publishedID, &state.status, &state.examRevision,
	); err != nil {
		t.Fatal(err)
	}
	if err := f.h.db.QueryRowContext(ctx, `
		SELECT is_draft, is_published, revision, sat_publish_scope
		FROM exam_versions WHERE id = ?`, f.draftID).Scan(
		&state.isDraft, &state.isPublished, &state.draftRevision, &state.publishScope,
	); err != nil {
		t.Fatal(err)
	}
	if err := f.h.db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM exam_events WHERE exam_id = ? AND action = 'published'`, f.h.examID,
	).Scan(&state.publishedEvents); err != nil {
		t.Fatal(err)
	}
	return state
}

func (f *satPublishFixture) questionRevisionID(t *testing.T, examQuestionID string) string {
	t.Helper()
	var revisionID string
	if err := f.h.db.QueryRowContext(context.Background(),
		"SELECT question_revision_id FROM assessment_exam_questions WHERE id = ?", examQuestionID,
	).Scan(&revisionID); err != nil {
		t.Fatal(err)
	}
	return revisionID
}

// questionRevisionNumber reads the CAS fence the authoring save expects.
func (f *satPublishFixture) questionRevisionNumber(t *testing.T, examQuestionID string) int {
	t.Helper()
	var revision int
	if err := f.h.db.QueryRowContext(context.Background(), `
		SELECT r.revision FROM assessment_exam_questions eq
		JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
		WHERE eq.id = ?`, examQuestionID).Scan(&revision); err != nil {
		t.Fatal(err)
	}
	return revision
}

// questionPrompt reads the prompt the publish gate actually collects assets from.
func (f *satPublishFixture) questionPrompt(t *testing.T, examQuestionID string) string {
	t.Helper()
	var prompt string
	if err := f.h.db.QueryRowContext(context.Background(), `
		SELECT CAST(r.prompt AS CHAR) FROM assessment_exam_questions eq
		JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
		WHERE eq.id = ?`, examQuestionID).Scan(&prompt); err != nil {
		t.Fatal(err)
	}
	return prompt
}

// refreshFences re-reads the draft/exam revisions so the next publish request
// mirrors what a console sends after committing an author save.
func (f *satPublishFixture) refreshFences(t *testing.T) {
	t.Helper()
	if err := f.h.db.QueryRowContext(context.Background(),
		"SELECT revision FROM exam_versions WHERE id = ? AND is_draft = TRUE", f.draftID,
	).Scan(&f.draftRevision); err != nil {
		t.Fatal(err)
	}
	if err := f.h.db.QueryRowContext(context.Background(),
		"SELECT revision FROM exam_entities WHERE id = ?", f.h.examID,
	).Scan(&f.examRevision); err != nil {
		t.Fatal(err)
	}
}

// insertFinalizedAsset stands in for the upload-complete step so the real media
// service can resolve the object it was given.
func (f *satPublishFixture) insertFinalizedAsset(t *testing.T, assetID, objectKey, fileName string) {
	t.Helper()
	if _, err := f.h.db.ExecContext(context.Background(), `
		INSERT INTO media_assets (id, owner_kind, owner_id, content_type, file_name, upload_status, object_key, size_bytes, checksum_sha256, upload_url, created_at, updated_at)
		VALUES (?, 'assessment_question', ?, 'image/png', ?, 'finalized', ?, 68, ?, '', NOW(), NOW())`,
		assetID, "replacement-owner-"+assetID, fileName, objectKey, strings.Repeat("a", 64),
	); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if _, err := f.h.db.Exec("DELETE FROM media_assets WHERE id = ?", assetID); err != nil {
			t.Error(err)
		}
	})
}

func (f *satPublishFixture) setQuestion(t *testing.T, examQuestionID, questionType, prompt, answer string) {
	t.Helper()
	revisionID := f.questionRevisionID(t, examQuestionID)
	if _, err := f.h.db.ExecContext(context.Background(), `
		UPDATE assessment_question_revisions
		SET question_type = ?, prompt = ?, answer_definition = ?
		WHERE id = ?`, questionType, prompt, answer, revisionID); err != nil {
		t.Fatal(err)
	}
}

func assertSATPublishRejected(t *testing.T, f *satPublishFixture, wantCode, wantPath string, scope ...exams.SATPublishScope) {
	t.Helper()
	before := f.persistedState(t)
	req := f.publishRequest()
	if len(scope) > 0 {
		req.PublishScope = scope[0]
	}
	_, err := f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, req)
	if err == nil {
		t.Fatal("expected SAT publish to be rejected")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("expected validation error, got %v", err)
	}
	if got := appErr.Details["code"]; got != wantCode {
		t.Fatalf("issue code = %v, want %q (error: %v)", got, wantCode, err)
	}
	if got := appErr.Details["path"]; got != wantPath {
		t.Fatalf("issue path = %v, want %q", got, wantPath)
	}
	if after := f.persistedState(t); !reflect.DeepEqual(after, before) {
		t.Fatalf("rejected publish changed persisted state:\nbefore: %+v\nafter:  %+v", before, after)
	}
}

func TestSATPublishUsesConfiguredQuestionCountsMySQL(t *testing.T) {
	f := newSATPublishFixture(t, true)
	for _, module := range f.modules {
		var target, actual int
		if err := f.h.db.QueryRow("SELECT target_question_count FROM assessment_modules WHERE id = ?", module.id).Scan(&target); err != nil {
			t.Fatal(err)
		}
		if err := f.h.db.QueryRow("SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ?", module.id).Scan(&actual); err != nil {
			t.Fatal(err)
		}
		if actual != target {
			t.Fatalf("module %s has %d questions; configured target is %d", module.moduleKey, actual, target)
		}
	}

	published, err := f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, f.publishRequest())
	if err != nil {
		t.Fatalf("publish valid SAT draft with custom target: %v", err)
	}
	if published.ID != f.draftID || !published.IsPublished || published.IsDraft {
		t.Fatalf("unexpected published version: %+v", published)
	}
	if published.PublishScope == nil || *published.PublishScope != exams.SATPublishScopeFull {
		t.Fatalf("an omitted scope must publish Full SAT, got %+v", published.PublishScope)
	}
	state := f.persistedState(t)
	if state.draftID.Valid || !state.publishedID.Valid || state.publishedID.String != f.draftID {
		t.Fatalf("published pointers are incorrect: %+v", state)
	}
	if state.isDraft || !state.isPublished || state.publishedEvents != 1 {
		t.Fatalf("publish state was not sealed atomically: %+v", state)
	}
	if !state.publishScope.Valid || state.publishScope.String != string(exams.SATPublishScopeFull) {
		t.Fatalf("the immutable version must store Full SAT, got %+v", state.publishScope)
	}
	if state.status != exams.StatusPublished || state.examRevision != f.examRevision+1 || state.draftRevision != f.draftRevision+1 {
		t.Fatalf("publish revisions or status were not advanced: %+v", state)
	}
}

func TestSATPublishScopeIgnoresExcludedIssuesAndPersistsScopeMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	ctx := context.Background()
	var brokenMath *satPublishModuleFixture
	for index := range f.modules {
		if f.modules[index].sectionKey == "math" {
			brokenMath = &f.modules[index]
			break
		}
	}
	if brokenMath == nil {
		t.Fatal("fixture must include a Math module")
	}
	if _, err := f.h.db.ExecContext(ctx, "UPDATE assessment_modules SET target_question_count = 2 WHERE id = ?", brokenMath.id); err != nil {
		t.Fatal(err)
	}
	assertSATPublishRejected(t, f, "sat.module.incomplete", brokenMath.sectionKey+"."+brokenMath.moduleKey)

	full, err := f.h.authors.ValidateExamForScope(ctx, f.h.examID, exams.SATPublishScopeFull)
	if err != nil {
		t.Fatal(err)
	}
	if full.Valid {
		t.Fatal("Full SAT readiness must include the broken Math module")
	}
	rw, err := f.h.authors.ValidateExamForScope(ctx, f.h.examID, exams.SATPublishScopeReadingWriting)
	if err != nil {
		t.Fatal(err)
	}
	if !rw.Valid || rw.PublishScope != exams.SATPublishScopeReadingWriting {
		t.Fatalf("Reading & Writing checks should ignore Math issues: %+v", rw)
	}

	req := f.publishRequest()
	req.PublishScope = exams.SATPublishScopeReadingWriting
	published, err := f.h.exams.Publish(ctx, f.h.examID, f.h.actor, req)
	if err != nil {
		t.Fatalf("Reading & Writing publish should ignore Math issues: %v", err)
	}
	if published.PublishScope == nil || *published.PublishScope != exams.SATPublishScopeReadingWriting {
		t.Fatalf("published version did not return its scoped release: %+v", published.PublishScope)
	}
	state := f.persistedState(t)
	if !state.publishScope.Valid || state.publishScope.String != string(exams.SATPublishScopeReadingWriting) {
		t.Fatalf("scope was not persisted with the immutable version: %+v", state.publishScope)
	}
}

func TestSATPublishMathScopeIgnoresExcludedIssuesAndPersistsScopeMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	ctx := context.Background()
	var brokenRW *satPublishModuleFixture
	for index := range f.modules {
		if f.modules[index].sectionKey == "reading-writing" {
			brokenRW = &f.modules[index]
			break
		}
	}
	if brokenRW == nil {
		t.Fatal("fixture must include a Reading & Writing module")
	}
	if _, err := f.h.db.ExecContext(ctx, "UPDATE assessment_modules SET target_question_count = 2 WHERE id = ?", brokenRW.id); err != nil {
		t.Fatal(err)
	}
	assertSATPublishRejected(t, f, "sat.module.incomplete", brokenRW.sectionKey+"."+brokenRW.moduleKey, exams.SATPublishScopeReadingWriting)

	rw, err := f.h.authors.ValidateExamForScope(ctx, f.h.examID, exams.SATPublishScopeReadingWriting)
	if err != nil {
		t.Fatal(err)
	}
	math, err := f.h.authors.ValidateExamForScope(ctx, f.h.examID, exams.SATPublishScopeMath)
	if err != nil {
		t.Fatal(err)
	}
	if rw.Valid || !math.Valid || math.PublishScope != exams.SATPublishScopeMath {
		t.Fatalf("scoped readiness did not isolate Math from Reading & Writing issues: RW=%+v Math=%+v", rw, math)
	}

	req := f.publishRequest()
	req.PublishScope = exams.SATPublishScopeMath
	published, err := f.h.exams.Publish(ctx, f.h.examID, f.h.actor, req)
	if err != nil {
		t.Fatalf("Math publish should ignore Reading & Writing issues: %v", err)
	}
	if published.PublishScope == nil || *published.PublishScope != exams.SATPublishScopeMath {
		t.Fatalf("published version did not return the Math scope: %+v", published.PublishScope)
	}
	state := f.persistedState(t)
	if !state.publishScope.Valid || state.publishScope.String != string(exams.SATPublishScopeMath) {
		t.Fatalf("Math scope was not persisted with the immutable version: %+v", state.publishScope)
	}
}

func TestSATPublishRejectsUnknownScopeMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	before := f.persistedState(t)
	req := f.publishRequest()
	req.PublishScope = "verbal"
	_, err := f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, req)
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("unknown scope should be rejected as validation, got %v", err)
	}
	if after := f.persistedState(t); !reflect.DeepEqual(after, before) {
		t.Fatalf("unknown scope changed persisted state:\nbefore: %+v\nafter:  %+v", before, after)
	}
}

func TestSATPublishRejectsEachContentViolationMySQL(t *testing.T) {
	tests := []struct {
		name   string
		code   string
		mutate func(*testing.T, *satPublishFixture) string
	}{
		{
			name: "empty prompt",
			code: "question.prompt.required",
			mutate: func(t *testing.T, f *satPublishFixture) string {
				eqID := f.modules[0].questions[0]
				f.setQuestion(t, eqID, "single_choice", `{"version":1,"nodes":[{"type":"paragraph","text":"  "}]}`, string(validSATPublishQuestion().Answer))
				return "examQuestion:" + eqID + ":prompt"
			},
		},
		{
			name: "choice count",
			code: "sat.choice.count",
			mutate: func(t *testing.T, f *satPublishFixture) string {
				eqID := f.modules[0].questions[0]
				answer := `{"options":[{"id":"A","content":"A"},{"id":"B","content":"B"},{"id":"C","content":"C"}],"correctOptionId":"A"}`
				f.setQuestion(t, eqID, "single_choice", string(validSATPublishQuestion().Prompt), answer)
				return "examQuestion:" + eqID + ":answer.options"
			},
		},
		{
			name: "choice content",
			code: "sat.choice.content.required",
			mutate: func(t *testing.T, f *satPublishFixture) string {
				eqID := f.modules[0].questions[0]
				answer := `{"options":[{"id":"A","content":"A"},{"id":"B","content":"  "},{"id":"C","content":"C"},{"id":"D","content":"D"}],"correctOptionId":"A"}`
				f.setQuestion(t, eqID, "single_choice", string(validSATPublishQuestion().Prompt), answer)
				return "examQuestion:" + eqID + ":answer.options[1].content"
			},
		},
		{
			name: "missing correct answer",
			code: "sat.correct_answer.required",
			mutate: func(t *testing.T, f *satPublishFixture) string {
				eqID := f.modules[0].questions[0]
				answer := `{"options":[{"id":"A","content":"A"},{"id":"B","content":"B"},{"id":"C","content":"C"},{"id":"D","content":"D"}]}`
				f.setQuestion(t, eqID, "single_choice", string(validSATPublishQuestion().Prompt), answer)
				return "examQuestion:" + eqID + ":answer.correctOptionId"
			},
		},
		{
			name: "invalid correct answer",
			code: "sat.correct_answer.invalid",
			mutate: func(t *testing.T, f *satPublishFixture) string {
				eqID := f.modules[0].questions[0]
				answer := `{"options":[{"id":"A","content":"A"},{"id":"B","content":"B"},{"id":"C","content":"C"},{"id":"D","content":"D"}],"correctOptionId":"E"}`
				f.setQuestion(t, eqID, "single_choice", string(validSATPublishQuestion().Prompt), answer)
				return "examQuestion:" + eqID + ":answer.correctOptionId"
			},
		},
		{
			name: "SPR without accepted response",
			code: "sat.spr.answer.required",
			mutate: func(t *testing.T, f *satPublishFixture) string {
				eqID := f.modules[0].questions[0]
				f.setQuestion(t, eqID, "student_produced_response", string(validSATPublishSPR().Prompt), `{"acceptedResponses":["  "]}`)
				return "examQuestion:" + eqID + ":answer.acceptedResponses"
			},
		},
		{
			name: "module count differs from configured target",
			code: "sat.module.incomplete",
			mutate: func(t *testing.T, f *satPublishFixture) string {
				module := f.modules[0]
				if _, err := f.h.db.Exec("UPDATE assessment_modules SET target_question_count = 2 WHERE id = ?", module.id); err != nil {
					t.Fatal(err)
				}
				return module.sectionKey + "." + module.moduleKey
			},
		},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f := newSATPublishFixture(t, false)
			path := test.mutate(t, f)
			assertSATPublishRejected(t, f, test.code, path)
		})
	}
}

func TestSATPublishIgnoresLegacyReadinessFieldsMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	ctx := context.Background()
	for _, module := range f.modules {
		if _, err := f.h.db.ExecContext(ctx, `
			UPDATE assessment_modules
			SET duration_seconds = 0, instructions = '[]', tool_policy = '["unsupported-tool"]'
			WHERE id = ?`, module.id); err != nil {
			t.Fatal(err)
		}
		for _, examQuestionID := range module.questions {
			revisionID := f.questionRevisionID(t, examQuestionID)
			if _, err := f.h.db.ExecContext(ctx, `
				UPDATE assessment_question_revisions
				SET stimulus = '[]', rationale = '[]', metadata = '[]', accessibility = '[]'
				WHERE id = ?`, revisionID); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := f.h.db.ExecContext(ctx, "UPDATE assessment_exam_questions SET is_pretest = TRUE WHERE id = ?", module.questions[0]); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := f.h.db.ExecContext(ctx, `
		UPDATE assessment_sections
		SET duration_seconds = 0, break_after_seconds = -1, instructions = '[]', tool_policy = '["unsupported-tool"]'
		WHERE exam_version_id = ?`, f.draftID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.h.db.ExecContext(ctx, `
		UPDATE assessment_sections
		SET section_key = CONCAT(section_key, '-legacy')
		WHERE exam_version_id = ?`, f.draftID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.h.db.ExecContext(ctx, `
		UPDATE assessment_routing_policies
		SET policy_key = 'legacy-invalid', policy_config = '{}'
		WHERE section_id IN (SELECT id FROM assessment_sections WHERE exam_version_id = ?)`, f.draftID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.h.db.ExecContext(ctx, "UPDATE exam_versions SET content_snapshot = '{}', config_snapshot = '{}' WHERE id = ?", f.draftID); err != nil {
		t.Fatal(err)
	}

	published, err := f.h.exams.Publish(ctx, f.h.examID, f.h.actor, f.publishRequest())
	if err != nil {
		t.Fatalf("legacy readiness fields blocked SAT publish: %v", err)
	}
	if published.ID != f.draftID || !published.IsPublished {
		t.Fatalf("unexpected published version: %+v", published)
	}
}

func TestSATPublishPreservesRevisionFencesMySQL(t *testing.T) {
	tests := []struct {
		name string
		edit func(*exams.PublishRequest)
	}{
		{
			name: "expected draft id",
			edit: func(req *exams.PublishRequest) {
				staleID := "stale-" + *req.ExpectedDraftVersionID
				req.ExpectedDraftVersionID = &staleID
			},
		},
		{
			name: "expected draft revision",
			edit: func(req *exams.PublishRequest) {
				staleRevision := *req.ExpectedDraftRevision + 1
				req.ExpectedDraftRevision = &staleRevision
			},
		},
		{
			name: "exam revision",
			edit: func(req *exams.PublishRequest) {
				req.Revision++
			},
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			f := newSATPublishFixture(t, false)
			before := f.persistedState(t)
			req := f.publishRequest()
			test.edit(&req)
			_, err := f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, req)
			appErr, ok := apperrors.As(err)
			if !ok || appErr.Code != apperrors.CodeConflict {
				t.Fatalf("stale %s should conflict, got %v", test.name, err)
			}
			if after := f.persistedState(t); !reflect.DeepEqual(after, before) {
				t.Fatalf("stale publish changed persisted state:\nbefore: %+v\nafter:  %+v", before, after)
			}
		})
	}
}

func TestSATPublishOperationKeyReplaysOneReleaseMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	req := f.publishRequest()
	req.OperationKey = "sat-publish-" + uuid.NewString()
	req.PublishNotes = stringPointer("integration publish")

	first, err := f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, req)
	if err != nil {
		t.Fatalf("first publish failed: %v", err)
	}
	replayed, err := f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, req)
	if err != nil {
		t.Fatalf("identical publish retry failed: %v", err)
	}
	if replayed.ID != first.ID || replayed.VersionNumber != first.VersionNumber {
		t.Fatalf("retry returned a different release: first=%+v replayed=%+v", first, replayed)
	}
	req.PublishScope = exams.SATPublishScopeMath
	_, err = f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, req)
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeConflict {
		t.Fatalf("reusing operation key with a different scope should conflict, got %v", err)
	}

	differentNotes := "different payload"
	req.PublishNotes = &differentNotes
	req.PublishScope = exams.SATPublishScopeFull
	_, err = f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, req)
	appErr, ok = apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeConflict {
		t.Fatalf("reusing operation key with a different payload should conflict, got %v", err)
	}
	state := f.persistedState(t)
	if state.publishedEvents != 1 || state.draftID.Valid || !state.publishedID.Valid || state.publishedID.String != first.ID {
		t.Fatalf("idempotent retry created extra publish state: %+v", state)
	}
}

func stringPointer(value string) *string { return &value }

type satPublishMediaVerifierFunc func(context.Context, []string) ([]media.AssetIssue, error)

func (verify satPublishMediaVerifierFunc) VerifyRenderableAssets(ctx context.Context, assetIDs []string) ([]media.AssetIssue, error) {
	return verify(ctx, assetIDs)
}

func TestSATPublishBlocksUnavailableMediaMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	questionID := f.modules[0].questions[0]
	f.setQuestion(t, questionID, "single_choice", `{"version":1,"nodes":[{"type":"paragraph","text":"Choose the correct answer."},{"type":"image","attrs":{"assetId":"missing-media"}}]}`, string(validSATPublishQuestion().Answer))
	f.h.exams.SetMediaVerifier(satPublishMediaVerifierFunc(func(_ context.Context, ids []string) ([]media.AssetIssue, error) {
		if !reflect.DeepEqual(ids, []string{"missing-media"}) {
			t.Fatalf("verified asset IDs = %v", ids)
		}
		return []media.AssetIssue{{AssetID: "missing-media", Reason: "object_unreadable", StorageErrorClass: "missing"}}, nil
	}))

	before := f.persistedState(t)
	_, err := f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, f.publishRequest())
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("unavailable media should block publish with validation, got %v", err)
	}
	if got := appErr.Details["code"]; got != "sat.media.unavailable" {
		t.Fatalf("diagnostic code = %v, want sat.media.unavailable", got)
	}
	if got := appErr.Details["path"]; got != "examQuestion:"+questionID+":prompt.nodes[1].attrs.assetId" {
		t.Fatalf("diagnostic path = %v", got)
	}
	if after := f.persistedState(t); !reflect.DeepEqual(after, before) {
		t.Fatalf("blocked publish changed persisted state:\nbefore: %+v\nafter:  %+v", before, after)
	}
}

// TestSATPublishAfterLegacyImageReplacementMySQL is the end-to-end proof for
// the image-replacement repair path. A legacy question points at an asset whose
// object is gone and whose alt text is empty; the author replaces the file; the
// committed revision must then carry the new finalized asset, the old ID must
// be gone from it, and the media gate must pass with the real object store.
func TestSATPublishAfterLegacyImageReplacementMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	ctx := context.Background()
	questionID := f.modules[0].questions[0]

	root := t.TempDir()
	store := objectstore.NewLocalStore(root)
	inner := media.NewService(f.h.db, tx.NewRunner(f.h.db), store)
	var verified []string
	f.h.exams.SetMediaVerifier(satPublishMediaVerifierFunc(func(ctx context.Context, ids []string) ([]media.AssetIssue, error) {
		verified = append([]string(nil), ids...)
		return inner.VerifyRenderableAssets(ctx, ids)
	}))

	// Legacy state: an uploaded-then-lost asset and the empty alt text the old
	// upload flow produced.
	const legacyAssetID = "legacy-lost-image"
	f.setQuestion(t, questionID, "single_choice", legacyImagePrompt(legacyAssetID, ""), string(validSATPublishQuestion().Answer))

	before := f.persistedState(t)
	_, err := f.h.exams.Publish(ctx, f.h.examID, f.h.actor, f.publishRequest())
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("a lost legacy asset should block publish with validation, got %v", err)
	}
	if got := appErr.Details["code"]; got != "sat.media.unavailable" {
		t.Fatalf("diagnostic code = %v, want sat.media.unavailable", got)
	}
	if got := appErr.Details["assetId"]; got != legacyAssetID {
		t.Fatalf("diagnostic asset = %v, want %q", got, legacyAssetID)
	}
	if !reflect.DeepEqual(verified, []string{legacyAssetID}) {
		t.Fatalf("verified asset IDs = %v, want only the lost legacy asset", verified)
	}
	if after := f.persistedState(t); !reflect.DeepEqual(after, before) {
		t.Fatalf("blocked publish changed persisted state:\nbefore: %+v\nafter:  %+v", before, after)
	}

	// Replace the file: object written under the configured root at the same
	// media/<assetId>/<file> layout the upload-complete flow uses, then a
	// finalized asset row, then the normal author save that commits the node.
	const replacementAssetID = "replaced-image"
	objectKey := "media/" + replacementAssetID + "/graph.png"
	if err := store.Put(ctx, objectKey, []byte("\x89PNG replacement bytes"), "image/png"); err != nil {
		t.Fatalf("write replacement object: %v", err)
	}
	objectPath := filepath.Join(root, filepath.FromSlash(objectKey))
	if _, err := os.Stat(objectPath); err != nil {
		t.Fatalf("replacement object missing at %s: %v", objectPath, err)
	}
	if _, err := os.Stat(filepath.Join(root, "media", legacyAssetID)); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("legacy object unexpectedly present for %q: %v", legacyAssetID, err)
	}
	f.insertFinalizedAsset(t, replacementAssetID, objectKey, "graph.png")

	legacyRevisionID := f.questionRevisionID(t, questionID)
	if _, err := f.h.authors.UpdateQuestion(ctx, questionID, f.h.actor, f.questionRevisionNumber(t, questionID), authoring.QuestionDraft{
		QuestionType: "single_choice",
		Prompt:       json.RawMessage(legacyImagePrompt(replacementAssetID, "Supply demand graph")),
		Answer:       validSATPublishQuestion().Answer,
	}); err != nil {
		t.Fatalf("commit the replacement author save: %v", err)
	}

	// The acceptance condition: the canonical revision holds the new asset ID
	// and never the old one.
	committedRevisionID := f.questionRevisionID(t, questionID)
	if committedRevisionID == legacyRevisionID {
		t.Fatal("replacement should commit a new question revision")
	}
	committedPrompt := f.questionPrompt(t, questionID)
	if !strings.Contains(committedPrompt, replacementAssetID) {
		t.Fatalf("committed revision is missing the new asset: %s", committedPrompt)
	}
	if strings.Contains(committedPrompt, legacyAssetID) {
		t.Fatalf("committed revision still references the lost asset: %s", committedPrompt)
	}

	verified = nil
	f.refreshFences(t)
	published, err := f.h.exams.Publish(ctx, f.h.examID, f.h.actor, f.publishRequest())
	if err != nil {
		t.Fatalf("publish after repairing the image should pass the media gate: %v", err)
	}
	if published.ID != f.draftID || !published.IsPublished {
		t.Fatalf("unexpected published version: %+v", published)
	}
	if !reflect.DeepEqual(verified, []string{replacementAssetID}) {
		t.Fatalf("publish verified asset IDs = %v, want only the replacement", verified)
	}
}

func legacyImagePrompt(assetID, alt string) string {
	return `{"version":1,"nodes":[{"type":"paragraph","text":"Choose the correct answer."},` +
		`{"type":"image","attrs":{"assetId":"` + assetID + `","alt":"` + alt + `"}}]}`
}

func TestSATPublishConflictsWhenDraftChangesDuringMediaCheckMySQL(t *testing.T) {
	f := newSATPublishFixture(t, false)
	questionID := f.modules[0].questions[0]
	f.setQuestion(t, questionID, "single_choice", `{"version":1,"nodes":[{"type":"paragraph","text":"Choose the correct answer."},{"type":"image","attrs":{"assetId":"media-1"}}]}`, string(validSATPublishQuestion().Answer))
	questionRevisionID := f.questionRevisionID(t, questionID)
	f.h.exams.SetMediaVerifier(satPublishMediaVerifierFunc(func(_ context.Context, _ []string) ([]media.AssetIssue, error) {
		// Simulate a committed author save after preflight read and before object verification returns.
		if _, err := f.h.db.Exec(`UPDATE assessment_question_revisions SET prompt = ? WHERE id = ?`, `{"version":1,"nodes":[{"type":"paragraph","text":"Updated during media check."}]}`, questionRevisionID); err != nil {
			return nil, err
		}
		if _, err := f.h.db.Exec("UPDATE exam_versions SET revision = revision + 1 WHERE id = ? AND is_draft = TRUE", f.draftID); err != nil {
			return nil, err
		}
		return nil, nil
	}))

	before := f.persistedState(t)
	_, err := f.h.exams.Publish(context.Background(), f.h.examID, f.h.actor, f.publishRequest())
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeConflict {
		t.Fatalf("draft change during media verification should conflict, got %v", err)
	}
	after := f.persistedState(t)
	if !after.isDraft || after.isPublished || after.publishedID.Valid || after.publishedEvents != before.publishedEvents {
		t.Fatalf("stale preflight published after draft changed: before=%+v after=%+v", before, after)
	}
	if after.draftRevision != before.draftRevision+1 {
		t.Fatalf("simulated author save did not advance draft revision: before=%+v after=%+v", before, after)
	}
}

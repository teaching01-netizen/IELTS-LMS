package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/schedules"
	"github.com/go-chi/chi/v5"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestAuthoringHTTPContractsMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	runner := tx.NewRunner(db)
	examService := exams.NewService(db, runner)
	authors := authoring.NewService(db, runner)
	app := &App{DB: db, Exams: examService, Authoring: authors, Schedules: schedules.NewService(db, runner)}
	actor := "contract-" + uuid.NewString()
	provider := "sat"
	exam, err := examService.Create(context.Background(), exams.CreateRequest{Slug: actor, Title: "Contract test", ExamType: "Academic", Visibility: "private", ProviderKey: &provider, OwnerID: actor})
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := db.Exec("DELETE FROM exam_schedules WHERE exam_id = ?", exam.ID); err != nil {
			t.Error(err)
		}
		if err := examService.Delete(context.Background(), exam.ID); err != nil {
			t.Error(err)
		}
		if _, err := db.Exec("DELETE FROM assessment_questions WHERE created_by = ?", actor); err != nil {
			t.Error(err)
		}
	}()
	router := chi.NewRouter()
	router.Patch("/question-revisions/{revisionID}", authorSaveRevisionHandler(app))
	router.Post("/exam-questions/{examQuestionID}/duplicate", authorDuplicateHandler(app))
	router.Patch("/modules/{moduleID}/question-order", authorReorderHandler(app))
	router.Post("/questions/bulk", authorBulkHandler(app))
	router.Post("/modules/{moduleID}/questions/batch", authorBatchQuestionsHandler(app))
	router.Get("/exams/{examID}/preview", authorPreviewHandler(app))
	router.Get("/versions/{versionID}", versionSummaryHandler(app))
	request := func(method, path string, body any, status int) map[string]any {
		t.Helper()
		var raw []byte
		if body != nil {
			raw, _ = json.Marshal(body)
		}
		req := httptest.NewRequest(method, path, bytes.NewReader(raw))
		req = req.WithContext(context.WithValue(req.Context(), sessionCtxKey, &auth.Session{UserID: actor, Role: auth.RoleAdmin}))
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if rec.Code != status {
			t.Fatalf("%s %s: status %d want %d: %s", method, path, rec.Code, status, rec.Body.String())
		}
		var wire map[string]any
		if len(rec.Body.Bytes()) > 0 && rec.Body.Bytes()[0] == '{' {
			if err := json.Unmarshal(rec.Body.Bytes(), &wire); err != nil {
				t.Fatal(err)
			}
		}
		return wire
	}
	shell, err := authors.Shell(context.Background(), exam.ID)
	if err != nil {
		t.Fatal(err)
	}
	module := shell.Sections[0].Modules[0]
	first, err := authors.CreateQuestion(context.Background(), module.ID, actor, authoring.QuestionDraft{})
	if err != nil {
		t.Fatal(err)
	}
	second, err := authors.CreateQuestion(context.Background(), module.ID, actor, authoring.QuestionDraft{})
	if err != nil {
		t.Fatal(err)
	}
	payload := map[string]any{"revision": first.Question.Revision, "questionType": first.Question.QuestionType, "stimulus": first.Question.Stimulus, "prompt": map[string]any{"version": 1, "nodes": []any{map[string]any{"type": "paragraph", "id": "p", "text": "Candidate prompt"}}}, "answer": first.Question.Answer, "rationale": first.Question.Rationale, "metadata": first.Question.Metadata, "accessibility": first.Question.Accessibility}
	saved := request(http.MethodPatch, "/question-revisions/"+first.Question.ID, payload, 200)
	if saved["id"] != first.Question.ID || saved["revision"] != float64(first.Question.Revision+1) || saved["prompt"] == nil {
		t.Fatalf("invalid editor save response: %+v", saved)
	}
	request(http.MethodPatch, "/question-revisions/"+first.Question.ID, payload, 409)
	// Two consoles saving the same revision must produce exactly one winner.
	rawDraft, _ := json.Marshal(payload)
	var concurrentDraft authoring.QuestionDraft
	if err := json.Unmarshal(rawDraft, &concurrentDraft); err != nil {
		t.Fatal(err)
	}
	outcomes := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := authors.SaveRevision(context.Background(), first.ExamQuestionID, first.Question.ID, first.Question.Revision+1, concurrentDraft, actor)
			outcomes <- err
		}()
	}
	successes, conflicts := 0, 0
	for i := 0; i < 2; i++ {
		err := <-outcomes
		if err == nil {
			successes++
		} else if e, ok := apperrors.As(err); ok && e.Code == apperrors.CodeConflict {
			conflicts++
		} else {
			t.Fatalf("unexpected concurrent-save failure: %v", err)
		}
	}
	if successes != 1 || conflicts != 1 {
		t.Fatalf("concurrent writes: %d successes, %d conflicts", successes, conflicts)
	}

	duplicate := request(http.MethodPost, "/exam-questions/"+first.ExamQuestionID+"/duplicate", map[string]any{"insertAfterExamQuestionId": first.ExamQuestionID}, 201)
	copyID := duplicate["examQuestionId"].(string)
	copyRevision := duplicate["question"].(map[string]any)
	if duplicate["displayOrder"] != float64(1) || copyRevision["id"] == first.Question.ID || copyRevision["questionId"] == first.Question.QuestionID {
		t.Fatalf("copy placement/content not independent: %+v", duplicate)
	}
	before := []string{first.ExamQuestionID, copyID, second.ExamQuestionID}
	after := []string{second.ExamQuestionID, copyID, first.ExamQuestionID}
	request(http.MethodPatch, "/modules/"+module.ID+"/question-order", map[string]any{"expectedQuestionIds": before, "questionIds": after}, 200)
	request(http.MethodPatch, "/modules/"+module.ID+"/question-order", map[string]any{"expectedQuestionIds": before, "questionIds": after}, 409)
	bulk := map[string]any{"questionIds": []string{copyID}, "expectedRevisions": map[string]int{copyID: 0}, "action": map[string]any{"type": "patch_metadata", "patch": map[string]any{"difficulty": "hard"}}}
	updated := request(http.MethodPost, "/questions/bulk", bulk, 200)
	if updated["updatedQuestions"] == nil {
		t.Fatal("missing bulk summaries")
	}
	request(http.MethodPost, "/questions/bulk", bulk, 409)
	original, err := authors.GetQuestion(context.Background(), first.ExamQuestionID)
	if err != nil {
		t.Fatal(err)
	}
	var metadata map[string]any
	json.Unmarshal(original.Question.Metadata, &metadata)
	if metadata["difficulty"] == "hard" {
		t.Fatal("copy edit changed original")
	}
	preview := request(http.MethodGet, "/exams/"+exam.ID+"/preview", nil, 200)
	sections := preview["sections"].([]any)
	questions := sections[0].(map[string]any)["modules"].([]any)[0].(map[string]any)["questions"].([]any)
	for _, item := range questions {
		q := item.(map[string]any)
		if q["prompt"] == nil || q["stimulus"] == nil {
			t.Fatal("preview returned summary instead of content")
		}
		answer := q["answer"].(map[string]any)
		if _, ok := answer["correctOptionId"]; ok {
			t.Fatal("preview leaks grading key")
		}
	}
	// Mirror the single-question paths through the batch APIs.
	batch := request(http.MethodPost, "/modules/"+module.ID+"/questions/batch", map[string]any{"questions": []any{map[string]any{
		"questionType": first.Question.QuestionType, "stimulus": first.Question.Stimulus, "prompt": payload["prompt"], "answer": first.Question.Answer,
		"rationale": first.Question.Rationale, "metadata": first.Question.Metadata, "accessibility": first.Question.Accessibility, "isPretest": true,
	}}}, 201)
	summary := batch["questions"].([]any)[0].(map[string]any)
	if summary["semanticRevision"] != float64(1) || summary["promptPreview"] != "Candidate prompt" || summary["readiness"] == nil || summary["tags"] == nil {
		t.Fatalf("incomplete batch summary: %+v", summary)
	}
	bulkCopy := request(http.MethodPost, "/questions/bulk", map[string]any{"questionIds": []string{first.ExamQuestionID}, "expectedRevisions": map[string]int{first.ExamQuestionID: original.Question.Revision}, "action": map[string]any{"type": "duplicate", "destinationModuleId": module.ID}}, 200)
	bulkCopyID := bulkCopy["createdQuestionIds"].([]any)[0].(string)
	copied, err := authors.GetQuestion(context.Background(), bulkCopyID)
	if err != nil {
		t.Fatal(err)
	}
	if copied.Question.ID == original.Question.ID || copied.Question.QuestionID == original.Question.QuestionID {
		t.Fatal("bulk duplicate shares editable source content")
	}
	current, err := authors.Shell(context.Background(), exam.ID)
	if err != nil {
		t.Fatal(err)
	}
	if current.VersionRevision <= shell.VersionRevision {
		t.Fatal("authoring mutations did not invalidate draft revision")
	}
	version := request(http.MethodGet, "/versions/"+shell.VersionID, nil, 200)
	if version["createdAt"] == nil {
		t.Fatal("version missing creation date")
	}
	// Entity and draft revisions are distinct counters in the publish request.
	published, err := examService.Publish(context.Background(), exam.ID, actor, exams.PublishRequest{Revision: exam.Revision, ExpectedDraftVersionID: &current.VersionID, ExpectedDraftRevision: &current.VersionRevision})
	if err != nil {
		t.Fatal(err)
	}
	if published.CreatedAt.IsZero() {
		t.Fatal("published version missing creation timestamp")
	}
	_, err = authors.CreateQuestion(context.Background(), module.ID, actor, authoring.QuestionDraft{})
	if e, ok := apperrors.As(err); !ok || e.Code != apperrors.CodeConflict {
		t.Fatalf("published mutation accepted: %v", err)
	}
	// Saved schedule switches and timestamps must survive the read projection.
	start := time.Now().UTC().Add(time.Hour).Truncate(time.Second)
	schedule, err := app.Schedules.Create(context.Background(), schedules.CreateRequest{ExamID: exam.ID, PublishedVersionID: published.ID, CohortName: "contract cohort", StartTime: start, EndTime: start.Add(3 * time.Hour), AutoStart: true, AutoStop: true, CreatedBy: actor})
	if err != nil {
		t.Fatal(err)
	}
	if !schedule.AutoStart || !schedule.AutoStop || schedule.RecurrenceType != "none" || schedule.CreatedAt.IsZero() || schedule.CreatedBy != actor {
		t.Fatalf("lost schedule settings: %+v", schedule)
	}
	reopened, err := authors.OpenShell(context.Background(), exam.ID, actor)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := authors.CreateQuestion(context.Background(), reopened.Sections[0].Modules[0].ID, actor, authoring.QuestionDraft{}); err != nil {
		t.Fatal(err)
	}
	latest, err := authors.Shell(context.Background(), exam.ID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := examService.Publish(context.Background(), exam.ID, actor, exams.PublishRequest{Revision: latest.VersionRevision}); err != nil {
		t.Fatalf("legacy draft-only publish failed: %v", err)
	}
	events, err := examService.ListEvents(context.Background(), exam.ID)
	if err != nil {
		t.Fatal(err)
	}
	for _, event := range events {
		if event.CreatedAt.IsZero() {
			t.Fatal("event missing timestamp")
		}
	}

}

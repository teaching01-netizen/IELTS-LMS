package main

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
)

func TestGradingSectionsHandlerReturnsPersistedAnswers(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	answersJSON := `{"type":"science","answers":{"science-q1":"option-b"}}`
	autoGradingJSON := `{"totalScore":0,"maxScore":1,"questionResults":[]}`
	mock.ExpectQuery(regexp.QuoteMeta(
		"SELECT id, section, answers, grading_status, auto_grading_results FROM section_submissions WHERE submission_id = ?",
	)).WithArgs("submission-1").WillReturnRows(
		sqlmock.NewRows([]string{"id", "section", "answers", "grading_status", "auto_grading_results"}).
			AddRow("section-1", "science", answersJSON, "auto_graded", autoGradingJSON),
	)

	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("submissionID", "submission-1")
	req := httptest.NewRequest(http.MethodGet, "/v1/grading/submissions/submission-1/sections", nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "admin-1", Role: auth.RoleAdmin}))
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
	rec := httptest.NewRecorder()

	gradingSectionsHandler(&App{DB: db})(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var sections []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&sections); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(sections) != 1 {
		t.Fatalf("expected one section, got %d", len(sections))
	}
	answers, ok := sections[0]["answers"].(map[string]any)
	if !ok {
		t.Fatalf("expected answers object, got %#v", sections[0]["answers"])
	}
	if answers["type"] != "science" {
		t.Fatalf("expected science answer payload, got %#v", answers)
	}
	nested, ok := answers["answers"].(map[string]any)
	if !ok || nested["science-q1"] != "option-b" {
		t.Fatalf("expected persisted student answer, got %#v", answers["answers"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

func TestGradingWritingTasksHandlerReturnsPromptAndStudentResponse(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	submittedAt := time.Date(2026, time.October, 4, 8, 15, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT w.id, w.submission_id, w.task_id, w.task_label, w.prompt, w.student_text,
				w.word_count, w.grading_status, w.submitted_at
			FROM writing_task_submissions w
			WHERE w.submission_id = ?
			ORDER BY w.task_id ASC`,
	)).WithArgs("submission-1").WillReturnRows(
		sqlmock.NewRows([]string{"id", "submission_id", "task_id", "task_label", "prompt", "student_text", "word_count", "grading_status", "submitted_at"}).
			AddRow("writing-1", "submission-1", "task1", "Task 1", "<p>Describe the chart.</p>", "<p>My saved essay.</p>", 3, "needs_review", submittedAt),
	)

	routeCtx := chi.NewRouteContext()
	routeCtx.URLParams.Add("submissionID", "submission-1")
	req := httptest.NewRequest(http.MethodGet, "/v1/grading/submissions/submission-1/writing-tasks", nil)
	req = req.WithContext(sessionCtx(req.Context(), &auth.Session{UserID: "admin-1", Role: auth.RoleAdmin}))
	req = req.WithContext(context.WithValue(req.Context(), chi.RouteCtxKey, routeCtx))
	rec := httptest.NewRecorder()

	gradingWritingTasksHandler(&App{DB: db})(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var tasks []map[string]any
	if err := json.NewDecoder(rec.Body).Decode(&tasks); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if len(tasks) != 1 {
		t.Fatalf("expected one writing task, got %d", len(tasks))
	}
	if tasks[0]["prompt"] != "<p>Describe the chart.</p>" {
		t.Errorf("expected persisted prompt in response, got %#v", tasks[0]["prompt"])
	}
	if tasks[0]["studentText"] != "<p>My saved essay.</p>" {
		t.Errorf("expected persisted student response in response, got %#v", tasks[0]["studentText"])
	}
	if tasks[0]["submissionId"] != "submission-1" {
		t.Errorf("expected submission ID in response, got %#v", tasks[0]["submissionId"])
	}
	if tasks[0]["wordCount"] != float64(3) {
		t.Errorf("expected word count in response, got %#v", tasks[0]["wordCount"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

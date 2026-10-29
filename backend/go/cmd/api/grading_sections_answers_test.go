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
	mock.ExpectQuery("SELECT COALESCE\\(s.attempt_id").WithArgs("submission-1").WillReturnRows(
		sqlmock.NewRows([]string{"attempt_id", "protocol_version"}),
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
	if sections[0]["submissionId"] != "submission-1" {
		t.Errorf("expected submission ID in section response, got %#v", sections[0]["submissionId"])
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

// A snapshot-backed IELTS exam (the builder content tree) stores its module KEY
// ('reading') as the V2 response module_id: the assessment_modules join is
// empty, so the section of a saved cell must come from the module key. Every
// question type is covered here because the loss was type-independent.
func TestGradingSectionsHandlerRecoversSnapshotBackedRowAnswers(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(
		"SELECT id, section, answers, grading_status, auto_grading_results FROM section_submissions WHERE submission_id = ?",
	)).WithArgs("submission-1").WillReturnRows(
		sqlmock.NewRows([]string{"id", "section", "answers", "grading_status", "auto_grading_results"}).
			AddRow("section-reading", "reading", `{"type":"reading","answers":{}}`, "auto_graded", nil),
	)
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COALESCE(s.attempt_id, ''), COALESCE(a.protocol_version, 1)
		FROM student_submissions s
		LEFT JOIN student_attempts a ON a.id = s.attempt_id AND a.terminal_generation = s.terminal_generation AND a.submitted_at IS NOT NULL
		WHERE s.id = ? AND s.provider_key = 'ielts'`)).WithArgs("submission-1").WillReturnRows(
		sqlmock.NewRows([]string{"attempt_id", "protocol_version"}).AddRow("attempt-1", 2),
	)
	// The LEFT JOIN columns are NULL for snapshot-backed modules; the module
	// key carries the section identity instead.
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT COALESCE(s.section_key, ''), r.module_id, r.question_id, CAST(r.response AS CHAR)
		FROM attempt_responses_v2 r
		LEFT JOIN assessment_modules m ON m.id = r.module_id
		LEFT JOIN assessment_sections s ON s.id = m.section_id
		WHERE r.attempt_id = ?`)).WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{"section_key", "module_id", "question_id", "response"}).
			AddRow("", "reading", "reading-q1", `{"answer":"option-b","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`).
			AddRow("", "reading", "matching-block", `{"answer":["i",""],"markedForReview":false,"eliminatedOptions":[],"annotations":[]}`).
			AddRow("", "listening", "listening-q5", `{"answer":"science","markedForReview":true,"eliminatedOptions":[],"annotations":[]}`),
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
	nested, ok := answers["answers"].(map[string]any)
	if !ok {
		t.Fatalf("expected nested answer map, got %#v", answers["answers"])
	}
	if nested["reading-q1"] != "option-b" {
		t.Errorf("expected the saved reading answer, got %#v", nested["reading-q1"])
	}
	slots, ok := nested["matching-block"].([]any)
	if !ok || len(slots) != 2 || slots[0] != "i" {
		t.Errorf("expected the saved slot array answer, got %#v", nested["matching-block"])
	}
	if _, leaked := nested["listening-q5"]; leaked {
		t.Errorf("a listening row must not be merged into the reading section: %#v", nested)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

// A module key that is neither a section nor section-prefixed stays
// unresolvable: guessing would file one section's answers under another.
func TestNormalizeReviewSectionKeyRejectsUnknownModules(t *testing.T) {
	cases := map[string]string{
		"reading":            "reading",
		"Reading":            "reading",
		"listening_2":        "listening",
		"reading-part-1":     "reading",
		"writing":            "",
		"":                   "",
		"0f43c69b-9f6a-4d3b": "",
		"relistening":        "",
	}
	for raw, want := range cases {
		if got := reviewSectionKeyForCell("", raw); got != want {
			t.Errorf("reviewSectionKeyForCell(%q) = %q, want %q", raw, got, want)
		}
	}
	if got := reviewSectionKeyForCell("reading", "listening"); got != "reading" {
		t.Errorf("normalized section wins over the module key: got %q", got)
	}
}

func TestGradingWritingTasksHandlerReturnsPromptAndStudentResponse(t *testing.T) {
	t.Run("persisted essay", func(t *testing.T) { testGradingWritingResponse(t, "<p>My saved essay.</p>") })
	t.Run("recover essay sealed under objective answers", func(t *testing.T) { testGradingWritingResponse(t, "") })
	t.Run("exact native writing text", func(t *testing.T) { testGradingWritingResponse(t, "  A\t\u00a0 B &nbsp; <p>literal</p>\n\n  ") })
}

func testGradingWritingResponse(t *testing.T, storedText string) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	submittedAt := time.Date(2026, time.October, 4, 8, 15, 0, 0, time.UTC)
	mock.ExpectQuery(regexp.QuoteMeta(
		`SELECT w.id, w.submission_id, w.task_id, w.task_label, w.prompt, w.student_text,
				w.word_count, w.grading_status, w.submitted_at, COALESCE(a.protocol_version, 1)
			FROM writing_task_submissions w
			LEFT JOIN student_submissions s ON s.id = w.submission_id
			LEFT JOIN student_attempts a ON a.id = s.attempt_id
			WHERE w.submission_id = ?
			ORDER BY w.task_id ASC`,
	)).WithArgs("submission-1").WillReturnRows(
		sqlmock.NewRows([]string{"id", "submission_id", "task_id", "task_label", "prompt", "student_text", "word_count", "grading_status", "submitted_at", "protocol_version"}).
			AddRow("writing-1", "submission-1", "task1", "Task 1", "<p>Describe the chart.</p>", storedText, 3, "needs_review", submittedAt, 2),
	)
	finalSubmission := any(nil)
	if storedText == "" {
		finalSubmission = `{"answers":{"task1":"<p>My saved essay.</p>"},"writingAnswers":{}}`
	}
	mock.ExpectQuery("SELECT a.id, COALESCE\\(a.protocol_version, 1\\), a.final_submission").
		WithArgs("submission-1").WillReturnRows(sqlmock.NewRows([]string{"id", "protocol_version", "final_submission"}).
		AddRow("attempt-1", 1, finalSubmission))

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
	expectedText := storedText
	if expectedText == "" {
		expectedText = "<p>My saved essay.</p>"
	}
	if tasks[0]["studentText"] != expectedText {
		t.Errorf("expected persisted student response in response, got %#v", tasks[0]["studentText"])
	}
	if tasks[0]["responseFormat"] != "plain_text" {
		t.Errorf("native essays must be returned as literal plain text, got %#v", tasks[0]["responseFormat"])
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

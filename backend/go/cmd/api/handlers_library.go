package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/answerhistory"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/library"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// requireLibraryService rejects requests when the library service is not wired.
func requireLibraryService(w http.ResponseWriter, r *http.Request, app *App) bool {
	if app.Library == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Library service is unavailable."))
		return false
	}
	return true
}

// requireAnswerHistoryService rejects requests when the answer-history service is not wired.
func requireAnswerHistoryService(w http.ResponseWriter, r *http.Request, app *App) bool {
	if app.AnswerHistory == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Answer-history service is unavailable."))
		return false
	}
	return true
}

// libraryListFilter builds a library ListFilter from ?difficulty= ?topic=
// ?type= (questions only) ?limit=. Non-positive/garbage limits fall back to
// the service default, mirroring domainQueryInt.
func libraryListFilter(r *http.Request, includeType bool) library.ListFilter {
	var difficulty, topic, typ *string
	if v := strings.TrimSpace(r.URL.Query().Get("difficulty")); v != "" {
		difficulty = &v
	}
	if v := strings.TrimSpace(r.URL.Query().Get("topic")); v != "" {
		topic = &v
	}
	if includeType {
		if v := strings.TrimSpace(r.URL.Query().Get("type")); v != "" {
			typ = &v
		}
	}
	return library.ListFilter{
		Difficulty: difficulty,
		Topic:      topic,
		Type:       typ,
		Limit:      domainQueryInt(r, "limit", 0),
	}
}

// libraryPassagesListHandler lists passages within read scope.
func libraryPassagesListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		out, err := app.Library.ListPassages(r.Context(), actorOf(r.Context()), libraryListFilter(r, false))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []library.Passage{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// libraryPassageCreateHandler inserts a passage scoped to the writable org.
func libraryPassageCreateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		var body struct {
			Title                string          `json:"title"`
			PassageSnapshot      json.RawMessage `json:"passageSnapshot"`
			Difficulty           string          `json:"difficulty"`
			Topic                string          `json:"topic"`
			Tags                 json.RawMessage `json:"tags"`
			WordCount            *int            `json:"wordCount"`
			EstimatedTimeMinutes *int            `json:"estimatedTimeMinutes"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Library.CreatePassage(r.Context(), actorOf(r.Context()), library.CreatePassageRequest{
			Title:                body.Title,
			PassageSnapshot:      body.PassageSnapshot,
			Difficulty:           body.Difficulty,
			Topic:                body.Topic,
			Tags:                 body.Tags,
			WordCount:            body.WordCount,
			EstimatedTimeMinutes: body.EstimatedTimeMinutes,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// libraryPassageGetHandler returns one passage by {id}.
func libraryPassageGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		out, err := app.Library.GetPassage(r.Context(), actorOf(r.Context()), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// libraryPassageUpdateHandler patches a passage with revision fencing.
func libraryPassageUpdateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		var body struct {
			Title                *string         `json:"title"`
			PassageSnapshot      json.RawMessage `json:"passageSnapshot"`
			Difficulty           *string         `json:"difficulty"`
			Topic                *string         `json:"topic"`
			Tags                 json.RawMessage `json:"tags"`
			WordCount            *int            `json:"wordCount"`
			EstimatedTimeMinutes *int            `json:"estimatedTimeMinutes"`
			Revision             *int            `json:"revision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if body.Revision == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision is required."))
			return
		}
		out, err := app.Library.UpdatePassage(r.Context(), actorOf(r.Context()), chi.URLParam(r, "id"), library.UpdatePassageRequest{
			Title:                body.Title,
			PassageSnapshot:      body.PassageSnapshot,
			Difficulty:           body.Difficulty,
			Topic:                body.Topic,
			Tags:                 body.Tags,
			WordCount:            body.WordCount,
			EstimatedTimeMinutes: body.EstimatedTimeMinutes,
			Revision:             *body.Revision,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// libraryPassageDeleteHandler removes a passage within writable scope.
func libraryPassageDeleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		var delBody struct {
			Revision *int `json:"revision"`
		}
		_ = httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &delBody)
		var delRev *int
		if delBody.Revision != nil {
			delRev = delBody.Revision
		} else if q := strings.TrimSpace(r.URL.Query().Get("revision")); q != "" {
			if n, err := strconv.Atoi(q); err == nil {
				delRev = &n
			}
		}
		if err := app.Library.DeletePassage(r.Context(), actorOf(r.Context()), chi.URLParam(r, "id"), delRev); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// libraryPassageIncrementUsageHandler records a successful passage insertion
// into an exam/library consumer.
func libraryPassageIncrementUsageHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil || !requireLibraryService(w, r, app) {
			return
		}
		out, err := app.Library.IncrementPassageUsage(r.Context(), actorOf(r.Context()), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// libraryQuestionsListHandler lists questions within read scope.
func libraryQuestionsListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		out, err := app.Library.ListQuestions(r.Context(), actorOf(r.Context()), libraryListFilter(r, true))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []library.QuestionItem{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// libraryQuestionCreateHandler inserts a question scoped to the writable org.
func libraryQuestionCreateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		var body struct {
			QuestionType  string          `json:"questionType"`
			BlockSnapshot json.RawMessage `json:"blockSnapshot"`
			Difficulty    string          `json:"difficulty"`
			Topic         string          `json:"topic"`
			Tags          json.RawMessage `json:"tags"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Library.CreateQuestion(r.Context(), actorOf(r.Context()), library.CreateQuestionRequest{
			QuestionType:  body.QuestionType,
			BlockSnapshot: body.BlockSnapshot,
			Difficulty:    body.Difficulty,
			Topic:         body.Topic,
			Tags:          body.Tags,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// libraryQuestionGetHandler returns one question by {id}.
func libraryQuestionGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		out, err := app.Library.GetQuestion(r.Context(), actorOf(r.Context()), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// libraryQuestionUpdateHandler patches a question with revision fencing.
func libraryQuestionUpdateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		var body struct {
			QuestionType  *string         `json:"questionType"`
			BlockSnapshot json.RawMessage `json:"blockSnapshot"`
			Difficulty    *string         `json:"difficulty"`
			Topic         *string         `json:"topic"`
			Tags          json.RawMessage `json:"tags"`
			Revision      *int            `json:"revision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if body.Revision == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision is required."))
			return
		}
		out, err := app.Library.UpdateQuestion(r.Context(), actorOf(r.Context()), chi.URLParam(r, "id"), library.UpdateQuestionRequest{
			QuestionType:  body.QuestionType,
			BlockSnapshot: body.BlockSnapshot,
			Difficulty:    body.Difficulty,
			Topic:         body.Topic,
			Tags:          body.Tags,
			Revision:      *body.Revision,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// libraryQuestionDeleteHandler removes a question within writable scope.
func libraryQuestionDeleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		var delQBody struct {
			Revision *int `json:"revision"`
		}
		_ = httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &delQBody)
		var delQRev *int
		if delQBody.Revision != nil {
			delQRev = delQBody.Revision
		} else if q := strings.TrimSpace(r.URL.Query().Get("revision")); q != "" {
			if n, err := strconv.Atoi(q); err == nil {
				delQRev = &n
			}
		}
		if err := app.Library.DeleteQuestion(r.Context(), actorOf(r.Context()), chi.URLParam(r, "id"), delQRev); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// libraryQuestionIncrementUsageHandler records a successful question-bank
// insertion into an exam/library consumer.
func libraryQuestionIncrementUsageHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil || !requireLibraryService(w, r, app) {
			return
		}
		out, err := app.Library.IncrementQuestionUsage(r.Context(), actorOf(r.Context()), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// settingsExamDefaultsGetHandler returns the active exam defaults row.
func settingsExamDefaultsGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		out, err := app.Library.GetExamDefaults(r.Context(), actorOf(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// settingsExamDefaultsPutHandler upserts the writable-org defaults row with revision fencing.
func settingsExamDefaultsPutHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		var body struct {
			ProfileName    *string         `json:"profileName"`
			ConfigSnapshot json.RawMessage `json:"configSnapshot"`
			Revision       *int            `json:"revision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if body.Revision == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Revision is required."))
			return
		}
		out, err := app.Library.UpdateExamDefaults(r.Context(), actorOf(r.Context()), library.UpdateDefaultsRequest{
			ProfileName:    body.ProfileName,
			ConfigSnapshot: body.ConfigSnapshot,
		}, *body.Revision)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// settingsExportProfilesListHandler lists grading export profiles within read scope.
func settingsExportProfilesListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder, auth.RoleGrader) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		out, err := app.Library.ListExportProfiles(r.Context(), actorOf(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []library.ExportProfile{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// settingsExportProfilesCreateHandler inserts a grading export profile.
func settingsExportProfilesCreateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder, auth.RoleGrader) == nil {
			return
		}
		if !requireLibraryService(w, r, app) {
			return
		}
		var body struct {
			ProfileName    string          `json:"profileName"`
			ConfigSnapshot json.RawMessage `json:"configSnapshot"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Library.CreateExportProfile(r.Context(), actorOf(r.Context()), library.CreateExportProfileRequest{
			ProfileName:    body.ProfileName,
			ConfigSnapshot: body.ConfigSnapshot,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// answerHistoryScheduleForSubmission resolves the schedule owning a submission.
// Missing rows map to 404 NOT_FOUND, never a leak.
func answerHistoryScheduleForSubmission(w http.ResponseWriter, r *http.Request, app *App, submissionID string) (string, bool) {
	if app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
		return "", false
	}
	var scheduleID string
	err := app.DB.QueryRowContext(r.Context(),
		`SELECT schedule_id FROM student_submissions WHERE id = ?`,
		submissionID).Scan(&scheduleID)
	if err == sql.ErrNoRows {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
		return "", false
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return "", false
	}
	return scheduleID, true
}

// answerHistoryScheduleForAttempt resolves the schedule owning an attempt.
// Missing rows map to 404 NOT_FOUND, never a leak.
func answerHistoryScheduleForAttempt(w http.ResponseWriter, r *http.Request, app *App, attemptID string) (string, bool) {
	if app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
		return "", false
	}
	var scheduleID string
	err := app.DB.QueryRowContext(r.Context(),
		`SELECT schedule_id FROM student_attempts WHERE id = ?`,
		attemptID).Scan(&scheduleID)
	if err == sql.ErrNoRows {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
		return "", false
	}
	if err != nil {
		httpx.WriteError(w, r, err)
		return "", false
	}
	return scheduleID, true
}

// requireAnswerHistorySchedule enforces schedule-staff assignment without
// opening a transaction: Admin|AdminObserver pass immediately, Grader|Proctor
// must present a live schedule_staff_assignments row. Assignment misses map
// to 404 NOT_FOUND, never a 403 leak.
func requireAnswerHistorySchedule(w http.ResponseWriter, r *http.Request, app *App, sess *auth.Session, scheduleID string) bool {
	if sess.Role == auth.RoleAdmin || sess.Role == auth.RoleAdminObserver {
		return true
	}
	if app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
		return false
	}
	var exists bool
	err := app.DB.QueryRowContext(r.Context(),
		`SELECT EXISTS(SELECT 1 FROM schedule_staff_assignments WHERE schedule_id = ? AND (actor_id = ? OR user_id = ?) AND revoked_at IS NULL)`,
		scheduleID, sess.UserID, sess.UserID).Scan(&exists)
	if err != nil {
		httpx.WriteError(w, r, err)
		return false
	}
	if !exists {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
		return false
	}
	return true
}

// answerHistoryTargetTypeParam reads ?targetType=, defaulting to objective.
func answerHistoryTargetTypeParam(r *http.Request) string {
	if v := strings.TrimSpace(r.URL.Query().Get("targetType")); v != "" {
		return v
	}
	return answerhistory.TargetObjective
}

// answerHistoryCursorParam reads the optional ?cursor= int64 param.
func answerHistoryCursorParam(r *http.Request) *int64 {
	raw := strings.TrimSpace(r.URL.Query().Get("cursor"))
	if raw == "" {
		return nil
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return nil
	}
	return &n
}

// writeAnswerHistoryJSON writes a service RawMessage projection as-is with
// Content-Type application/json (no envelope re-encode).
func writeAnswerHistoryJSON(w http.ResponseWriter, raw json.RawMessage) {
	if len(raw) == 0 {
		raw = json.RawMessage("null")
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(raw)
}

// answerHistoryOverviewHandler returns the per-target revision overview for a submission.
func answerHistoryOverviewHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor)
		if sess == nil {
			return
		}
		if !requireAnswerHistoryService(w, r, app) {
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		scheduleID, ok := answerHistoryScheduleForSubmission(w, r, app, submissionID)
		if !ok {
			return
		}
		if !requireAnswerHistorySchedule(w, r, app, sess, scheduleID) {
			return
		}
		out, err := app.AnswerHistory.GetOverview(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		writeAnswerHistoryJSON(w, out)
	}
}

// answerHistoryTargetDetailHandler returns the checkpoint replay for one submission target.
func answerHistoryTargetDetailHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor)
		if sess == nil {
			return
		}
		if !requireAnswerHistoryService(w, r, app) {
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		scheduleID, ok := answerHistoryScheduleForSubmission(w, r, app, submissionID)
		if !ok {
			return
		}
		if !requireAnswerHistorySchedule(w, r, app, sess, scheduleID) {
			return
		}
		out, err := app.AnswerHistory.GetTargetDetail(r.Context(), submissionID, answerHistoryTargetTypeParam(r), chi.URLParam(r, "targetID"), answerHistoryCursorParam(r), domainQueryInt(r, "limit", 200))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		writeAnswerHistoryJSON(w, out)
	}
}

// answerHistoryExportHandler downloads one submission target as a JSON or CSV file.
func answerHistoryExportHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor)
		if sess == nil {
			return
		}
		if !requireAnswerHistoryService(w, r, app) {
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		scheduleID, ok := answerHistoryScheduleForSubmission(w, r, app, submissionID)
		if !ok {
			return
		}
		if !requireAnswerHistorySchedule(w, r, app, sess, scheduleID) {
			return
		}
		targetType := answerHistoryTargetTypeParam(r)
		if targetType != answerhistory.TargetObjective && targetType != answerhistory.TargetWriting {
			httpx.WriteError(w, r, &apperrors.Error{Code: apperrors.CodeValidation, Message: "targetType must be objective or writing.", HTTPStatus: http.StatusUnprocessableEntity})
			return
		}
		targetID := strings.TrimSpace(r.URL.Query().Get("targetId"))
		if targetID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "targetId is required."))
			return
		}
		format := strings.TrimSpace(r.URL.Query().Get("format"))
		if format == "" {
			format = answerhistory.FormatJSON
		}
		if format != answerhistory.FormatJSON && format != answerhistory.FormatCSV {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "format must be json or csv."))
			return
		}
		filename, contentType, content, err := app.AnswerHistory.ExportTarget(r.Context(), submissionID, targetType, targetID, format)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Content-Disposition", "attachment; filename=\""+strings.ReplaceAll(filename, "\"", "")+"\"")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(content))
	}
}

// answerHistoryOverviewByAttemptHandler returns the per-target revision overview for an attempt.
func answerHistoryOverviewByAttemptHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor)
		if sess == nil {
			return
		}
		if !requireAnswerHistoryService(w, r, app) {
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		scheduleID, ok := answerHistoryScheduleForAttempt(w, r, app, attemptID)
		if !ok {
			return
		}
		if !requireAnswerHistorySchedule(w, r, app, sess, scheduleID) {
			return
		}
		out, err := app.AnswerHistory.GetOverviewByAttempt(r.Context(), attemptID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		writeAnswerHistoryJSON(w, out)
	}
}

// answerHistoryTargetDetailByAttemptHandler returns the checkpoint replay for one attempt target.
func answerHistoryTargetDetailByAttemptHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor)
		if sess == nil {
			return
		}
		if !requireAnswerHistoryService(w, r, app) {
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		scheduleID, ok := answerHistoryScheduleForAttempt(w, r, app, attemptID)
		if !ok {
			return
		}
		if !requireAnswerHistorySchedule(w, r, app, sess, scheduleID) {
			return
		}
		out, err := app.AnswerHistory.GetTargetDetailByAttempt(r.Context(), attemptID, answerHistoryTargetTypeParam(r), chi.URLParam(r, "targetID"), answerHistoryCursorParam(r), domainQueryInt(r, "limit", 200))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		writeAnswerHistoryJSON(w, out)
	}
}

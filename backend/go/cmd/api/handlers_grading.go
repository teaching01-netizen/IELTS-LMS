package main

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/grading"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// Grading policy: reads, SaveDraft, OverrideObjectiveQuestion and
// GradeObjective serve Admin|Grader; MarkComplete, MarkReadyToRelease,
// ReleaseNow and ReopenReview are Admin-only. Results reads serve
// Admin|Grader|Proctor; fetching one result additionally allows Student.

// latestSubmissionForSchedule resolves the newest student_submissions row
// for a schedule (WS-05: thin shim over grading.Service; the SQL lives in
// internal/grading/result_read.go). sql.ErrNoRows surfaces when the schedule
// has none.
func latestSubmissionForSchedule(r *http.Request, app *App, scheduleID string) (string, error) {
	if app.Grading == nil {
		return "", apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured.")
	}
	return app.Grading.LatestSubmissionForSchedule(r.Context(), scheduleID)
}

// latestGradingResult loads the newest student_results row for a submission
// (WS-05: thin shim over grading.Service.LatestGradingResult; the 22-column
// scan lives in internal/grading/result_read.go). Corrupt JSON columns
// surface as *grading.ResultProjectionCorruptError — callers map it via
// writeGradingResultError to the 502 corrupt-projection envelope.
func latestGradingResult(r *http.Request, app *App, submissionID string) (map[string]any, error) {
	if app.Grading == nil {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured.")
	}
	return app.Grading.LatestGradingResult(r.Context(), submissionID)
}

// writeGradingResultError maps result-read failures: corrupt projections
// render the 502 corrupt-projection envelope plus a structured server-side
// log (column + submission + request IDs; raw payloads never logged), every
// other error keeps the stable envelope via httpx.WriteError.
func writeGradingResultError(w http.ResponseWriter, r *http.Request, submissionID string, err error) {
	var corrupt *grading.ResultProjectionCorruptError
	if errors.As(err, &corrupt) {
		telemetry.IncCounter(telemetry.MGradingProjectionCorrupt, "column", corrupt.Column)
		log.Printf(`{"level":"error","msg":"grading projection corrupt","column":%q,"submissionId":%q,"requestId":%q}`,
			corrupt.Column, submissionID, httpx.RequestIDOf(w, r))
		httpx.WriteError(w, r, &apperrors.Error{
			Code:       apperrors.Code("CORRUPT_PROJECTION"),
			Message:    "Grading result projection is corrupt.",
			Details:    map[string]any{"column": corrupt.Column, "submissionId": submissionID},
			HTTPStatus: http.StatusBadGateway,
		})
		return
	}
	httpx.WriteError(w, r, err)
}

// gradingLimitParam parses ?limit= with default 100 capped at 500.
func gradingLimitParam(r *http.Request) int {
	s := strings.TrimSpace(r.URL.Query().Get("limit"))
	if s == "" {
		return 100
	}
	n := 0
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < '0' || c > '9' {
			return 100
		}
		n = n*10 + int(c-'0')
		if n > 500 {
			return 500
		}
	}
	if n <= 0 {
		return 100
	}
	return n
}

// gradingOK renders the shared 200 ok:true envelope.
func gradingOK(w http.ResponseWriter) {
	httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// requireGradingDB rejects requests when the pool is not wired.
func requireGradingDB(w http.ResponseWriter, r *http.Request, app *App) bool {
	if app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
		return false
	}
	return true
}

// gradingOverridesHandler lists schedule-scoped question overrides.
func gradingOverridesHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader) == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		rows, err := app.DB.QueryContext(r.Context(),
			`SELECT question_id, override_json FROM grading_schedule_question_overrides WHERE schedule_id = ?`,
			scheduleID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer rows.Close()
		type row struct {
			QuestionID string          `json:"questionId"`
			Override   json.RawMessage `json:"override"`
		}
		out := []row{}
		for rows.Next() {
			var qid, raw string
			if err := rows.Scan(&qid, &raw); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			out = append(out, row{QuestionID: qid, Override: json.RawMessage(raw)})
		}
		if err := rows.Err(); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// gradingSourceHandler returns the schedule's active objective-grading
// source version (draft version id, null when the schedule grades from
// its published version). Same gates as the overrides handler:
// Admin|Grader with schedule-scoped reads.
func gradingSourceHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader) == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		versionID, err := app.Grading.GradingSourceVersionID(r.Context(), scheduleID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"draftVersionId": versionID})
	}
}

// gradingIntegrityHandler returns the schedule-level objective-grading
// integrity projection (verified counts, roll-up status, issue summaries).
// Same gates as the overrides handler: Admin|Grader schedule-scoped reads.
func gradingIntegrityHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader) == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		overview, err := app.Grading.ObjectiveIntegrityOverview(r.Context(), scheduleID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if overview.Issues == nil {
			overview.Issues = []grading.ObjectiveIntegrityIssue{}
		}
		httpx.WriteJSON(w, http.StatusOK, overview)
	}
}

// gradingOverridePutHandler records a teacher override for one schedule question.
func gradingOverridePutHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		var req struct {
			Section     string  `json:"section"`
			Points      float64 `json:"points"`
			TeacherName string  `json:"teacherName"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		questionID := chi.URLParam(r, "questionID")
		submissionID, err := latestSubmissionForSchedule(r, app, scheduleID)
		if err == sql.ErrNoRows {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Submission not found."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Grading.OverrideObjectiveQuestion(r.Context(), submissionID, req.Section, questionID, req.Points, sess.UserID, req.TeacherName); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		gradingOK(w)
	}
}

// gradingOverrideDeleteHandler removes one schedule-scoped question override.
func gradingOverrideDeleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader) == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		questionID := chi.URLParam(r, "questionID")
		res, err := app.DB.ExecContext(r.Context(),
			`DELETE FROM grading_schedule_question_overrides WHERE schedule_id = ? AND question_id = ?`,
			scheduleID, questionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		n, err := res.RowsAffected()
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if n == 0 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Override not found."))
			return
		}
		gradingOK(w)
	}
}

// gradingRegradeHandler re-runs objective auto-grading for a schedule.
// Graders are fenced to their assigned schedules before the regrade runs.
func gradingRegradeHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		if sess.Role == auth.RoleGrader {
			if err := requireGraderSchedule(r.Context(), app.DB, sess.UserID, chi.URLParam(r, "scheduleID")); err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			}
		}
		var req struct {
			Answers map[string]any `json:"answers"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		submissionID, err := latestSubmissionForSchedule(r, app, scheduleID)
		if err == sql.ErrNoRows {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Submission not found."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		answers := req.Answers
		if answers == nil {
			answers = map[string]any{}
		}
		out, err := app.Grading.GradeObjective(r.Context(), submissionID, answers)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// gradingSubmissionHandler returns one student submission row.
func gradingSubmissionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		submission, err := app.Grading.GetSubmission(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if sess.Role == auth.RoleGrader {
			allowed, err := gradingAssignedScheduleIDs(r.Context(), app.DB, sess.UserID)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			found := false
			for _, sid := range allowed {
				if sid == submission.ScheduleID {
					found = true
					break
				}
			}
			if !found {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"submission": submission,
		})
	}
}

// gradingSectionsHandler lists section submissions for one submission.
func gradingSectionsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		if sess.Role == auth.RoleGrader {
			var scheduleID string
			if err := app.DB.QueryRowContext(r.Context(),
				`SELECT schedule_id FROM student_submissions WHERE id = ?`, submissionID).Scan(&scheduleID); err == sql.ErrNoRows {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			} else if err != nil {
				httpx.WriteError(w, r, err)
				return
			} else if err := requireGraderSchedule(r.Context(), app.DB, sess.UserID, scheduleID); err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			}
		}
		rows, err := app.DB.QueryContext(r.Context(),
			`SELECT id, section, grading_status, auto_grading_results FROM section_submissions WHERE submission_id = ?`,
			submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id, section, status string
			var auto sql.NullString
			if err := rows.Scan(&id, &section, &status, &auto); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			var autoVal any
			if auto.Valid && strings.TrimSpace(auto.String) != "" {
				var v any
				if json.Unmarshal([]byte(auto.String), &v) == nil {
					autoVal = v
				} else {
					autoVal = auto.String
				}
			}
			out = append(out, map[string]any{
				"id": id, "section": section, "gradingStatus": status,
				"autoGradingResults": autoVal,
			})
		}
		if err := rows.Err(); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// gradingOverrideQuestionHandler records a per-question teacher override.
func gradingOverrideQuestionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		var req struct {
			Points      float64 `json:"points"`
			TeacherName string  `json:"teacherName"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		section := chi.URLParam(r, "section")
		questionID := chi.URLParam(r, "questionID")
		if err := app.Grading.OverrideObjectiveQuestion(r.Context(), submissionID, section, questionID, req.Points, sess.UserID, req.TeacherName); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		gradingOK(w)
	}
}

// gradingWritingTasksHandler lists writing task submissions for review.
// Graders are fenced to their assigned schedules like the other
// submission-scoped reads.
func gradingWritingTasksHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		if sess.Role == auth.RoleGrader {
			var scheduleID string
			if err := app.DB.QueryRowContext(r.Context(),
				`SELECT schedule_id FROM student_submissions WHERE id = ?`, submissionID).Scan(&scheduleID); err == sql.ErrNoRows {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			} else if err != nil {
				httpx.WriteError(w, r, err)
				return
			} else if err := requireGraderSchedule(r.Context(), app.DB, sess.UserID, scheduleID); err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			}
		}
		rows, err := app.DB.QueryContext(r.Context(),
			`SELECT w.id, w.task_id, w.task_label, w.grading_status, w.word_count FROM writing_task_submissions w WHERE w.submission_id = ?`,
			submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id, taskID, label, status string
			var words sql.NullInt64
			if err := rows.Scan(&id, &taskID, &label, &status, &words); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			row := map[string]any{
				"id": id, "taskId": taskID, "taskLabel": label,
				"gradingStatus": status,
			}
			if words.Valid {
				row["wordCount"] = words.Int64
			}
			out = append(out, row)
		}
		if err := rows.Err(); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// gradingStartReviewHandler opens a review draft checkpoint. Graders are
// fenced to their assigned schedules before the draft write.
func gradingStartReviewHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		if sess.Role == auth.RoleGrader {
			var scheduleID string
			if err := app.DB.QueryRowContext(r.Context(),
				`SELECT schedule_id FROM student_submissions WHERE id = ?`, submissionID).Scan(&scheduleID); err == sql.ErrNoRows {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			} else if err != nil {
				httpx.WriteError(w, r, err)
				return
			} else if err := requireGraderSchedule(r.Context(), app.DB, sess.UserID, scheduleID); err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			}
		}
		if err := app.Grading.SaveDraft(r.Context(), submissionID, sess.UserID, map[string]any{}); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		draft, err := app.Grading.GetReviewDraft(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, draft)
	}
}

// gradingReviewDraftGetHandler returns the saved review draft checkpoint.
func gradingReviewDraftGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader) == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		draft, err := app.Grading.GetReviewDraft(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, draft)
	}
}

// gradingReviewDraftPutHandler merges and saves the review draft checkpoint.
func gradingReviewDraftPutHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		var req struct {
			Draft         map[string]any `json:"draft"`
			SectionDrafts any            `json:"sectionDrafts"`
			Revision      *int           `json:"revision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		merged := map[string]any{}
		for k, v := range req.Draft {
			merged[k] = v
		}
		if req.SectionDrafts != nil {
			merged["sectionDrafts"] = req.SectionDrafts
		}
		submissionID := chi.URLParam(r, "submissionID")
		if err := app.Grading.SaveDraftWithRevision(r.Context(), submissionID, sess.UserID, merged, req.Revision); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		draft, err := app.Grading.GetReviewDraft(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, draft)
	}
}

// gradingMarkCompleteHandler finalizes grading (admin-only).
func gradingMarkCompleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin)
		if sess == nil {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		if err := app.Grading.MarkComplete(r.Context(), submissionID, sess.UserID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		draft, err := app.Grading.GetReviewDraft(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, draft)
	}
}

// gradingMarkReadyHandler gates a submission for release (admin-only).
func gradingMarkReadyHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin)
		if sess == nil {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		if err := app.Grading.MarkReadyToRelease(r.Context(), submissionID, sess.UserID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		draft, err := app.Grading.GetReviewDraft(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, draft)
	}
}

// gradingReleaseNowHandler releases a ready submission (admin-only).
func gradingReleaseNowHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin)
		if sess == nil {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		if err := app.Grading.ReleaseNow(r.Context(), submissionID, sess.UserID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		result, err := latestGradingResult(r, app, submissionID)
		if err != nil {
			writeGradingResultError(w, r, submissionID, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, result)
	}
}

// gradingScheduleReleaseHandler pins a future release timestamp for a ready
// submission (admin-only). It mirrors ScheduleReleaseRequest.release_at
// (camelCase releaseAt, RFC3339) and renders 422 on a missing or
// unparseable timestamp, matching the task contract; DecodeLimited failures
// keep their 400 envelope via httpx.WriteError.
func gradingScheduleReleaseHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin)
		if sess == nil {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		var req struct {
			ReleaseAt string `json:"releaseAt"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		releaseAt, err := time.Parse(time.RFC3339, strings.TrimSpace(req.ReleaseAt))
		if err != nil {
			httpx.WriteError(w, r, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "releaseAt must be an RFC3339 timestamp.", HTTPStatus: 422})
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		if err := app.Grading.ScheduleRelease(r.Context(), submissionID, sess.UserID, releaseAt); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		draft, err := app.Grading.GetReviewDraft(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, draft)
	}
}

// gradingReopenHandler reopens a finalized submission (admin-only).
func gradingReopenHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin)
		if sess == nil {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		var req struct {
			Reason string `json:"reason"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		submissionID := chi.URLParam(r, "submissionID")
		if err := app.Grading.ReopenReview(r.Context(), submissionID, sess.UserID, req.Reason); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		draft, err := app.Grading.GetReviewDraft(r.Context(), submissionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, draft)
	}
}

// gradingResultEventsHandler serves the best-effort audit trail for a result.
func gradingResultEventsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader) == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		resultID := chi.URLParam(r, "resultID")
		rows, err := app.DB.QueryContext(r.Context(),
			`SELECT id, action, created_at FROM review_events WHERE submission_id = (SELECT submission_id FROM student_results WHERE id = ?) ORDER BY created_at DESC LIMIT 200`,
			resultID)
		if err != nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id, action string
			var created string
			if err := rows.Scan(&id, &action, &created); err != nil {
				httpx.WriteJSON(w, http.StatusOK, []any{})
				return
			}
			out = append(out, map[string]any{
				"id": id, "action": action, "createdAt": created,
			})
		}
		if err := rows.Err(); err != nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsListHandler lists ready-to-release results, optional ?provider=.
func resultsListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Results == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service not configured."))
			return
		}
		provider := strings.TrimSpace(r.URL.Query().Get("provider"))
		out, err := app.Results.ListReadyToRelease(r.Context(), actorOf(r.Context()), provider, gradingLimitParam(r))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsDashboardHandler serves the provider-neutral admin results read
// model. It includes released, ready, reopened, pending, and invalidated
// outcomes so the UI never has to invent rows for a provider.
func resultsDashboardHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Results == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service not configured."))
			return
		}
		provider := strings.TrimSpace(r.URL.Query().Get("provider"))
		out, err := app.Results.ListDashboard(r.Context(), actorOf(r.Context()), provider, gradingLimitParam(r))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsAnalyticsHandler serves aggregate release counters over the latest
// student_results versions (mirrors ResultsService::analytics; roles
// Admin|AdminObserver|Grader|Proctor; tenant actors scope to their org +
// assignment, platform readers see all, no-scope actors see zero rows).
func resultsAnalyticsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Results == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service not configured."))
			return
		}
		out, err := app.Results.Analytics(r.Context(), actorOf(r.Context()))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsExportHandler exports caller-owned result payloads for download.
func resultsExportHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		var req struct {
			SubmissionIDs []string `json:"submissionIds"`
			ProfileID     string   `json:"profileId"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Grading.Export(r.Context(), actorOf(r.Context()), req.SubmissionIDs, req.ProfileID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsSATListHandler lists ready-to-release SAT results.
func resultsSATListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Results == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service not configured."))
			return
		}
		out, err := app.Results.ListReadyToRelease(r.Context(), actorOf(r.Context()), "sat", gradingLimitParam(r))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsACTScienceHandler lists sealed ACT science reports, optional ?scheduleId=.
func resultsACTScienceHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.ACT == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "ACT service not configured."))
			return
		}
		scheduleID := strings.TrimSpace(r.URL.Query().Get("scheduleId"))
		out, err := app.ACT.ListScienceReports(r.Context(), act.ReportFilter{ScheduleID: scheduleID, Limit: gradingLimitParam(r)})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsACTScienceDetailHandler returns one sealed ACT science attempt
// with per-question rows. Same role gate as the ACT list
// (Admin|Grader|Proctor); pending/unsealed attempts surface NOT_FOUND so
// the UI renders its pending empty state instead of a fabricated table.
func resultsACTScienceDetailHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.ACT == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "ACT service not configured."))
			return
		}
		attemptID := strings.TrimSpace(chi.URLParam(r, "attemptID"))
		out, err := app.ACT.GetScienceDetail(r.Context(), actorOf(r.Context()), attemptID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsSATGetHandler returns one SAT result with section detail.
func resultsSATGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Results == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service not configured."))
			return
		}
		resultID := chi.URLParam(r, "resultID")
		out, err := app.Results.GetSATResult(r.Context(), actorOf(r.Context()), resultID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsEventsHandler serves the best-effort release audit trail.
func resultsEventsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		resultID := chi.URLParam(r, "resultID")
		rows, err := app.DB.QueryContext(r.Context(),
			`SELECT id, created_at FROM release_events WHERE result_id = ? ORDER BY created_at DESC LIMIT 200`,
			resultID)
		if err != nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		defer rows.Close()
		out := []map[string]any{}
		for rows.Next() {
			var id, created string
			if err := rows.Scan(&id, &created); err != nil {
				httpx.WriteJSON(w, http.StatusOK, []any{})
				return
			}
			out = append(out, map[string]any{"id": id, "createdAt": created})
		}
		if err := rows.Err(); err != nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// resultsGetHandler re-materializes one released result from its snapshot.
// Students are allowed alongside Admin|Grader|Proctor.
func resultsGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil {
			return
		}
		switch sess.Role {
		case auth.RoleAdmin, auth.RoleGrader, auth.RoleProctor, auth.RoleStudent:
		default:
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Forbidden."))
			return
		}
		if app.Results == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service not configured."))
			return
		}
		resultID := chi.URLParam(r, "resultID")
		out, err := app.Results.RematerializeFromSnapshot(r.Context(), actorOf(r.Context()), resultID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

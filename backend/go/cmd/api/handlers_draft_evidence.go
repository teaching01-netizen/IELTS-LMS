package main

import (
	"net/http"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"github.com/go-chi/chi/v5"
)

// Draft evidence (exam-session continuity FR7). The student route records
// retained drafts under a live exam credential; the proctor routes list them
// and record a one-time review. Nothing here changes answers or scores.

func studentDraftEvidenceHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Exam service is unavailable."))
			return
		}
		var body struct {
			Items []attempts.DraftEvidenceItem `json:"items"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		ack, err := app.Attempts.RecordDraftEvidence(r.Context(), bearer, chi.URLParam(r, "attemptID"), body.Items)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, ack)
	}
}

func proctorDraftEvidenceListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		sess, schedule, ok := requireStaffSchedule(w, r, app)
		if !ok || !requireProctorAttemptScope(w, r, app, sess, schedule.ID) {
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Exam service is unavailable."))
			return
		}
		items, err := app.Attempts.ListDraftEvidence(r.Context(), schedule.ID, chi.URLParam(r, "attemptID"))
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

func proctorDraftEvidenceReviewHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		sess, schedule, ok := requireStaffSchedule(w, r, app)
		if !ok || !requireProctorAttemptScope(w, r, app, sess, schedule.ID) {
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Exam service is unavailable."))
			return
		}
		var body struct {
			Disposition string `json:"disposition"`
			Note        string `json:"note"`
		}
		if err := httpx.DecodeLimited(r, 16<<10, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Attempts.ReviewDraftEvidence(r.Context(), schedule.ID, chi.URLParam(r, "attemptID"), chi.URLParam(r, "evidenceID"), sess.UserID, body.Disposition, body.Note); err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

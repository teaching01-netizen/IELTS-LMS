package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// releaseStateHandler returns the assessment-release state for one exam
// (mirrors get_release_state: Admin|AdminObserver|Builder, then the exams
// existence check, then the release read). The exams 404 passes through
// before the release service runs.
func releaseStateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if app.Exams == nil || app.Release == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Release service is unavailable."))
			return
		}
		examID := chi.URLParam(r, "examID")
		if _, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), examID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Release.Get(r.Context(), examID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

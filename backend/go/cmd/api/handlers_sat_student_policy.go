package main

import (
	"fmt"
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// satStudentPolicyStateHandler serves the student-safe, revisioned policy view
// used by foreground completion and pause controls. The ETag covers the
// projected values as well as the room revision, so a legacy room whose
// fallback changed still invalidates a cached response.
func satStudentPolicyStateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			writeAttemptVerificationError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		if claims.ScheduleID != scheduleID {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule."))
			return
		}
		state, err := app.Delivery.StudentPolicyState(r.Context(), scheduleID, claims.AttemptID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		etag := fmt.Sprintf(`W/"sat-policy-%s-%d-%t-%t-%t-%t"`, scheduleID, state.Revision,
			state.ReportVisible, state.IncludeAnswerKeyInPdf, state.UnlimitedRetakes, state.PauseOnLeave)
		if writeETagOrNotModified(w, r, etag) {
			return
		}
		httpx.WriteJSON(w, http.StatusOK, state)
	}
}

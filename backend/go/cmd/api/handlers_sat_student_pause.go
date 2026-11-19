package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

func satStudentPauseHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		if r.Method == http.MethodGet {
			claims, err := verifyAttemptReadBearer(app, r, bearer)
			if err != nil {
				writeAttemptVerificationError(w, r, err)
				return
			}
			if claims.ScheduleID != scheduleID {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule."))
				return
			}
			out, err := app.Delivery.ReadStudentPause(r.Context(), scheduleID, claims.AttemptID)
			if err != nil {
				httpx.WriteError(w, r, MapDBError(err))
				return
			}
			httpx.WriteJSON(w, http.StatusOK, out)
			return
		}
		claims, err := verifyAttemptWriteBearer(app, r, bearer)
		if err != nil {
			writeAttemptVerificationError(w, r, err)
			return
		}
		if claims.ScheduleID != scheduleID {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule."))
			return
		}
		var body struct {
			Paused       *bool  `json:"paused"`
			ControlEpoch uint64 `json:"controlEpoch"`
		}
		if err := httpx.DecodeLimited(r, 1024, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if body.Paused == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Choose Pause or Resume."))
			return
		}
		out, err := app.Delivery.SetStudentPause(r.Context(), scheduleID, claims.AttemptID, *body.Paused, body.ControlEpoch, claims.ClientSessionID, claims.TokenID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

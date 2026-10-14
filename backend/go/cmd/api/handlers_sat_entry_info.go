package main

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// proctorSessionEntryInfoHandler serves the canonical student join details
// for one SAT room. The shared schedule authorization keeps proctors scoped to
// their assigned room; the response omits roster codes and email addresses.
func proctorSessionEntryInfoHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, schedule, ok := requireStaffSchedule(w, r, app)
		if !ok {
			return
		}
		if strings.ToLower(strings.TrimSpace(schedule.ProviderKey)) != "sat" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
			return
		}
		if app.AccessLinks == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Access-links service is unavailable."))
			return
		}
		info, err := app.AccessLinks.SessionEntryInfo(r.Context(), chi.URLParam(r, "scheduleID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		httpx.WriteJSON(w, http.StatusOK, info)
	}
}

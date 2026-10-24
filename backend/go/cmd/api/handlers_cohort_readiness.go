package main

import (
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/runtime"
	"github.com/go-chi/chi/v5"
	"net/http"
)

func ieltsCohortReadyHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStudentService(w, r, app) {
			return
		}
		var body struct {
			AttemptID         string `json:"attemptId"`
			ClientSessionID   string `json:"clientSessionId"`
			RoundTripMS       *int   `json:"roundTripMs"`
			ContentReady      *bool  `json:"contentReady"`
			LocalStorageReady *bool  `json:"localStorageReady"`
			AudioReady        *bool  `json:"audioReady"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		attemptID, err := attemptIDFromStudentWire(app, r, scheduleID, body.AttemptID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		identity, err := requireV1StudentIdentity(app, r, attemptID, scheduleID, body.ClientSessionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		result, err := app.Runtime.ReadyCohortSection(r.Context(), scheduleID, chi.URLParam(r, "sectionKey"), attemptID, identity.UserID, body.RoundTripMS, runtime.IELTSReadinessSignals{
			ContentReady: body.ContentReady, LocalStorageReady: body.LocalStorageReady, AudioReady: body.AudioReady,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"success": true, "data": result})
	}
}

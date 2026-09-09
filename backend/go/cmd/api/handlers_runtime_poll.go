package main

import (
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/telemetry"
)

// runtimePollHandler serves GET /api/v1/student/sessions/{scheduleID}/runtime
// (plan C3, Polling tier): the versioned runtime poll that replaces student
// sockets. Auth is session or attempt-bearer (bound to the URL schedule).
// sinceRevision == current renders 304 (bandwidth-free steady state);
// otherwise the delta {revision,status,activeSection,pollAfterSecs}.
//
// Visibility bound (explicit, stakeholder-signed): attempt-scoped control
// effects reach students within pollAfterSecs (<=30s steady, 2s fast-lane
// for 60s after control commands); server-side write gates enforce control
// commands on the next write regardless of poll lag.
func runtimePollHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Plan E1: bounded budget on the hottest poll (slow-DB honesty).
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			runtimePollInner(app, w, r)
		})
	}
}

func runtimePollInner(app *App, w http.ResponseWriter, r *http.Request) {
	scheduleID := strings.TrimSpace(chi.URLParam(r, "scheduleID"))
	if scheduleID == "" {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Schedule is required."))
		return
	}
	if app.Runtime == nil || app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable."))
		return
	}
	if !authorizeRuntimePoll(w, r, app, scheduleID) {
		return
	}
	since, ok := parseSinceRevision(w, r)
	if !ok {
		return
	}
	view, notModified, err := app.Runtime.PollView(r.Context(), app.DB, scheduleID, since, time.Now().UTC())
	if err != nil {
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	if notModified {
		telemetry.IncCounter(telemetry.MRuntimePollTotal, "result", "not_modified")
		w.WriteHeader(http.StatusNotModified)
		return
	}
	telemetry.IncCounter(telemetry.MRuntimePollTotal, "result", "delta")
	httpx.WriteJSON(w, http.StatusOK, view)
}

// parseSinceRevision parses ?sinceRevision=N as a non-negative int64
// (pure query contract, unit-pinned): missing = full view (nil, true);
// valid = (rev, true); invalid renders exactly one 400 and returns
// (nil, false). Callers return when ok is false.
func parseSinceRevision(w http.ResponseWriter, r *http.Request) (*int64, bool) {
	raw := strings.TrimSpace(r.URL.Query().Get("sinceRevision"))
	if raw == "" {
		return nil, true
	}
	rev, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || rev < 0 {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "sinceRevision must be a non-negative integer."))
		return nil, false
	}
	return &rev, true
}

// authorizeRuntimePoll accepts a session whose allowed schedules include the
// URL schedule, or an attempt-bearer bound to it. It renders exactly one
// denial and reports false when neither authorizes (same 404/403 shapes as
// the WS upgrade path so poll and socket stay auth-equivalent). SessionOf
// (not requireSession) probes the session so the bearer fallback does not
// double-render when the request is anonymous.
func authorizeRuntimePoll(w http.ResponseWriter, r *http.Request, app *App, scheduleID string) bool {
	if sess := SessionOf(r.Context()); sess != nil {
		if _, err := liveAllowedScheduleIDs(r.Context(), app.DB, sess, liveWebSocketQuery{scheduleID: scheduleID}); err != nil {
			httpx.WriteError(w, r, err)
			return false
		}
		return true
	}
	// No session: fall back to the attempt bearer (bound to the schedule).
	if _, ok := authorizeRuntimePollBearer(w, r, app, scheduleID); ok {
		return true
	}
	return false
}

// authorizeRuntimePollBearer verifies the attempt bearer against the URL
// schedule (mirrors attemptIDFromStudentWire's binding check). It renders
// the denial envelope and reports false on failure.
func authorizeRuntimePollBearer(w http.ResponseWriter, r *http.Request, app *App, scheduleID string) (string, bool) {
	bearer := bearerOf(r)
	if bearer == "" {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "Authentication is required."))
		return "", false
	}
	claims, err := verifyAttemptBearer(app, r, bearer)
	if err != nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
		return "", false
	}
	if claims.ScheduleID != scheduleID {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule."))
		return "", false
	}
	return claims.AttemptID, true
}

package main

import (
	"errors"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// writeAnsweredExam renders the print projection of docs/sat-result.md §4–5
// for both audiences: 429 + Retry-After when the build bound is full (PDF-09),
// no-store because it carries a candidate's responses.
func writeAnsweredExam(w http.ResponseWriter, r *http.Request, out *delivery.AnsweredExam, err error) {
	if errors.Is(err, delivery.ErrAnsweredExamBusy) {
		httpx.WriteRateLimitExceeded(w, r, "answered-exam", "node", 2*time.Second)
		return
	}
	if err != nil {
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, out)
}

// deliveryAnsweredExamHandler serves GET /schedules/{scheduleID}/answered-exam
// to the attempt bearer: the attempt comes from the credential, and only while
// its score report is open.
func deliveryAnsweredExamHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			bearer, ok := requireBearer(w, r)
			if !ok {
				return
			}
			claims, err := verifyAttemptReadBearer(app, r, bearer)
			if err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
				return
			}
			if app.Delivery == nil || app.DB == nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
				return
			}
			out, err := app.Delivery.AnsweredExamForStudent(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"))
			writeAnsweredExam(w, r, out, err)
		})
	}
}

// resultsSATAnsweredExamHandler serves GET /results/sat/attempts/{attemptID}/answered-exam
// to staff inside the results scope (org + schedule assignment).
func resultsSATAnsweredExamHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Results == nil || app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service not configured."))
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		if err := app.Results.AuthorizeSATAttempt(r.Context(), actorOf(r.Context()), attemptID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.AnsweredExam(r.Context(), attemptID)
		writeAnsweredExam(w, r, out, err)
	}
}

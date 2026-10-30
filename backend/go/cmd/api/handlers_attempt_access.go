package main

import (
	"net/http"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"github.com/go-chi/chi/v5"
)

func attemptAccessResumeHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Exam service is unavailable."))
			return
		}
		out, err := app.Attempts.ResumeAccess(r.Context(), bearer, chi.URLParam(r, "attemptID"))
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func attemptSubmissionReceiptHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Exam service is unavailable."))
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		receipt, err := app.Attempts.SubmissionReceipt(r.Context(), bearer, attemptID, r.URL.Query().Get("submissionId"))
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		httpx.WriteJSON(w, http.StatusOK, receipt)
	}
}

// Projection reads may use a sitting grant without account cookies. This
// request-local identity is deliberately not installed as SessionOf: it cannot
// authorize registration, transfer requests, or account/staff operations.
func requireStudentProjectionIdentity(w http.ResponseWriter, r *http.Request, app *App) *auth.Session {
	if r.Header.Get("Authorization") == "" {
		return requireStudentDeps(w, r, app)
	}
	bearer, ok := requireBearer(w, r)
	if !ok {
		return nil
	}
	claims, err := verifyAttemptReadBearer(app, r, bearer)
	if err != nil {
		writeAttemptVerificationError(w, r, err)
		return nil
	}
	if claims.CredentialPolicy != auth.ExamCredentialSitting || claims.ScheduleID != chi.URLParam(r, "scheduleID") {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "This credential cannot read the requested exam sitting."))
		return nil
	}
	if app.Student == nil || app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable."))
		return nil
	}
	return &auth.Session{UserID: claims.UserID, Role: auth.RoleStudent, AttemptCredential: &claims}
}

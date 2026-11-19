package main

import (
	"context"

	"database/sql"
	"errors"
	"github.com/google/uuid"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/satlearning"
	"example.com/ielts-proctoring/internal/schedules"
)

type practiceIdentity struct {
	UserID      string
	DisplayName string
	Email       string
	Account     bool
	Session     *auth.Session
}

// practiceIdentityFor resolves an authenticated account student or the
// retained practice-entry capability. Display names, WCODEs, and arbitrary
// student ids never establish ownership.
func practiceIdentityFor(ctx context.Context, app *App, r *http.Request, scheduleID, capability string) (practiceIdentity, error) {
	if session := SessionOf(ctx); session != nil && session.Role == auth.RoleStudent {
		// An account session or the practice session minted by this schedule's
		// check-in. Both are server-issued; a display email never selects one.
		accountSession := session.Proof.Source == auth.SessionSourceAccount
		practiceSession := session.Proof.Source == auth.SessionSourcePractice &&
			session.Proof.PracticeScheduleID == scheduleID
		if !accountSession && !practiceSession {
			return practiceIdentity{}, apperrors.New(apperrors.CodeUnauthorized, "Open the practice activity to continue.")
		}
		var email, displayName, state string
		if err := app.DB.QueryRowContext(ctx, `SELECT COALESCE(email,''), COALESCE(display_name,''), state
			FROM users WHERE id = ?`, session.UserID).Scan(&email, &displayName, &state); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				return practiceIdentity{}, studentEntryNotFound()
			}
			return practiceIdentity{}, err
		}
		if state != "active" {
			return practiceIdentity{}, apperrors.New(apperrors.CodeUnauthorized, "Practice admission is unavailable.")
		}
		if practiceSession {
			// A practice principal's user row carries the opaque derived address.
			// The browser-facing contact belongs to the attempts it already owns;
			// reusing it keeps the session projection unambiguous after a retake.
			var contact sql.NullString
			if err := app.DB.QueryRowContext(ctx, `SELECT MIN(candidate_email) FROM student_attempts
				WHERE user_id = ? AND schedule_id = ?`, session.UserID, scheduleID).Scan(&contact); err != nil {
				return practiceIdentity{}, err
			}
			if contact.Valid && strings.TrimSpace(contact.String) != "" {
				email = strings.TrimSpace(contact.String)
			}
		}
		return practiceIdentity{UserID: session.UserID, DisplayName: displayName, Email: email, Account: accountSession, Session: session}, nil
	}
	capability = strings.TrimSpace(capability)
	if capability == "" {
		return practiceIdentity{}, apperrors.New(apperrors.CodeUnauthorized, "Open the practice activity to continue.")
	}
	email, err := practiceEntryAddress(scheduleID, capability)
	if err != nil {
		return practiceIdentity{}, err
	}
	var id, displayName, role, state string
	err = app.DB.QueryRowContext(ctx, `SELECT id, COALESCE(display_name,''), role, state FROM users WHERE email = ?`, email).
		Scan(&id, &displayName, &role, &state)
	if errors.Is(err, sql.ErrNoRows) || role != auth.RoleStudent || state != "active" {
		return practiceIdentity{}, apperrors.New(apperrors.CodeUnauthorized, "Open the practice activity to continue.")
	}
	if err != nil {
		return practiceIdentity{}, err
	}
	return practiceIdentity{UserID: id, DisplayName: displayName, Email: email}, nil
}

// requirePracticeCSRF applies to every browser session, account or practice.
// Only the retained entry capability (no session) is exempt, because it is not
// a cookie-authenticated ambient credential.
func requirePracticeCSRF(r *http.Request, identity practiceIdentity) error {
	if identity.Session == nil {
		return nil
	}
	// VerifyCSRF returns a typed *apperrors.Error; convert explicitly so a nil
	// pointer is not carried as a non-nil error interface.
	if err := auth.VerifyCSRF(r, identity.Session.CSRFToken); err != nil {
		return err
	}
	return nil
}

// practiceLearningStateHandler serves the caller's own measured eligibility,
// active attempt, and history. No cross-schedule or cross-student enumeration.
func practiceLearningStateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		if app.DB == nil || app.Schedules == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Practice is unavailable."))
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		identity, err := practiceIdentityFor(r.Context(), app, r, scheduleID, r.URL.Query().Get("entrySession"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		state, err := app.Schedules.PracticeLearningState(r.Context(), scheduleID, identity.UserID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, state)
	}
}

type practiceStartRequest struct {
	Mode            string `json:"mode"`
	Intent          string `json:"intent"`
	ObservedOrdinal int    `json:"observedOrdinal"`
	EntrySession    string `json:"entrySession,omitempty"`
	ClientSessionID string `json:"clientSessionId,omitempty"`
}

func practiceStartHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		if app.DB == nil || app.Schedules == nil || app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Practice is unavailable."))
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		var body practiceStartRequest
		if err := httpx.DecodeLimited(r, 8192, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		identity, err := practiceIdentityFor(r.Context(), app, r, scheduleID, body.EntrySession)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := requirePracticeCSRF(r, identity); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		if key == "" || len(key) > 64 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "A valid Idempotency-Key is required."))
			return
		}
		attempt, err := app.Schedules.StartPracticeAttempt(r.Context(), scheduleID, schedules.PracticeStartInput{
			StudentID: identity.UserID, StudentName: identity.DisplayName, StudentEmail: identity.Email,
			Mode:   satlearning.Mode(strings.ToLower(strings.TrimSpace(body.Mode))),
			Intent: body.Intent, ObservedOrdinal: body.ObservedOrdinal,
			OperationKey: key, ClientSessionID: body.ClientSessionID,
		})
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		clientSessionID := strings.TrimSpace(body.ClientSessionID)
		if clientSessionID == "" && attempt.Disposition == "started" {
			clientSessionID = attempt.ClientSessionID
		}
		if clientSessionID == "" {
			// An existing attempt's writer identity belongs to that browser.
			clientSessionID = uuid.NewString()
		}
		admission, err := admitStudentSession(r.Context(), app, identity.UserID, scheduleID, attempt.AttemptID,
			clientSessionID, nil, auth.ExamGrantOptions{Reauthorize: true})
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		out := map[string]any{
			"scheduleId": attempt.ScheduleID, "attemptId": attempt.AttemptID,
			"ordinal": attempt.Ordinal, "disposition": attempt.Disposition,
			"attemptStatus": attempt.AttemptStatus, "acceptedAt": attempt.AcceptedAt.UTC(),
			"learning": attempt.Learning, "clientSessionId": clientSessionID,
		}
		if admission.Token != "" {
			out["attemptToken"] = admission.Token
			out["attemptExpiresAt"] = admission.ExpiresAt.UTC()
			out["credentialPolicy"] = admission.CredentialPolicy
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// practiceCompletedAttemptsHandler serves the result selector and the selected
// report through the same completed-attempt ownership boundary as PDF export.
func practiceCompletedAttemptsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			writeAttemptVerificationError(w, r, err)
			return
		}
		if claims.ScheduleID != chi.URLParam(r, "scheduleID") {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule."))
			return
		}
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "SAT results are unavailable."))
			return
		}
		ctx := r.Context()
		if attemptID := strings.TrimSpace(r.URL.Query().Get("attemptId")); attemptID != "" {
			result, err := app.Delivery.StudentSATCompletedResult(ctx, claims, attemptID)
			if err != nil {
				httpx.WriteError(w, r, MapDBError(err))
				return
			}
			httpx.WriteJSON(w, http.StatusOK, map[string]any{"result": result})
			return
		}
		attempts, err := app.Delivery.StudentSATCompletedAttempts(ctx, claims)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"attempts": attempts})
	}
}

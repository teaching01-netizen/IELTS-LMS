package main

// Staff-assisted device recovery HTTP surface.
//
// Two routes, both assignment-scoped:
//
//   - GET  /api/v1/proctor/sessions/{scheduleID}/attempts/{attemptID}/device-recovery
//   - POST /api/v1/proctor/sessions/{scheduleID}/attempts/{attemptID}/device-recovery
//
// The GET is a preview: it never fences and remains readable while the
// rollout gate is off, so a sitting already holding recovery state stays
// diagnosable. The POST is the single explicit staff decision that fences the
// old writer and commits the grant. It is replayable by operation id, which is
// what makes a lost response safe; the response carries the live link/code
// only while those secrets can still be used.

import (
	"crypto/sha256"
	"encoding/hex"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

func proctorDeviceRecoveryOptionsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, schedule, ok := requireStaffSchedule(w, r, app)
		if !ok {
			return
		}
		if !requireProctorAttemptScope(w, r, app, sess, schedule.ID) {
			return
		}
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		out, err := app.Delivery.RecoveryOptions(r.Context(), schedule.ID, chi.URLParam(r, "attemptID"))
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		writeDeviceRecoveryJSON(w, out)
	}
}

func proctorIssueDeviceRecoveryHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, schedule, ok := requireStaffSchedule(w, r, app)
		if !ok {
			return
		}
		if !requireProctorAttemptScope(w, r, app, sess, schedule.ID) {
			return
		}
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var body delivery.IssueDeviceRecoveryRequest
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.IssueDeviceRecovery(r.Context(), schedule.ID, chi.URLParam(r, "attemptID"), sess.UserID, body)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		writeDeviceRecoveryJSON(w, out)
	}
}

// writeDeviceRecoveryJSON marks both responses uncacheable: one carries a
// live single-use code, the other carries the current grant state. Neither may
// land in a shared cache or the browser back/forward document cache.
func writeDeviceRecoveryJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Pragma", "no-cache")
	httpx.WriteJSON(w, http.StatusOK, payload)
}

func studentClaimDeviceRecoveryHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req delivery.ClaimDeviceRecoveryRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.ClaimDeviceRecovery(r.Context(), chi.URLParam(r, "grantID"), req)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		writeDeviceRecoveryJSON(w, out)
	}
}

func studentReadyDeviceRecoveryHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Referrer-Policy", "no-referrer")
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req struct {
			BrowserProof string `json:"browserProof"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.ReadyDeviceRecovery(r.Context(), chi.URLParam(r, "grantID"), req.BrowserProof)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		writeDeviceRecoveryJSON(w, out)
	}
}

func studentBeginDeviceRecoveryHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req delivery.BeginDeviceRecoveryRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if req.ExpectedGrantRevision == 0 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "The current recovery revision is required."))
			return
		}

		ua := sha256.Sum256([]byte(r.UserAgent()))
		uaHash := hex.EncodeToString(ua[:])
		out, credential, err := app.Delivery.BeginDeviceRecovery(r.Context(), chi.URLParam(r, "grantID"), req, &uaHash, nil)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		sessionExpires, _ := auth.SessionExpiry(app.Config, auth.RoleStudent, out.ServerNow)
		setCreatedSessionCookies(w, app, auth.RoleStudent, credential.SessionToken, credential.CSRFToken, sessionExpires, out.ServerNow)
		writeDeviceRecoveryJSON(w, map[string]any{"recovery": out, "attemptCredential": map[string]any{"attemptToken": credential.AttemptToken, "expiresAt": credential.AttemptExpiresAt}, "clientSessionId": credential.ClientSessionID})
	}
}

func studentAudioCheckpointHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		claims, err := verifyAttemptReadBearer(app, r, bearerOf(r))
		if err != nil {
			httpx.WriteError(w, r, attemptVerificationError(err))
			return
		}
		if claims.ScheduleID != chi.URLParam(r, "scheduleID") {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Attempt does not match this sitting."))
			return
		}
		if r.Method == http.MethodGet {
			out, err := app.Delivery.ReadAudioCheckpoint(r.Context(), claims, r.URL.Query().Get("partId"))
			if err != nil {
				httpx.WriteError(w, r, MapDBError(err))
				return
			}
			writeDeviceRecoveryJSON(w, out)
			return
		}
		var req delivery.AudioCheckpointRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.SaveAudioCheckpoint(r.Context(), claims, req)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		writeDeviceRecoveryJSON(w, out)
	}
}

func proctorRestoreOriginalDeviceHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, schedule, ok := requireStaffSchedule(w, r, app)
		if !ok {
			return
		}
		if !requireProctorAttemptScope(w, r, app, sess, schedule.ID) {
			return
		}
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req delivery.RestoreOriginalDeviceRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.RestoreOriginalDevice(r.Context(), schedule.ID, chi.URLParam(r, "attemptID"), sess.UserID, req)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		writeDeviceRecoveryJSON(w, out)
	}
}

func studentPrepareOriginalDeviceHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		sess := SessionOf(r.Context())
		if sess == nil || sess.Role != auth.RoleStudent {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "The original student session is required."))
			return
		}
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req struct {
			OperationID          string `json:"operationId"`
			BrowserProof         string `json:"browserProof"`
			OriginalAttemptToken string `json:"originalAttemptToken"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Signature + expiry are required. The stored token stays revoked; the
		// service checks its immutable original binding without granting writes.
		original, err := crypto.VerifyAttemptToken([]byte(app.Config.AuthSecret), time.Now().UTC(), req.OriginalAttemptToken)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeUnauthorized, "The original device proof expired. Ask staff for a new QR and code."))
			return
		}
		out, err := app.Delivery.PrepareOriginalDeviceRecovery(r.Context(), chi.URLParam(r, "scheduleID"), chi.URLParam(r, "attemptID"), sess.UserID, original, delivery.ClaimDeviceRecoveryRequest{OperationID: req.OperationID, BrowserProof: req.BrowserProof})
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		writeDeviceRecoveryJSON(w, out)
	}
}

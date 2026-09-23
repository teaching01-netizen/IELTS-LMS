package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/sat"
)

// deliveryBootstrapHandler bootstraps SAT assessment delivery for one
// schedule. The request carries no body (POST with empty body); the attempt
// bearer token binds schedule + attempt, and the URL schedule id must match
// the bearer schedule id.
func deliveryBootstrapHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Plan E1: bounded budget on the herd path (slow-DB honesty).
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			deliveryBootstrapInner(app, w, r)
		})
	}
}

func deliveryBootstrapInner(app *App, w http.ResponseWriter, r *http.Request) {
	{
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		// Bootstrap is a read (no in-tx fence downstream): the
		// session-bound read verify runs in BOTH verify modes so a
		// revoked or takeover-rotated bearer renders 401 even when
		// ATTEMPT_VERIFY=stateless.
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if app.Delivery == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		urlScheduleID := chi.URLParam(r, "scheduleID")
		// NO conditional read here. The bootstrap payload is a LIVE attempt
		// projection — module attempts, the adaptive Higher/Lower route,
		// responses, timers, proctor state, result — while the only cache
		// validator available is the published exam version
		// (W/"v{versionId}-{revision}"). Routing a candidate from Module 1 into
		// Module 2 Higher does not touch the published version, so a
		// version-scoped 304 kept answering "nothing changed" and the client
		// rehydrated the pre-routing module. Exam-version caching belongs to the
		// genuinely immutable static content tree (loadSections / authored plan),
		// never to attempt state: the assembly below always runs so the response
		// can never be older than the routing decision it must report.
		out, err := app.Delivery.Bootstrap(r.Context(), claims.ScheduleID, claims.AttemptID, urlScheduleID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		// Attempt-state read: safe to re-send, never safe to reuse.
		w.Header().Set("Cache-Control", "no-store")
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// deliverySaveResponseHandler persists one SAT question response
// (PATCH /schedules/{scheduleID}/responses/{examQuestionID}). The attempt
// bearer token binds schedule + attempt, and the URL schedule id must match
// the bearer schedule id.
func deliverySaveResponseHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		// Security P0: delivery writes take the session-bound verify in
		// BOTH modes — a revoked or takeover-rotated bearer must not
		// write, even when ATTEMPT_VERIFY=stateless.
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		// Empty writer identity gets edge-only binding with no in-tx
		// writer-session fence (claimWriterSessionTx skips ""). Every
		// minted bearer carries a clientSessionId — reject the empty
		// case loudly instead of silently weakening the binding.
		if claims.ClientSessionID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if app.Delivery == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req delivery.SaveResponseRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// B2.4: writer claim folds into the mutation tx (claimWriterSessionTx
		// re-checks token revocation + writer session in-tx); no separate
		// pre-tx round trip.
		out, err := app.Delivery.SaveResponse(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "examQuestionID"), req, claims.ClientSessionID, claims.TokenID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// deliveryStartModuleHandler starts one SAT module attempt
// (POST /schedules/{scheduleID}/modules/start). The attempt bearer token
// binds schedule + attempt, and the URL schedule id must match the bearer
// schedule id.
func deliveryStartModuleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		// Security P0: session-bound verify in both modes (see save).
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if claims.ClientSessionID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if app.Delivery == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req delivery.ModuleStartRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// B2.4: writer claim folds into the mutation tx (claimWriterSessionTx
		// re-checks token revocation + writer session in-tx); no separate
		// pre-tx round trip.
		out, err := app.Delivery.StartModule(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), req.ModuleID, claims.ClientSessionID, claims.TokenID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// deliverySubmitModuleHandler submits one SAT module attempt
// (POST /schedules/{scheduleID}/modules/submit). The attempt bearer token
// binds schedule + attempt, and the URL schedule id must match the bearer
// schedule id.
func deliverySubmitModuleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		// Security P0: session-bound verify in both modes (see save).
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if claims.ClientSessionID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if app.Delivery == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req delivery.ModuleSubmitRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// B2.4: writer claim folds into the mutation tx (claimWriterSessionTx
		// re-checks token revocation + writer session in-tx); no separate
		// pre-tx round trip.
		out, err := app.Delivery.SubmitModule(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), req.ModuleID, claims.ClientSessionID, claims.TokenID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// deliverySubmitAssessmentHandler finalizes one SAT assessment
// (POST /schedules/{scheduleID}/submit). It delegates to the SAT
// completion service (true-terminal seal); the bearer schedule claim must
// match the URL schedule id.
func deliverySubmitAssessmentHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		// Security P0: session-bound verify in both modes (see save).
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if claims.ScheduleID != chi.URLParam(r, "scheduleID") {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule."))
			return
		}
		if app.SAT == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var req struct {
			SubmissionID string `json:"submissionId"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.SAT.CompleteAssessment(r.Context(), sat.CompleteRequest{
			ScheduleID:   claims.ScheduleID,
			AttemptID:    claims.AttemptID,
			SubmissionID: req.SubmissionID,
			ActorKind:    "student",
			ActorID:      claims.AttemptID,
			RequestID:    httpx.RequestIDOf(w, r),
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

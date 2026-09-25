package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/sat"
)

func omitDeliverySections(out *delivery.Bootstrap) {
	if out != nil {
		out.Sections = []delivery.DeliverySection{}
	}
}

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

func deliveryStateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			deliveryBootstrapInnerMode(app, w, r, false)
		})
	}
}

func deliveryBootstrapInner(app *App, w http.ResponseWriter, r *http.Request) {
	deliveryBootstrapInnerMode(app, w, r, true)
}

func deliveryBootstrapInnerMode(app *App, w http.ResponseWriter, r *http.Request, includeSections bool) {
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
	if !includeSections {
		omitDeliverySections(out)
	}
	// Attempt-state read: safe to re-send, never safe to reuse.
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, out)
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
//
// It runs on the entry budget: this request sits inside the client's
// three-second offer lead, so a transition that cannot get database capacity
// fails fast as a retryable 503 rather than holding its connection and
// starving the rest of the cohort.
func deliveryStartModuleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		withQueryTimeout(w, r, DefaultEntryTimeout, func(w http.ResponseWriter, r *http.Request) {
			deliveryStartModuleInner(app, w, r)
		})
	}
}

func deliveryStartModuleInner(app *App, w http.ResponseWriter, r *http.Request) {
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
	out, err := app.Delivery.StartModuleOfferAck(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), req.ModuleID, req.Generation, req.ControlEpoch, req.NeedContent, claims.ClientSessionID, claims.TokenID)
	if err != nil {
		writeEntryError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func deliveryEnterModuleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		withQueryTimeout(w, r, DefaultEntryTimeout, func(w http.ResponseWriter, r *http.Request) {
			deliveryEnterModuleInner(app, w, r)
		})
	}
}

func deliveryEnterModuleInner(app *App, w http.ResponseWriter, r *http.Request) {
	claims, ok := verifiedDeliveryWriterClaims(app, w, r)
	if !ok {
		return
	}
	var req delivery.ModuleEntryRequest
	if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out, err := app.Delivery.EnterModuleAck(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), req, claims.ClientSessionID, claims.TokenID)
	if err != nil {
		writeEntryError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

func deliveryMarkStageVisibleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		withQueryTimeout(w, r, DefaultEntryTimeout, func(w http.ResponseWriter, r *http.Request) {
			deliveryMarkStageVisibleInner(app, w, r)
		})
	}
}

// deliveryMarkStageVisibleInner acknowledges the first active frame. The
// response is a compact ack: the candidate is already looking at the module, so
// an attempt projection here would make one entry trigger a second full
// projection for a one-row write.
func deliveryMarkStageVisibleInner(app *App, w http.ResponseWriter, r *http.Request) {
	claims, ok := verifiedDeliveryWriterClaims(app, w, r)
	if !ok {
		return
	}
	var req delivery.ModuleEntryRequest
	if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out, err := app.Delivery.MarkStageVisible(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), req, claims.ClientSessionID, claims.TokenID)
	if err != nil {
		writeEntryError(w, r, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// deliveryModuleEntryStateHandler answers "where is this module entry right
// now?" with a handful of indexed reads and no attempt projection. It is the
// recovery read behind "Retry now" and the lost-response case: the client asks
// the server what actually committed instead of blindly replaying the
// transition command against a database that may already be saturated.
func deliveryModuleEntryStateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		withQueryTimeout(w, r, DefaultEntryTimeout, func(w http.ResponseWriter, r *http.Request) {
			bearer, ok := requireBearer(w, r)
			if !ok {
				return
			}
			// A read that reports authoritative entry state: session-bound verify
			// in both modes, like the bootstrap read.
			claims, err := verifyAttemptReadBearer(app, r, bearer)
			if err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
				return
			}
			if app.Delivery == nil || app.DB == nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
				return
			}
			out, err := app.Delivery.EntryState(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "moduleID"))
			if err != nil {
				writeEntryError(w, r, err)
				return
			}
			// Attempt-state read: safe to re-send, never safe to reuse.
			w.Header().Set("Cache-Control", "no-store")
			httpx.WriteJSON(w, http.StatusOK, out)
		})
	}
}

func deliveryStartBreakHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := verifiedDeliveryWriterClaims(app, w, r)
		if !ok {
			return
		}
		// The optional body carries the control epoch the client believed it
		// held, so a break armed across a pause/resume boundary is refused
		// instead of entering under a frozen clock (mirrors EnterBreak).
		var req delivery.BreakEntryRequest
		if err := httpx.DecodeLimitedOptional(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.StartBreak(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "breakID"), req.ControlEpoch, claims.ClientSessionID, claims.TokenID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func deliveryEnterBreakHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := verifiedDeliveryWriterClaims(app, w, r)
		if !ok {
			return
		}
		var req delivery.BreakEntryRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.EnterBreak(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), req, claims.ClientSessionID, claims.TokenID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func deliveryMarkBreakVisibleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		claims, ok := verifiedDeliveryWriterClaims(app, w, r)
		if !ok {
			return
		}
		var req delivery.BreakEntryRequest
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.MarkBreakVisible(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), req, claims.ClientSessionID, claims.TokenID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// verifiedDeliveryWriterClaims shares the session-bound bearer and writer
// identity gates used by delivery mutations.
func verifiedDeliveryWriterClaims(app *App, w http.ResponseWriter, r *http.Request) (crypto.AttemptClaims, bool) {
	bearer, ok := requireBearer(w, r)
	if !ok {
		return crypto.AttemptClaims{}, false
	}
	claims, err := verifyAttemptReadBearer(app, r, bearer)
	if err != nil || claims.ClientSessionID == "" {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
		return crypto.AttemptClaims{}, false
	}
	if app.Delivery == nil || app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
		return crypto.AttemptClaims{}, false
	}
	return claims, true
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

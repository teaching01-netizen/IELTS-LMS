package main

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// SAT session ownership + device transfer HTTP boundary
// (docs/superpowers/plans/2026-10-06-sat-session-ownership-and-device-transfer.md).
// Handlers decode and dispatch; every ownership rule lives in the attempts
// service transaction.

func transferPolicy(app *App) attempts.TransferPolicy {
	return attempts.TransferPolicy{
		Enabled:     app.Config.SATSingleWriter,
		RequestTTL:  time.Duration(app.Config.SATTransferRequestTTLSecs) * time.Second,
		ApprovalTTL: time.Duration(app.Config.SATTransferApprovalTTLSecs) * time.Second,
	}
}

// Schedule selection gates new claims, never an already-snapshotted owner.
func singleWriterEnabledForSchedule(app *App, scheduleID string) bool {
	if !app.Config.SATSingleWriter {
		return false
	}
	selected := app.Config.SATSingleWriterScheduleIDs
	if selected == "" {
		return true
	}
	for id := range strings.SplitSeq(selected, ",") {
		if strings.TrimSpace(id) == scheduleID {
			return true
		}
	}
	return false
}

// transferBlockedError refuses protected content or writer authority to a
// browser that is not the current owner of a single-writer attempt.
func transferBlockedError() *apperrors.Error {
	e := apperrors.New(apperrors.CodeSessionAlreadyActive, "This attempt is active in another browser or device.")
	e.Details = map[string]any{"reason": "SESSION_ALREADY_ACTIVE"}
	return e
}

// attemptCredentialIssuer issues the writer credential inside the ownership
// transaction that authorized it.
func attemptCredentialIssuer(app *App, userID, scheduleID, attemptID, clientSessionID string) attempts.CredentialIssuer {
	return func(ctx context.Context, q tx.Tx, lease uint64) (string, time.Time, error) {
		l := lease
		return auth.IssueAttemptTokenTx(ctx, q, app.Config, userID, scheduleID, attemptID, clientSessionID, nil, &l, time.Now().UTC())
	}
}

// admitStudentSession is the shared admission path for entry, session
// bootstrap, and credential refresh: never a hardcoded lease, never a writer
// credential for a blocked session.
func admitStudentSession(ctx context.Context, app *App, userID, scheduleID, attemptID, clientSessionID string) (attempts.Admission, error) {
	if app.Attempts == nil {
		return attempts.Admission{}, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable.")
	}
	return app.Attempts.Admit(ctx, attempts.AdmitCommand{
		AttemptID: attemptID, UserID: userID, ClientSessionID: clientSessionID,
		SingleWriterEnabled: singleWriterEnabledForSchedule(app, scheduleID),
	}, attemptCredentialIssuer(app, userID, scheduleID, attemptID, clientSessionID))
}

// admissionPayload is the browser-facing admission summary.
func admissionPayload(a attempts.Admission) map[string]any {
	out := map[string]any{
		"outcome":      a.Outcome,
		"attemptId":    a.AttemptID,
		"leaseEpoch":   a.LeaseEpoch,
		"singleWriter": a.SingleWriter,
	}
	if a.PolicyStage != "" {
		out["policyStage"] = a.PolicyStage
	}
	return out
}

// redactWriterIdentity withholds writer session ids that are not the
// caller's own from a student-facing attempt projection. Under the
// single-writer policy the owner's session id is the writer capability: a
// browser that learned it could present it at entry and be admitted as the
// owner.
func redactWriterIdentity(attempt map[string]any, callerSession string) {
	if attempt == nil {
		return
	}
	callerSession = strings.TrimSpace(callerSession)
	keep := func(v any) bool {
		s, _ := v.(string)
		return callerSession != "" && s == callerSession
	}
	if v, ok := attempt["activeClientSessionId"]; ok && !keep(v) {
		delete(attempt, "activeClientSessionId")
	}
	for _, key := range []string{"integrity", "recovery"} {
		obj, ok := attempt[key].(map[string]any)
		if !ok {
			continue
		}
		if v, ok := obj["clientSessionId"]; ok && !keep(v) {
			cp := make(map[string]any, len(obj))
			for k, val := range obj {
				cp[k] = val
			}
			cp["clientSessionId"] = nil
			attempt[key] = cp
		}
	}
}

func requireStudentTransferDeps(w http.ResponseWriter, r *http.Request, app *App) *auth.Session {
	sess := requireStudentDeps(w, r, app)
	if sess == nil {
		return nil
	}
	if app.Attempts == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
		return nil
	}
	return sess
}

// requesterOf binds a request to the blocked browser's authenticated student
// and the schedule in the URL (checked inside the transaction). The browser's
// writer session id is accepted as proof alongside the cookie session.
func requesterOf(sess *auth.Session, scheduleID, clientSessionID string) attempts.RequesterRef {
	return attempts.RequesterRef{UserID: sess.UserID, AuthSessionID: sess.ID, ScheduleID: scheduleID, ClientSessionID: strings.TrimSpace(clientSessionID)}
}

// studentTransferRequestHandler: a blocked browser asks to become the writer.
func studentTransferRequestHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireStudentTransferDeps(w, r, app)
		if sess == nil {
			return
		}
		var body struct {
			OperationID        string `json:"operationId"`
			AttemptID          string `json:"attemptId"`
			ClientSessionID    string `json:"clientSessionId"`
			ExpectedLeaseEpoch uint64 `json:"expectedLeaseEpoch"`
			ReasonCode         string `json:"reasonCode"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		view, err := app.Attempts.RequestTransfer(r.Context(), attempts.RequestTransferCommand{
			OperationID: strings.TrimSpace(body.OperationID), AttemptID: strings.TrimSpace(body.AttemptID),
			ScheduleID: chi.URLParam(r, "scheduleID"), UserID: sess.UserID, AuthSessionID: sess.ID,
			TargetSessionID: strings.TrimSpace(body.ClientSessionID), ExpectedLeaseEpoch: body.ExpectedLeaseEpoch,
			ReasonCode: strings.TrimSpace(body.ReasonCode),
		}, transferPolicy(app))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"transfer": view})
	}
}

func studentTransferStatusHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireStudentTransferDeps(w, r, app)
		if sess == nil {
			return
		}
		view, err := app.Attempts.TransferStatus(r.Context(), chi.URLParam(r, "requestID"), requesterOf(sess, chi.URLParam(r, "scheduleID"), r.URL.Query().Get("clientSessionId")))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"transfer": view})
	}
}

func studentTransferCancelHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireStudentTransferDeps(w, r, app)
		if sess == nil {
			return
		}
		view, err := app.Attempts.CancelTransfer(r.Context(), chi.URLParam(r, "requestID"), requesterOf(sess, chi.URLParam(r, "scheduleID"), r.URL.Query().Get("clientSessionId")))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"transfer": view})
	}
}

// studentTransferCommitHandler redeems an approved request (or recovers the
// credential of an already-committed one) for the target browser.
func studentTransferCommitHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireStudentTransferDeps(w, r, app)
		if sess == nil {
			return
		}
		var body struct {
			ClientSessionID string `json:"clientSessionId"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		requestID := chi.URLParam(r, "requestID")
		target := strings.TrimSpace(body.ClientSessionID)
		issuerFor := func(attemptID string) attempts.CredentialIssuer {
			return attemptCredentialIssuer(app, sess.UserID, scheduleID, attemptID, target)
		}
		res, err := app.Attempts.CommitTransfer(r.Context(), attempts.CommitTransferCommand{
			RequestID: requestID, TargetSessionID: target, Requester: requesterOf(sess, scheduleID, target),
		}, issuerFor)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"transfer":         res.Transfer,
			"recovered":        res.Recovered,
			"admission":        admissionPayload(res.Admission),
			"attemptId":        res.Admission.AttemptID,
			"attemptToken":     res.Admission.Token,
			"attemptExpiresAt": res.Admission.ExpiresAt.UTC(),
			"clientSessionId":  target,
		})
	}
}

// writerPendingTransferHandler lets the authorized browser see an open
// request for its attempt (so it can flush and confirm, pre-start).
func writerPendingTransferHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		view, err := app.Attempts.PendingTransferForWriter(r.Context(), bearer, strings.TrimSpace(r.URL.Query().Get("attemptId")))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"transfer": view})
	}
}

// writerConfirmTransferHandler is the pre-start self-service approval by the
// currently authorized session.
func writerConfirmTransferHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		view, err := app.Attempts.ConfirmTransferByWriter(r.Context(), bearer, chi.URLParam(r, "requestID"), transferPolicy(app))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"transfer": view})
	}
}

// proctorDeviceTransfersHandler lists open requests for an assigned schedule.
func proctorDeviceTransfersHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		if !requireProctorAttemptScope(w, r, app, sess, scheduleID) {
			return
		}
		if app.Attempts == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		items, err := app.Attempts.ListOpenTransfers(r.Context(), app.DB, scheduleID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"items": items})
	}
}

// proctorDeviceTransferDecisionHandler approves or denies one request.
func proctorDeviceTransferDecisionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		if !requireProctorAttemptScope(w, r, app, sess, scheduleID) {
			return
		}
		if app.Attempts == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Attempt service is unavailable."))
			return
		}
		var body struct {
			Decision                   string `json:"decision"`
			Reason                     string `json:"reason"`
			AcknowledgeUnconfirmedRisk bool   `json:"acknowledgeUnconfirmedRisk"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var approve bool
		switch strings.ToLower(strings.TrimSpace(body.Decision)) {
		case "approve":
			approve = true
		case "deny":
		default:
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "decision must be approve or deny."))
			return
		}
		view, err := app.Attempts.DecideTransfer(r.Context(), attempts.ProctorDecision{
			RequestID: chi.URLParam(r, "requestID"), ScheduleID: scheduleID, ActorID: sess.UserID,
			Approve: approve, Reason: strings.TrimSpace(body.Reason), AcknowledgeUnconfirmedRisk: body.AcknowledgeUnconfirmedRisk,
		}, transferPolicy(app))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"transfer": view})
	}
}

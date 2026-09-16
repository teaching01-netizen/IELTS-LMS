package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/url"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/authoringcoedit"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// Co-edit HTTP surface.
//
// Public (session-authenticated, tenant-scoped by the authoring ACL helpers):
//
//	POST  /api/v1/assessment-authoring/exam-questions/{examQuestionID}/coedit-token
//	PATCH /api/v1/assessment-authoring/question-revisions/{revisionID}/fields
//
// Private (HMAC service-signature authenticated, never reachable from a
// browser because the signing secret ships only to the Hocuspocus singleton):
//
//	POST /internal/authoring-coedit/load
//	POST /internal/authoring-coedit/initialize
//	POST /internal/authoring-coedit/store
//	POST /internal/authoring-coedit/final-store
//	POST /internal/authoring-coedit/rebase
//	POST /internal/authoring-coedit/recover
//
// The private calls are signed over method + path + timestamp + body hash and
// are idempotent, so a replay cannot apply the same state twice.

// coeditPrivateMaxBodyBytes bounds a private request body. It is larger than
// the 4 MiB document cap because the body carries the binary state plus the
// materialized prompt plus JSON framing, and we want the size check to be the
// typed one (413 COEDIT_OVERSIZED), not a body-limit 413.
const coeditPrivateMaxBodyBytes = 8 << 20

// authorCoeditTokenHandler issues a five-minute co-edit token for the selected
// question. The room name and every identity field are server-derived; the
// browser supplies only the exam-question id it already had access to.
func authorCoeditTokenHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		examQuestionID := strings.TrimSpace(chi.URLParam(r, "examQuestionID"))
		sess := requireAuthoringQuestionRead(app, w, r, examQuestionID)
		if sess == nil {
			return
		}
		if !app.Config.AuthoringRealtimeCoediting || app.CoeditTokens == nil || app.Authoring == nil {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeUnavailable)
			httpx.WriteError(w, r, authoringcoedit.ErrServiceDisabled.ToAppError())
			return
		}
		write := authoringcoedit.CanWriteCoedit(sess.Role)
		if !write && !authoringcoedit.CanReadCoedit(sess.Role) {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeRejected)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Authoring access is required."))
			return
		}
		if !app.Config.AuthoringCoeditServiceEnabled {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeUnavailable)
			httpx.WriteError(w, r, authoringcoedit.ErrServiceDisabled.ToAppError())
			return
		}
		if err := recoverExpiredCoeditFreezes(r.Context(), app); err != nil {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeUnavailable)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		identity, err := app.Authoring.CoeditEnsureDocument(r.Context(), examQuestionID, sess.UserID)
		if err != nil {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeRejected)
			writeCoeditError(w, r, err)
			return
		}
		mode := authoringcoedit.ModeRead
		if write {
			mode = authoringcoedit.ModeWrite
		}
		displayName := ""
		if app.AuthoringDisplayNames != nil {
			if name, lookupErr := app.AuthoringDisplayNames.DisplayNameForActor(r.Context(), sess.UserID); lookupErr == nil {
				displayName = name
			}
		}
		token, claims, err := app.CoeditTokens.Mint(authoringcoedit.TokenClaims{
			DocumentName:       string(identity.DocumentName),
			ActorID:            sess.UserID,
			DisplayName:        displayName,
			OrganizationID:     identity.OrganizationID,
			ExamID:             identity.ExamID,
			DraftVersionID:     identity.DraftVersionID,
			ExamQuestionID:     identity.ExamQuestionID,
			QuestionRevisionID: identity.QuestionRevisionID,
			Mode:               mode,
			StateEpoch:         identity.StateEpoch,
			CommitSequence:     identity.CommitSequence,
			WorkspaceRevision:  identity.WorkspaceRevision,
		})
		if err != nil {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeRejected)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeInternal, "Co-edit token could not be issued."))
			return
		}
		authoringcoedit.EmitToken(authoringcoedit.OutcomeAccepted)
		httpx.WriteJSON(w, http.StatusOK, authoringcoedit.CoeditTokenResponse{
			Token:             token,
			DocumentName:      string(identity.DocumentName),
			ServiceURL:        coeditPublicSocketURL(app, r),
			ExpiresAt:         claims.ExpiresAt,
			SchemaVersion:     identity.SchemaVersion,
			FieldSet:          identity.FieldSet,
			Mode:              string(mode),
			ActorID:           sess.UserID,
			DisplayName:       displayName,
			Capability:        app.CoeditCapability(),
			StateEpoch:        identity.StateEpoch,
			CommitSequence:    identity.CommitSequence,
			WorkspaceRevision: identity.WorkspaceRevision,
		})
	}
}

// authorWorkspaceCoeditTokenHandler issues the single exam-level v2 room
// shared by SAT builder, delivery/release, and Student Access. The browser
// supplies only the exam id; the current editable draft and room identity are
// resolved under the same authoring ACL as every other authoring endpoint.
func authorWorkspaceCoeditTokenHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		examID := strings.TrimSpace(chi.URLParam(r, "examID"))
		sess := requireAuthoringExamRead(app, w, r, examID)
		if sess == nil {
			return
		}
		if !app.CoeditCapability() || app.Authoring == nil {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeUnavailable)
			httpx.WriteError(w, r, authoringcoedit.ErrServiceDisabled.ToAppError())
			return
		}
		if err := recoverExpiredCoeditFreezes(r.Context(), app); err != nil {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeUnavailable)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		identity, err := app.Authoring.CoeditEnsureWorkspace(r.Context(), examID, sess.UserID)
		if err != nil {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeRejected)
			writeCoeditError(w, r, err)
			return
		}
		write := authoringcoedit.CanWriteCoedit(sess.Role)
		if !write && !authoringcoedit.CanReadCoedit(sess.Role) {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Authoring access is required."))
			return
		}
		displayName := ""
		if app.AuthoringDisplayNames != nil {
			if name, lookupErr := app.AuthoringDisplayNames.DisplayNameForActor(r.Context(), sess.UserID); lookupErr == nil {
				displayName = name
			}
		}
		mode := authoringcoedit.ModeRead
		if write {
			mode = authoringcoedit.ModeWrite
		}
		token, claims, err := app.CoeditTokens.Mint(authoringcoedit.TokenClaims{
			DocumentName: string(identity.DocumentName), ActorID: sess.UserID,
			DisplayName: displayName, OrganizationID: identity.OrganizationID,
			ExamID: identity.ExamID, DraftVersionID: identity.DraftVersionID,
			FieldSet: authoringcoedit.FieldSetWorkspace, Mode: mode,
			StateEpoch: identity.StateEpoch, CommitSequence: identity.CommitSequence,
			WorkspaceRevision: identity.WorkspaceRevision,
		})
		if err != nil {
			authoringcoedit.EmitToken(authoringcoedit.OutcomeRejected)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeInternal, "Co-edit token could not be issued."))
			return
		}
		authoringcoedit.EmitToken(authoringcoedit.OutcomeAccepted)
		httpx.WriteJSON(w, http.StatusOK, authoringcoedit.CoeditTokenResponse{
			Token: token, DocumentName: string(identity.DocumentName),
			ServiceURL: coeditPublicSocketURL(app, r), ExpiresAt: claims.ExpiresAt,
			SchemaVersion: authoringcoedit.WorkspaceSchemaVersion,
			FieldSet:      authoringcoedit.FieldSetWorkspace, Mode: string(mode),
			ActorID: sess.UserID, DisplayName: displayName, Capability: app.CoeditCapability(),
			StateEpoch: identity.StateEpoch, CommitSequence: identity.CommitSequence,
			WorkspaceRevision: identity.WorkspaceRevision,
		})
	}
}

// coeditPublicSocketURL derives the browser-facing socket URL from the private
// service URL. An explicit AUTHORING_COEDIT_PUBLIC_WS_SCHEME wins; otherwise ws
// for plain http and wss for https (mirroring the page scheme).
func coeditPublicSocketURL(app *App, r *http.Request) string {
	base := strings.TrimRight(strings.TrimSpace(app.Config.AuthoringCoeditServiceURL), "/")
	if base == "" {
		return ""
	}
	scheme := app.Config.AuthoringCoeditPublicWSScheme
	if scheme != "ws" && scheme != "wss" {
		scheme = "ws"
		if r != nil && r.TLS != nil {
			scheme = "wss"
		}
	}
	parsed, err := url.Parse(base)
	if err != nil || parsed.Host == "" {
		return base
	}
	parsed.Scheme = scheme
	return parsed.String()
}

// authorRevisionFieldsHandler applies a partial, allow-listed non-prompt field
// update. `prompt` is structurally absent from the request type, so no client
// can overwrite a collaborative prompt through this path.
func authorRevisionFieldsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		revisionID := strings.TrimSpace(chi.URLParam(r, "revisionID"))
		sess := requireAuthoringRevisionWrite(app, w, r, revisionID)
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req struct {
			Revision      int             `json:"revision"`
			QuestionType  *string         `json:"questionType"`
			Stimulus      json.RawMessage `json:"stimulus"`
			Answer        json.RawMessage `json:"answer"`
			Rationale     json.RawMessage `json:"rationale"`
			Metadata      json.RawMessage `json:"metadata"`
			Accessibility json.RawMessage `json:"accessibility"`
			// Prompt is deliberately NOT decoded. A client that sends it gets
			// a validation error from the strict decoder below rather than a
			// silent success.
			Prompt json.RawMessage `json:"prompt"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if len(strings.TrimSpace(string(req.Prompt))) > 0 {
			authoringcoedit.EmitFieldPatch(authoringcoedit.OutcomeRejected)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation,
				"Prompt is collaborative and cannot be saved through the field patch endpoint."))
			return
		}
		patch := authoring.CoeditFieldPatchFromRequest(req.QuestionType, req.Stimulus, req.Answer, req.Rationale, req.Metadata, req.Accessibility)
		if !patch.Present() {
			authoringcoedit.EmitFieldPatch(authoringcoedit.OutcomeRejected)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "At least one field must be provided."))
			return
		}
		out, err := app.Authoring.PatchRevisionFields(r.Context(), revisionID, sess.UserID, req.Revision, patch)
		if err != nil {
			authoringcoedit.EmitFieldPatch(authoringcoedit.OutcomeRejected)
			writeCoeditError(w, r, err)
			return
		}
		authoringcoedit.EmitFieldPatch(authoringcoedit.OutcomeAccepted)
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// requireCoeditService authenticates a private Hocuspocus call and returns the
// raw body. Every failure is the same uniform 403 so a caller cannot probe for
// route existence or secret length.
func requireCoeditService(app *App, w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	if app.CoeditSigner == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Co-editing service is not configured."))
		return nil, false
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, coeditPrivateMaxBodyBytes))
	if err != nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Request body could not be read."))
		return nil, false
	}
	if err := app.CoeditSigner.Verify(r.Method, r.URL.Path,
		r.Header.Get(authoringcoedit.HeaderServiceTimestamp),
		r.Header.Get(authoringcoedit.HeaderServiceSignature), body); err != nil {
		httpx.WriteError(w, r, authoringcoedit.New(authoringcoedit.CodeSignatureInvalid,
			"Co-edit service signature is invalid.").ToAppError())
		return nil, false
	}
	return body, true
}

// coeditServiceDisabled reports whether the private surface is closed.
func coeditServiceDisabled(app *App, w http.ResponseWriter, r *http.Request) bool {
	if !app.Config.AuthoringRealtimeCoediting || app.Authoring == nil {
		httpx.WriteError(w, r, authoringcoedit.ErrServiceDisabled.ToAppError())
		return true
	}
	return false
}

func coeditLoadHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if coeditServiceDisabled(app, w, r) {
			return
		}
		body, ok := requireCoeditService(app, w, r)
		if !ok {
			return
		}
		var req struct {
			DocumentName string `json:"documentName"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid load request."))
			return
		}
		if _, _, version, parseErr := authoringcoedit.ParseAnyDocumentName(req.DocumentName); parseErr == nil && version == authoringcoedit.WorkspaceSchemaVersion {
			out, err := app.Authoring.CoeditWorkspaceLoad(r.Context(), req.DocumentName)
			if err != nil {
				writeCoeditError(w, r, err)
				return
			}
			httpx.WriteJSON(w, http.StatusOK, out)
			return
		}
		out, err := app.Authoring.CoeditLoad(r.Context(), req.DocumentName)
		if err != nil {
			writeCoeditError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func coeditInitializeHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if coeditServiceDisabled(app, w, r) {
			return
		}
		body, ok := requireCoeditService(app, w, r)
		if !ok {
			return
		}
		var req struct {
			DocumentName string          `json:"documentName"`
			YdocState    []byte          `json:"ydocState"`
			StateVector  []byte          `json:"stateVector"`
			StateHash    string          `json:"stateHash"`
			Prompt       json.RawMessage `json:"prompt"`
			Workspace    json.RawMessage `json:"workspace"`
			ActorID      string          `json:"actorId"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid initialize request."))
			return
		}
		if _, _, version, parseErr := authoringcoedit.ParseAnyDocumentName(req.DocumentName); parseErr == nil && version == authoringcoedit.WorkspaceSchemaVersion {
			out, err := app.Authoring.CoeditWorkspaceInitialize(r.Context(), authoring.CoeditInitializeRequest{
				DocumentName: req.DocumentName, YdocState: req.YdocState, StateVector: req.StateVector,
				StateHash: req.StateHash, Workspace: req.Workspace, ActorID: req.ActorID,
			})
			if err != nil {
				authoringcoedit.EmitStore(authoringcoedit.OutcomeRejected)
				writeCoeditError(w, r, err)
				return
			}
			authoringcoedit.EmitStore(authoringcoedit.OutcomeAccepted)
			httpx.WriteJSON(w, http.StatusOK, out)
			return
		}
		out, err := app.Authoring.CoeditInitialize(r.Context(), authoring.CoeditInitializeRequest{
			DocumentName: req.DocumentName,
			YdocState:    req.YdocState,
			StateVector:  req.StateVector,
			StateHash:    req.StateHash,
			Prompt:       req.Prompt,
			Workspace:    req.Workspace,
			ActorID:      req.ActorID,
		})
		if err != nil {
			authoringcoedit.EmitStore(authoringcoedit.OutcomeRejected)
			writeCoeditError(w, r, err)
			return
		}
		authoringcoedit.EmitStore(authoringcoedit.OutcomeAccepted)
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func coeditStoreHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if coeditServiceDisabled(app, w, r) {
			return
		}
		body, ok := requireCoeditService(app, w, r)
		if !ok {
			return
		}
		var req struct {
			DocumentName      string          `json:"documentName"`
			PreviousStateHash string          `json:"previousStateHash"`
			StateHash         string          `json:"stateHash"`
			YdocState         []byte          `json:"ydocState"`
			StateVector       []byte          `json:"stateVector"`
			Prompt            json.RawMessage `json:"prompt"`
			Workspace         json.RawMessage `json:"workspace"`
			ActorID           string          `json:"actorId"`
			FreezeOperationID string          `json:"freezeOperationId"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid store request."))
			return
		}
		if _, _, version, parseErr := authoringcoedit.ParseAnyDocumentName(req.DocumentName); parseErr == nil && version == authoringcoedit.WorkspaceSchemaVersion {
			out, err := app.Authoring.CoeditWorkspaceStore(r.Context(), authoring.CoeditStoreRequest{
				DocumentName: req.DocumentName, PreviousStateHash: req.PreviousStateHash,
				StateHash: req.StateHash, YdocState: req.YdocState, StateVector: req.StateVector,
				Workspace: req.Workspace, ActorID: req.ActorID, FreezeOperationID: req.FreezeOperationID,
			})
			if err != nil {
				emitCoeditStoreOutcome(err)
				writeCoeditError(w, r, err)
				return
			}
			authoringcoedit.EmitStore(authoringcoedit.OutcomeAccepted)
			httpx.WriteJSON(w, http.StatusOK, out)
			return
		}
		out, err := app.Authoring.CoeditStore(r.Context(), authoring.CoeditStoreRequest{
			DocumentName:      req.DocumentName,
			PreviousStateHash: req.PreviousStateHash,
			StateHash:         req.StateHash,
			YdocState:         req.YdocState,
			StateVector:       req.StateVector,
			Prompt:            req.Prompt,
			Workspace:         req.Workspace,
			ActorID:           req.ActorID,
			FreezeOperationID: req.FreezeOperationID,
		})
		if err != nil {
			emitCoeditStoreOutcome(err)
			writeCoeditError(w, r, err)
			return
		}
		authoringcoedit.EmitStore(authoringcoedit.OutcomeAccepted)
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func coeditFinalStoreHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if coeditServiceDisabled(app, w, r) {
			return
		}
		body, ok := requireCoeditService(app, w, r)
		if !ok {
			return
		}
		var req struct {
			DocumentName      string          `json:"documentName"`
			PreviousStateHash string          `json:"previousStateHash"`
			StateHash         string          `json:"stateHash"`
			YdocState         []byte          `json:"ydocState"`
			StateVector       []byte          `json:"stateVector"`
			Prompt            json.RawMessage `json:"prompt"`
			Workspace         json.RawMessage `json:"workspace"`
			ActorID           string          `json:"actorId"`
			FreezeOperationID string          `json:"freezeOperationId"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid final store request."))
			return
		}
		storeReq := authoring.CoeditStoreRequest{
			DocumentName: req.DocumentName, PreviousStateHash: req.PreviousStateHash,
			StateHash: req.StateHash, YdocState: req.YdocState, StateVector: req.StateVector,
			Prompt: req.Prompt, Workspace: req.Workspace, ActorID: req.ActorID,
			FreezeOperationID: req.FreezeOperationID,
		}
		if _, _, version, parseErr := authoringcoedit.ParseAnyDocumentName(req.DocumentName); parseErr == nil && version == authoringcoedit.WorkspaceSchemaVersion {
			out, err := app.Authoring.CoeditWorkspaceFinalStore(r.Context(), storeReq)
			if err != nil {
				emitCoeditStoreOutcome(err)
				writeCoeditError(w, r, err)
				return
			}
			authoringcoedit.EmitStore(authoringcoedit.OutcomeAccepted)
			httpx.WriteJSON(w, http.StatusOK, out)
			return
		}
		out, err := app.Authoring.CoeditFinalStore(r.Context(), storeReq)
		if err != nil {
			emitCoeditStoreOutcome(err)
			writeCoeditError(w, r, err)
			return
		}
		authoringcoedit.EmitStore(authoringcoedit.OutcomeAccepted)
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func coeditRebaseHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if coeditServiceDisabled(app, w, r) {
			return
		}
		body, ok := requireCoeditService(app, w, r)
		if !ok {
			return
		}
		var req struct {
			DocumentName       string                        `json:"documentName"`
			ExpectedStateHash  string                        `json:"expectedStateHash"`
			ExpectedStateEpoch authoringcoedit.DecimalString `json:"expectedStateEpoch"`
			StateHash          string                        `json:"stateHash"`
			YdocState          []byte                        `json:"ydocState"`
			StateVector        []byte                        `json:"stateVector"`
		}
		if err := json.Unmarshal(body, &req); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid rebase request."))
			return
		}
		rebaseReq := authoring.CoeditRebaseRequest{
			DocumentName: req.DocumentName, ExpectedStateHash: req.ExpectedStateHash,
			ExpectedStateEpoch: req.ExpectedStateEpoch, StateHash: req.StateHash,
			YdocState: req.YdocState, StateVector: req.StateVector,
		}
		var (
			out authoring.CoeditStoreResult
			err error
		)
		if _, _, version, parseErr := authoringcoedit.ParseAnyDocumentName(req.DocumentName); parseErr == nil && version == authoringcoedit.WorkspaceSchemaVersion {
			out, err = app.Authoring.CoeditWorkspaceRebase(r.Context(), rebaseReq)
		} else {
			out, err = app.Authoring.CoeditRebase(r.Context(), rebaseReq)
		}
		if err != nil {
			emitCoeditStoreOutcome(err)
			writeCoeditError(w, r, err)
			return
		}
		authoringcoedit.EmitStore(authoringcoedit.OutcomeAccepted)
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func coeditRecoverHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if coeditServiceDisabled(app, w, r) {
			return
		}
		body, ok := requireCoeditService(app, w, r)
		if !ok {
			return
		}
		if value := strings.TrimSpace(string(body)); value != "" && value != "{}" {
			var payload map[string]any
			if err := json.Unmarshal(body, &payload); err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid recovery request."))
				return
			}
		}
		documents, err := app.Authoring.CoeditRecoverExpiredFreezes(r.Context())
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		workspaces, err := app.Authoring.CoeditWorkspaceRecoverExpiredFreezes(r.Context())
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]int{
			"documentsRecovered":  len(documents),
			"workspacesRecovered": len(workspaces),
		})
	}
}

// recoverExpiredCoeditFreezes is intentionally called immediately before a
// token can create or reuse a room. It is idempotent and keeps a stale
// freezing row from blocking a new lifecycle indefinitely after a crashed
// publish process.
func recoverExpiredCoeditFreezes(ctx context.Context, app *App) error {
	if app == nil || app.Authoring == nil {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable.")
	}
	if _, err := app.Authoring.CoeditRecoverExpiredFreezes(ctx); err != nil {
		return err
	}
	_, err := app.Authoring.CoeditWorkspaceRecoverExpiredFreezes(ctx)
	return err
}

func emitCoeditStoreOutcome(err error) {
	if typed, ok := authoringcoedit.As(err); ok {
		switch typed.Code {
		case authoringcoedit.CodeDocumentFrozen:
			authoringcoedit.EmitStore(authoringcoedit.OutcomeFrozen)
			return
		case authoringcoedit.CodeDocumentClosed:
			authoringcoedit.EmitStore(authoringcoedit.OutcomeClosed)
			return
		case authoringcoedit.CodeOversized:
			authoringcoedit.EmitStore(authoringcoedit.OutcomeOversized)
			return
		case authoringcoedit.CodePreviousHashMismatch, authoringcoedit.CodeRevisionConflict,
			authoringcoedit.CodeSeedConflict, authoringcoedit.CodeActiveConflict,
			authoringcoedit.CodeFreezeConflict, authoringcoedit.CodeEpochMismatch,
			authoringcoedit.CodeFinalStoreRequired, authoringcoedit.CodeStaleCache:
			authoringcoedit.EmitStore(authoringcoedit.OutcomeConflict)
			return
		}
	}
	authoringcoedit.EmitStore(authoringcoedit.OutcomeRejected)
}

// writeCoeditError renders a typed co-edit error through the stable envelope.
func writeCoeditError(w http.ResponseWriter, r *http.Request, err error) {
	if typed, ok := authoringcoedit.As(err); ok {
		httpx.WriteError(w, r, typed.ToAppError())
		return
	}
	httpx.WriteError(w, r, err)
}

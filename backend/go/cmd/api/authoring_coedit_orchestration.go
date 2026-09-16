package main

import (
	"bytes"
	"context"
	"log"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/authoringcoedit"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// Destructive lifecycle orchestration for prompt co-editing.
//
// The rule from the design: no HTTP revision can be published while a room is
// accepting newer edits, and delete/draft replacement/workbook replacement must
// freeze or close affected rooms before stale mutations can be persisted.
//
// These wrappers are deliberately thin and fail-closed:
//   - when the capability is off, or the exam has no active room, the wrapped
//     handler runs exactly as before (byte-identical legacy behavior);
//   - when the service is unreachable while an active room exists, the
//     operation fails closed with a retryable 503 rather than publishing a
//     revision the room may still be editing.

// coeditStatusRecorder captures the wrapped handler's status code while
// streaming the body through unchanged. Publish and the authoring mutations
// return small JSON envelopes, so buffering is bounded by the existing body
// limits.
type coeditStatusRecorder struct {
	http.ResponseWriter
	status int
	buffer bytes.Buffer
}

var coeditLifecycleOperationID = uuid.NewString

func (rec *coeditStatusRecorder) WriteHeader(status int) {
	if rec.status == 0 {
		rec.status = status
	}
	rec.ResponseWriter.WriteHeader(status)
}

func (rec *coeditStatusRecorder) Write(b []byte) (int, error) {
	if rec.status == 0 {
		rec.status = http.StatusOK
	}
	rec.buffer.Write(b)
	return rec.ResponseWriter.Write(b)
}

func (rec *coeditStatusRecorder) statusCode() int {
	if rec.status == 0 {
		return http.StatusOK
	}
	return rec.status
}

// coeditActiveDocuments returns the unclosed rooms for the exam, or nil when
// the capability is off. A DB error is returned so the caller can fail closed.
func coeditActiveDocuments(ctx context.Context, app *App, examID string) ([]authoringcoedit.DocumentName, error) {
	if !app.CoeditCapability() || app.Authoring == nil {
		return nil, nil
	}
	docs, err := app.Authoring.CoeditDocumentsForExam(ctx, examID)
	if err != nil {
		return nil, err
	}
	names := make([]authoringcoedit.DocumentName, 0, len(docs))
	for _, doc := range docs {
		var name authoringcoedit.DocumentName
		var err error
		if doc.SchemaVersion == authoringcoedit.WorkspaceSchemaVersion || doc.FieldSet == authoringcoedit.FieldSetWorkspace {
			name, err = authoringcoedit.NewWorkspaceDocumentName(doc.ID)
		} else {
			name, err = authoringcoedit.NewDocumentName(doc.ID)
		}
		if err != nil {
			continue
		}
		names = append(names, name)
	}
	return names, nil
}

func coeditNameStrings(names []authoringcoedit.DocumentName) []string {
	out := make([]string, 0, len(names))
	for _, name := range names {
		out = append(out, string(name))
	}
	return out
}

func coeditDocumentIDs(names []authoringcoedit.DocumentName) []string {
	out := make([]string, 0, len(names))
	for _, name := range names {
		if _, id, err := authoringcoedit.ParseDocumentName(string(name)); err == nil {
			out = append(out, id)
		}
	}
	return out
}

func coeditWorkspaceIDs(names []authoringcoedit.DocumentName) []string {
	out := make([]string, 0, len(names))
	for _, name := range names {
		_, id, schemaVersion, err := authoringcoedit.ParseAnyDocumentName(string(name))
		if err == nil && schemaVersion == authoringcoedit.WorkspaceSchemaVersion {
			out = append(out, id)
		}
	}
	return out
}

func newCoeditLifecycleOperation() authoringcoedit.CoeditLifecycleOperation {
	return authoringcoedit.CoeditLifecycleOperation{
		FreezeOperationID: coeditLifecycleOperationID(),
		FreezeExpiresAt:   time.Now().UTC().Add(time.Duration(authoringcoedit.FreezeLeaseSeconds) * time.Second).Unix(),
	}
}

type coeditLeaseHeartbeat struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	mu     sync.Mutex
	err    error
}

func startCoeditLeaseHeartbeat(ctx context.Context, app *App, ids, workspaceIDs []string, lease string, operation authoringcoedit.CoeditLifecycleOperation) *coeditLeaseHeartbeat {
	heartbeatCtx, cancel := context.WithCancel(ctx)
	h := &coeditLeaseHeartbeat{ctx: heartbeatCtx, cancel: cancel, done: make(chan struct{})}
	go func() {
		defer close(h.done)
		interval := time.Duration(authoringcoedit.FreezeLeaseSeconds)*time.Second/2 - time.Second
		if interval <= 0 {
			interval = time.Second
		}
		ticker := time.NewTicker(interval)
		defer ticker.Stop()
		for {
			select {
			case <-heartbeatCtx.Done():
				return
			case <-ticker.C:
				renewed := operation
				renewed.FreezeExpiresAt = time.Now().UTC().Add(time.Duration(authoringcoedit.FreezeLeaseSeconds) * time.Second).Unix()
				if err := app.Authoring.CoeditRenewFreeze(heartbeatCtx, ids, renewed); err != nil {
					h.setError(err)
					return
				}
				if err := app.Authoring.CoeditWorkspaceRenewFreeze(heartbeatCtx, workspaceIDs, renewed); err != nil {
					h.setError(err)
					return
				}
				if err := app.CoeditControl.Renew(heartbeatCtx, authoringcoedit.RenewRequest{
					FreezeToken: lease, FreezeOperationID: operation.FreezeOperationID,
					FreezeExpiresAt: renewed.FreezeExpiresAt,
				}); err != nil {
					h.setError(err)
					return
				}
			}
		}
	}()
	return h
}

func (h *coeditLeaseHeartbeat) setError(err error) {
	h.mu.Lock()
	if h.err == nil {
		h.err = err
	}
	h.mu.Unlock()
	h.cancel()
}

func (h *coeditLeaseHeartbeat) stop() error {
	if h == nil {
		return nil
	}
	h.cancel()
	<-h.done
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.err
}

func coeditAbortFreeze(ctx context.Context, app *App, names []authoringcoedit.DocumentName, lease string, operation authoringcoedit.CoeditLifecycleOperation) {
	if lease != "" {
		_ = app.CoeditControl.Unfreeze(ctx, authoringcoedit.UnfreezeRequest{
			FreezeToken: lease, FreezeOperationID: operation.FreezeOperationID,
		})
	}
	ids := coeditDocumentIDs(names)
	workspaceIDs := coeditWorkspaceIDs(names)
	// These calls are deliberately independent: a partial v1/v2 cleanup must
	// never hide the other family behind an else-if or early return.
	_ = app.Authoring.CoeditAbortFreeze(ctx, ids, operation)
	_ = app.Authoring.CoeditWorkspaceAbortFreeze(ctx, workspaceIDs, operation)
}

func coeditCloseAfterSuccess(ctx context.Context, app *App, names []authoringcoedit.DocumentName, operation authoringcoedit.CoeditLifecycleOperation, reason authoringcoedit.CloseReason) error {
	controlErr := app.CoeditControl.Close(ctx, authoringcoedit.CloseRequest{
		DocumentNames: coeditNameStrings(names), Reason: string(reason),
		FreezeOperationID: operation.FreezeOperationID,
	})
	ids := coeditDocumentIDs(names)
	workspaceIDs := coeditWorkspaceIDs(names)
	// Durable close is attempted even when service close fails. It keeps the
	// successful destructive mutation fenced instead of reopening stale rooms.
	documentErr := app.Authoring.CoeditCloseDocuments(ctx, ids, reason)
	workspaceErr := app.Authoring.CoeditWorkspaceCloseDocuments(ctx, workspaceIDs, reason)
	if controlErr != nil {
		return controlErr
	}
	if documentErr != nil {
		return documentErr
	}
	return workspaceErr
}

// coeditPublishGuard implements the publish freeze/flush/commit protocol.
func coeditPublishGuard(app *App, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !app.CoeditCapability() {
			next(w, r)
			return
		}
		examID := strings.TrimSpace(chi.URLParam(r, "id"))
		names, err := coeditActiveDocuments(r.Context(), app, examID)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		if len(names) == 0 {
			next(w, r)
			return
		}
		ids := coeditDocumentIDs(names)
		workspaceIDs := coeditWorkspaceIDs(names)
		// coeditFreeze verifies both the manifest and the operation owner before
		// returning, so only the lease is needed here.
		_, lease, operation, ok := coeditFreeze(w, r, app, names, "publish")
		if !ok {
			return
		}
		heartbeat := startCoeditLeaseHeartbeat(r.Context(), app, ids, workspaceIDs, lease, operation)
		defer func() { _ = heartbeat.stop() }()
		recorder := &coeditStatusRecorder{ResponseWriter: w}
		next(recorder, r.WithContext(heartbeatContext(r.Context(), heartbeat)))
		if recorder.statusCode() >= 400 {
			// Publish failed: unfreeze so authors keep working. A failed
			// unfreeze is recovered by the freeze lease expiry.
			coeditAbortFreeze(r.Context(), app, names, lease, operation)
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeRejected)
			return
		}
		if heartbeatErr := heartbeat.stop(); heartbeatErr != nil {
			// A successful handler response has already committed the mutation;
			// never reopen its durable rows after a lost heartbeat. Leave them
			// fenced for explicit recovery/close.
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeUnavailable)
			return
		}
		if err := coeditCloseAfterSuccess(r.Context(), app, names, operation, authoringcoedit.CloseExamPublished); err != nil {
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeUnavailable)
		} else {
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeAccepted)
		}
	}
}

func heartbeatContext(ctx context.Context, heartbeat *coeditLeaseHeartbeat) context.Context {
	// The heartbeat owns cancellation internally; this helper keeps the request
	// context stable until the first renewal failure. Long-running handlers that
	// honor cancellation then stop before committing an unprotected mutation.
	if heartbeat == nil || heartbeat.ctx == nil {
		return ctx
	}
	return heartbeat.ctx
}

// startCoeditRecoveryLoop keeps a crashed coordinator from leaving durable
// freezing rows stuck forever. The loop is cancellable by main during
// shutdown; token issuance also invokes the same idempotent recovery function
// immediately before creating a room.
func startCoeditRecoveryLoop(ctx context.Context, app *App) context.CancelFunc {
	if app == nil || app.Authoring == nil || !app.CoeditCapability() {
		return func() {}
	}
	loopCtx, cancel := context.WithCancel(ctx)
	go func() {
		ticker := time.NewTicker(time.Duration(authoringcoedit.FreezeLeaseSeconds) * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-loopCtx.Done():
				return
			case <-ticker.C:
				recoveryCtx, recoveryCancel := context.WithTimeout(loopCtx, 10*time.Second)
				if err := recoverExpiredCoeditFreezes(recoveryCtx, app); err != nil && loopCtx.Err() == nil {
					// A token request will retry this same recovery at the
					// boundary. Do not make the periodic loop a process killer.
					// The durable rows remain fenced until a successful pass.
					log.Printf("api: co-edit freeze recovery pass failed: %v", err)
				}
				recoveryCancel()
			}
		}
	}()
	return cancel
}

// coeditFreeze freezes rooms, marks rows freezing, and verifies the manifest
// against MySQL. A failure fails the caller closed with a retryable 503.
func coeditFreeze(w http.ResponseWriter, r *http.Request, app *App, names []authoringcoedit.DocumentName, reason string) ([]authoringcoedit.FreezeManifestEntry, string, authoringcoedit.CoeditLifecycleOperation, bool) {
	ids := coeditDocumentIDs(names)
	workspaceIDs := coeditWorkspaceIDs(names)
	operation := newCoeditLifecycleOperation()
	if err := app.Authoring.CoeditMarkFreezing(r.Context(), ids, operation); err != nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
		return nil, "", operation, false
	}
	if err := app.Authoring.CoeditWorkspaceMarkFreezing(r.Context(), workspaceIDs, operation); err != nil {
		_ = app.Authoring.CoeditAbortFreeze(r.Context(), ids, operation)
		_ = app.Authoring.CoeditWorkspaceAbortFreeze(r.Context(), workspaceIDs, operation)
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
		return nil, "", operation, false
	}
	frozen, err := app.CoeditControl.Freeze(r.Context(), authoringcoedit.FreezeRequest{
		DocumentNames:     coeditNameStrings(names),
		Reason:            reason,
		FreezeOperationID: operation.FreezeOperationID,
		FreezeExpiresAt:   operation.FreezeExpiresAt,
	})
	if err != nil {
		_ = app.Authoring.CoeditAbortFreeze(r.Context(), ids, operation)
		_ = app.Authoring.CoeditWorkspaceAbortFreeze(r.Context(), workspaceIDs, operation)
		authoringcoedit.EmitLifecycle(authoringcoedit.CloseReason(reason), authoringcoedit.OutcomeUnavailable)
		writeCoeditError(w, r, err)
		return nil, "", operation, false
	}
	if frozen.FreezeOperationID != "" && frozen.FreezeOperationID != operation.FreezeOperationID {
		coeditAbortFreeze(r.Context(), app, names, frozen.FreezeToken, operation)
		authoringcoedit.EmitManifestMismatch()
		writeCoeditError(w, r, authoringcoedit.New(authoringcoedit.CodeFreezeConflict, "The collaboration freeze owner changed; try again.").ToAppError())
		return nil, "", operation, false
	}
	if strings.TrimSpace(frozen.FreezeToken) == "" {
		coeditAbortFreeze(r.Context(), app, names, "", operation)
		authoringcoedit.EmitLifecycle(authoringcoedit.CloseReason(reason), authoringcoedit.OutcomeUnavailable)
		writeCoeditError(w, r, authoringcoedit.ErrServiceUnavailable)
		return nil, "", operation, false
	}
	if frozen.FreezeExpiresAt != 0 && frozen.FreezeExpiresAt < operation.FreezeExpiresAt {
		coeditAbortFreeze(r.Context(), app, names, frozen.FreezeToken, operation)
		authoringcoedit.EmitManifestMismatch()
		writeCoeditError(w, r, authoringcoedit.New(authoringcoedit.CodeFreezeConflict, "The collaboration freeze lease is too short; try again.").ToAppError())
		return nil, "", operation, false
	}
	if err := app.Authoring.CoeditVerifyManifestOwned(r.Context(), names, frozen.Manifest, operation); err != nil {
		coeditAbortFreeze(r.Context(), app, names, frozen.FreezeToken, operation)
		writeCoeditError(w, r, err)
		return nil, "", operation, false
	}
	return frozen.Manifest, frozen.FreezeToken, operation, true
}

// coeditScopeCloseGuard freezes and operation-owned-final-stores the affected
// rooms before a destructive mutation runs, then closes them afterwards. The
// shared freeze helper verifies the durable ownership boundary for both room
// families before the mutation is admitted.
func coeditScopeCloseGuard(app *App, reason authoringcoedit.CloseReason, param string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !app.CoeditCapability() {
			next(w, r)
			return
		}
		names, err := coeditActiveDocuments(r.Context(), app, strings.TrimSpace(chi.URLParam(r, param)))
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		if len(names) == 0 {
			next(w, r)
			return
		}
		_, lease, operation, ok := coeditFreeze(w, r, app, names, string(reason))
		if !ok {
			return
		}
		heartbeat := startCoeditLeaseHeartbeat(r.Context(), app, coeditDocumentIDs(names), coeditWorkspaceIDs(names), lease, operation)
		defer func() { _ = heartbeat.stop() }()
		recorder := &coeditStatusRecorder{ResponseWriter: w}
		next(recorder, r.WithContext(heartbeatContext(r.Context(), heartbeat)))
		if recorder.statusCode() >= 400 {
			coeditAbortFreeze(r.Context(), app, names, lease, operation)
			authoringcoedit.EmitLifecycle(reason, authoringcoedit.OutcomeRejected)
			return
		}
		if heartbeatErr := heartbeat.stop(); heartbeatErr != nil {
			authoringcoedit.EmitLifecycle(reason, authoringcoedit.OutcomeUnavailable)
			return
		}
		if err := coeditCloseAfterSuccess(r.Context(), app, names, operation, reason); err != nil {
			authoringcoedit.EmitLifecycle(reason, authoringcoedit.OutcomeUnavailable)
			return
		}
		authoringcoedit.EmitLifecycle(reason, authoringcoedit.OutcomeAccepted)
	}
}

// coeditQuestionDeleteGuard freezes the target question's room (if any) before
// the fenced delete, then closes it with question_deleted.
func coeditQuestionDeleteGuard(app *App, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !app.CoeditCapability() {
			next(w, r)
			return
		}
		examQuestionID := strings.TrimSpace(chi.URLParam(r, "examQuestionID"))
		active, err := app.Authoring.CoeditActiveForQuestion(r.Context(), examQuestionID)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		if !active {
			next(w, r)
			return
		}
		// Resolve the room via its exam so the control call carries a name the
		// service already knows about.
		var examID string
		if app.DB != nil {
			_ = app.DB.QueryRowContext(r.Context(), `SELECT e.id FROM assessment_exam_questions eq
 JOIN assessment_modules m ON m.id = eq.module_id
 JOIN assessment_sections s ON s.id = m.section_id
 JOIN exam_versions v ON v.id = s.exam_version_id
 JOIN exam_entities e ON e.id = v.exam_id WHERE eq.id = ?`, examQuestionID).Scan(&examID)
		}
		var names []authoringcoedit.DocumentName
		if examID != "" {
			names, err = coeditActiveDocuments(r.Context(), app, examID)
			if err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
				return
			}
		}
		if len(names) == 0 {
			next(w, r)
			return
		}
		_, lease, operation, ok := coeditFreeze(w, r, app, names, string(authoringcoedit.CloseQuestionDeleted))
		if !ok {
			return
		}
		heartbeat := startCoeditLeaseHeartbeat(r.Context(), app, coeditDocumentIDs(names), coeditWorkspaceIDs(names), lease, operation)
		defer func() { _ = heartbeat.stop() }()
		recorder := &coeditStatusRecorder{ResponseWriter: w}
		next(recorder, r.WithContext(heartbeatContext(r.Context(), heartbeat)))
		if recorder.statusCode() >= 400 {
			coeditAbortFreeze(r.Context(), app, names, lease, operation)
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseQuestionDeleted, authoringcoedit.OutcomeRejected)
			return
		}
		if heartbeatErr := heartbeat.stop(); heartbeatErr != nil {
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseQuestionDeleted, authoringcoedit.OutcomeUnavailable)
			return
		}
		if err := coeditCloseAfterSuccess(r.Context(), app, names, operation, authoringcoedit.CloseQuestionDeleted); err != nil {
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseQuestionDeleted, authoringcoedit.OutcomeUnavailable)
			return
		}
		authoringcoedit.EmitLifecycle(authoringcoedit.CloseQuestionDeleted, authoringcoedit.OutcomeAccepted)
	}
}

package main

import (
	"bytes"
	"context"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

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
		manifest, lease, ok := coeditFreeze(w, r, app, names, "publish")
		if !ok {
			return
		}
		recorder := &coeditStatusRecorder{ResponseWriter: w}
		next(recorder, r)
		if recorder.statusCode() >= 400 {
			// Publish failed: unfreeze so authors keep working. A failed
			// unfreeze is recovered by the freeze lease expiry.
			_ = app.CoeditControl.Unfreeze(r.Context(), authoringcoedit.UnfreezeRequest{FreezeToken: lease})
			_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
			_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), coeditWorkspaceIDs(names))
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeRejected)
			return
		}
		if err := app.CoeditControl.Close(r.Context(), authoringcoedit.CloseRequest{
			DocumentNames: coeditNameStrings(names),
			Reason:        string(authoringcoedit.CloseExamPublished),
		}); err != nil {
			// The publish committed. Closing is best-effort: the lease and the
			// next load both refuse a published draft, so a failed close
			// degrades to a read-only room rather than a correctness hole.
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeUnavailable)
		}
		if err := app.Authoring.CoeditCloseDocuments(r.Context(), ids, authoringcoedit.CloseExamPublished); err != nil {
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeUnavailable)
		} else if err := app.Authoring.CoeditWorkspaceCloseDocuments(r.Context(), coeditWorkspaceIDs(names), authoringcoedit.CloseExamPublished); err != nil {
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeUnavailable)
		} else {
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseExamPublished, authoringcoedit.OutcomeAccepted)
		}
		_ = manifest
	}
}

// coeditFreeze freezes rooms, marks rows freezing, and verifies the manifest
// against MySQL. A failure fails the caller closed with a retryable 503.
func coeditFreeze(w http.ResponseWriter, r *http.Request, app *App, names []authoringcoedit.DocumentName, reason string) ([]authoringcoedit.FreezeManifestEntry, string, bool) {
	ids := coeditDocumentIDs(names)
	workspaceIDs := coeditWorkspaceIDs(names)
	if err := app.Authoring.CoeditMarkFreezing(r.Context(), ids); err != nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
		return nil, "", false
	}
	if err := app.Authoring.CoeditWorkspaceMarkFreezing(r.Context(), workspaceIDs); err != nil {
		_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
		_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
		return nil, "", false
	}
	frozen, err := app.CoeditControl.Freeze(r.Context(), authoringcoedit.FreezeRequest{
		DocumentNames: coeditNameStrings(names),
		Reason:        reason,
	})
	if err != nil {
		_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
		_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
		authoringcoedit.EmitLifecycle(authoringcoedit.CloseReason(reason), authoringcoedit.OutcomeUnavailable)
		writeCoeditError(w, r, err)
		return nil, "", false
	}
	if err := app.Authoring.CoeditVerifyManifest(r.Context(), frozen.Manifest); err != nil {
		_ = app.CoeditControl.Unfreeze(r.Context(), authoringcoedit.UnfreezeRequest{FreezeToken: frozen.FreezeToken})
		_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
		_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
		authoringcoedit.EmitManifestMismatch()
		writeCoeditError(w, r, err)
		return nil, "", false
	}
	return frozen.Manifest, frozen.FreezeToken, true
}

// coeditScopeCloseGuard freezes and flushes the affected rooms before a
// destructive mutation runs, then closes them afterwards. Unlike publish it
// does not verify a manifest: the mutation itself is the authority, and the
// rooms are being torn down rather than snapshotted.
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
		ids := coeditDocumentIDs(names)
		workspaceIDs := coeditWorkspaceIDs(names)
		if err := app.Authoring.CoeditMarkFreezing(r.Context(), ids); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		if err := app.Authoring.CoeditWorkspaceMarkFreezing(r.Context(), workspaceIDs); err != nil {
			_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
			_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
			return
		}
		if err := app.CoeditControl.Flush(r.Context(), authoringcoedit.FlushRequest{
			DocumentNames: coeditNameStrings(names),
		}); err != nil {
			_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
			_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
			authoringcoedit.EmitLifecycle(reason, authoringcoedit.OutcomeUnavailable)
			writeCoeditError(w, r, err)
			return
		}
		recorder := &coeditStatusRecorder{ResponseWriter: w}
		next(recorder, r)
		if recorder.statusCode() >= 400 {
			_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
			_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
			authoringcoedit.EmitLifecycle(reason, authoringcoedit.OutcomeRejected)
			return
		}
		_ = app.CoeditControl.Close(r.Context(), authoringcoedit.CloseRequest{
			DocumentNames: coeditNameStrings(names),
			Reason:        string(reason),
		})
		if err := app.Authoring.CoeditCloseDocuments(r.Context(), ids, reason); err != nil {
			authoringcoedit.EmitLifecycle(reason, authoringcoedit.OutcomeUnavailable)
			return
		}
		if err := app.Authoring.CoeditWorkspaceCloseDocuments(r.Context(), workspaceIDs, reason); err != nil {
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
		ids := coeditDocumentIDs(names)
		workspaceIDs := coeditWorkspaceIDs(names)
		if len(ids) > 0 {
			if err := app.Authoring.CoeditMarkFreezing(r.Context(), ids); err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
				return
			}
		}
		if len(workspaceIDs) > 0 {
			if err := app.Authoring.CoeditWorkspaceMarkFreezing(r.Context(), workspaceIDs); err != nil {
				_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
				_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring state is unavailable."))
				return
			}
		}
		if len(ids) > 0 || len(workspaceIDs) > 0 {
			if err := app.CoeditControl.Flush(r.Context(), authoringcoedit.FlushRequest{
				DocumentNames: coeditNameStrings(names),
			}); err != nil {
				_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
				_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
				authoringcoedit.EmitLifecycle(authoringcoedit.CloseQuestionDeleted, authoringcoedit.OutcomeUnavailable)
				writeCoeditError(w, r, err)
				return
			}
		}
		recorder := &coeditStatusRecorder{ResponseWriter: w}
		next(recorder, r)
		if recorder.statusCode() >= 400 {
			_ = app.Authoring.CoeditReopenActive(r.Context(), ids)
			_ = app.Authoring.CoeditWorkspaceReopenActive(r.Context(), workspaceIDs)
			authoringcoedit.EmitLifecycle(authoringcoedit.CloseQuestionDeleted, authoringcoedit.OutcomeRejected)
			return
		}
		if len(ids) > 0 || len(workspaceIDs) > 0 {
			_ = app.CoeditControl.Close(r.Context(), authoringcoedit.CloseRequest{
				DocumentNames: coeditNameStrings(names),
				Reason:        string(authoringcoedit.CloseQuestionDeleted),
			})
			_ = app.Authoring.CoeditCloseDocuments(r.Context(), ids, authoringcoedit.CloseQuestionDeleted)
			_ = app.Authoring.CoeditWorkspaceCloseDocuments(r.Context(), workspaceIDs, authoringcoedit.CloseQuestionDeleted)
		}
		authoringcoedit.EmitLifecycle(authoringcoedit.CloseQuestionDeleted, authoringcoedit.OutcomeAccepted)
	}
}

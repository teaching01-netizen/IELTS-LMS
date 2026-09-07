package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/media"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// authorSatWorkbookTemplateHandler downloads the canonical SAT authoring
// workbook. The shell lookup keeps this endpoint restricted to SAT exams and
// mirrors the Rust route's published/draft access check.
func authorSatWorkbookTemplateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringExamRead(app, w, r, chi.URLParam(r, "examID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		if _, err := app.Authoring.Shell(r.Context(), chi.URLParam(r, "examID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		workbook, err := buildSATWorkbookTemplate()
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeInternal, "SAT workbook template could not be generated."))
			return
		}
		w.Header().Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		w.Header().Set("Content-Disposition", `attachment; filename="SAT-Authoring-Template.xlsx"`)
		w.Header().Set("Cache-Control", "private, no-store")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write(workbook)
	}
}

// mediaUploadHandler stages a pending media upload intent.
func mediaUploadHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder, auth.RoleProctor, auth.RoleGrader, auth.RoleStudent) == nil {
			return
		}
		if app.Media == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Media service is unavailable."))
			return
		}
		var req struct {
			OwnerKind   string  `json:"ownerKind"`
			OwnerID     string  `json:"ownerId"`
			ContentType string  `json:"contentType"`
			FileName    string  `json:"fileName"`
			Checksum    *string `json:"checksumSha256"`
			SizeBytes   *int64  `json:"sizeBytes"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		intent, err := app.Media.CreateUpload(r.Context(), media.CreateRequest{
			OwnerKind:   req.OwnerKind,
			OwnerID:     req.OwnerID,
			ContentType: req.ContentType,
			FileName:    req.FileName,
			Checksum:    req.Checksum,
			SizeBytes:   req.SizeBytes,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, intent)
	}
}

// mediaCompleteHandler finalizes a pending media upload.
func mediaCompleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder, auth.RoleProctor, auth.RoleGrader, auth.RoleStudent) == nil {
			return
		}
		if app.Media == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Media service is unavailable."))
			return
		}
		assetID := strings.TrimSpace(chi.URLParam(r, "assetID"))
		var req struct {
			SizeBytes int64  `json:"sizeBytes"`
			Checksum  string `json:"checksumSha256"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Media.CompleteUpload(r.Context(), assetID, media.CompleteRequest{
			SizeBytes: req.SizeBytes,
			Checksum:  req.Checksum,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorShellHandler returns the editable-draft authoring shell.
func authorShellHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringExamRead(app, w, r, chi.URLParam(r, "examID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		out, err := app.Authoring.Shell(r.Context(), chi.URLParam(r, "examID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorOpenShellHandler opens (or returns) the editable-draft shell.
func authorOpenShellHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringExamWrite(app, w, r, chi.URLParam(r, "examID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		out, err := app.Authoring.OpenShell(r.Context(), chi.URLParam(r, "examID"), sess.UserID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorListQuestionsHandler lists question summaries for one module.
func authorListQuestionsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringModuleRead(app, w, r, chi.URLParam(r, "moduleID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		out, err := app.Authoring.ListQuestions(r.Context(), chi.URLParam(r, "moduleID"))
		if out == nil {
			out = []authoring.QuestionSummary{}
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorPreviewHandler returns the student-facing preview projection.
func authorPreviewHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringExamRead(app, w, r, chi.URLParam(r, "examID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		out, err := app.Authoring.Preview(r.Context(), chi.URLParam(r, "examID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorSampleHandler atomically applies the complete built-in SAT sample.
func authorSampleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringExamWrite(app, w, r, chi.URLParam(r, "examID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req authoring.LoadSampleExamRequest
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Authoring.LoadSampleExam(r.Context(), chi.URLParam(r, "examID"), req, sess.UserID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorPreviewImportHandler parses and stages a workbook-import preview.
func authorPreviewImportHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringExamWrite(app, w, r, chi.URLParam(r, "examID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, httpx.MaxWorkbookBodyBytes)
		if err := r.ParseMultipartForm(2 << 20); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Upload a readable .xlsx workbook."))
			return
		}
		file, header, err := r.FormFile("file")
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "The workbook file is required."))
			return
		}
		defer file.Close()
		if !strings.HasSuffix(strings.ToLower(strings.TrimSpace(header.Filename)), ".xlsx") {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Choose an .xlsx SAT workbook."))
			return
		}
		data, err := io.ReadAll(io.LimitReader(file, int64(authoring.MaxSATWorkbookBytes)+1))
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "The workbook could not be read."))
			return
		}
		if len(data) > authoring.MaxSATWorkbookBytes {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodePayloadTooLarge, "SAT workbooks must be 12 MB or smaller."))
			return
		}
		preview, err := authoring.ParseSATWorkbook(data)
		if err != nil {
			var workbookErr *authoring.WorkbookError
			if errors.As(err, &workbookErr) && workbookErr.TooLarge {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodePayloadTooLarge, workbookErr.Message))
			} else {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, err.Error()))
			}
			return
		}
		if preview.Valid {
			if err := app.Authoring.RegisterSATWorkbookPreview(r.Context(), chi.URLParam(r, "examID"), sess.UserID, preview); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
		}
		out := preview
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorCommitImportHandler commits a staged workbook import.
func authorCommitImportHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringExamWrite(app, w, r, chi.URLParam(r, "examID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req authoring.SatWorkbookCommitRequest
		if err := httpx.DecodeLimited(r, httpx.MaxWorkbookBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Authoring.CommitSATWorkbook(r.Context(), chi.URLParam(r, "examID"), req, sess.UserID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorUndoStateHandler returns the undo availability for an import.
func authorUndoStateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringExamRead(app, w, r, chi.URLParam(r, "examID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		out, err := app.Authoring.SATWorkbookUndoState(r.Context(), chi.URLParam(r, "examID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteJSON(w, http.StatusOK, nil)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, *out)
	}
}

// authorUndoImportHandler undoes a committed workbook import.
func authorUndoImportHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringExamWrite(app, w, r, chi.URLParam(r, "examID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		out, err := app.Authoring.UndoSATWorkbook(r.Context(), chi.URLParam(r, "examID"), chi.URLParam(r, "importID"), sess.UserID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// draftPayload is the shared JSON envelope for a question draft.
type draftPayload struct {
	QuestionType  string          `json:"questionType"`
	Stimulus      json.RawMessage `json:"stimulus"`
	Prompt        json.RawMessage `json:"prompt"`
	Answer        json.RawMessage `json:"answer"`
	Rationale     json.RawMessage `json:"rationale"`
	Metadata      json.RawMessage `json:"metadata"`
	Accessibility json.RawMessage `json:"accessibility"`
	IsPretest     bool            `json:"isPretest"`
}

// decodeDraftOptional decodes a question draft, accepting an empty body as
// the zero draft (the service fills in the section-aware blank editor
// draft). Non-empty bodies stay strict.
func decodeDraftOptional(r *http.Request) (authoring.QuestionDraft, error) {
	var req draftPayload
	if err := httpx.DecodeLimitedOptional(r, httpx.MaxAdminBodyBytes, &req); err != nil {
		return authoring.QuestionDraft{}, err
	}
	return authoring.QuestionDraft{
		QuestionType:  req.QuestionType,
		Stimulus:      req.Stimulus,
		Prompt:        req.Prompt,
		Answer:        req.Answer,
		Rationale:     req.Rationale,
		Metadata:      req.Metadata,
		Accessibility: req.Accessibility,
		IsPretest:     req.IsPretest,
	}, nil
}

// bytesTrimSpace is bytes.TrimSpace without pulling bytes into every file
// scope comment; the handler only needs the empty check.
func bytesTrimSpace(b json.RawMessage) []byte {
	return bytes.TrimSpace(b)
}

// decodeDraft decodes a question draft from the request body.
func decodeDraft(r *http.Request) (authoring.QuestionDraft, error) {
	var req draftPayload
	if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
		return authoring.QuestionDraft{}, err
	}
	return authoring.QuestionDraft{
		QuestionType:  req.QuestionType,
		Stimulus:      req.Stimulus,
		Prompt:        req.Prompt,
		Answer:        req.Answer,
		Rationale:     req.Rationale,
		Metadata:      req.Metadata,
		Accessibility: req.Accessibility,
		IsPretest:     req.IsPretest,
	}, nil
}

// authorCreateQuestionHandler creates one question in a module.
// The frontend POSTs with no body; an explicit draft is also accepted for
// API clients. Either way the service synthesizes a section-aware default.
func authorCreateQuestionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringModuleWrite(app, w, r, chi.URLParam(r, "moduleID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		draft, err := decodeDraftOptional(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Authoring.CreateQuestion(r.Context(), chi.URLParam(r, "moduleID"), sess.UserID, draft)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// authorBatchQuestionsHandler creates many questions in one module.
func authorBatchQuestionsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringModuleWrite(app, w, r, chi.URLParam(r, "moduleID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req struct {
			Drafts    []draftPayload `json:"drafts"`
			Questions []draftPayload `json:"questions"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		payloads := req.Drafts
		if len(payloads) == 0 {
			payloads = req.Questions
		}
		drafts := make([]authoring.QuestionDraft, 0, len(payloads))
		for _, d := range payloads {
			drafts = append(drafts, authoring.QuestionDraft{
				QuestionType:  d.QuestionType,
				Stimulus:      d.Stimulus,
				Prompt:        d.Prompt,
				Answer:        d.Answer,
				Rationale:     d.Rationale,
				Metadata:      d.Metadata,
				Accessibility: d.Accessibility,
				IsPretest:     d.IsPretest,
			})
		}
		out, err := app.Authoring.BatchCreateQuestions(r.Context(), chi.URLParam(r, "moduleID"), sess.UserID, drafts)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []authoring.QuestionSummary{}
		}
		created := make([]string, 0, len(out))
		for _, summary := range out {
			created = append(created, summary.ExamQuestionID)
		}
		httpx.WriteJSON(w, http.StatusCreated, map[string]any{"createdQuestionIds": created, "questions": out})
	}
}

// authorGetQuestionHandler returns one exam question by {examQuestionID}.
func authorGetQuestionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringQuestionRead(app, w, r, chi.URLParam(r, "examQuestionID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		out, err := app.Authoring.GetQuestion(r.Context(), chi.URLParam(r, "examQuestionID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorUpdateQuestionHandler updates one exam question with revision fencing.
func authorUpdateQuestionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringQuestionWrite(app, w, r, chi.URLParam(r, "examQuestionID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req struct {
			ExpectedRevision int `json:"expectedRevision"`
			draftPayload
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Authoring.UpdateQuestion(r.Context(), chi.URLParam(r, "examQuestionID"), sess.UserID, req.ExpectedRevision, authoring.QuestionDraft{
			QuestionType:  req.QuestionType,
			Stimulus:      req.Stimulus,
			Prompt:        req.Prompt,
			Answer:        req.Answer,
			Rationale:     req.Rationale,
			Metadata:      req.Metadata,
			Accessibility: req.Accessibility,
			IsPretest:     req.IsPretest,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorDeleteQuestionHandler deletes one exam question.
func authorDeleteQuestionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringQuestionWrite(app, w, r, chi.URLParam(r, "examQuestionID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		if err := app.Authoring.DeleteQuestion(r.Context(), chi.URLParam(r, "examQuestionID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// authorReorderHandler reorders questions within a module.
func authorReorderHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringModuleWrite(app, w, r, chi.URLParam(r, "moduleID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req struct {
			ExpectedIDs         []string `json:"expectedIds"`
			OrderedIDs          []string `json:"orderedIds"`
			ExpectedQuestionIDs []string `json:"expectedQuestionIds"`
			QuestionIDs         []string `json:"questionIds"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		expected := req.ExpectedIDs
		if expected == nil {
			expected = req.ExpectedQuestionIDs
		}
		ordered := req.OrderedIDs
		if ordered == nil {
			ordered = req.QuestionIDs
		}
		if ordered == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "orderedIds and questionIds are required."))
			return
		}
		if err := app.Authoring.ReorderQuestions(r.Context(), chi.URLParam(r, "moduleID"), expected, ordered); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		summaries, err := app.Authoring.ListQuestions(r.Context(), chi.URLParam(r, "moduleID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if summaries == nil {
			summaries = []authoring.QuestionSummary{}
		}
		httpx.WriteJSON(w, http.StatusOK, summaries)
	}
}

// authorDuplicateHandler duplicates one exam question.
func authorDuplicateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringQuestionWrite(app, w, r, chi.URLParam(r, "examQuestionID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req struct {
			DestinationModuleID       *string `json:"destinationModuleId"`
			InsertAfterExamQuestionID *string `json:"insertAfterExamQuestionId"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if req.DestinationModuleID != nil && requireAuthoringModuleWrite(app, w, r, *req.DestinationModuleID) == nil {
			return
		}
		out, err := app.Authoring.DuplicateQuestion(r.Context(), chi.URLParam(r, "examQuestionID"), req.DestinationModuleID, sess.UserID, req.InsertAfterExamQuestionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// authorBulkHandler applies one bulk action to many questions.
func authorBulkHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req struct {
			QuestionIDs []string `json:"questionIds"`
			Action      struct {
				Type                string         `json:"type"`
				DestinationModuleID *string        `json:"destinationModuleId"`
				PretestValue        *bool          `json:"pretestValue"`
				Value               *bool          `json:"value"`
				Patch               map[string]any `json:"patch"`
			} `json:"action"`
			ExpectedRevisions map[string]int `json:"expectedRevisions"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		for _, questionID := range req.QuestionIDs {
			if requireAuthoringQuestionWrite(app, w, r, questionID) == nil {
				return
			}
		}
		if req.Action.DestinationModuleID != nil && requireAuthoringModuleWrite(app, w, r, *req.Action.DestinationModuleID) == nil {
			return
		}
		action := authoring.BulkAction{Type: req.Action.Type, Patch: req.Action.Patch}
		if req.Action.DestinationModuleID != nil {
			action.DestinationModuleID = *req.Action.DestinationModuleID
		}
		pretest := req.Action.PretestValue
		if pretest == nil {
			pretest = req.Action.Value
		}
		if pretest != nil {
			action.PretestValue = *pretest
		}
		result, err := app.Authoring.BulkQuestions(r.Context(), req.QuestionIDs, action, sess.UserID, req.ExpectedRevisions)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if result.AffectedQuestionIDs == nil {
			result.AffectedQuestionIDs = []string{}
		}
		if result.CreatedQuestionIDs == nil {
			result.CreatedQuestionIDs = []string{}
		}
		if result.UpdatedQuestions == nil {
			result.UpdatedQuestions = []authoring.QuestionSummary{}
		}
		httpx.WriteJSON(w, http.StatusOK, result)
	}
}

// authorSaveRevisionHandler persists the edited draft for a question.
// The frontend PATCHes the revision id with { revision, questionType,
// stimulus, prompt, answer, rationale, metadata, accessibility }; the payload
// field is `answer` (the DB column stays `answer_definition`).
func authorSaveRevisionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireAuthoringRevisionWrite(app, w, r, chi.URLParam(r, "revisionID"))
		if sess == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req struct {
			Revision int `json:"revision"`
			draftPayload
			AnswerCompat json.RawMessage `json:"answerDefinition"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		answer := req.Answer
		if len(bytesTrimSpace(answer)) == 0 && len(bytesTrimSpace(req.AnswerCompat)) != 0 {
			answer = req.AnswerCompat
		}
		examQuestionID, err := app.Authoring.ExamQuestionIDForRevision(r.Context(), chi.URLParam(r, "revisionID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Authoring.SaveRevision(r.Context(), examQuestionID, chi.URLParam(r, "revisionID"), req.Revision, authoring.QuestionDraft{
			QuestionType:  req.QuestionType,
			Stimulus:      req.Stimulus,
			Prompt:        req.Prompt,
			Answer:        answer,
			Rationale:     req.Rationale,
			Metadata:      req.Metadata,
			Accessibility: req.Accessibility,
		}, sess.UserID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorDeliverySettingsHandler updates section delivery settings.
func authorDeliverySettingsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringSectionWrite(app, w, r, chi.URLParam(r, "examID"), chi.URLParam(r, "sectionID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		var req struct {
			ExpectedSectionRevision int `json:"expectedSectionRevision"`
			BreakAfterSeconds       int `json:"breakAfterSeconds"`
			ModuleTimings           []struct {
				ModuleID         string `json:"moduleId"`
				DurationSeconds  int    `json:"durationSeconds"`
				ExpectedRevision int    `json:"expectedRevision"`
			} `json:"moduleTimings"`
			MinimumCorrectForHigher int `json:"minimumCorrectForHigher"`
			ExpectedRoutingRevision int `json:"expectedRoutingRevision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		timings := make([]authoring.ModuleTiming, 0, len(req.ModuleTimings))
		for _, t := range req.ModuleTimings {
			timings = append(timings, authoring.ModuleTiming{
				ModuleID:         t.ModuleID,
				DurationSeconds:  t.DurationSeconds,
				ExpectedRevision: t.ExpectedRevision,
			})
		}
		out, err := app.Authoring.UpdateDeliverySettings(r.Context(), chi.URLParam(r, "examID"), chi.URLParam(r, "sectionID"), authoring.DeliverySettingsRequest{
			ExpectedSectionRevision: req.ExpectedSectionRevision,
			BreakAfterSeconds:       req.BreakAfterSeconds,
			ModuleTimings:           timings,
			MinimumCorrectForHigher: req.MinimumCorrectForHigher,
			ExpectedRoutingRevision: req.ExpectedRoutingRevision,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// authorValidateHandler validates an exam draft.
func authorValidateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireAuthoringExamRead(app, w, r, chi.URLParam(r, "examID")) == nil {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		out, err := app.Authoring.ValidateExam(r.Context(), chi.URLParam(r, "examID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

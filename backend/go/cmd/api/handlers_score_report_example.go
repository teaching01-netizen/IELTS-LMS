package main

import (
	"context"
	"database/sql"
	"mime"
	"net/http"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/answeredpdf"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/satwordvault"
	"github.com/go-chi/chi/v5"
)

// satScoreReportExampleHandler serves the authoring example: a sample paper
// with every sample question answered correctly, the answer key, the saved PDF
// layout, and the exam's Word Vault from the current draft (or the latest
// published version when no draft is open).
//
// This is a preview, never a student artifact: the candidate is "Sample
// Student", the answer key is always present, and the filename says example.
// A stale vault blocks the download for the same reason it blocks student
// PDFs: the example must not print a paper students cannot receive.
func satScoreReportExampleHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		examID := chi.URLParam(r, "examID")
		_, title, ok := requireSATPDFLayoutAccess(app, w, r, examID, false)
		if !ok {
			return
		}
		if app.AnsweredPDF == nil || app.PDFLayouts == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "The score report example is unavailable."))
			return
		}
		versionID, err := scoreReportExampleVersion(r.Context(), app, examID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		words, stale, err := satwordvault.Read(r.Context(), app.DB, versionID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		if stale > 0 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation,
				"The Word Vault has stale question references. Re-import the vocabulary workbook before downloading an example."))
			return
		}
		editor, err := app.PDFLayouts.Read(r.Context(), examID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		layout, err := app.PDFLayouts.ResolvePreview(r.Context(), examID, nil, nil)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		exam, view := answeredpdf.LayoutSample(title, editor.Targets, true)
		payload, err := answeredpdf.MarshalAttemptPayload(exam, view, map[string]string{}, layout, words)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeInternal, "The score report example could not be prepared."))
			return
		}
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(answeredpdf.RenderTimeout + 5*time.Second))
		pdf, err := app.AnsweredPDF.RenderPreview(r.Context(), func(context.Context) ([]byte, error) {
			return payload, nil
		})
		if err != nil {
			pdfExportError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
			"filename": answeredpdf.ExampleFilename(title),
		}))
		_, _ = w.Write(pdf)
	}
}

// scoreReportExampleVersion follows the PDF layout editor's version rule: the
// editable draft when one exists, otherwise the latest published version.
func scoreReportExampleVersion(ctx context.Context, app *App, examID string) (string, error) {
	var versionID sql.NullString
	err := app.DB.QueryRowContext(ctx, `
		SELECT COALESCE(e.current_draft_version_id, e.current_published_version_id)
		FROM exam_entities e
		WHERE e.id = ? AND e.provider_key = 'sat' AND e.status <> 'archived'`, examID).Scan(&versionID)
	if err == sql.ErrNoRows {
		return "", apperrors.New(apperrors.CodeNotFound, "SAT exam not found.")
	}
	if err != nil {
		return "", err
	}
	if !versionID.Valid || strings.TrimSpace(versionID.String) == "" {
		return "", apperrors.New(apperrors.CodeValidation, "Open a draft or publish this exam before downloading a score report example.")
	}
	return versionID.String, nil
}

package main

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
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

const scoreReportExampleTimeout = 45 * time.Second

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
		ctx, cancel := context.WithTimeout(r.Context(), scoreReportExampleTimeout)
		defer cancel()
		r = r.WithContext(ctx)
		deadline, _ := ctx.Deadline()
		_ = http.NewResponseController(w).SetWriteDeadline(deadline.Add(5 * time.Second))
		examID := chi.URLParam(r, "examID")
		_, title, ok := requireSATPDFLayoutAccess(app, w, r, examID, false)
		if !ok {
			return
		}
		if app.AnsweredPDF == nil || app.PDFLayouts == nil || app.Delivery == nil || app.Media == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "The score report example is unavailable."))
			return
		}
		requestID := httpx.RequestIDOf(w, r)
		pdf, err := app.AnsweredPDF.RenderPreview(ctx, func(ctx context.Context) ([]byte, error) {
			return buildScoreReportExample(ctx, app, examID, title, requestID)
		})
		if err != nil {
			writeScoreReportExampleError(w, r, err)
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

func buildScoreReportExample(ctx context.Context, app *App, examID, title, requestID string) (payload []byte, err error) {
	started := time.Now()
	stage, stageStarted := "version", started
	timings := make([]slog.Attr, 0, 5)
	advance := func(next string) {
		timings = append(timings, slog.Int64(stage+"_ms", time.Since(stageStarted).Milliseconds()))
		stage, stageStarted = next, time.Now()
	}
	defer func() {
		lastStage := stage
		advance("")
		slog.LogAttrs(ctx, slog.LevelInfo, "SAT score report example preparation",
			slog.String("request_id", requestID),
			slog.String("exam_id", examID),
			slog.String("stage", lastStage),
			slog.Bool("ok", err == nil),
			slog.Int64("elapsed_ms", time.Since(started).Milliseconds()),
			slog.Attr{Key: "timings", Value: slog.GroupValue(timings...)},
		)
	}()
	versionID, err := scoreReportExampleVersion(ctx, app, examID)
	if err != nil {
		return nil, err
	}
	advance("word_vault")
	words, stale, err := satwordvault.Read(ctx, app.DB, versionID)
	if err != nil {
		return nil, err
	}
	if stale > 0 {
		return nil, apperrors.New(apperrors.CodeValidation,
			"The Word Vault has stale question references. Re-import the vocabulary workbook before downloading an example.")
	}
	advance("layout")
	layout, err := app.PDFLayouts.ResolvePreview(ctx, examID, nil, nil)
	if err != nil {
		return nil, err
	}
	advance("paper")
	exam, view, err := app.Delivery.SampleAnsweredExam(ctx, versionID, examID, title, "Sample Student")
	if err != nil {
		return nil, err
	}
	advance("media")
	return answeredpdf.BuildAttemptPayload(ctx, exam, view, app.Media.OpenOriginal, layout, words)
}

func writeScoreReportExampleError(w http.ResponseWriter, r *http.Request, err error) {
	if r.Context().Err() != nil || errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
		w.Header().Set("Retry-After", "2")
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable,
			"The score report example took too long. Please retry."))
		return
	}
	pdfExportError(w, r, err)
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

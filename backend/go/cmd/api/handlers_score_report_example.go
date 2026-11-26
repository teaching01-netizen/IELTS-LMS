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

// The example is a full paper render. Keep the whole request bounded: a broken
// database or renderer must fail in under a minute with a retryable message,
// not hold the connection until a proxy gives up.
const scoreReportExampleTimeout = 45 * time.Second

// satScoreReportExampleHandler serves the authoring example: a sample paper
// with every question answered correctly, the answer key, the saved PDF layout,
// and the exam's Word Vault from the current draft (or the latest published
// version when no draft is open).
//
// The rendered artifact is cached per content revision in the object store, so
// only the first download after a change pays for Chromium. A cheap revision
// key is checked before the delivery tree, answers, vault, layout and renderer
// are touched.
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
		versionID, versionRevision, examRevision, layoutRevision, err := scoreReportExampleVersion(ctx, app, examID)
		if err != nil {
			writeScoreReportExampleError(w, r, err)
			return
		}
		cacheKey := scoreReportExampleCacheKey(examID, versionID, versionRevision, examRevision, layoutRevision, title)
		if pdf, cached := readCachedScoreReportExample(ctx, app.ObjectStore, examID, cacheKey); cached {
			slog.InfoContext(ctx, "sat score report example", "exam_id", examID, "stage", "cache_hit")
			serveScoreReportExample(w, pdf, title)
			return
		}

		// One render per exam in this process; the losers re-read the cache.
		unlock := lockScoreReportExample(examID)
		defer unlock()
		versionID, versionRevision, examRevision, layoutRevision, err = scoreReportExampleVersion(ctx, app, examID)
		if err != nil {
			writeScoreReportExampleError(w, r, err)
			return
		}
		cacheKey = scoreReportExampleCacheKey(examID, versionID, versionRevision, examRevision, layoutRevision, title)
		if pdf, cached := readCachedScoreReportExample(ctx, app.ObjectStore, examID, cacheKey); cached {
			slog.InfoContext(ctx, "sat score report example", "exam_id", examID, "stage", "cache_hit_after_wait")
			serveScoreReportExample(w, pdf, title)
			return
		}
		started := time.Now()
		requestID := httpx.RequestIDOf(w, r)
		pdf, err := app.AnsweredPDF.RenderPreview(ctx, func(ctx context.Context) ([]byte, error) {
			return buildScoreReportExample(ctx, app, examID, title, requestID)
		})
		if err != nil {
			slog.InfoContext(ctx, "sat score report example", "exam_id", examID, "stage", "render_failed", "elapsed_ms", time.Since(started).Milliseconds())
			writeScoreReportExampleError(w, r, err)
			return
		}
		// Do not cache a paper that a newer revision has already superseded.
		if currentVersion, currentVersionRevision, currentExamRevision, currentLayout, versionErr := scoreReportExampleVersion(ctx, app, examID); versionErr == nil {
			currentKey := scoreReportExampleCacheKey(examID, currentVersion, currentVersionRevision, currentExamRevision, currentLayout, title)
			if currentKey == cacheKey {
				writeCachedScoreReportExample(ctx, app.ObjectStore, examID, cacheKey, pdf)
			}
		}
		slog.InfoContext(ctx, "sat score report example", "exam_id", examID, "stage", "rendered",
			"elapsed_ms", time.Since(started).Milliseconds(), "bytes", len(pdf))
		serveScoreReportExample(w, pdf, title)
	}
}

// buildScoreReportExample runs inside the render slot: vault, layout, real
// paper and media preparation share the render deadline.
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
	versionID, _, _, _, err := scoreReportExampleVersion(ctx, app, examID)
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

func serveScoreReportExample(w http.ResponseWriter, pdf []byte, title string) {
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{
		"filename": answeredpdf.ExampleFilename(title),
	}))
	_, _ = w.Write(pdf)
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
// editable draft when one exists, otherwise the latest published version. The
// revisions are the cheap cache key inputs.
func scoreReportExampleVersion(ctx context.Context, app *App, examID string) (versionID string, versionRevision, examRevision, layoutRevision int, err error) {
	var rawVersionID sql.NullString
	err = app.DB.QueryRowContext(ctx, `
		SELECT COALESCE(e.current_draft_version_id, e.current_published_version_id),
		       COALESCE(v.revision, 0), e.revision,
		       COALESCE((SELECT revision FROM sat_exam_pdf_layouts WHERE exam_id = e.id), 0)
		FROM exam_entities e
		LEFT JOIN exam_versions v ON v.id = COALESCE(e.current_draft_version_id, e.current_published_version_id)
		WHERE e.id = ? AND e.provider_key = 'sat' AND e.status <> 'archived'`, examID).Scan(&rawVersionID, &versionRevision, &examRevision, &layoutRevision)
	if err == sql.ErrNoRows {
		return "", 0, 0, 0, apperrors.New(apperrors.CodeNotFound, "SAT exam not found.")
	}
	if err != nil {
		return "", 0, 0, 0, err
	}
	if !rawVersionID.Valid || strings.TrimSpace(rawVersionID.String) == "" {
		return "", 0, 0, 0, apperrors.New(apperrors.CodeValidation, "Open a draft or publish this exam before downloading a score report example.")
	}
	return rawVersionID.String, versionRevision, examRevision, layoutRevision, nil
}

package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"time"

	"example.com/ielts-proctoring/internal/answeredpdf"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/satpdflayout"
	"github.com/go-chi/chi/v5"
)

const layoutBodyLimit = 32 << 10

func resolveAttemptPDFLayout(ctx context.Context, app *App, exam *delivery.AnsweredExam, view json.RawMessage, student bool) (*satpdflayout.Resolved, error) {
	if app.PDFLayouts == nil || exam.ExamID == "" {
		return nil, nil
	}
	visible := answeredpdf.VisibleLayoutTargets(exam, answeredpdf.IncludesScore(view))
	var scoreAllowed func(*sql.Tx) (bool, error)
	if student {
		scoreAllowed = func(q *sql.Tx) (bool, error) {
			return delivery.StudentSATPDFScoreAvailable(ctx, q, exam.AttemptID)
		}
	}
	design, err := app.PDFLayouts.ResolveSaved(ctx, exam.ExamID, visible, scoreAllowed)
	if err != nil {
		var domain *apperrors.Error
		if errors.As(err, &domain) {
			return nil, answeredpdf.ErrNotPrintable
		}
	}
	return design, err
}

func satPDFLayoutHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		examID := chi.URLParam(r, "examID")
		write := r.Method == http.MethodPut
		session, _, ok := requireSATPDFLayoutAccess(app, w, r, examID, write)
		if !ok {
			return
		}
		if !write {
			result, err := app.PDFLayouts.Read(r.Context(), examID)
			writePDFLayoutJSON(w, r, result, err, http.StatusOK)
			return
		}
		var request struct {
			Expected *int64               `json:"expectedRevision"`
			Layout   *satpdflayout.Layout `json:"layout"`
		}
		if err := decodePDFLayoutRequest(w, r, &request); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if request.Expected == nil || *request.Expected < 0 || request.Layout == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "A revision and layout are required."))
			return
		}
		result, err := app.PDFLayouts.Save(r.Context(), examID, session.UserID, pdfLayoutOrganization(session), *request.Expected, *request.Layout)
		writePDFLayoutJSON(w, r, result, err, http.StatusOK)
	}
}

func requireSATPDFLayoutAccess(app *App, w http.ResponseWriter, r *http.Request, examID string, write bool) (*auth.Session, string, bool) {
	roles := []string{auth.RoleAdmin, auth.RoleBuilder, auth.RoleAdminObserver}
	if write {
		roles = roles[:2]
	}
	session := requireRole(w, r, roles...)
	if session == nil {
		return nil, "", false
	}
	if app.Exams == nil || app.PDFLayouts == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "PDF layouts are unavailable."))
		return nil, "", false
	}
	exam, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), examID)
	if err != nil {
		httpx.WriteError(w, r, MapDBError(err))
		return nil, "", false
	}
	if exam.ProviderKey != "sat" {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "SAT exam not found."))
		return nil, "", false
	}
	return session, exam.Title, true
}

func pdfLayoutOrganization(session *auth.Session) *string {
	if session.Role != auth.RoleBuilder {
		return nil
	}
	return session.OrganizationID
}

func writePDFLayoutJSON(w http.ResponseWriter, r *http.Request, value any, err error, status int) {
	if err != nil {
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	httpx.WriteJSON(w, status, value)
}

func satPDFAssetUploadHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		examID := chi.URLParam(r, "examID")
		session, _, ok := requireSATPDFLayoutAccess(app, w, r, examID, true)
		if !ok {
			return
		}
		purpose := r.URL.Query().Get("purpose")
		limit := satpdflayout.Limit(purpose)
		if limit == 0 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Choose a slide or logo image."))
			return
		}
		contentType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
		if contentType != "image/png" && contentType != "image/jpeg" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Choose a PNG or JPEG image."))
			return
		}
		ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
		defer cancel()
		defer r.Body.Close()
		data, err := io.ReadAll(http.MaxBytesReader(w, r.Body, int64(limit)))
		if err != nil {
			var tooLarge *http.MaxBytesError
			if errors.As(err, &tooLarge) {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodePayloadTooLarge, "The image exceeds the size limit."))
			} else {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "The image upload did not complete."))
			}
			return
		}
		a, err := app.PDFLayouts.Upload(ctx, examID, pdfLayoutOrganization(session), purpose, r.URL.Query().Get("filename"), contentType, data)
		writePDFLayoutJSON(w, r, a, err, http.StatusCreated)
	}
}

func satPDFAssetReadHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		examID := chi.URLParam(r, "examID")
		session, _, ok := requireSATPDFLayoutAccess(app, w, r, examID, false)
		if !ok {
			return
		}
		a, data, err := app.PDFLayouts.ReadAsset(r.Context(), examID, chi.URLParam(r, "assetID"), session.Role != auth.RoleAdminObserver)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		w.Header().Set("Content-Type", a.ContentType)
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(data)
	}
}

func satPDFLayoutPreviewHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		examID := chi.URLParam(r, "examID")
		session, title, ok := requireSATPDFLayoutAccess(app, w, r, examID, false)
		if !ok {
			return
		}
		if app.AnsweredPDF == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "PDF preview is unavailable."))
			return
		}
		var request struct {
			Layout          *satpdflayout.Layout `json:"layout"`
			SampleAnswerKey bool                 `json:"sampleAnswerKey"`
			SectionSample   *satpdflayout.Target `json:"sectionSample"`
			SampleBook      bool                 `json:"sampleBook"`
		}
		if err := decodePDFLayoutRequest(w, r, &request); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if request.SampleBook && request.SectionSample != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Choose one sample preview mode."))
			return
		}
		if request.Layout != nil && session.Role == auth.RoleAdminObserver {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "You can preview only the saved layout."))
			return
		}
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(answeredpdf.RenderTimeout + 5*time.Second))
		pdf, err := app.AnsweredPDF.RenderPreview(r.Context(), func(ctx context.Context) ([]byte, error) {
			saved, err := app.PDFLayouts.Read(ctx, examID)
			if err != nil {
				return nil, err
			}
			withKey := request.SampleBook || request.SampleAnswerKey || request.SectionSample != nil && request.SectionSample.Kind == "answerKey"
			exam, view := answeredpdf.LayoutSample(title, saved.Targets, withKey)
			visible := answeredpdf.VisibleLayoutTargets(exam, true)
			if request.SectionSample != nil {
				if !visible[*request.SectionSample] {
					return nil, apperrors.New(apperrors.CodeValidation, "This section is unavailable for the sample.")
				}
			}
			// The editor shows uploaded pages separately from generated sections.
			if request.SectionSample != nil || request.SampleBook {
				visible = nil
			}
			layout, err := app.PDFLayouts.ResolvePreview(ctx, examID, request.Layout, visible)
			if err != nil {
				return nil, err
			}
			if request.SectionSample != nil {
				return answeredpdf.MarshalSectionSample(exam, view, layout, *request.SectionSample)
			}
			if request.SampleBook {
				return answeredpdf.MarshalSampleBook(exam, view, layout)
			}
			return answeredpdf.MarshalPayload(exam, view, map[string]string{}, layout)
		})
		if err != nil {
			pdfExportError(w, r, err)
			return
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		_, _ = w.Write(pdf)
	}
}

func decodePDFLayoutRequest(w http.ResponseWriter, r *http.Request, dest any) error {
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, layoutBodyLimit))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(dest); err != nil {
		return apperrors.New(apperrors.CodeBadRequest, "Invalid PDF layout request.")
	}
	var trailing any
	if err := decoder.Decode(&trailing); err != io.EOF {
		return apperrors.New(apperrors.CodeBadRequest, "Invalid PDF layout request.")
	}
	return nil
}

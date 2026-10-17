package main

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/answeredpdf"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"github.com/go-chi/chi/v5"
)

const pdfDownloadCookie = "sat-pdf-download"

func pdfExportError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, answeredpdf.ErrBusy), errors.Is(err, delivery.ErrAnsweredExamBusy):
		httpx.WriteRateLimitExceeded(w, r, "answered-exam-pdf", "node", 5*time.Second)
	case errors.Is(err, answeredpdf.ErrNotPrintable):
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "The answered exam could not be printed completely."))
	case errors.Is(err, answeredpdf.ErrExportUnavailable):
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "This PDF is unavailable. Prepare it again from your report."))
	default:
		httpx.WriteError(w, r, MapDBError(err))
	}
}

func prepareAnsweredPDFHandler(app *App, student bool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		if app.PDFExports == nil || app.AnsweredPDF == nil || app.Delivery == nil || app.Media == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "PDF preparation is unavailable."))
			return
		}
		binding := answeredpdf.Binding{Kind: "staff", AttemptID: chi.URLParam(r, "attemptID")}
		var expiryLimit time.Time
		if student {
			bearer, ok := requireBearer(w, r)
			if !ok {
				return
			}
			claims, err := verifyAttemptReadBearer(app, r, bearer)
			if err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
				return
			}
			if claims.ScheduleID != chi.URLParam(r, "scheduleID") || claims.ClientSessionID == "" {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule."))
				return
			}
			binding = answeredpdf.Binding{Kind: "student", OwnerID: claims.UserID, AttemptID: claims.AttemptID, SessionID: claims.ClientSessionID, Claims: &claims}
			expiryLimit = time.Unix(claims.Exp, 0)
		} else {
			sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor)
			if sess == nil {
				return
			}
			if app.Results == nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service is unavailable."))
				return
			}
			if err := app.Results.AuthorizeSATAttempt(r.Context(), actorOf(r.Context()), binding.AttemptID); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			binding.OwnerID, binding.SessionID = sess.UserID, sess.ID
		}
		var request struct {
			View json.RawMessage `json:"view"`
		}
		decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 128<<10))
		decoder.DisallowUnknownFields()
		if err := decoder.Decode(&request); err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid PDF preparation request."))
			return
		}
		var extra any
		if err := decoder.Decode(&extra); err != io.EOF {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid PDF preparation request."))
			return
		}
		_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(answeredpdf.RenderTimeout + 30*time.Second))
		ctx, cancel := context.WithTimeout(r.Context(), answeredpdf.RenderTimeout)
		defer cancel()
		var nonce [32]byte
		if _, err := rand.Read(nonce[:]); err != nil {
			pdfExportError(w, r, err)
			return
		}
		cookieValue := hex.EncodeToString(nonce[:])
		record, err := app.PDFExports.Reserve(ctx, binding, answeredpdf.BrowserHash(cookieValue))
		if err != nil {
			pdfExportError(w, r, err)
			return
		}
		published := false
		defer func() {
			if !published {
				app.PDFExports.Discard(ctx, record)
			}
		}()
		var filename string
		pdf, err := app.AnsweredPDF.RenderPrepared(ctx, func(ctx context.Context) ([]byte, error) {
			var exam *delivery.AnsweredExam
			var err error
			if student {
				exam, err = app.Delivery.AnsweredExamForStudent(ctx, binding.Claims.ScheduleID, binding.AttemptID, binding.Claims.ScheduleID)
			} else {
				exam, err = app.Delivery.AnsweredExam(ctx, binding.AttemptID)
			}
			if err != nil {
				return nil, err
			}
			scored := len(request.View) > 0 && string(request.View) != "null"
			filename = answeredpdf.Filename(exam.CandidateName, exam.ExamTitle, scored)
			if student {
				return answeredpdf.BuildPayload(ctx, exam, request.View, app.Media.OpenDelivery)
			}
			return answeredpdf.BuildPayload(ctx, exam, request.View, app.Media.OpenFinalized)
		})
		if err != nil {
			pdfExportError(w, r, err)
			return
		}
		prepared, err := app.PDFExports.Publish(ctx, record, pdf, filename, expiryLimit)
		if err != nil {
			pdfExportError(w, r, err)
			return
		}
		published = true
		// An export-scoped cookie avoids first-use races between tabs. The scope
		// key uses the authenticated client/session identity, not this random secret.
		http.SetCookie(w, &http.Cookie{Name: pdfDownloadCookie, Value: cookieValue, Path: prepared.DownloadURL, HttpOnly: true, Secure: app.Config.CookieSecure, SameSite: http.SameSiteStrictMode, MaxAge: int(time.Until(prepared.ExpiresAt).Seconds()), Expires: prepared.ExpiresAt})
		httpx.WriteJSON(w, http.StatusOK, prepared)
	}
}

func downloadAnsweredPDFHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "private, no-store")
		if app.PDFExports == nil {
			pdfExportError(w, r, answeredpdf.ErrExportUnavailable)
			return
		}
		cookie, err := r.Cookie(pdfDownloadCookie)
		if err != nil || len(cookie.Value) != 64 {
			pdfExportError(w, r, answeredpdf.ErrExportUnavailable)
			return
		}
		record, err := app.PDFExports.Lookup(r.Context(), chi.URLParam(r, "exportID"), answeredpdf.BrowserHash(cookie.Value))
		if err != nil {
			pdfExportError(w, r, err)
			return
		}
		binding := record.Binding
		if binding.Kind == "student" {
			if binding.Claims == nil || app.Delivery == nil {
				pdfExportError(w, r, answeredpdf.ErrExportUnavailable)
				return
			}
			claims, err := auth.VerifyAttemptReadBinding(r.Context(), app.DB, time.Now().UTC(), *binding.Claims)
			if err != nil || claims.AttemptID != binding.AttemptID || claims.UserID != binding.OwnerID || claims.ClientSessionID != binding.SessionID {
				pdfExportError(w, r, answeredpdf.ErrExportUnavailable)
				return
			}
			if _, err := app.Delivery.AnsweredExamForStudent(r.Context(), claims.ScheduleID, claims.AttemptID, claims.ScheduleID); err != nil {
				pdfExportError(w, r, err)
				return
			}
		} else if binding.Kind == "staff" {
			sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor)
			if sess == nil {
				return
			}
			if sess.UserID != binding.OwnerID || sess.ID != binding.SessionID || app.Results == nil {
				pdfExportError(w, r, answeredpdf.ErrExportUnavailable)
				return
			}
			if err := app.Results.AuthorizeSATAttempt(r.Context(), actorOf(r.Context()), binding.AttemptID); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
		} else {
			pdfExportError(w, r, answeredpdf.ErrExportUnavailable)
			return
		}
		body, err := app.PDFExports.Open(r.Context(), record.ObjectKey)
		if err != nil {
			pdfExportError(w, r, answeredpdf.ErrExportUnavailable)
			return
		}
		servePreparedPDF(w, r, record, body)
	}
}

func servePreparedPDF(w http.ResponseWriter, r *http.Request, record *answeredpdf.Export, body io.ReadSeekCloser) {
	defer body.Close()
	_ = http.NewResponseController(w).SetWriteDeadline(time.Now().Add(10 * time.Minute))
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": record.Filename}))
	w.Header().Set("ETag", `"`+strings.TrimSuffix(strings.TrimPrefix(record.ObjectKey, "answered-pdf/"), ".pdf")+`"`)
	http.ServeContent(privatePDFWriter{w}, r, "", time.Time{}, body)
}

// ServeContent removes caching headers on range errors. Keep private exports
// non-cacheable on those responses too, without changing range semantics.
type privatePDFWriter struct{ http.ResponseWriter }

func (w privatePDFWriter) WriteHeader(code int) {
	w.Header().Set("Cache-Control", "private, no-store")
	w.ResponseWriter.WriteHeader(code)
}
func (w privatePDFWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

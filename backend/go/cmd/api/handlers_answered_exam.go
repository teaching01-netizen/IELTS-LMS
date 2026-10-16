package main

import (
	"encoding/json"
	"errors"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/answeredpdf"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// writeAnsweredExam renders the print projection of docs/sat-result.md §4–5
// for both audiences: 429 + Retry-After when the build bound is full (PDF-09),
// no-store because it carries a candidate's responses.
func writeAnsweredExam(w http.ResponseWriter, r *http.Request, out *delivery.AnsweredExam, err error) {
	if errors.Is(err, delivery.ErrAnsweredExamBusy) {
		httpx.WriteRateLimitExceeded(w, r, "answered-exam", "node", 2*time.Second)
		return
	}
	if err != nil {
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteJSON(w, http.StatusOK, out)
}

// deliveryAnsweredExamHandler serves GET /schedules/{scheduleID}/answered-exam
// to the attempt bearer: the attempt comes from the credential, and only while
// its score report is open.
func deliveryAnsweredExamHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			bearer, ok := requireBearer(w, r)
			if !ok {
				return
			}
			claims, err := verifyAttemptReadBearer(app, r, bearer)
			if err != nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
				return
			}
			if app.Delivery == nil || app.DB == nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
				return
			}
			out, err := app.Delivery.AnsweredExamForStudent(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"))
			writeAnsweredExam(w, r, out, err)
		})
	}
}

// resultsSATAnsweredExamHandler serves GET /results/sat/attempts/{attemptID}/answered-exam
// to staff inside the results scope (org + schedule assignment).
func resultsSATAnsweredExamHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Results == nil || app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Results service not configured."))
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		if err := app.Results.AuthorizeSATAttempt(r.Context(), actorOf(r.Context()), attemptID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.AnsweredExam(r.Context(), attemptID)
		writeAnsweredExam(w, r, out, err)
	}
}

// answeredPDFRequest is what the caller's browser posts: the score report it
// already shows and the figures it already loaded (data URLs keyed by media
// id). The paper itself always comes from the authorized projection.
// offcut: view is the caller's own score report, trusted like the old
// browser print was; the PDF is a convenience copy, not a signed record
type answeredPDFRequest struct {
	Title string            `json:"title"`
	View  json.RawMessage   `json:"view"`
	Media map[string]string `json:"media"`
}

// answeredPDFMaxBodyBytes bounds the posted figures.
const answeredPDFMaxBodyBytes = 32 << 20

// answeredPDFSlots bounds concurrent headless browsers per node.
const answeredPDFSlots = 2

// readAnsweredPDFRequest extends the connection deadlines past the server
// defaults (an upload of figures from a phone plus a render outlasts them)
// and decodes the body.
func readAnsweredPDFRequest(w http.ResponseWriter, r *http.Request) (answeredPDFRequest, bool) {
	rc := http.NewResponseController(w)
	deadline := time.Now().Add(answeredpdf.RenderTimeout + 30*time.Second)
	_ = rc.SetReadDeadline(deadline)
	_ = rc.SetWriteDeadline(deadline)
	var req answeredPDFRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Invalid PDF request."))
		return req, false
	}
	for _, v := range req.Media {
		if !strings.HasPrefix(v, "data:image/") {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "Figures must be data URLs."))
			return req, false
		}
	}
	return req, true
}

// writeAnsweredPDF renders exam with the posted view and figures. Busy maps
// to 429 + Retry-After; an incomplete paper to 422 and no file (PDF-10).
func writeAnsweredPDF(app *App, w http.ResponseWriter, r *http.Request, req answeredPDFRequest, exam *delivery.AnsweredExam) {
	payload, err := json.Marshal(struct {
		Exam  *delivery.AnsweredExam `json:"exam"`
		View  json.RawMessage        `json:"view,omitempty"`
		Media map[string]string      `json:"media"`
	}{exam, req.View, req.Media})
	if err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	pdf, err := app.AnsweredPDF.Render(r.Context(), payload)
	switch {
	case errors.Is(err, answeredpdf.ErrBusy):
		httpx.WriteRateLimitExceeded(w, r, "answered-exam-pdf", "node", 5*time.Second)
		return
	case errors.Is(err, answeredpdf.ErrNotPrintable):
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeValidation, "The answered exam could not be printed completely."))
		return
	case err != nil:
		httpx.WriteError(w, r, err)
		return
	}
	title := strings.TrimSpace(req.Title)
	if title == "" || len(title) > 200 {
		title = "answered-exam"
	}
	w.Header().Set("Content-Type", "application/pdf")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": title + ".pdf"}))
	_, _ = w.Write(pdf)
}

// deliveryAnsweredPDFHandler serves POST /sat-answered-pdf/schedules/{scheduleID}
// to the attempt bearer, under the same rule as the answered-exam read.
func deliveryAnsweredPDFHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		bearer, ok := requireBearer(w, r)
		if !ok {
			return
		}
		claims, err := verifyAttemptReadBearer(app, r, bearer)
		if err != nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential."))
			return
		}
		if app.Delivery == nil || app.DB == nil || app.AnsweredPDF == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "PDF rendering is unavailable."))
			return
		}
		req, ok := readAnsweredPDFRequest(w, r)
		if !ok {
			return
		}
		exam, err := app.Delivery.AnsweredExamForStudent(r.Context(), claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"))
		if err != nil {
			writeAnsweredExam(w, r, nil, err)
			return
		}
		writeAnsweredPDF(app, w, r, req, exam)
	}
}

// resultsSATAnsweredPDFHandler serves POST /sat-answered-pdf/attempts/{attemptID}
// to staff inside the results scope.
func resultsSATAnsweredPDFHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader, auth.RoleProctor) == nil {
			return
		}
		if app.Results == nil || app.Delivery == nil || app.AnsweredPDF == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "PDF rendering is unavailable."))
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		if err := app.Results.AuthorizeSATAttempt(r.Context(), actorOf(r.Context()), attemptID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		req, ok := readAnsweredPDFRequest(w, r)
		if !ok {
			return
		}
		exam, err := app.Delivery.AnsweredExam(r.Context(), attemptID)
		if err != nil {
			writeAnsweredExam(w, r, nil, err)
			return
		}
		writeAnsweredPDF(app, w, r, req, exam)
	}
}

package main

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/assessmentforms"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// SAT configurable registration forms and Eva SIM
// (docs/plans/SAT-configurable-forms-and-eva-sim.md §3). Handlers decode,
// bind credentials and dispatch; every rule lives in the services.

func noStore(w http.ResponseWriter) { w.Header().Set("Cache-Control", "no-store") }

// appHostsOf names this application's own hosts so an embed URL cannot
// target it. Request-derived, never client-body-supplied.
func appHostsOf(r *http.Request) []string {
	hosts := []string{r.Host, r.Header.Get("X-Forwarded-Host")}
	for _, h := range []string{r.Header.Get("Origin"), r.Header.Get("Referer")} {
		if u, err := url.Parse(h); err == nil && u.Host != "" {
			hosts = append(hosts, u.Host)
		}
	}
	return hosts
}

// authorFormsHandler reads (GET) or saves (PUT) the exam draft's forms.
func authorFormsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		write := r.Method != http.MethodGet
		examID := chi.URLParam(r, "examID")
		var ok bool
		if write {
			ok = requireAuthoringExamWrite(app, w, r, examID) != nil
		} else {
			ok = requireAuthoringExamRead(app, w, r, examID) != nil
		}
		if !ok {
			return
		}
		if app.Authoring == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Authoring service is unavailable."))
			return
		}
		noStore(w)
		var out authoring.ExamForms
		var err error
		if write {
			var req authoring.SaveFormsRequest
			if err = httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			req.AppHosts = appHostsOf(r)
			out, err = app.Authoring.SaveForms(r.Context(), examID, req)
		} else {
			out, err = app.Authoring.GetForms(r.Context(), examID)
		}
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// evaCredential binds the attempt bearer to the URL. A mismatched schedule
// or attempt is a resource-scoped 404 (no oracle for other attempts).
func evaCredential(w http.ResponseWriter, r *http.Request, app *App, write bool) (assessmentforms.Credential, bool) {
	bearer, ok := requireBearer(w, r)
	if !ok {
		return assessmentforms.Credential{}, false
	}
	if app.Forms == nil || app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Form service is unavailable."))
		return assessmentforms.Credential{}, false
	}
	verify := verifyAttemptReadBearer
	if write {
		// The submit transaction rechecks the session row FOR SHARE.
		verify = verifyAttemptWriteBearer
	}
	claims, err := verify(app, r, bearer)
	if err != nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Attempt session is no longer valid."))
		return assessmentforms.Credential{}, false
	}
	if claims.ScheduleID != chi.URLParam(r, "scheduleID") || claims.AttemptID != chi.URLParam(r, "attemptID") {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Attempt not found."))
		return assessmentforms.Credential{}, false
	}
	return assessmentforms.Credential{TokenID: claims.TokenID, UserID: claims.UserID, ScheduleID: claims.ScheduleID, AttemptID: claims.AttemptID, LeaseEpoch: claims.LeaseEpoch}, true
}

func studentEvaStateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		cred, ok := evaCredential(w, r, app, false)
		if !ok {
			return
		}
		state, err := app.Forms.EvaStateFor(r.Context(), cred.ScheduleID, cred.AttemptID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, state)
	}
}

func studentEvaSubmitHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		cred, ok := evaCredential(w, r, app, true)
		if !ok {
			return
		}
		var cmd assessmentforms.SubmitEvaCommand
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &cmd); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		ack, err := app.Forms.SubmitEva(r.Context(), cred, cmd)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, ack)
	}
}

// formViewerOf maps the staff session to its response-viewing scope.
func formViewerOf(sess *auth.Session) assessmentforms.Viewer {
	if sess.Role == auth.RoleAdmin {
		return assessmentforms.Viewer{All: true}
	}
	if sess.Role == auth.RoleProctor {
		return assessmentforms.Viewer{ProctorUserID: sess.UserID}
	}
	return assessmentforms.Viewer{}
}

func formResponsesListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleProctor)
		if sess == nil {
			return
		}
		if app.Forms == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Form service is unavailable."))
			return
		}
		noStore(w)
		q := r.URL.Query()
		limit, _ := strconv.Atoi(q.Get("limit"))
		page, err := app.Forms.ListResponses(r.Context(), formViewerOf(sess), assessmentforms.ListFilter{
			ExamID: strings.TrimSpace(q.Get("examId")), ScheduleID: strings.TrimSpace(q.Get("scheduleId")),
			VersionID: strings.TrimSpace(q.Get("versionId")), FormKey: strings.TrimSpace(q.Get("formKey")),
			Mode: strings.TrimSpace(q.Get("mode")), Status: strings.TrimSpace(q.Get("status")),
			Cursor: strings.TrimSpace(q.Get("cursor")), Limit: limit,
		})
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, page)
	}
}

func formResponseDetailHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleProctor)
		if sess == nil {
			return
		}
		if app.Forms == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Form service is unavailable."))
			return
		}
		noStore(w)
		detail, err := app.Forms.ResponseDetailFor(r.Context(), formViewerOf(sess), chi.URLParam(r, "attemptID"), chi.URLParam(r, "formKey"))
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, detail)
	}
}

// proctorFormsStateHandler is the room-level Eva summary that keeps End Exam
// available on an automatically completed room while Eva is open.
func proctorFormsStateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		if !requireProctorAttemptScope(w, r, app, sess, scheduleID) {
			return
		}
		if app.Forms == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Form service is unavailable."))
			return
		}
		noStore(w)
		state, err := app.Forms.ScheduleState(r.Context(), scheduleID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, state)
	}
}

func studentSectionEntryHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		noStore(w)
		write := r.Method == http.MethodPut
		cred, ok := evaCredential(w, r, app, write)
		if !ok {
			return
		}
		section := chi.URLParam(r, "sectionKey")
		if write {
			var cmd assessmentforms.SubmitSectionEntryCommand
			if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &cmd); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			ack, err := app.Forms.SubmitSectionEntry(r.Context(), cred, section, cmd)
			if err != nil {
				httpx.WriteError(w, r, MapDBError(err))
				return
			}
			httpx.WriteJSON(w, http.StatusOK, ack)
			return
		}
		state, err := app.Forms.SectionEntryFor(r.Context(), cred.ScheduleID, cred.AttemptID, section)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, state)
	}
}

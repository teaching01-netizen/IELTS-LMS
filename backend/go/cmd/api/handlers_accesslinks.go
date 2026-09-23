package main

import (
	"net/http"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/accesslinks"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// requireAccessLinks rejects requests when the access-links service is not wired.
func requireAccessLinks(w http.ResponseWriter, r *http.Request, app *App) bool {
	if app.AccessLinks == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Access-links service is unavailable."))
		return false
	}
	return true
}

// accessLinkCreateBody mirrors CreateAssessmentAccessLinkRequest (camelCase).
type accessLinkCreateBody struct {
	PublishedVersionID *string                      `json:"publishedVersionId"`
	Name               string                       `json:"name"`
	EnabledSections    []string                     `json:"enabledSections"`
	AudienceType       accesslinks.AudienceType     `json:"audienceType"`
	AudienceLabel      *string                      `json:"audienceLabel"`
	AccessMode         accesslinks.Mode             `json:"accessMode"`
	AvailabilityType   accesslinks.AvailabilityType `json:"availabilityType"`
	OpensAt            *time.Time                   `json:"opensAt"`
	ClosesAt           *time.Time                   `json:"closesAt"`
	SelectedStudents   []accesslinks.MemberInput    `json:"selectedStudents"`
}

// accessLinkUpdateBody mirrors UpdateAssessmentAccessLinkRequest (camelCase;
// nil SelectedStudents keeps the existing roster).
type accessLinkUpdateBody struct {
	Revision         int32                        `json:"revision"`
	Name             string                       `json:"name"`
	EnabledSections  *[]string                    `json:"enabledSections"`
	AudienceType     accesslinks.AudienceType     `json:"audienceType"`
	AudienceLabel    *string                      `json:"audienceLabel"`
	AccessMode       accesslinks.Mode             `json:"accessMode"`
	AvailabilityType accesslinks.AvailabilityType `json:"availabilityType"`
	OpensAt          *time.Time                   `json:"opensAt"`
	ClosesAt         *time.Time                   `json:"closesAt"`
	SelectedStudents *[]accesslinks.MemberInput   `json:"selectedStudents"`
}

// accessLinkLifecycleBody mirrors SetAccessLinkLifecycleRequest (camelCase).
type accessLinkLifecycleBody struct {
	Revision int32                      `json:"revision"`
	State    accesslinks.LifecycleState `json:"state"`
}

type accessLinkDeleteBody struct {
	Revision *int32 `json:"revision"`
}

// accessLinkDuplicateBody mirrors DuplicateAssessmentAccessLinkRequest
// (camelCase; empty releaseTarget defaults to "source").
type accessLinkDuplicateBody struct {
	Revision         int32                         `json:"revision"`
	Name             *string                       `json:"name"`
	ReleaseTarget    string                        `json:"releaseTarget"`
	AvailabilityType *accesslinks.AvailabilityType `json:"availabilityType"`
	OpensAt          *time.Time                    `json:"opensAt"`
	ClosesAt         *time.Time                    `json:"closesAt"`
}

// accessLinkOverview returns the distribution overview for an exam (staff read).
func accessLinkOverview(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		out, err := app.AccessLinks.Overview(r.Context(), chi.URLParam(r, "examID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examLinksList lists the access links for an exam (staff read).
func examLinksList(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		out, err := app.AccessLinks.ListForExam(r.Context(), chi.URLParam(r, "examID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []accesslinks.AccessLink{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examLinkCreate creates an access link for an exam (staff write).
func examLinkCreate(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		var body accessLinkCreateBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.AccessLinks.Create(r.Context(), chi.URLParam(r, "examID"), sess.UserID, accesslinks.CreateRequest{
			PublishedVersionID: body.PublishedVersionID,
			Name:               body.Name,
			EnabledSections:    body.EnabledSections,
			AudienceType:       body.AudienceType,
			AudienceLabel:      body.AudienceLabel,
			AccessMode:         body.AccessMode,
			AvailabilityType:   body.AvailabilityType,
			OpensAt:            body.OpensAt,
			ClosesAt:           body.ClosesAt,
			SelectedStudents:   body.SelectedStudents,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// linkGet returns one access link by {linkID} (staff read; link exam context
// is loaded first, mirroring require_link_read_staff).
func linkGet(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		out, err := app.AccessLinks.Get(r.Context(), chi.URLParam(r, "linkID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// linkUpdate patches an access link with revision fencing (staff write).
func linkUpdate(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		linkID := chi.URLParam(r, "linkID")
		if _, err := app.AccessLinks.Get(r.Context(), linkID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var body accessLinkUpdateBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.AccessLinks.Update(r.Context(), linkID, accesslinks.UpdateRequest{
			Revision:         body.Revision,
			Name:             body.Name,
			EnabledSections:  body.EnabledSections,
			AudienceType:     body.AudienceType,
			AudienceLabel:    body.AudienceLabel,
			AccessMode:       body.AccessMode,
			AvailabilityType: body.AvailabilityType,
			OpensAt:          body.OpensAt,
			ClosesAt:         body.ClosesAt,
			SelectedStudents: body.SelectedStudents,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// linkLifecycle transitions an access link lifecycle state (staff write).
func linkLifecycle(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		linkID := chi.URLParam(r, "linkID")
		if _, err := app.AccessLinks.Get(r.Context(), linkID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var body accessLinkLifecycleBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.AccessLinks.SetLifecycle(r.Context(), linkID, accesslinks.SetLifecycleRequest{
			Revision: body.Revision,
			State:    body.State,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// linkDelete permanently removes a Student Link. Its member allowlist is
// removed by the existing foreign key; the backing schedule and attempts stay.
func linkDelete(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		var body accessLinkDeleteBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if body.Revision == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "revision is required."))
			return
		}
		if err := app.AccessLinks.Delete(r.Context(), chi.URLParam(r, "linkID"), *body.Revision); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// linkDuplicate duplicates an access link onto a new backing schedule (staff write).
func linkDuplicate(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		linkID := chi.URLParam(r, "linkID")
		if _, err := app.AccessLinks.Get(r.Context(), linkID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var body accessLinkDuplicateBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.AccessLinks.Duplicate(r.Context(), linkID, sess.UserID, accesslinks.DuplicateRequest{
			Revision:         body.Revision,
			Name:             body.Name,
			ReleaseTarget:    accesslinks.DuplicateReleaseTarget(body.ReleaseTarget),
			AvailabilityType: body.AvailabilityType,
			OpensAt:          body.OpensAt,
			ClosesAt:         body.ClosesAt,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// linkMembers returns the member roster for a link (staff read).
func linkMembers(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		linkID := chi.URLParam(r, "linkID")
		if _, err := app.AccessLinks.Get(r.Context(), linkID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.AccessLinks.ListMembers(r.Context(), linkID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []accesslinks.Member{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// linkActivity returns the participation activity for a link (staff read).
func linkActivity(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		if !requireAccessLinks(w, r, app) {
			return
		}
		linkID := chi.URLParam(r, "linkID")
		if _, err := app.AccessLinks.Get(r.Context(), linkID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.AccessLinks.Activity(r.Context(), linkID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []accesslinks.Activity{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// publicLinkResolveEntry gates entry for a link (no auth): lifecycle + roster /
// identity + backing-schedule window via ResolveEntry. Register as
// POST /public/access-links/{linkID}/resolve-entry in cmd/api/main.go (see
// stream-E summary snippet); kept in this owned file so main.go stays untouched.
func publicLinkResolveEntry(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAccessLinks(w, r, app) {
			return
		}
		var body struct {
			StudentCode  string `json:"studentCode"`
			StudentName  string `json:"studentName"`
			StudentEmail string `json:"studentEmail"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.AccessLinks.ResolveEntry(r.Context(), chi.URLParam(r, "linkID"), body.StudentCode, body.StudentName, body.StudentEmail)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// publicLinkGet returns the public projection for a link (no auth).
func publicLinkGet(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireAccessLinks(w, r, app) {
			return
		}
		out, err := app.AccessLinks.PublicLink(r.Context(), chi.URLParam(r, "linkID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

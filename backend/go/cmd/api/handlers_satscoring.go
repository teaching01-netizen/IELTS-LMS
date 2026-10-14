package main

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/authoring"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/satconvert"
)

// Global SAT score conversion (docs/scoreconverimplement.md §3). Reads are
// admin/admin_observer, writes are admin only; both are enforced by the authz
// table. The actor and request id come from the trusted session/request
// context, never from the body.

const codePreconditionRequired apperrors.Code = "PRECONDITION_REQUIRED"

func satScoringService(w http.ResponseWriter, r *http.Request, app *App) bool {
	if app.SatScoring == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Score conversion service is unavailable."))
		return false
	}
	return true
}

func satScoringSettingsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireSession(w, r) == nil || !satScoringService(w, r, app) {
			return
		}
		active, err := app.SatScoring.ActiveRevision(r.Context(), app.DB)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		drafts, err := app.SatScoring.ListDrafts(r.Context())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		blueprint := map[string]map[string]int{}
		for _, section := range []string{satconvert.SectionReadingWriting, satconvert.SectionMath} {
			if n, ok := authoring.SATBlueprintOperational(section); ok {
				blueprint[section] = map[string]int{"m1Operational": n, "m2Operational": n}
			}
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"active": active, "drafts": drafts, "blueprint": blueprint})
	}
}

func satScoringRevisionsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireSession(w, r) == nil || !satScoringService(w, r, app) {
			return
		}
		revisions, err := app.SatScoring.ListRevisions(r.Context())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"revisions": revisions})
	}
}

func satScoringRevisionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireSession(w, r) == nil || !satScoringService(w, r, app) {
			return
		}
		rev, err := app.SatScoring.GetRevision(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, rev)
	}
}

func satScoringCreateDraftHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil || !satScoringService(w, r, app) {
			return
		}
		var req struct {
			FromRevisionID *string `json:"fromRevisionId"`
		}
		if err := httpx.DecodeLimitedOptional(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		rev, err := app.SatScoring.CreateDraft(r.Context(), sess.UserID, httpx.RequestIDOf(w, r), req.FromRevisionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, rev)
	}
}

// parseIfMatch accepts the draft version as a bare integer, "3" or W/"3".
func parseIfMatch(r *http.Request) (int, error) {
	raw := strings.TrimSpace(r.Header.Get("If-Match"))
	if raw == "" {
		return 0, &apperrors.Error{Code: codePreconditionRequired, Message: "If-Match with the draft version is required.", HTTPStatus: http.StatusPreconditionRequired}
	}
	raw = strings.Trim(strings.TrimPrefix(raw, "W/"), `"`)
	v, err := strconv.Atoi(raw)
	if err != nil || v < 1 {
		return 0, apperrors.New(apperrors.CodeBadRequest, "If-Match must be the draft version number.")
	}
	return v, nil
}

func satScoringSaveDraftHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil || !satScoringService(w, r, app) {
			return
		}
		version, err := parseIfMatch(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var req struct {
			Content           json.RawMessage `json:"content"`
			CalibrationSource string          `json:"calibrationSource"`
			Note              string          `json:"note"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		rev, err := app.SatScoring.SaveDraft(r.Context(), sess.UserID, httpx.RequestIDOf(w, r), chi.URLParam(r, "id"), version, req.Content, req.CalibrationSource, req.Note)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, rev)
	}
}

func satScoringValidateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireSession(w, r) == nil || !satScoringService(w, r, app) {
			return
		}
		errs, warns, err := app.SatScoring.Validate(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"valid": len(errs) == 0, "errors": errs, "warnings": warns})
	}
}

func satScoringLookupHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireSession(w, r) == nil || !satScoringService(w, r, app) {
			return
		}
		var req struct {
			DraftID       string `json:"draftId"`
			RevisionID    string `json:"revisionId"`
			Section       string `json:"section"`
			Topology      string `json:"topology"`
			M1            int    `json:"m1"`
			M2            *int   `json:"m2"`
			M1Operational *int   `json:"m1Operational"`
			M2Operational *int   `json:"m2Operational"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		id := req.DraftID
		if id == "" {
			id = req.RevisionID
		}
		if id == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "draftId or revisionId is required."))
			return
		}
		out, err := app.SatScoring.Lookup(r.Context(), id, req.Section, satconvert.Topology(req.Topology), req.M1, req.M2, req.M1Operational, req.M2Operational)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

func satScoringImpactHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireSession(w, r) == nil || !satScoringService(w, r, app) {
			return
		}
		report, err := app.SatScoring.Impact(r.Context(), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, report)
	}
}

func satScoringPublishHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil || !satScoringService(w, r, app) {
			return
		}
		out, err := app.SatScoring.Publish(r.Context(), sess.UserID, httpx.RequestIDOf(w, r), chi.URLParam(r, "id"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

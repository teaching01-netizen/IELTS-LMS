package main

import (
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/pagination"
	"example.com/ielts-proctoring/internal/proctor"
)

// proctorRosterHandler serves the plan-D4 paginated roster: cursor
// (updated_at,id) + limit (default 200, cap 1000) + status filter. Same
// row shape as the full detail; cursor echo lets clients page on demand
// instead of re-scanning the cohort.
func proctorRosterHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Plan E1: bounded budget on the cohort-scan path.
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			proctorRosterInner(app, w, r)
		})
	}
}

func proctorRosterInner(app *App, w http.ResponseWriter, r *http.Request) {
	{
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleProctor)
		if sess == nil {
			return
		}
		// Fail-closed ?limit= runs before service/DB gates: malformed
		// input 400s even when dependencies are down.
		q := r.URL.Query()
		cur, cerr := pagination.ParseCursor(r)
		if cerr != nil {
			if writePaginationFieldError(w, r, cerr) {
				return
			}
			httpx.WriteError(w, r, cerr)
			return
		}
		rosterLimit := proctor.DefaultRosterPageLimit
		if strings.TrimSpace(q.Get("limit")) != "" {
			rosterLimit = cur.Limit
		}
		if app.Proctor == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Proctor service is unavailable."))
			return
		}
		scheduleID := strings.TrimSpace(chi.URLParam(r, "scheduleID"))
		if scheduleID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Schedule id is required."))
			return
		}
		if sess.Role == auth.RoleProctor {
			ok, err := proctorHasLiveAssignment(r.Context(), app.DB, scheduleID, sess.UserID)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if !ok {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			}
		}
		limit := rosterLimit
		var cursor proctor.RosterCursor
		if raw := strings.TrimSpace(q.Get("cursorUpdatedAt")); raw != "" {
			if ts, err := time.Parse(time.RFC3339Nano, raw); err == nil {
				cursor.UpdatedAt = ts
			}
		}
		cursor.ID = strings.TrimSpace(q.Get("cursorID"))
		if !cursor.UpdatedAt.IsZero() && cursor.ID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "cursorID is required with cursorUpdatedAt."))
			return
		}
		page, err := app.Proctor.LoadStudentSessionsPage(r.Context(), scheduleID, cursor, limit, strings.TrimSpace(q.Get("status")))
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		nextUpdated := ""
		if !page.Next.UpdatedAt.IsZero() {
			nextUpdated = page.Next.UpdatedAt.UTC().Format(time.RFC3339Nano)
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"rows":              page.Rows,
			"hasMore":           page.HasMore,
			"nextCursorUpdated": nextUpdated,
			"nextCursorID":      page.Next.ID,
		})
	}
}

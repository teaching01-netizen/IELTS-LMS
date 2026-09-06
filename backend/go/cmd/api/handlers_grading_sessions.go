package main

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// Grading session reads (GET /grading/sessions, GET /grading/sessions/{id}).
//
// Mirrors backend/crates/api/src/routes/grading.rs list_sessions (dual shape:
// paginated {sessions,pagination} when ?page/?pageSize/?search is present,
// else the legacy plain array) and get_session (page/pageSize default 1/25).
// Role gate is Admin|AdminObserver|Grader on both routes.
//
// Grader scope choice: Go has no per-request assignment loader on
// auth.ActorContext (actorOf only attaches the org), so the handler loads the
// grader's live assignment set directly from schedule_staff_assignments with
// the same predicate as the Rust assigned_schedule_ids helper
// (user_id + role='grader' + revoked_at IS NULL; per-schedule live checks
// elsewhere use proctor.SQLAssignmentChecker). Admin/AdminObserver pass no
// allow-list and see all rows. A grader with no assignments gets an empty
// (non-nil) allow-list: the list collapses to zero rows and the detail path
// returns NOT_FOUND, never cross-schedule state. auth.ActorContext
// ScheduleScope remains a fallback inside the service for direct (non-HTTP)
// callers that pass a nil allow-list.
//
// NOTE: the scope check applies to the session's schedule_id (the same scope
// the Rust service enforces via ensure_can_grade_schedule), not to the raw
// {sessionID} path value.

// gradingSessionsLimitParam parses ?limit= with default 200 clamped 1..500,
// mirroring the Rust legacy list clamp.
func gradingSessionsLimitParam(r *http.Request) int {
	s := strings.TrimSpace(r.URL.Query().Get("limit"))
	if s == "" {
		return 200
	}
	n, err := strconv.Atoi(s)
	if err != nil {
		return 200
	}
	if n < 1 {
		return 1
	}
	if n > 500 {
		return 500
	}
	return n
}

// gradingPageParam parses a 1-based ?page=/?pageSize= value; absent, blank,
// or non-numeric values yield def (Rust handler defaults: page 1, pageSize
// 10 for the queue and 25 for detail). Numeric values below 1 yield 1; the
// service clamps pageSize to 1..100.
func gradingPageParam(r *http.Request, key string, def uint64) uint64 {
	s := strings.TrimSpace(r.URL.Query().Get(key))
	if s == "" {
		return def
	}
	n, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return def
	}
	if n < 1 {
		return 1
	}
	return n
}

// gradingAssignedScheduleIDs loads the grader's live assignment set
// (schedule_staff_assignments, role='grader', revoked_at IS NULL), mirroring
// the Rust assigned_schedule_ids helper. It returns an empty non-nil slice
// when the grader holds no assignments so callers can distinguish "grader
// with no access" (empty) from "no allow-list" (nil, admin path).
func gradingAssignedScheduleIDs(ctx context.Context, db *sql.DB, userID string) ([]string, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT schedule_id FROM schedule_staff_assignments WHERE user_id = ? AND role = 'grader' AND revoked_at IS NULL`,
		userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// requireGraderSchedule fences grader reads/writes to one schedule via a
// live schedule_staff_assignments row (role='grader', revoked_at IS NULL).
// Missing assignment maps to not-found so graders cannot probe other
// schedules; callers render the 404 envelope.
func requireGraderSchedule(ctx context.Context, db *sql.DB, userID, scheduleID string) error {
	if strings.TrimSpace(scheduleID) == "" {
		return sql.ErrNoRows
	}
	var one int
	err := db.QueryRowContext(ctx,
		`SELECT 1 FROM schedule_staff_assignments WHERE schedule_id = ? AND user_id = ? AND role = 'grader' AND revoked_at IS NULL LIMIT 1`,
		scheduleID, userID).Scan(&one)
	return err
}

// gradingSessionScope returns the actor's schedule scope, if any.
func gradingSessionScope(ctx context.Context) []string {
	if actor := actorOf(ctx); len(actor.ScheduleScope) > 0 {
		return actor.ScheduleScope
	}
	return nil
}

// gradingSessionsHandler serves the dual-shape session queue: paginated
// {sessions,pagination} when any of page/pageSize/search is present, else
// the legacy plain array capped by ?limit= (default 200, clamp 1..500).
func gradingSessionsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		ctx := r.Context()
		var allowed []string
		if sess.Role == auth.RoleGrader {
			ids, err := gradingAssignedScheduleIDs(ctx, app.DB, sess.UserID)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			allowed = ids
		}
		scope := gradingSessionScope(ctx)
		q := r.URL.Query()
		_, hasPage := q["page"]
		_, hasPageSize := q["pageSize"]
		search := strings.TrimSpace(q.Get("search"))
		if hasPage || hasPageSize || search != "" {
			out, err := app.Grading.ListSessionsPage(ctx, sess.Role, allowed, scope,
				gradingPageParam(r, "page", 1), gradingPageParam(r, "pageSize", 10), search)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			httpx.WriteJSON(w, http.StatusOK, out)
			return
		}
		out, err := app.Grading.ListSessions(ctx, sess.Role, allowed, scope, gradingSessionsLimitParam(r))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteJSON(w, http.StatusOK, []any{})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// gradingSessionHandler serves one session plus its submissions page
// (page/pageSize default 1/25). Graders outside the session's schedule get
// NOT_FOUND, matching the Rust service authorization.
func gradingSessionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleGrader)
		if sess == nil {
			return
		}
		if !requireGradingDB(w, r, app) {
			return
		}
		if app.Grading == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Grading service not configured."))
			return
		}
		sessionID := strings.TrimSpace(chi.URLParam(r, "sessionID"))
		if sessionID == "" {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "Session id is required."))
			return
		}
		ctx := r.Context()
		var allowed []string
		if sess.Role == auth.RoleGrader {
			ids, err := gradingAssignedScheduleIDs(ctx, app.DB, sess.UserID)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			allowed = ids
		}
		out, err := app.Grading.GetSessionDetail(ctx, sess.Role, allowed, gradingSessionScope(ctx),
			sessionID, gradingPageParam(r, "page", 1), gradingPageParam(r, "pageSize", 25))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

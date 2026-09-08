package main

import (
	"context"
	"database/sql"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/proctor"
)

// liveModeSnapshot is the GET /proctor/live-mode wire shape. It mirrors the
// Rust DegradedLiveState (camelCase): degraded plus a nullable reason.
type liveModeSnapshot struct {
	Degraded bool    `json:"degraded"`
	Reason   *string `json:"reason"`
}

// proctorLiveModeHandler serves the degraded-live-mode snapshot. Role gate is
// Admin|AdminObserver|Proctor; a Proctor with no ?scheduleId= gets 404
// NOT_FOUND (Rust authorize rule). When live mode is disabled the snapshot is
// static and touches no DB; otherwise stale outbox rows decide degraded.
func proctorLiveModeHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleProctor)
		if sess == nil {
			return
		}
		scheduleID := strings.TrimSpace(r.URL.Query().Get("scheduleId"))
		if scheduleID == "" && sess.Role == auth.RoleProctor {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
			return
		}
		if !app.Config.LiveModeEnabled {
			reason := "live-mode-disabled"
			httpx.WriteJSON(w, http.StatusOK, liveModeSnapshot{Degraded: false, Reason: &reason})
			return
		}
		if app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Database not configured."))
			return
		}
		n, err := liveModeStaleOutboxCount(r.Context(), app.DB, scheduleID, time.Now().UTC().Add(-15*time.Second))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if n > 0 {
			reason := "outbox-backlog"
			httpx.WriteJSON(w, http.StatusOK, liveModeSnapshot{Degraded: true, Reason: &reason})
			return
		}
		httpx.WriteJSON(w, http.StatusOK, liveModeSnapshot{Degraded: false})
	}
}

// liveModeStaleOutboxCount counts stale outbox rows (unpublished, unfailed,
// created over 15s ago), mirroring Rust LiveModeService::snapshot. Column
// names follow the Go schema (0009 base + 0030 retry policy): aggregate_kind,
// aggregate_id, published_at, failed_at, created_at. Scoped to
// aggregate_kind=schedule_runtime when scheduleID is given, else global.
func liveModeStaleOutboxCount(ctx context.Context, db *sql.DB, scheduleID string, threshold time.Time) (int64, error) {
	if scheduleID != "" {
		const q = `SELECT COUNT(*) FROM outbox_events` +
			` WHERE aggregate_kind = 'schedule_runtime'` +
			` AND aggregate_id = ?` +
			` AND published_at IS NULL` +
			` AND failed_at IS NULL` +
			` AND created_at < ?`
		var n int64
		if err := db.QueryRowContext(ctx, q, scheduleID, threshold).Scan(&n); err != nil {
			return 0, err
		}
		return n, nil
	}
	const q = `SELECT COUNT(*) FROM outbox_events` +
		` WHERE published_at IS NULL` +
		` AND failed_at IS NULL` +
		` AND created_at < ?`
	var n int64
	if err := db.QueryRowContext(ctx, q, threshold).Scan(&n); err != nil {
		return 0, err
	}
	return n, nil
}

// Proctor session reads (GET /proctor/sessions, GET /proctor/sessions/{scheduleID}).
//
// Mirrors backend/crates/api/src/routes/proctor.rs list_sessions/get_session.
// Role gate is Admin|AdminObserver|Proctor on both routes. Scoping (same
// split as Rust): proctors are filtered/checked against their live
// schedule_staff_assignments rows (user_id + role='proctor' + revoked_at IS
// NULL, mirroring the Rust assigned_schedule_ids helper and the
// gradingAssignedScheduleIDs pattern); out-of-scope schedules collapse the
// list and 404 the detail (never a cross-schedule leak). ?providerKey= is
// validated to sat|ielts|act with a 422 VALIDATION_ERROR otherwise (Rust
// behavior), applied via the exams-provider join from
// provider_schedule_ids. ?mode=dashboard switches the audit/alert limits
// (defaults 200/100, mirroring Rust); otherwise limits are unbounded and
// alerts build from the audit rows with no second query.

// proctorAssignedScheduleIDs loads the proctor's live assignment set
// (schedule_staff_assignments, user_id + role='proctor' + revoked_at IS
// NULL), mirroring the Rust assigned_schedule_ids helper. It returns an
// empty non-nil slice when the proctor holds no assignments so the list
// collapses to zero rows and the detail 404s.
func proctorAssignedScheduleIDs(ctx context.Context, db *sql.DB, userID string) ([]string, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT schedule_id FROM schedule_staff_assignments WHERE user_id = ? AND role = 'proctor' AND revoked_at IS NULL",
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

// proctorProviderScheduleIDs resolves the schedule ids owned by a provider,
// mirroring the Rust provider_schedule_ids join.
func proctorProviderScheduleIDs(ctx context.Context, db *sql.DB, providerKey string) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx,
		"SELECT schedules.id FROM exam_schedules schedules JOIN exam_entities exams ON exams.id = schedules.exam_id WHERE exams.provider_key = ?",
		providerKey)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// proctorHasLiveAssignment reports one live proctor assignment row for the
// schedule (actor_id OR user_id, never revoked). Misses 404, mirroring the
// Rust authorize_read_schedule mapping.
func proctorHasLiveAssignment(ctx context.Context, db *sql.DB, scheduleID, userID string) (bool, error) {
	var exists bool
	err := db.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM schedule_staff_assignments WHERE schedule_id = ? AND (actor_id = ? OR user_id = ?) AND revoked_at IS NULL)",
		scheduleID, userID, userID).Scan(&exists)
	if err != nil {
		return false, err
	}
	return exists, nil
}

// proctorSessionLimits resolves the audit/alert limits: ?mode=dashboard
// switches to the bounded dashboard path (defaults audit 200 / alert 100,
// mirroring Rust), otherwise both stay unbounded (Rust default options) so
// the service builds alerts from the audit rows with no second query.
func proctorSessionLimits(r *http.Request) (auditLimit, alertLimit int) {
	if strings.TrimSpace(r.URL.Query().Get("mode")) != "dashboard" {
		return 0, 0
	}
	return proctorLimitParam(r, "auditLimit", 200), proctorLimitParam(r, "alertLimit", 100)
}

// proctorLimitParam parses a positive int query param or returns def.
func proctorLimitParam(r *http.Request, key string, def int) int {
	raw := strings.TrimSpace(r.URL.Query().Get(key))
	if raw == "" {
		return def
	}
	n, err := strconv.Atoi(raw)
	if err != nil || n <= 0 {
		return def
	}
	return n
}

// proctorSessionsHandler serves the session summary list. Proctors see only
// assigned schedules; ?providerKey= filters to sat|ielts|act (422 otherwise).
func proctorSessionsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleProctor)
		if sess == nil {
			return
		}
		if app.Proctor == nil || app.DB == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Proctor service is unavailable."))
			return
		}
		ctx := r.Context()
		var allowed map[string]bool
		if sess.Role == auth.RoleProctor {
			ids, err := proctorAssignedScheduleIDs(ctx, app.DB, sess.UserID)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			allowed = make(map[string]bool, len(ids))
			for _, id := range ids {
				allowed[id] = true
			}
		}
		if providerKey := strings.TrimSpace(r.URL.Query().Get("providerKey")); providerKey != "" {
			if providerKey != "sat" && providerKey != "ielts" && providerKey != "act" {
				httpx.WriteError(w, r, &apperrors.Error{Code: apperrors.CodeValidation, Message: "providerKey must be sat, ielts, or act.", HTTPStatus: http.StatusUnprocessableEntity})
				return
			}
			ids, err := proctorProviderScheduleIDs(ctx, app.DB, providerKey)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if allowed == nil {
				allowed = ids
			} else {
				for id := range allowed {
					if !ids[id] {
						delete(allowed, id)
					}
				}
			}
		}
		summaries, err := app.Proctor.ListSessions(ctx, proctorActorOf(sess), app.Config.LiveModeEnabled)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out := []proctor.ProctorSessionSummary{}
		for _, s := range summaries {
			if allowed != nil && !allowed[s.Schedule.ID] {
				continue
			}
			out = append(out, s)
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// proctorSessionHandler serves one session detail view. Proctors outside
// the schedule assignment get NOT_FOUND. ?mode=dashboard switches the
// audit/alert limits (defaults 200/100).
func proctorSessionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleProctor)
		if sess == nil {
			return
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
		// Plan D4: ?mode=rollup serves the 1-row header (dashboard poll fast
		// path; falls back to the full roster on a miss so old clients keep
		// working). Default mode keeps today's full detail (rollback shape).
		if r.URL.Query().Get("mode") == "rollup" {
			rollup, rerr := app.Proctor.LoadRollup(r.Context(), scheduleID)
			if rerr == nil {
				httpx.WriteJSON(w, http.StatusOK, rollup)
				return
			}
		}
		auditLimit, alertLimit := proctorSessionLimits(r)
		detail, err := app.Proctor.GetSessionDetail(r.Context(), proctorActorOf(sess), scheduleID, auditLimit, alertLimit)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if app.Config.LiveModeEnabled {
			n, err := liveModeStaleOutboxCount(r.Context(), app.DB, scheduleID, time.Now().UTC().Add(-15*time.Second))
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			detail.DegradedLiveMode = n > 0
		}
		httpx.WriteJSON(w, http.StatusOK, detail)
	}
}

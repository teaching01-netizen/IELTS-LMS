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
	"example.com/ielts-proctoring/internal/platform/pagination"
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
// split as Rust): proctors are scoped by their live
// schedule_staff_assignments rows (user_id + role='proctor' + revoked_at IS
// NULL, mirroring the Rust assigned_schedule_ids helper and the
// gradingAssignedScheduleIDs pattern). The list route applies that
// assignment and ?providerKey= at SQL selection time (proctor.ListSessions
// scope) so runtimes and grouped counts only read authorized rooms; the
// detail route checks one assignment and 404s (never a cross-schedule leak).
// ?providerKey= is validated to sat|ielts|act with a 422 VALIDATION_ERROR
// otherwise (Rust behavior), applied through the same provider relationship
// as the old provider_schedule_ids helper (exam_entities.id =
// exam_schedules.exam_id). ?mode=dashboard switches the audit/alert limits
// (defaults 200/100, mirroring Rust); otherwise limits are unbounded and
// alerts build from the audit rows with no second query.

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

// parseProctorDashboardLimits parses dashboard limits fail-closed
// (WS-13.1): malformed numerics yield FieldError (400); absent keeps
// legacy defaults; numerics <= 0 clamp to the legacy default path via
// proctorLimitParam (behavior preserved, only malformed becomes 400).
func parseProctorDashboardLimits(r *http.Request) (auditLimit, alertLimit int, err error) {
	if strings.TrimSpace(r.URL.Query().Get("mode")) != "dashboard" {
		return 0, 0, nil
	}
	for _, key := range []string{"auditLimit", "alertLimit"} {
		raw := strings.TrimSpace(r.URL.Query().Get(key))
		if raw == "" {
			continue
		}
		if _, aerr := strconv.Atoi(raw); aerr != nil {
			return 0, 0, pagination.FieldError{Field: key, Reason: "must be a base-10 integer"}
		}
	}
	return proctorLimitParam(r, "auditLimit", 200), proctorLimitParam(r, "alertLimit", 100), nil
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
// Both filters are pushed into the service's schedule query so hydration and
// grouped counts never run for rooms this caller cannot see.
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
		scope := proctor.SessionListScope{}
		if providerKey := strings.TrimSpace(r.URL.Query().Get("providerKey")); providerKey != "" {
			if providerKey != "sat" && providerKey != "ielts" && providerKey != "act" {
				httpx.WriteError(w, r, &apperrors.Error{Code: apperrors.CodeValidation, Message: "providerKey must be sat, ielts, or act.", HTTPStatus: http.StatusUnprocessableEntity})
				return
			}
			scope.ProviderKey = providerKey
		}
		summaries, err := app.Proctor.ListSessions(ctx, proctorActorOf(sess), app.Config.LiveModeEnabled, scope)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, summaries)
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
		// Fail-closed dashboard parsing before service/DB gates.
		auditLimit, alertLimit, lerr := parseProctorDashboardLimits(r)
		if lerr != nil {
			if writePaginationFieldError(w, r, lerr) {
				return
			}
			httpx.WriteError(w, r, lerr)
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

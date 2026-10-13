package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
)

// proctorAssignRouteHandler commits staff's Module 2 choice for one student
// (POST /proctor/sessions/{scheduleID}/attempts/{attemptID}/route, body
// {sectionKey, route: lower|higher}) under a staff_selects classroom session.
// 403 unauthorized, 404 outside the staff scope, 409 conflicting/stale choice,
// 422 impossible plan; an identical repeat replays the committed decision.
func proctorAssignRouteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, schedule, ok := requireStaffSchedule(w, r, app)
		if !ok {
			return
		}
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		var body struct {
			SectionKey string `json:"sectionKey"`
			Route      string `json:"route"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Delivery.AssignStaffRoute(r.Context(), sess.UserID, schedule.ID, chi.URLParam(r, "attemptID"), body.SectionKey, body.Route)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// proctorStaffRouteQueueHandler lists students awaiting a Module 2 choice
// (GET /proctor/sessions/{scheduleID}/route-queue).
func proctorStaffRouteQueueHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, schedule, ok := requireStaffSchedule(w, r, app)
		if !ok {
			return
		}
		if app.Delivery == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Delivery service is unavailable."))
			return
		}
		out, err := app.Delivery.ListStaffRouteQueue(r.Context(), schedule.ID)
		if err != nil {
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

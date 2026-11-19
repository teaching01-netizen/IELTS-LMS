package main

import (
	"context"
	"errors"
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satlearning"
	"example.com/ielts-proctoring/internal/schedules"
)

func authorizeLearningSchedule(app *App, r *http.Request) (schedules.Schedule, error) {
	id := chi.URLParam(r, "id")
	if id == "" {
		id = chi.URLParam(r, "scheduleID")
	}
	if app.Schedules == nil {
		return schedules.Schedule{}, apperrors.New(apperrors.CodeServiceUnavailable, "Sat schedules are temporarily unavailable.")
	}
	schedule, err := app.Schedules.Get(r.Context(), id)
	if err != nil {
		return schedules.Schedule{}, err
	}
	if err := authorizeScheduleForActor(app, r, SessionOf(r.Context()), schedule); err != nil {
		return schedules.Schedule{}, err
	}
	if schedule.ProviderKey != "sat" {
		return schedules.Schedule{}, apperrors.New(apperrors.CodeNotFound, "SAT schedule not found.")
	}
	actor := actorOf(r.Context())
	if schedule.OrganizationID != nil && actor.OrgID != nil && *schedule.OrganizationID != *actor.OrgID {
		return schedules.Schedule{}, apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
	}
	return schedule, nil
}

func satLearningSettingsGet(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		schedule, err := authorizeLearningSchedule(app, r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		policy, err := satlearning.LoadPolicyTx(r.Context(), app.DB, schedule.ID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, policy)
	}
}

func satLearningSettingsPut(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		schedule, err := authorizeLearningSchedule(app, r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		var input struct {
			satlearning.Policy
			ExpectedRevision int64 `json:"expectedRevision"`
		}
		if err := httpx.DecodeLimited(r, 8192, &input); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if app.Tx == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Settings are temporarily unavailable."))
			return
		}
		var saved satlearning.Policy
		err = app.Tx.WithTxRetry(r.Context(), 3, func(ctx context.Context, q tx.Tx) error {
			var writeErr error
			saved, writeErr = satlearning.SavePolicyTx(ctx, q, schedule.ID, input.Policy, input.ExpectedRevision, actorOf(ctx).UserID)
			return writeErr
		})
		if err != nil {
			httpx.WriteError(w, r, mapLearningSettingsError(r, err))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, saved)
	}
}

func mapLearningSettingsError(r *http.Request, err error) error {
	var conflict *satlearning.RevisionConflict
	if errors.As(err, &conflict) {
		typed := apperrors.New(apperrors.CodePolicyRevisionConflict, "These settings were saved by another teacher. Reload before saving.")
		typed.HTTPStatus = http.StatusConflict
		typed.Details = map[string]any{"currentRevision": conflict.Current}
		return typed
	}
	var validation *satlearning.ValidationError
	if errors.As(err, &validation) {
		typed := apperrors.New(apperrors.CodeValidation, validation.Message)
		typed.HTTPStatus = http.StatusBadRequest
		typed.Details = map[string]any{"field": validation.Field}
		return typed
	}
	return err
}

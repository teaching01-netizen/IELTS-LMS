package main

import (
	"net/http"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/proctor"
)

type sessionNoteMutationBody struct {
	Category   string `json:"category"`
	Content    string `json:"content"`
	IsResolved bool   `json:"isResolved"`
}

type violationRuleMutationBody struct {
	TriggerType           string  `json:"triggerType"`
	Threshold             int     `json:"threshold"`
	SpecificViolationType *string `json:"specificViolationType"`
	SpecificSeverity      *string `json:"specificSeverity"`
	Action                string  `json:"action"`
	IsEnabled             bool    `json:"isEnabled"`
}

func proctorSessionNotesListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		notes, err := app.Proctor.ListSessionNotes(r.Context(), *actor, chi.URLParam(r, "scheduleID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, notes)
	}
}

func proctorAllSessionNotesHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		notes, err := app.Proctor.ListAllSessionNotes(r.Context(), *actor)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, notes)
	}
}

func proctorSessionNoteSaveHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		var body sessionNoteMutationBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		note := proctor.SessionNote{
			ID:         chi.URLParam(r, "noteID"),
			ScheduleID: chi.URLParam(r, "scheduleID"),
			Category:   body.Category,
			Content:    body.Content,
			IsResolved: body.IsResolved,
		}
		saved, err := app.Proctor.UpsertSessionNote(r.Context(), *actor, note)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, saved)
	}
}

func proctorSessionNoteCreateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		var body sessionNoteMutationBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		saved, err := app.Proctor.UpsertSessionNote(r.Context(), *actor, proctor.SessionNote{
			ScheduleID: chi.URLParam(r, "scheduleID"),
			Category:   body.Category,
			Content:    body.Content,
			IsResolved: body.IsResolved,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, saved)
	}
}

func proctorSessionNoteDeleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if err := app.Proctor.DeleteSessionNote(r.Context(), *actor, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "noteID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func proctorSessionNoteDeleteByIDHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if err := app.Proctor.DeleteSessionNoteByID(r.Context(), *actor, chi.URLParam(r, "noteID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func proctorViolationRulesListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		rules, err := app.Proctor.ListViolationRules(r.Context(), *actor, chi.URLParam(r, "scheduleID"))
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, rules)
	}
}

func proctorViolationRuleSaveHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		var body violationRuleMutationBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		saved, err := app.Proctor.UpsertViolationRule(r.Context(), *actor, proctor.ViolationRule{
			ID:                    chi.URLParam(r, "ruleID"),
			ScheduleID:            chi.URLParam(r, "scheduleID"),
			TriggerType:           body.TriggerType,
			Threshold:             body.Threshold,
			SpecificViolationType: body.SpecificViolationType,
			SpecificSeverity:      body.SpecificSeverity,
			Action:                body.Action,
			IsEnabled:             body.IsEnabled,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, saved)
	}
}

func proctorViolationRuleCreateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		var body violationRuleMutationBody
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		saved, err := app.Proctor.UpsertViolationRule(r.Context(), *actor, proctor.ViolationRule{
			ScheduleID:            chi.URLParam(r, "scheduleID"),
			TriggerType:           body.TriggerType,
			Threshold:             body.Threshold,
			SpecificViolationType: body.SpecificViolationType,
			SpecificSeverity:      body.SpecificSeverity,
			Action:                body.Action,
			IsEnabled:             body.IsEnabled,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, saved)
	}
}

func proctorViolationRuleDeleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if err := app.Proctor.DeleteViolationRule(r.Context(), *actor, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "ruleID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

func proctorViolationRuleDeleteByIDHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if err := app.Proctor.DeleteViolationRuleByID(r.Context(), *actor, chi.URLParam(r, "ruleID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	}
}

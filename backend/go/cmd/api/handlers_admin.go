package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/schedules"
)

// examsListHandler lists exams, optionally filtered by provider.
// The response is always a non-nil JSON array.
func examsListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		provider := strings.TrimSpace(r.URL.Query().Get("provider"))
		if provider == "" {
			provider = strings.TrimSpace(r.URL.Query().Get("providerKey"))
		}
		var providerKey *string
		if provider != "" {
			providerKey = &provider
		}
		out, err := app.Exams.ListForActor(r.Context(), actorOf(r.Context()), providerKey)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []exams.Exam{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examsCreateHandler creates an exam owned by the caller.
func examsCreateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		var req struct {
			Slug             string  `json:"slug"`
			Title            string  `json:"title"`
			ExamType         string  `json:"examType"`
			Visibility       string  `json:"visibility"`
			OrganizationID   *string `json:"organizationId"`
			ProviderKey      *string `json:"providerKey"`
			ProviderExamType *string `json:"providerExamType"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := app.Exams.CreateForActor(r.Context(), actorOf(r.Context()), exams.CreateRequest{
			Slug:             req.Slug,
			Title:            req.Title,
			ExamType:         req.ExamType,
			Visibility:       req.Visibility,
			OrganizationID:   req.OrganizationID,
			ProviderKey:      req.ProviderKey,
			ProviderExamType: req.ProviderExamType,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// examsGetHandler returns one exam by {id}.
func examsGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examsUpdateHandler patches title/status/visibility with revision fencing.
func examsUpdateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		var req struct {
			Title          *string `json:"title"`
			Status         *string `json:"status"`
			Visibility     *string `json:"visibility"`
			OrganizationID *string `json:"organizationId"`
			Revision       int     `json:"revision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.UpdateForActor(r.Context(), actorOf(r.Context()), id, exams.UpdateRequest{
			Title:          req.Title,
			Status:         req.Status,
			Visibility:     req.Visibility,
			OrganizationID: req.OrganizationID,
			Revision:       req.Revision,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examsDeleteHandler removes an exam.
func examsDeleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		id := chi.URLParam(r, "id")
		if err := app.Exams.DeleteForActor(r.Context(), actorOf(r.Context()), id); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// examsDraftHandler replaces the current draft content/config snapshots.
func examsDraftHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		var req struct {
			Content  json.RawMessage `json:"contentSnapshot"`
			Config   json.RawMessage `json:"configSnapshot"`
			Revision int             `json:"revision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.SaveDraftForActor(r.Context(), actorOf(r.Context()), id, exams.SaveDraftRequest{
			Content:  req.Content,
			Config:   req.Config,
			Revision: req.Revision,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examsDraftReopenHandler heals clone-database exams that lost their editable
// draft (orphan NULL/NULL pointers or sealed published rows): it reopens a
// fresh draft from the latest surviving version and returns it (201).
func examsDraftReopenHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.ReopenDraftForActor(r.Context(), actorOf(r.Context()), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// examsPublishHandler seals the current draft as published.
func examsPublishHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder) == nil {
			return
		}
		var req struct {
			PublishNotes           *string `json:"publishNotes"`
			Revision               int     `json:"revision"`
			ExpectedDraftVersionID *string `json:"expectedDraftVersionId"`
			ExpectedDraftRevision  *int    `json:"expectedDraftRevision"`
			OperationKey           *string `json:"operationKey"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		operationKey := ""
		if req.OperationKey != nil {
			operationKey = strings.TrimSpace(*req.OperationKey)
		}
		if operationKey == "" {
			operationKey = strings.TrimSpace(r.Header.Get("Idempotency-Key"))
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.PublishForActor(r.Context(), actorOf(r.Context()), id, exams.PublishRequest{
			PublishNotes:           req.PublishNotes,
			Revision:               req.Revision,
			ExpectedDraftVersionID: req.ExpectedDraftVersionID,
			ExpectedDraftRevision:  req.ExpectedDraftRevision,
			OperationKey:           operationKey,
		})
		observeAuthoringOp("publish", err)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examsEventsHandler returns the append-only audit trail for an exam.
func examsEventsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.ListEventsForActor(r.Context(), actorOf(r.Context()), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []exams.Event{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examsValidationHandler returns the publish-gate validation report.
func examsValidationHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.GetValidationForActor(r.Context(), actorOf(r.Context()), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examsVersionsHandler lists every version for an exam, newest first.
func examsVersionsHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.ListVersionsForActor(r.Context(), actorOf(r.Context()), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []exams.Version{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// examsVersionSummariesHandler lists light version summaries for an exam,
// newest first (mirrors list_version_summaries; Admin|AdminObserver|Builder).
func examsVersionSummariesHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Exams.ListVersionSummariesForActor(r.Context(), actorOf(r.Context()), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []exams.VersionSummary{}
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// versionSummaryHandler returns one exam_versions row by {versionID}.
// Explicit SQL keeps this read thin; NULL snapshots stay absent.
func versionSummaryHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder) == nil {
			return
		}
		versionID := chi.URLParam(r, "versionID")
		var id, examID string
		var versionNumber, revision int
		var parentVersionID, contentSnapshot, configSnapshot, validationSnapshot sql.NullString
		var createdBy string
		var createdAt time.Time
		var publishNotes sql.NullString
		var isDraft, isPublished bool
		err := app.DB.QueryRowContext(r.Context(),
			`SELECT id, exam_id, version_number, parent_version_id, content_snapshot, config_snapshot, validation_snapshot, created_by, is_draft, is_published, revision, created_at, publish_notes FROM exam_versions WHERE id = ?`,
			versionID).Scan(&id, &examID, &versionNumber, &parentVersionID, &contentSnapshot, &configSnapshot, &validationSnapshot, &createdBy, &isDraft, &isPublished, &revision, &createdAt, &publishNotes)
		if err == sql.ErrNoRows {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Version not found."))
			return
		}
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if _, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), examID); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out := map[string]any{
			"id":            id,
			"examId":        examID,
			"versionNumber": versionNumber,
			"createdBy":     createdBy,
			"createdAt":     createdAt,
			"publishNotes":  nil,
			"isDraft":       isDraft,
			"isPublished":   isPublished,
			"revision":      revision,
		}
		if publishNotes.Valid {
			out["publishNotes"] = publishNotes.String
		}
		if parentVersionID.Valid {
			out["parentVersionId"] = parentVersionID.String
		}
		if contentSnapshot.Valid {
			out["contentSnapshot"] = json.RawMessage(contentSnapshot.String)
		}
		if configSnapshot.Valid {
			out["configSnapshot"] = json.RawMessage(configSnapshot.String)
		}
		if validationSnapshot.Valid {
			out["validationSnapshot"] = json.RawMessage(validationSnapshot.String)
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

const previewRuntimeCohortPrefix = "__preview_runtime__:"

func isPreviewRuntimeSchedule(schedule schedules.Schedule) bool {
	return strings.HasPrefix(strings.TrimSpace(schedule.CohortName), previewRuntimeCohortPrefix)
}

// authorizeScheduleForActor keeps builder schedule access limited to the
// isolated schedules created by the builder preview. Normal cohort schedule
// administration remains an admin-only capability.
func authorizeScheduleForActor(app *App, r *http.Request, sess *auth.Session, schedule schedules.Schedule) error {
	if sess == nil || sess.Role != auth.RoleBuilder {
		return nil
	}
	if !isPreviewRuntimeSchedule(schedule) {
		return apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
	}
	if app.Exams == nil {
		return apperrors.New(apperrors.CodeServiceUnavailable, "Exam service is unavailable.")
	}
	_, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), schedule.ExamID)
	return err
}

func filterBuilderPreviewSchedules(app *App, r *http.Request, sess *auth.Session, input []schedules.Schedule) ([]schedules.Schedule, error) {
	if sess == nil || sess.Role != auth.RoleBuilder {
		return input, nil
	}
	out := make([]schedules.Schedule, 0, len(input))
	for _, schedule := range input {
		if !isPreviewRuntimeSchedule(schedule) {
			continue
		}
		if err := authorizeScheduleForActor(app, r, sess, schedule); err != nil {
			if typed, ok := apperrors.As(err); ok && typed.Code == apperrors.CodeNotFound {
				continue
			}
			return nil, err
		}
		out = append(out, schedule)
	}
	return out, nil
}

// schedulesListHandler lists schedules ordered by start time.
func schedulesListHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		out, err := app.Schedules.List(r.Context())
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			out = []schedules.Schedule{}
		}
		out, err = filterBuilderPreviewSchedules(app, r, sess, out)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// schedulesCreateHandler creates a schedule pinned to a published version.
func schedulesCreateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		var req struct {
			ExamID             string    `json:"examId"`
			PublishedVersionID string    `json:"publishedVersionId"`
			CohortName         string    `json:"cohortName"`
			ProctorDisplayName *string   `json:"proctorDisplayName"`
			GradingDisplayName *string   `json:"gradingDisplayName"`
			Institution        *string   `json:"institution"`
			StartTime          time.Time `json:"startTime"`
			EndTime            time.Time `json:"endTime"`
			AutoStart          *bool     `json:"autoStart"`
			AutoStop           *bool     `json:"autoStop"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Round 60 fail-fast: malformed envelope 400s before the builder
		// preview check + exam Get (no DB read burned on bad input).
		if verr := schedules.ValidateCreateRequest(schedules.CreateRequest{ExamID: req.ExamID, PublishedVersionID: req.PublishedVersionID, CohortName: req.CohortName, StartTime: req.StartTime, EndTime: req.EndTime}); verr != nil {
			httpx.WriteError(w, r, verr)
			return
		}
		if sess.Role == auth.RoleBuilder {
			if !isPreviewRuntimeSchedule(schedules.Schedule{CohortName: req.CohortName}) {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Builders may only create isolated preview schedules."))
				return
			}
			if app.Exams == nil {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Exam service is unavailable."))
				return
			}
			if _, err := app.Exams.GetForActor(r.Context(), actorOf(r.Context()), req.ExamID); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
		}
		proctorName := ""
		if req.ProctorDisplayName != nil {
			proctorName = *req.ProctorDisplayName
		}
		gradingName := ""
		if req.GradingDisplayName != nil {
			gradingName = *req.GradingDisplayName
		}
		autoStart := false
		if req.AutoStart != nil {
			autoStart = *req.AutoStart
		}
		autoStop := false
		if req.AutoStop != nil {
			autoStop = *req.AutoStop
		}
		out, err := app.Schedules.Create(r.Context(), schedules.CreateRequest{
			ExamID:             req.ExamID,
			PublishedVersionID: req.PublishedVersionID,
			CohortName:         req.CohortName,
			ProctorDisplayName: proctorName,
			GradingDisplayName: gradingName,
			Institution:        req.Institution,
			StartTime:          req.StartTime,
			EndTime:            req.EndTime,
			AutoStart:          autoStart,
			AutoStop:           autoStop,
			CreatedBy:          sess.UserID,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

// schedulesGetHandler returns one schedule by {id}.
func schedulesGetHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Schedules.Get(r.Context(), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := authorizeScheduleForActor(app, r, sess, out); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// schedulesUpdateHandler applies schedule edits with revision fencing.
func schedulesUpdateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if requireRole(w, r, auth.RoleAdmin) == nil {
			return
		}
		var req struct {
			PublishedVersionID *string    `json:"publishedVersionId"`
			CohortName         *string    `json:"cohortName"`
			ProctorDisplayName *string    `json:"proctorDisplayName"`
			GradingDisplayName *string    `json:"gradingDisplayName"`
			Institution        *string    `json:"institution"`
			StartTime          *time.Time `json:"startTime"`
			EndTime            *time.Time `json:"endTime"`
			AutoStart          *bool      `json:"autoStart"`
			AutoStop           *bool      `json:"autoStop"`
			Status             *string    `json:"status"`
			Revision           int        `json:"revision"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Round 62 fail-fast: explicitly inverted window 400s before
		// the FOR UPDATE row lock (merged-window check in the tx stays
		// authoritative for single-sided patches).
		if verr := schedules.ValidateUpdateWindow(req.StartTime, req.EndTime); verr != nil {
			httpx.WriteError(w, r, verr)
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Schedules.Update(r.Context(), id, schedules.UpdateRequest{
			PublishedVersionID: req.PublishedVersionID,
			CohortName:         req.CohortName,
			ProctorDisplayName: req.ProctorDisplayName,
			GradingDisplayName: req.GradingDisplayName,
			Institution:        req.Institution,
			StartTime:          req.StartTime,
			EndTime:            req.EndTime,
			AutoStart:          req.AutoStart,
			AutoStop:           req.AutoStop,
			Status:             req.Status,
			Revision:           req.Revision,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// schedulesDeleteHandler removes a pre-live schedule.
func schedulesDeleteHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder)
		if sess == nil {
			return
		}
		id := chi.URLParam(r, "id")
		schedule, err := app.Schedules.Get(r.Context(), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := authorizeScheduleForActor(app, r, sess, schedule); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Schedules.Delete(r.Context(), id); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// schedulesRuntimeHandler returns the complete cohort runtime projection for
// {id}. The scheduling service uses a compact header internally, but the
// public frontend contract also requires clock fields and section rows.
func schedulesRuntimeHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleAdminObserver, auth.RoleBuilder, auth.RoleProctor, auth.RoleGrader)
		if sess == nil {
			return
		}
		id := chi.URLParam(r, "id")
		schedule, err := app.Schedules.Get(r.Context(), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := authorizeScheduleForActor(app, r, sess, schedule); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if sess.Role == auth.RoleProctor {
			ok, err := proctorHasLiveAssignment(r.Context(), app.DB, id, sess.UserID)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if !ok {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			}
		}
		if _, err := app.Schedules.GetRuntime(r.Context(), id); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := loadStudentRuntimeContext(r.Context(), app.DB, id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Runtime not found."))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// schedulesRuntimeCommandHandler applies a runtime command with fencing.
func schedulesRuntimeCommandHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder, auth.RoleProctor)
		if sess == nil {
			return
		}
		var req struct {
			Action                  string  `json:"action"`
			Reason                  *string `json:"reason"`
			ExpectedRuntimeRevision *int64  `json:"expectedRuntimeRevision"`
			ExpectedSectionKey      *string `json:"expectedSectionKey"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Round 57 fail-fast: unknown actions 400 before authz + schedule
		// Get (no DB read burned on a malformed command).
		if _, verr := schedules.ValidateRuntimeCommandAction(req.Action); verr != nil {
			httpx.WriteError(w, r, verr)
			return
		}
		id := chi.URLParam(r, "id")
		schedule, err := app.Schedules.Get(r.Context(), id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := authorizeScheduleForActor(app, r, sess, schedule); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if sess.Role == auth.RoleProctor {
			ok, err := proctorHasLiveAssignment(r.Context(), app.DB, id, sess.UserID)
			if err != nil {
				httpx.WriteError(w, r, err)
				return
			}
			if !ok {
				httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
				return
			}
		}
		if _, err := app.Schedules.ApplyRuntimeCommand(r.Context(), id, schedules.RuntimeCommand{
			Action:                  req.Action,
			Reason:                  req.Reason,
			ExpectedRuntimeRevision: req.ExpectedRuntimeRevision,
			ExpectedSectionKey:      req.ExpectedSectionKey,
			ActorID:                 sess.UserID,
		}); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		out, err := loadStudentRuntimeContext(r.Context(), app.DB, id)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if out == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Runtime not found."))
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// schedulesRegisterHandler registers the caller into schedule {id}.
// Any authenticated session may register; no admin role required.
func schedulesRegisterHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess := requireSession(w, r)
		if sess == nil {
			return
		}
		var req struct {
			Wcode       string  `json:"wcode"`
			Email       string  `json:"email"`
			StudentName string  `json:"studentName"`
			Nickname    *string `json:"nickname"`
			IELTSCourse *string `json:"ieltsCourse"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &req); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		id := chi.URLParam(r, "id")
		out, err := app.Schedules.CreateRegistration(r.Context(), id, schedules.RegistrationRequest{
			Wcode:       req.Wcode,
			Email:       req.Email,
			StudentName: req.StudentName,
			Nickname:    req.Nickname,
			IELTSCourse: req.IELTSCourse,
			UserID:      sess.UserID,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusCreated, out)
	}
}

package main

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/student"
)

// proctorActorOf builds the verified proctor actor from a session.
func proctorActorOf(sess *auth.Session) proctor.Actor {
	return proctor.Actor{ID: sess.UserID, Role: sess.Role, CSRFVerified: true}
}

// readProctorCmd decodes the per-attempt command envelope.
func readProctorCmd(r *http.Request) (proctor.AttemptCommand, error) {
	var body proctorCmdBody
	if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
		return proctor.AttemptCommand{}, err
	}
	expectedSectionKey := body.ExpectedSectionKey
	if expectedSectionKey == nil {
		// The existing frontend/proctor adapter calls this field
		// expectedActiveSectionKey. Accept it during the Go cutover while the
		// service-level command keeps one canonical name.
		expectedSectionKey = body.ExpectedActiveSectionKey
	}
	return proctor.AttemptCommand{
		Message:                 body.Message,
		Reason:                  body.Reason,
		ExpectedRuntimeRevision: body.ExpectedRuntimeRevision,
		ExpectedSectionKey:      expectedSectionKey,
	}, nil
}

// proctorCmdBody is the wire envelope for per-attempt proctor commands.
// All fields are optional; unknown fields are rejected by DecodeLimited.
type proctorCmdBody struct {
	// ActorID is accepted for wire compatibility with the pre-migration
	// frontend. Authorization always comes from the authenticated session;
	// this client value is intentionally ignored.
	ActorID                  *string `json:"actorId"`
	Message                  *string `json:"message"`
	Reason                   *string `json:"reason"`
	ExpectedRuntimeRevision  *int64  `json:"expectedRuntimeRevision"`
	ExpectedSectionKey       *string `json:"expectedSectionKey"`
	ExpectedActiveSectionKey *string `json:"expectedActiveSectionKey"`
}

// writeStudentNotFound maps sql.ErrNoRows to a stable NOT_FOUND envelope.
// Services return raw sql errors, so callers check ErrNoRows first.
func writeStudentNotFound(w http.ResponseWriter, r *http.Request) {
	httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Attempt not found."))
}

// requireStudentDeps enforces session auth plus Student service + DB wiring.
// It returns the session, or nil after rendering the denial envelope.
func requireStudentDeps(w http.ResponseWriter, r *http.Request, app *App) *auth.Session {
	sess := requireSession(w, r)
	if sess == nil {
		return nil
	}
	if app.Student == nil || app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable."))
		return nil
	}
	return sess
}

func requireStudentService(w http.ResponseWriter, r *http.Request, app *App) bool {
	if app.Student == nil || app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable."))
		return false
	}
	return true
}

// attemptIDFromStudentWire fills the attempt id omitted by the SAT delivery
// heartbeat client from its bearer claims. The bearer remains the authority;
// a body-provided id is only accepted after requireV1StudentIdentity checks it.
func attemptIDFromStudentWire(app *App, r *http.Request, scheduleID, attemptID string) (string, error) {
	if strings.TrimSpace(attemptID) != "" {
		return strings.TrimSpace(attemptID), nil
	}
	bearer := bearerOf(r)
	if bearer == "" {
		return "", apperrors.New(apperrors.CodeValidation, "Attempt is required.")
	}
	// Session-bound verify in both modes (same rule as delivery writes).
	claims, err := verifyAttemptReadBearer(app, r, bearer)
	if err != nil {
		return "", apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
	}
	if claims.ScheduleID != scheduleID {
		return "", apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	return claims.AttemptID, nil
}

// v1SessionHandler returns the V1 attempt session projection.
func v1SessionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Plan E1: bounded budget on the per-poll session read.
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			v1SessionInner(app, w, r)
		})
	}
}

func v1SessionInner(app *App, w http.ResponseWriter, r *http.Request) {
	resumeProbe := r.URL.Query().Get("refreshAttemptCredential") == "true" && strings.TrimSpace(r.URL.Query().Get("candidateId")) == ""
	startedAt := time.Now()
	if resumeProbe {
		telemetry.IncCounter(telemetry.MStudentResumeProbeTotal)
		defer func() {
			telemetry.SetGauge(telemetry.MStudentResumeRecoveryMS, float64(time.Since(startedAt).Milliseconds()))
		}()
	}
	sess := requireStudentDeps(w, r, app)
	if sess == nil {
		if resumeProbe {
			telemetry.IncCounter(telemetry.MStudentResumeFailureTotal, "reason", "unauthenticated")
		}
		return
	}
	out, err := studentSessionContext(
		r.Context(), app, sess, chi.URLParam(r, "scheduleID"),
		r.URL.Query().Get("candidateId"), r.URL.Query().Get("clientSessionId"), true,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			if resumeProbe {
				telemetry.IncCounter(telemetry.MStudentResumeFailureTotal, "reason", "no_active_attempt")
			}
			writeStudentNotFound(w, r)
			return
		}
		if resumeProbe {
			telemetry.IncCounter(telemetry.MStudentResumeFailureTotal, "reason", "server_error")
		}
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	if resumeProbe {
		if out["attempt"] == nil {
			telemetry.IncCounter(telemetry.MStudentResumeFailureTotal, "reason", "no_active_attempt")
		} else {
			telemetry.IncCounter(telemetry.MStudentResumeSuccessTotal)
		}
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// v1StaticHandler returns the V1 static content snapshot.
func v1StaticHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Plan E1: bounded budget on the version-assembly read.
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			v1StaticInner(app, w, r)
		})
	}
}

func v1StaticInner(app *App, w http.ResponseWriter, r *http.Request) {
	{
		if requireStudentDeps(w, r, app) == nil {
			return
		}
		// Plan D1: conditional read — 2 indexed probes before assembly.
		var staticETag string
		if app.Delivery != nil {
			if _, _, etag, terr := app.Delivery.VersionTag(r.Context(), chi.URLParam(r, "scheduleID")); terr == nil {
				staticETag = etag
				if writeETagOrNotModified(w, r, etag) {
					return
				}
			}
		}
		schedule, version, _, err := loadStudentScheduleVersion(r.Context(), app.DB, chi.URLParam(r, "scheduleID"))
		if err != nil {
			if err == sql.ErrNoRows {
				writeStudentNotFound(w, r)
				return
			}
			httpx.WriteError(w, r, MapDBError(err))
			return
		}
		if staticETag != "" {
			w.Header().Set("ETag", staticETag)
		}
		out := map[string]any{"schedule": schedule, "version": version, "degradedLiveMode": false}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// v1LiveHandler returns the V1 live session context.
func v1LiveHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Plan E1: bounded budget on the per-poll live read.
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			v1LiveInner(app, w, r)
		})
	}
}

func v1LiveInner(app *App, w http.ResponseWriter, r *http.Request) {
	sess := requireStudentDeps(w, r, app)
	if sess == nil {
		return
	}
	ctx, err := studentSessionContext(
		r.Context(), app, sess, chi.URLParam(r, "scheduleID"),
		r.URL.Query().Get("candidateId"), "", false,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			writeStudentNotFound(w, r)
			return
		}
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	schedule, _ := ctx["schedule"].(map[string]any)
	out := map[string]any{
		"runtime":          ctx["runtime"],
		"attempt":          ctx["attempt"],
		"degradedLiveMode": false,
	}
	if publishedVersionID, ok := schedule["publishedVersionId"].(string); ok {
		out["publishedVersionId"] = publishedVersionID
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// v1PrecheckHandler returns the V1 integrity projection.
func v1PrecheckHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStudentService(w, r, app) {
			return
		}
		var body struct {
			AttemptID   string `json:"attemptId"`
			StudentKey  string `json:"studentKey"`
			CandidateID string `json:"candidateId"`
			// Candidate profile fields are accepted for compatibility with the
			// browser pre-check payload. The attempt projection is already the
			// source of truth for these values.
			CandidateName         string          `json:"candidateName"`
			CandidateEmail        string          `json:"candidateEmail"`
			ClientSessionID       string          `json:"clientSessionId"`
			PreCheck              json.RawMessage `json:"preCheck"`
			DeviceFingerprintHash *string         `json:"deviceFingerprintHash"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		attemptID := strings.TrimSpace(body.AttemptID)
		if attemptID == "" {
			if attemptID, err := attemptIDFromStudentWire(app, r, chi.URLParam(r, "scheduleID"), attemptID); err != nil {
				httpx.WriteError(w, r, err)
				return
			} else {
				body.AttemptID = attemptID
			}
		}
		var actorID string
		if sess := SessionOf(r.Context()); sess != nil {
			actorID = sess.UserID
		}
		identity, err := requireV1StudentIdentity(app, r, body.AttemptID, chi.URLParam(r, "scheduleID"), body.ClientSessionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if identity.UserID != "" {
			actorID = identity.UserID
		}
		out, err := app.Student.RecordPrecheck(r.Context(), student.PrecheckRequest{
			AttemptID: body.AttemptID, ScheduleID: chi.URLParam(r, "scheduleID"), StudentKey: body.StudentKey,
			ClientSessionID: identity.ClientSessionID, ActorUserID: actorID, PreCheck: body.PreCheck,
			DeviceFingerprintHash: body.DeviceFingerprintHash,
		})
		if err != nil {
			if err == sql.ErrNoRows {
				writeStudentNotFound(w, r)
				return
			}
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// v1BootstrapHandler returns the V1 flags/recovery projection.
func v1BootstrapHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Plan E1: bounded budget on the attempt-mint read.
		withQueryTimeout(w, r, DefaultQueryTimeout, func(w http.ResponseWriter, r *http.Request) {
			v1BootstrapInner(app, w, r)
		})
	}
}

func v1BootstrapInner(app *App, w http.ResponseWriter, r *http.Request) {
	sess := requireStudentDeps(w, r, app)
	if sess == nil {
		return
	}
	var req studentBootstrapRequest
	if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &req); err != nil {
		httpx.WriteError(w, r, err)
		return
	}
	out, err := bootstrapStudentAttempt(r.Context(), app, sess, chi.URLParam(r, "scheduleID"), req)
	if err != nil {
		if err == sql.ErrNoRows {
			writeStudentNotFound(w, r)
			return
		}
		httpx.WriteError(w, r, MapDBError(err))
		return
	}
	httpx.WriteJSON(w, http.StatusOK, out)
}

// v1HeartbeatHandler lists recent V1 heartbeat events for an attempt.
func v1HeartbeatHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStudentService(w, r, app) {
			return
		}
		var body struct {
			AttemptID       string          `json:"attemptId"`
			StudentKey      string          `json:"studentKey"`
			ClientSessionID string          `json:"clientSessionId"`
			MutationID      string          `json:"mutationId"`
			EventType       string          `json:"eventType"`
			Payload         json.RawMessage `json:"payload"`
			ClientTimestamp time.Time       `json:"clientTimestamp"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		attemptID, err := attemptIDFromStudentWire(app, r, chi.URLParam(r, "scheduleID"), body.AttemptID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		identity, err := requireV1StudentIdentity(app, r, attemptID, chi.URLParam(r, "scheduleID"), body.ClientSessionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// Plan D2: memory path = Touch + dedupe with zero heartbeat-event
		// SQL (projection re-read only); inline (default) = today's tx.
		// Both return (projection, deduped): count effective writes only
		// so retry storms can't inflate the series. The flag (not a
		// global-counter delta) keeps the decision race-free.
		path := telemetry.HeartbeatInline
		record := app.Student.RecordHeartbeat
		if app.Config.PresenceMemory() && app.Student.PresenceMap() != nil {
			record = app.Student.RecordHeartbeatMemory
			path = telemetry.HeartbeatMemory
		}
		attempt, deduped, err := record(r.Context(), student.HeartbeatRequest{
			AttemptID: attemptID, ScheduleID: chi.URLParam(r, "scheduleID"), StudentKey: body.StudentKey,
			ClientSessionID: identity.ClientSessionID, ActorUserID: identity.UserID, MutationID: body.MutationID,
			EventType: body.EventType, Payload: body.Payload, ClientTimestamp: body.ClientTimestamp,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if !deduped {
			telemetry.IncCounter(telemetry.MSATHeartbeatTotal, "path", path)
		}
		ackOnly := r.URL.Query().Get("responseMode") != "full"
		// Plan C5: every heartbeat ack echoes the presence window so
		// clients can coalesce beats after any write (save/poll/beat).
		// nextHeartbeatSecs mirrors the server TTL (90s); clients skip
		// standalone beats inside it.
		response := map[string]any{"attempt": nil, "runtime": nil, "refreshedAttemptCredential": nil, "nextHeartbeatSecs": student.PresenceWindowSeconds()}
		if !ackOnly {
			response["attempt"] = attempt
			response["runtime"], _ = loadStudentRuntimeContext(r.Context(), app.DB, chi.URLParam(r, "scheduleID"))
		}
		httpx.WriteJSON(w, http.StatusOK, response)
	}
}

// v1AuditHandler lists recent V1 session audit rows for a schedule.
// Unlike the other student handlers it takes the chi scheduleID directly.
func v1AuditHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !requireStudentService(w, r, app) {
			return
		}
		var body struct {
			AttemptID       string          `json:"attemptId"`
			StudentKey      string          `json:"studentKey"`
			ClientSessionID string          `json:"clientSessionId"`
			ActionType      string          `json:"actionType"`
			Payload         json.RawMessage `json:"payload"`
			ClientTimestamp *time.Time      `json:"clientTimestamp"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		attemptID, err := attemptIDFromStudentWire(app, r, scheduleID, body.AttemptID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		identity, err := requireV1StudentIdentity(app, r, attemptID, scheduleID, body.ClientSessionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		err = app.Student.RecordAudit(r.Context(), student.AuditRequest{
			AttemptID: attemptID, ScheduleID: scheduleID, StudentKey: body.StudentKey,
			ClientSessionID: identity.ClientSessionID, ActorUserID: identity.UserID,
			ActionType: body.ActionType, Payload: body.Payload, ClientTimestamp: body.ClientTimestamp,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// requireProctorDeps enforces admin|proctor auth plus Proctor service wiring.
// It returns the session and verified actor, or nil actor after rendering.
func requireProctorDeps(w http.ResponseWriter, r *http.Request, app *App) (*auth.Session, *proctor.Actor) {
	sess := requireRole(w, r, auth.RoleAdmin, auth.RoleProctor)
	if sess == nil {
		return nil, nil
	}
	if app.Proctor == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Proctor service is unavailable."))
		return nil, nil
	}
	actor := proctorActorOf(sess)
	return sess, &actor
}

// requirePreviewSectionDeps admits builders only for the isolated preview
// schedule used by the builder runtime. It keeps the normal proctor controls
// admin|proctor-only while allowing the preview to advance sections.
func requirePreviewSectionDeps(w http.ResponseWriter, r *http.Request, app *App) (*auth.Session, *proctor.Actor) {
	sess := requireRole(w, r, auth.RoleAdmin, auth.RoleBuilder, auth.RoleProctor)
	if sess == nil {
		return nil, nil
	}
	if app.Proctor == nil || app.Schedules == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Proctor service is unavailable."))
		return nil, nil
	}
	schedule, err := app.Schedules.Get(r.Context(), chi.URLParam(r, "scheduleID"))
	if err != nil {
		httpx.WriteError(w, r, err)
		return nil, nil
	}
	if err := authorizeScheduleForActor(app, r, sess, schedule); err != nil {
		httpx.WriteError(w, r, err)
		return nil, nil
	}
	if sess.Role == auth.RoleBuilder {
		return sess, &proctor.Actor{ID: sess.UserID, Role: proctor.RoleBuilder, CSRFVerified: true}
	}
	actor := proctorActorOf(sess)
	return sess, &actor
}

// requireProctorAttemptScope is the second-layer (DB-backed) scope check
// for per-attempt proctor commands (warn/pause/resume/extend/terminate).
// Admins bypass; proctors must hold a live schedule_staff_assignments row
// for the schedule or the attempt 404-collapses (never a cross-schedule
// leak). It runs after requireProctorDeps and before body decode (fail
// fast, no oracle on body shape). A nil DB renders 503, mirroring
// proctorSessionHandler's Proctor==nil||DB==nil guard.
func requireProctorAttemptScope(w http.ResponseWriter, r *http.Request, app *App, sess *auth.Session, scheduleID string) bool {
	if sess.Role != auth.RoleProctor {
		return true
	}
	if app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Proctor service is unavailable."))
		return false
	}
	ok, err := proctorHasLiveAssignment(r.Context(), app.DB, scheduleID, sess.UserID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return false
	}
	if !ok {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
		return false
	}
	return true
}

// proctorPresenceHandler upserts proctor presence (join/heartbeat/leave).
func proctorPresenceHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if sess == nil || actor == nil {
			return
		}
		var body struct {
			ProctorID   *string `json:"proctorId"`
			ProctorName *string `json:"proctorName"`
			Action      string  `json:"action"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		// The session identity owns presence: a body proctorId that
		// disagrees is a 403 (never an override that spoofs another
		// proctor's row).
		if body.ProctorID != nil && *body.ProctorID != sess.UserID {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeForbidden, "Presence identity mismatch."))
			return
		}
		proctorID := sess.UserID
		proctorName := sess.UserID
		if body.ProctorName != nil {
			proctorName = *body.ProctorName
		}
		if err := app.Proctor.RecordPresence(r.Context(), *actor, scheduleID, proctorID, proctorName, proctor.PresenceAction(body.Action)); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// proctorEndSectionHandler ends the live cohort section now.
func proctorEndSectionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requirePreviewSectionDeps(w, r, app)
		if actor == nil {
			return
		}
		cmd, err := readProctorCmd(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Proctor.EndSectionNow(r.Context(), *actor, chi.URLParam(r, "scheduleID"), cmd); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		// End-section-now also completes the runtime when the final section is
		// ended. Seal the now-completed schedule synchronously so IELTS and ACT
		// students do not wait for the worker's next hot cycle.
		if err := app.Proctor.AutoSubmitScheduleAfterComplete(r.Context(), *actor, chi.URLParam(r, "scheduleID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// proctorExtendSectionHandler adds minutes to the active cohort section.
func proctorExtendSectionHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		var body struct {
			// ActorID is a legacy client field; the session remains authoritative.
			ActorID                  *string `json:"actorId"`
			Minutes                  int64   `json:"minutes"`
			Reason                   *string `json:"reason"`
			ExpectedRuntimeRevision  *int64  `json:"expectedRuntimeRevision"`
			ExpectedSectionKey       *string `json:"expectedSectionKey"`
			ExpectedActiveSectionKey *string `json:"expectedActiveSectionKey"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		expectedSectionKey := body.ExpectedSectionKey
		if expectedSectionKey == nil {
			expectedSectionKey = body.ExpectedActiveSectionKey
		}
		cmd := proctor.ExtendSectionCommand{
			Minutes:                 body.Minutes,
			Reason:                  body.Reason,
			ExpectedRuntimeRevision: body.ExpectedRuntimeRevision,
			ExpectedSectionKey:      expectedSectionKey,
		}
		if err := app.Proctor.ExtendSection(r.Context(), *actor, chi.URLParam(r, "scheduleID"), cmd); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// proctorCompleteExamHandler completes the exam cohort clock.
func proctorCompleteExamHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		var body struct {
			// ActorID is a legacy client field; the session remains authoritative.
			ActorID *string `json:"actorId"`
			Reason  *string `json:"reason"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Proctor.CompleteExam(r.Context(), *actor, chi.URLParam(r, "scheduleID"), proctor.CompleteExamCommand{Reason: body.Reason}); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Proctor.AutoSubmitScheduleAfterComplete(r.Context(), *actor, chi.URLParam(r, "scheduleID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// proctorWarnHandler issues a non-blocking warning on an attempt.
func proctorWarnHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if !requireProctorAttemptScope(w, r, app, sess, chi.URLParam(r, "scheduleID")) {
			return
		}
		cmd, err := readProctorCmd(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Proctor.Warn(r.Context(), *actor, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "attemptID"), cmd); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// proctorPauseAttemptHandler moves an attempt to proctor paused.
func proctorPauseAttemptHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if !requireProctorAttemptScope(w, r, app, sess, chi.URLParam(r, "scheduleID")) {
			return
		}
		cmd, err := readProctorCmd(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Proctor.Pause(r.Context(), *actor, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "attemptID"), cmd); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// proctorResumeAttemptHandler moves a proctor-paused attempt back to active.
func proctorResumeAttemptHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if !requireProctorAttemptScope(w, r, app, sess, chi.URLParam(r, "scheduleID")) {
			return
		}
		cmd, err := readProctorCmd(r)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if err := app.Proctor.Resume(r.Context(), *actor, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "attemptID"), cmd); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// proctorExtendAttemptHandler grants per-student minutes on SAT attempts.
func proctorExtendAttemptHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if !requireProctorAttemptScope(w, r, app, sess, chi.URLParam(r, "scheduleID")) {
			return
		}
		var body struct {
			// ActorID is a legacy client field; the session remains authoritative.
			ActorID                 *string `json:"actorId"`
			Minutes                 int64   `json:"minutes"`
			Message                 *string `json:"message"`
			Reason                  *string `json:"reason"`
			ExpectedRuntimeRevision *int64  `json:"expectedRuntimeRevision"`
			ExpectedSectionKey      *string `json:"expectedSectionKey"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		cmd := proctor.AttemptCommand{
			Message:                 body.Message,
			Reason:                  body.Reason,
			ExpectedRuntimeRevision: body.ExpectedRuntimeRevision,
			ExpectedSectionKey:      body.ExpectedSectionKey,
		}
		if err := app.Proctor.ExtendAttempt(r.Context(), *actor, chi.URLParam(r, "scheduleID"), chi.URLParam(r, "attemptID"), body.Minutes, cmd); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

// proctorTerminateHandler seals an attempt via terminalization.
func proctorTerminateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if !requireProctorAttemptScope(w, r, app, sess, chi.URLParam(r, "scheduleID")) {
			return
		}
		var body struct {
			// ActorID is a legacy client field; the session remains authoritative.
			ActorID *string `json:"actorId"`
			Reason  *string `json:"reason"`
			Note    *string `json:"note"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		attemptID := chi.URLParam(r, "attemptID")
		cmd := proctor.AttemptCommand{Reason: body.Reason, Message: body.Note}
		if err := app.Proctor.Terminate(r.Context(), *actor, chi.URLParam(r, "scheduleID"), attemptID, cmd); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true, "attemptId": attemptID})
	}
}

// proctorAckAlertHandler acknowledges a monitoring alert.
func proctorAckAlertHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		_, actor := requireProctorDeps(w, r, app)
		if actor == nil {
			return
		}
		if err := app.Proctor.AckAlert(r.Context(), *actor, chi.URLParam(r, "alertID")); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{"ok": true})
	}
}

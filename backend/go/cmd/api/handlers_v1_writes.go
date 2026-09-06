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
	"example.com/ielts-proctoring/internal/student"
	"example.com/ielts-proctoring/internal/terminalization"
)

type v1StudentIdentity struct {
	UserID          string
	ClientSessionID string
}

// requireV1StudentIdentity supports both the Rust-era bearer attempt
// credential and a cookie session. The bearer is preferred when present so a
// student entry flow does not need to mint a second staff-style session.
func requireV1StudentIdentity(app *App, r *http.Request, attemptID, scheduleID, requestedClientSessionID string) (v1StudentIdentity, error) {
	if strings.TrimSpace(attemptID) == "" || strings.TrimSpace(scheduleID) == "" {
		return v1StudentIdentity{}, apperrors.New(apperrors.CodeValidation, "Attempt and schedule are required.")
	}
	if bearer := bearerOf(r); bearer != "" {
		claims, err := auth.VerifyAttemptToken(r.Context(), app.DB, app.Config, time.Now().UTC(), bearer)
		if err != nil {
			return v1StudentIdentity{}, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
		}
		if claims.AttemptID != attemptID || claims.ScheduleID != scheduleID {
			return v1StudentIdentity{}, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Attempt credential does not match the request.")
		}
		if requestedClientSessionID != "" && requestedClientSessionID != claims.ClientSessionID {
			return v1StudentIdentity{}, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Client session does not match the attempt credential.")
		}
		return v1StudentIdentity{UserID: claims.UserID, ClientSessionID: claims.ClientSessionID}, nil
	}
	sess := SessionOf(r.Context())
	if sess == nil {
		return v1StudentIdentity{}, apperrors.New(apperrors.CodeSessionExpired, "Session expired.")
	}
	if sess.Role != auth.RoleStudent {
		return v1StudentIdentity{}, apperrors.New(apperrors.CodeForbidden, "Student access is required.")
	}
	clientSessionID := strings.TrimSpace(requestedClientSessionID)
	if clientSessionID == "" {
		clientSessionID = sess.ID
	}
	return v1StudentIdentity{UserID: sess.UserID, ClientSessionID: clientSessionID}, nil
}

func v1MutationHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		telemetry.IncCounter(telemetry.MV1MutationTotal)
		if app.DB == nil || app.Student == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable."))
			return
		}
		var wire student.V1MutationBatchWire
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &wire); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		mutations, err := student.ParseMutationBatch(wire)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		identity, err := requireV1StudentIdentity(app, r, wire.AttemptID, scheduleID, wire.ClientSessionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		result, err := app.Student.ApplyMutationBatch(r.Context(), student.V1MutationBatchRequest{
			AttemptID:       wire.AttemptID,
			ScheduleID:      scheduleID,
			StudentKey:      strings.TrimSpace(wire.StudentKey),
			ClientSessionID: identity.ClientSessionID,
			ActorUserID:     identity.UserID,
			Mutations:       mutations,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		httpx.WriteJSON(w, http.StatusOK, result)
	}
}

func v1SubmitHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		telemetry.IncCounter(telemetry.MV1SubmitTotal)
		if app.DB == nil || app.Student == nil || app.Terminal == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Student service is unavailable."))
			return
		}
		var wire struct {
			AttemptID                string          `json:"attemptId"`
			StudentKey               string          `json:"studentKey"`
			ClientSessionID          string          `json:"clientSessionId"`
			LastSeenRevision         *int64          `json:"lastSeenRevision"`
			SubmissionID             string          `json:"submissionId"`
			ClientFinalSeq           *int64          `json:"clientFinalSeq"`
			ServerAcceptedThroughSeq *int64          `json:"serverAcceptedThroughSeq"`
			FinalAnswerPatch         json.RawMessage `json:"finalAnswerPatch"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxStudentBodyBytes, &wire); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		scheduleID := chi.URLParam(r, "scheduleID")
		identity, err := requireV1StudentIdentity(app, r, wire.AttemptID, scheduleID, wire.ClientSessionID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		ctx := r.Context()
		sqlTx, err := app.DB.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelRepeatableRead})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		defer func() { _ = sqlTx.Rollback() }()
		if _, err := sqlTx.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		preparation, err := app.Student.PrepareSubmitInTx(ctx, sqlTx, student.V1SubmitRequest{
			AttemptID:                wire.AttemptID,
			ScheduleID:               scheduleID,
			StudentKey:               strings.TrimSpace(wire.StudentKey),
			ClientSessionID:          identity.ClientSessionID,
			ActorUserID:              identity.UserID,
			LastSeenRevision:         wire.LastSeenRevision,
			SubmissionID:             strings.TrimSpace(wire.SubmissionID),
			ClientFinalSeq:           wire.ClientFinalSeq,
			ServerAcceptedThroughSeq: wire.ServerAcceptedThroughSeq,
			FinalAnswerPatch:         wire.FinalAnswerPatch,
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if preparation.StoredSubmissionID != "" && preparation.StoredSubmissionID != strings.TrimSpace(wire.SubmissionID) {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeSubmissionReplayMisuse, "Submission identity already used."))
			return
		}
		seal, err := app.Terminal.TerminalizeInTx(ctx, sqlTx, terminalization.SealCommand{
			AttemptID:       wire.AttemptID,
			ScheduleID:      scheduleID,
			Outcome:         terminalization.OutcomeSubmitted,
			Reason:          terminalization.ReasonStudentSubmit,
			ActorKind:       terminalization.ActorStudent,
			ActorID:         stringPtr(identity.UserID),
			FinalSubmission: preparation.FinalSubmission,
			RequestID:       httpx.RequestIDOf(w, r),
		})
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if seal == nil {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeInternal, "Submit did not produce a terminalization."))
			return
		}
		if seal.Created {
			if _, err := sqlTx.ExecContext(ctx, `INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (UUID(), ?, ?, 'STUDENT_SUBMIT', ?, ?, UTC_TIMESTAMP(6))`, scheduleID, identity.UserID, wire.AttemptID, `{"submissionId":`+quoteJSON(strings.TrimSpace(wire.SubmissionID))+`}`); err != nil {
				httpx.WriteError(w, r, err)
				return
			}
		}
		if err := sqlTx.Commit(); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		attempt, err := app.Student.GetAttemptProjection(ctx, wire.AttemptID)
		if err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		submissionID := strings.TrimSpace(wire.SubmissionID)
		if stored, ok := attempt["finalSubmission"].(map[string]any); ok {
			if value, ok := stored["submissionId"].(string); ok && value != "" {
				submissionID = value
			}
		}
		submittedAt := seal.EffectiveAt
		if value, ok := attempt["submittedAt"].(time.Time); ok && !value.IsZero() {
			submittedAt = value
		}
		httpx.WriteJSON(w, http.StatusOK, map[string]any{
			"attempt":                    attempt,
			"submissionId":               submissionID,
			"submittedAt":                submittedAt,
			"refreshedAttemptCredential": nil,
		})
	}
}

func stringPtr(value string) *string {
	if strings.TrimSpace(value) == "" {
		return nil
	}
	return &value
}

func quoteJSON(value string) string {
	encoded, _ := json.Marshal(value)
	return string(encoded)
}

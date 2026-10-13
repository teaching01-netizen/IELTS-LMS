package main

// SAT access-code start HTTP edge: decoding, authorization and error mapping
// only. Code lifecycle lives in internal/satstartcode; redemption in
// internal/delivery (sat_code_entry.go).

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/httpx"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satstartcode"
	"example.com/ielts-proctoring/internal/schedules"
)

// maxStartCodeBodyBytes bounds the start-with-code body: a six-digit string
// and an integer epoch fit in far less.
const maxStartCodeBodyBytes = 1 << 10

// decodeStartWithCodeBody accepts exactly {code: string, controlEpoch: int}.
// The code must be a JSON string (a number would silently drop leading zeros)
// and any identity/module selector is refused: the attempt comes from the
// verified bearer, the module from the delivered order.
func decodeStartWithCodeBody(r *http.Request) (delivery.SatCodeStartRequest, error) {
	var raw map[string]json.RawMessage
	if err := httpx.DecodeLimited(r, maxStartCodeBodyBytes, &raw); err != nil {
		return delivery.SatCodeStartRequest{}, err
	}
	for key := range raw {
		if key != "code" && key != "controlEpoch" {
			return delivery.SatCodeStartRequest{}, apperrors.New(apperrors.CodeBadRequest, "Unsupported field `"+key+"`.")
		}
	}
	formatErr := func() error {
		err := apperrors.New(apperrors.CodeStartCodeFormatInvalid, "Enter the 6-digit exam start code.")
		err.Details = map[string]any{"reason": "START_CODE_FORMAT_INVALID"}
		return err
	}
	codeRaw, ok := raw["code"]
	if !ok || len(bytes.TrimSpace(codeRaw)) == 0 || bytes.TrimSpace(codeRaw)[0] != '"' {
		return delivery.SatCodeStartRequest{}, formatErr()
	}
	var code string
	if err := json.Unmarshal(codeRaw, &code); err != nil {
		return delivery.SatCodeStartRequest{}, formatErr()
	}
	epochRaw, ok := raw["controlEpoch"]
	if !ok {
		return delivery.SatCodeStartRequest{}, apperrors.New(apperrors.CodeBadRequest, "controlEpoch is required.")
	}
	var epoch json.Number
	dec := json.NewDecoder(bytes.NewReader(epochRaw))
	dec.UseNumber()
	if err := dec.Decode(&epoch); err != nil {
		return delivery.SatCodeStartRequest{}, apperrors.New(apperrors.CodeBadRequest, "controlEpoch must be a nonnegative integer.")
	}
	n, err := strconv.ParseInt(epoch.String(), 10, 32)
	if err != nil || n < 0 {
		return delivery.SatCodeStartRequest{}, apperrors.New(apperrors.CodeBadRequest, "controlEpoch must be a nonnegative integer.")
	}
	return delivery.SatCodeStartRequest{Code: code, ControlEpoch: int(n)}, nil
}

// writeStartCodeError maps a start-with-code error, adding Retry-After for
// guard refusals and retryable outages.
func writeStartCodeError(w http.ResponseWriter, r *http.Request, err error) {
	mapped := MapDBError(err)
	if appErr, ok := apperrors.As(mapped); ok {
		if secs, ok := appErr.Details["retryAfterSeconds"].(int); ok && secs > 0 {
			w.Header().Set("Retry-After", strconv.Itoa(secs))
		} else if appErr.Code == apperrors.CodeServiceUnavailable {
			w.Header().Set("Retry-After", "1")
		}
	}
	w.Header().Set("Cache-Control", "no-store")
	httpx.WriteError(w, r, mapped)
}

// deliveryStartWithCodeHandler redeems the SAT session code for the bearer's
// own attempt (POST /assessment-delivery/schedules/{scheduleID}/start-with-code).
func deliveryStartWithCodeHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		requestStarted := time.Now()
		defer func() {
			telemetry.ObserveSeconds(telemetry.MSATStartCodeHTTPSeconds, time.Since(requestStarted).Seconds())
		}()
		claims, ok := verifiedDeliveryWriterClaims(app, w, r)
		if !ok {
			return
		}
		req, err := decodeStartWithCodeBody(r)
		if err != nil {
			writeStartCodeError(w, r, err)
			return
		}
		req.AdmissionStartedAt = requestStarted
		req.AdmissionTiming = &delivery.SATStartCodeAdmissionTiming{}
		// Admission may wait up to the explicit start-code limit; reserve the
		// ordinary query budget for the actual transactional start afterward.
		ctx, cancel := context.WithTimeout(r.Context(), DefaultQueryTimeout+delivery.SATStartCodeAdmissionWaitLimit)
		defer cancel()
		out, err := app.Delivery.StartWithCode(ctx, claims.ScheduleID, claims.AttemptID, chi.URLParam(r, "scheduleID"), req, claims.ClientSessionID, claims.TokenID)
		// Server-Timing exposes each request's time actually blocked in the
		// application admission queues, not database-pool or network delay.
		w.Header().Set("Server-Timing", req.AdmissionTiming.HeaderValue())
		w.Header().Set("Access-Control-Expose-Headers", "Server-Timing")
		if err != nil {
			writeStartCodeError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		httpx.WriteJSON(w, http.StatusOK, out)
	}
}

// startCodeView is the staff presentation payload. The code is returned only
// on these explicit reveal/rotate requests, never in lists or polling.
type startCodeView struct {
	ScheduleID   string     `json:"scheduleId"`
	CohortName   string     `json:"cohortName"`
	ExamTitle    string     `json:"examTitle"`
	Code         string     `json:"code"`
	Generation   int        `json:"generation"`
	OpensAt      time.Time  `json:"opensAt"`
	ClosesAt     time.Time  `json:"closesAt"`
	Status       string     `json:"status"`
	AcceptingNew bool       `json:"acceptingNewStarts"`
	ServerNow    time.Time  `json:"serverNow"`
	RotatedAt    *time.Time `json:"rotatedAt,omitempty"`
}

// requireStartCodeSchedule authorizes a start-code staff request: the staff
// schedule check below plus a code-start session; anything else collapses to 404.
func requireStartCodeSchedule(w http.ResponseWriter, r *http.Request, app *App) (*auth.Session, *schedules.Schedule, bool) {
	sess, schedule, ok := requireStaffSchedule(w, r, app)
	if !ok {
		return nil, nil, false
	}
	if schedule.SatStartMode != satstartcode.ModeAccessCode {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
		return nil, nil, false
	}
	return sess, schedule, true
}

// requireStaffSchedule authorizes a SAT staff request on {scheduleID}: admin in
// the schedule's organization or a proctor with a live proctor assignment;
// anything else collapses to 404.
func requireStaffSchedule(w http.ResponseWriter, r *http.Request, app *App) (*auth.Session, *schedules.Schedule, bool) {
	sess := requireRole(w, r, auth.RoleAdmin, auth.RoleProctor)
	if sess == nil {
		return nil, nil, false
	}
	if app.Schedules == nil || app.DB == nil {
		httpx.WriteError(w, r, apperrors.New(apperrors.CodeServiceUnavailable, "Schedule service is unavailable."))
		return nil, nil, false
	}
	scheduleID := chi.URLParam(r, "scheduleID")
	if sess.Role == auth.RoleProctor {
		// A grading/observer assignment is not permission to reveal or rotate
		// the start secret, even when this user's session role is proctor.
		var assigned bool
		err := app.DB.QueryRowContext(r.Context(), `
			SELECT EXISTS(SELECT 1 FROM schedule_staff_assignments
			WHERE schedule_id = ? AND role = 'proctor' AND revoked_at IS NULL
			AND (actor_id = ? OR user_id = ?))`, scheduleID, sess.UserID, sess.UserID).Scan(&assigned)
		if err != nil {
			httpx.WriteError(w, r, err)
			return nil, nil, false
		}
		if !assigned {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeNotFound, "Resource not found."))
			return nil, nil, false
		}
	}
	schedule, err := app.Schedules.Get(r.Context(), scheduleID)
	if err != nil {
		httpx.WriteError(w, r, err)
		return nil, nil, false
	}
	notFound := apperrors.New(apperrors.CodeNotFound, "Resource not found.")
	if sess.OrganizationID != nil && schedule.OrganizationID != nil && *sess.OrganizationID != *schedule.OrganizationID {
		httpx.WriteError(w, r, notFound)
		return nil, nil, false
	}
	return sess, &schedule, true
}

func buildStartCodeView(ctx context.Context, q tx.Tx, schedule *schedules.Schedule, code satstartcode.Code) (startCodeView, error) {
	view := startCodeView{
		ScheduleID: schedule.ID, CohortName: schedule.CohortName, ExamTitle: schedule.ExamTitle,
		Code: code.Value, Generation: code.Generation,
	}
	var status string
	var startTime, endTime, now time.Time
	var rotatedAt *time.Time
	var linkOpens, linkCloses *time.Time
	var lifecycle *string
	if err := q.QueryRowContext(ctx, `
		SELECT s.status, s.start_time, s.end_time, c.rotated_at, l.opens_at, l.closes_at, l.lifecycle_state, UTC_TIMESTAMP(6)
		FROM exam_schedules s
		JOIN sat_session_start_codes c ON c.schedule_id = s.id
		LEFT JOIN assessment_access_links l ON l.schedule_id = s.id
		WHERE s.id = ?`, schedule.ID).Scan(&status, &startTime, &endTime, &rotatedAt, &linkOpens, &linkCloses, &lifecycle, &now); err != nil {
		return view, err
	}
	opens, closes := startTime.UTC(), endTime.UTC()
	if linkOpens != nil && linkOpens.UTC().After(opens) {
		opens = linkOpens.UTC()
	}
	if linkCloses != nil && linkCloses.UTC().Before(closes) {
		closes = linkCloses.UTC()
	}
	view.OpensAt, view.ClosesAt, view.Status, view.ServerNow, view.RotatedAt = opens, closes, status, now.UTC(), rotatedAt
	linkActive := lifecycle == nil || *lifecycle == "active"
	view.AcceptingNew = linkActive && (status == "scheduled" || status == "live") && !now.Before(opens) && now.Before(closes)
	return view, nil
}

// proctorStartCodeRevealHandler returns the current code for presentation
// (GET /proctor/sessions/{scheduleID}/start-code). Revealing never touches
// any clock; every reveal is audited without the code.
func proctorStartCodeRevealHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, schedule, ok := requireStartCodeSchedule(w, r, app)
		if !ok {
			return
		}
		var view startCodeView
		err := tx.NewRunner(app.DB).WithTxRC(r.Context(), func(ctx context.Context, q tx.Tx) error {
			code, err := satstartcode.ReadTx(ctx, q, schedule.ID, "")
			if err != nil {
				return err
			}
			if view, err = buildStartCodeView(ctx, q, schedule, code); err != nil {
				return err
			}
			return satstartcode.AuditTx(ctx, q, schedule.ID, sess.UserID, satstartcode.AuditCodeRevealed, nil, map[string]any{
				"generation": code.Generation, "role": sess.Role,
			})
		})
		if err != nil {
			writeStartCodeError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// proctorStartCodeRotateHandler replaces the code (POST .../start-code/rotate,
// body {expectedGeneration}). Started candidates keep running; only later
// redemptions need the new code. A stale generation is a 409 and refetch.
func proctorStartCodeRotateHandler(app *App) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		sess, schedule, ok := requireStartCodeSchedule(w, r, app)
		if !ok {
			return
		}
		var body struct {
			ExpectedGeneration *int `json:"expectedGeneration"`
		}
		if err := httpx.DecodeLimited(r, httpx.MaxAdminBodyBytes, &body); err != nil {
			httpx.WriteError(w, r, err)
			return
		}
		if body.ExpectedGeneration == nil || *body.ExpectedGeneration < 1 {
			httpx.WriteError(w, r, apperrors.New(apperrors.CodeBadRequest, "expectedGeneration is required."))
			return
		}
		var view startCodeView
		err := tx.NewRunner(app.DB).WithTxRC(r.Context(), func(ctx context.Context, q tx.Tx) error {
			// Lock order: schedule (S) -> code (X); never an attempt.
			var status string
			if err := q.QueryRowContext(ctx, "SELECT status FROM exam_schedules WHERE id = ? FOR SHARE", schedule.ID).Scan(&status); err != nil {
				return err
			}
			if status != "scheduled" && status != "live" {
				err := apperrors.New(apperrors.CodeConflict, "This session no longer accepts new starts; the code cannot be rotated.")
				err.Details = map[string]any{"reason": "START_WINDOW_CLOSED"}
				return err
			}
			code, err := satstartcode.RotateTx(ctx, q, schedule.ID, *body.ExpectedGeneration, sess.UserID)
			if err != nil {
				return err
			}
			view, err = buildStartCodeView(ctx, q, schedule, code)
			return err
		})
		if err != nil {
			writeStartCodeError(w, r, err)
			return
		}
		w.Header().Set("Cache-Control", "private, no-store")
		httpx.WriteJSON(w, http.StatusOK, view)
	}
}

// startCodeGateForStudentWrite refuses a compatibility (V1/V2) student
// mutation or submit for a SAT code-start candidate who has not redeemed the
// code. Nil means the write may proceed to its own gates.
func startCodeGateForStudentWrite(ctx context.Context, app *App, scheduleID, attemptID string) error {
	if app == nil || app.Delivery == nil || strings.TrimSpace(attemptID) == "" {
		return nil
	}
	gated, err := app.Delivery.StudentContentGated(ctx, scheduleID, attemptID)
	if err != nil {
		return err
	}
	if gated {
		err := apperrors.New(apperrors.CodeAssessmentConflict, "Enter the exam start code to begin.")
		err.Details = map[string]any{"reason": "START_CODE_REQUIRED"}
		return err
	}
	return nil
}

// startCodeGateForBearer applies the start-code gate to a V2 attempt write
// only after the bearer verifies for that attempt, so an unauthenticated
// caller cannot use the refusal as an existence oracle; an invalid bearer is
// left to the write path's own verification.
func startCodeGateForBearer(r *http.Request, app *App, bearer, attemptID string) error {
	claims, err := verifyAttemptReadBearer(app, r, bearer)
	if err != nil || claims.AttemptID != attemptID {
		return nil
	}
	return startCodeGateForStudentWrite(r.Context(), app, claims.ScheduleID, attemptID)
}

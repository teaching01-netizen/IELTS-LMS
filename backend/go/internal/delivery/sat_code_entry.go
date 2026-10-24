package delivery

// SAT access-code start (docs/plans/2026-10-09-sat-access-code-start.md).
//
// A registered candidate submits the six-digit session code; one server-owned
// transaction validates the code, the effective start window and every
// existing attempt control, opens the personal runtime when it does not exist
// yet, and starts ONLY this candidate's first delivered module. Acceptance and
// activation commit together (no accepted-but-unstarted state), start time is
// the DB instant read after the locks, and a replay resumes the original start
// instead of creating a new one.
//
// Lock order (never acquire leftwards):
//
//	access link (S) -> schedule (S | X for first runtime) -> code (S)
//	  -> attempt (X) -> reservation (X) -> reservation slot (X)
//	  -> runtime -> module (X) -> exam entity (runtime creation)
//
// Six-digit guessing is bounded independently of bearer hash and instance:
// per-attempt and per-principal fixed windows, plus a generation-scoped
// schedule failure budget enforced by 200 durable slot rows. A slot is claimed
// before any decrypt/compare; its ledger and slot settle atomically.

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/satstartcode"
)

// Verification guard limits. Fixed windows (not rolling): adjacent windows
// can admit a short burst, which the schedule budget still bounds.
const (
	startCodeAttemptLimit         = 5
	startCodeAttemptWindow        = 60 * time.Second
	startCodePrincipalLimit       = 20
	startCodePrincipalWindow      = 10 * time.Minute
	startCodeScheduleFailureLimit = satstartcode.ReservationSlotsPerGeneration
	startCodeScheduleWindow       = 10 * time.Minute
	startCodeReservationLease     = 30 * time.Second
	// Settled reservations are kept for audit/abuse review, then purged.
	startCodeReservationRetention = 24 * time.Hour
)

// Start-policy states and blocked reasons (SatStartPolicy contract).
const (
	SatStartStateCodeRequired = "code_required"
	SatStartStateStarted      = "started"
	SatStartStateClosed       = "closed"

	SatStartBlockedNotOpen = "not_open"
	SatStartBlockedPaused  = "paused"
	SatStartBlockedRevoked = "revoked"
)

// SatStartPolicy is the single server-derived entry object a SAT student
// reads to decide between the code form, the exam and the closed surface. It
// never carries the code, its ciphertext, guess counts or key material.
type SatStartPolicy struct {
	Mode              string     `json:"mode"`
	State             string     `json:"state,omitempty"`
	OpensAt           *time.Time `json:"opensAt,omitempty"`
	ClosesAt          *time.Time `json:"closesAt,omitempty"`
	ServerNow         *time.Time `json:"serverNow,omitempty"`
	BlockedReason     *string    `json:"blockedReason,omitempty"`
	RetryAfterSeconds *int       `json:"retryAfterSeconds,omitempty"`
}

// SatCodeStartRequest is the decoded start-with-code body. Code is the raw
// JSON value so a numeric code (which would lose leading zeros) is refused.
type SatCodeStartRequest struct {
	Code               string
	ControlEpoch       int
	AdmissionStartedAt time.Time                    `json:"-"`
	AdmissionTiming    *SATStartCodeAdmissionTiming `json:"-"`
}

// SATStartCodeAdmissionTiming contains only this request's application-level
// queue waits. It is attached to the HTTP response as Server-Timing; IDs and
// other high-cardinality values are deliberately not exported as metrics.
type SATStartCodeAdmissionTiming struct {
	StartWorkerWait        time.Duration
	RuntimeInitializerWait time.Duration
	SlotCapacityWait       time.Duration
}

func (w *SATStartCodeAdmissionTiming) record(stage string, elapsed time.Duration) {
	if w == nil || elapsed < 0 {
		return
	}
	switch stage {
	case "start_worker_wait":
		w.StartWorkerWait += elapsed
	case "initializer_wait":
		w.RuntimeInitializerWait += elapsed
	case "capacity_wait":
		w.SlotCapacityWait += elapsed
	}
}

func (w SATStartCodeAdmissionTiming) total() time.Duration {
	return w.StartWorkerWait + w.RuntimeInitializerWait + w.SlotCapacityWait
}

func (w SATStartCodeAdmissionTiming) HeaderValue() string {
	milliseconds := func(d time.Duration) float64 { return float64(d) / float64(time.Millisecond) }
	return fmt.Sprintf(
		"sat_admission;dur=%.3f, sat_start_worker;dur=%.3f, sat_runtime_initializer;dur=%.3f, sat_slot_capacity;dur=%.3f",
		milliseconds(w.total()),
		milliseconds(w.StartWorkerWait),
		milliseconds(w.RuntimeInitializerWait),
		milliseconds(w.SlotCapacityWait),
	)
}

// SatCodeStartResponse is the discriminated start answer: "started" carries
// the compact entry ACK with the first module's content; "resume" carries the
// authoritative bootstrap for an already-started attempt at its CURRENT
// module or break (never routed back to the first module).
type SatCodeStartResponse struct {
	Kind      string             `json:"kind"`
	Entry     *SatModuleEntryAck `json:"entry,omitempty"`
	Bootstrap *Bootstrap         `json:"bootstrap,omitempty"`
}

func startCodeRequired() *apperrors.Error {
	return assessmentConflict("START_CODE_REQUIRED", "Enter the exam start code to begin.")
}

func startCodeFormatInvalid() *apperrors.Error {
	err := apperrors.New(apperrors.CodeStartCodeFormatInvalid, "Enter the 6-digit exam start code.")
	err.Details = map[string]any{"reason": "START_CODE_FORMAT_INVALID"}
	return err
}

func startCodeInvalid() *apperrors.Error {
	err := apperrors.New(apperrors.CodeStartCodeInvalid, "That exam start code is not correct. Check it and try again.")
	err.Details = map[string]any{"reason": "START_CODE_INVALID"}
	return err
}

func startCodeRateLimited(reason string, retryAfter time.Duration) *apperrors.Error {
	secs := int(retryAfter.Round(time.Second) / time.Second)
	if secs < 1 {
		secs = 1
	}
	msg := "Too many start code attempts. Wait a moment, then try again."
	if reason == "START_CODE_BUSY" {
		msg = "Your exam start code is already being checked. Wait a moment, then try again."
	}
	err := apperrors.New(apperrors.CodeRateLimited, msg)
	err.Details = map[string]any{"reason": reason, "retryAfterSeconds": secs}
	err.Retryable = true
	return err
}

func startWindowNotOpen(opensAt time.Time) *apperrors.Error {
	err := assessmentConflict("START_WINDOW_NOT_OPEN", "This exam is not open yet.")
	err.Details["opensAt"] = opensAt.UTC()
	return err
}

func startWindowClosed() *apperrors.Error {
	return assessmentConflict("START_WINDOW_CLOSED", "The start window for this exam has closed.")
}

// errStartCodeMismatch is the internal sentinel for a well-formed code that
// did not match; it is settled as a failed comparison, then mapped.
var errStartCodeMismatch = errors.New("sat start code mismatch")

// errNeedExclusiveStart asks the caller to rerun on the first-runtime path:
// the shared path found no runtime and may not upgrade its schedule lock.
var errNeedExclusiveStart = errors.New("sat code start needs the first-runtime path")

type codeStartAttempt struct {
	userID         sql.NullString
	studentKey     string
	required       bool
	acceptedAt     sql.NullTime
	proctorStatus  string
	deliveryStatus string
	submittedAt    sql.NullTime
	phase          sql.NullString
	versionID      sql.NullString
}

func (a codeStartAttempt) terminal() bool {
	return a.submittedAt.Valid || a.deliveryStatus == "submitted" || a.deliveryStatus == "terminated" ||
		a.deliveryStatus == "locked" || a.deliveryStatus == "cancelled" || a.proctorStatus == "terminated" ||
		(a.phase.Valid && a.phase.String == "post-exam")
}

func (a codeStartAttempt) principalKey() string {
	if a.userID.Valid && strings.TrimSpace(a.userID.String) != "" {
		return "user:" + a.userID.String
	}
	return "student:" + a.studentKey
}

func scanCodeStartAttempt(row *sql.Row) (codeStartAttempt, error) {
	var a codeStartAttempt
	err := row.Scan(&a.userID, &a.studentKey, &a.required, &a.acceptedAt, &a.proctorStatus, &a.deliveryStatus, &a.submittedAt, &a.phase, &a.versionID)
	if err == sql.ErrNoRows {
		return a, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	return a, err
}

const codeStartAttemptColumns = "user_id, student_key, sat_start_code_required, sat_start_code_accepted_at, COALESCE(proctor_status, 'active'), COALESCE(delivery_status, 'running'), submitted_at, phase, published_version_id"

func observeStartCodeStage(stage string, began time.Time) {
	telemetry.ObserveSeconds(telemetry.MSATStartCodeStageSeconds, time.Since(began).Seconds(), "stage", stage)
}

func satStartAdmissionDeadline(ctx context.Context, handlerStartedAt time.Time) time.Time {
	if handlerStartedAt.IsZero() {
		handlerStartedAt = time.Now()
	}
	deadline := handlerStartedAt.Add(startCodeAdmissionWaitLimit)
	if ctxDeadline, ok := ctx.Deadline(); ok && ctxDeadline.Before(deadline) {
		deadline = ctxDeadline
	}
	return deadline
}

func satStartAdmissionWaitError(ctx context.Context, err error) error {
	if errors.Is(err, context.Canceled) {
		return err
	}
	if errors.Is(err, context.DeadlineExceeded) ||
		errors.Is(err, errStartCodeAdmissionDeadline) ||
		errors.Is(err, errStartCodeAdmissionWaiterLimit) {
		telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "busy")
		return startCodeRateLimited("START_CODE_BUSY", time.Second)
	}
	return err
}

// StartWithCode redeems the session code for the bearer's own attempt. The
// attempt and module come from the verified credential and the delivered
// order, never from client input. writerBinding is [clientSessionID, tokenID].
func (s *Service) StartWithCode(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string, req SatCodeStartRequest, writerBinding ...string) (*SatCodeStartResponse, error) {
	began := time.Now()
	admissionDeadline := satStartAdmissionDeadline(ctx, req.AdmissionStartedAt)
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	admission := s.startCodeAdmission()
	workerWaitBegan := time.Now()
	releaseStartWorker, workerErr := admission.acquireStartWorker(ctx, bearerScheduleID, admissionDeadline, req.AdmissionTiming)
	observeStartCodeStage("start_worker_wait", workerWaitBegan)
	if workerErr != nil {
		return nil, satStartAdmissionWaitError(ctx, workerErr)
	}
	defer func() {
		if releaseStartWorker != nil {
			releaseStartWorker()
		}
	}()
	scheduleID, examID, providerKey, versionID, err := s.startScheduleBinding(ctx, bearerScheduleID)
	if err != nil {
		return nil, err
	}
	if providerKey != "sat" {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}
	if err := s.saveAttemptBinding(ctx, scheduleID, bearerAttemptID, examID); err != nil {
		return nil, err
	}
	code, ok := satstartcode.NormalizeSubmitted(req.Code)
	if !ok {
		telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "malformed")
		return nil, startCodeFormatInvalid()
	}
	pre, err := scanCodeStartAttempt(s.db.QueryRowContext(ctx,
		"SELECT "+codeStartAttemptColumns+" FROM student_attempts WHERE id = ? AND schedule_id = ?", bearerAttemptID, scheduleID))
	if err != nil {
		return nil, err
	}
	if !pre.required {
		return nil, assessmentConflict("START_MODE_CONFLICT", "This SAT session is started by the proctor, not with a start code.")
	}
	if pre.acceptedAt.Valid {
		// Started-attempt recovery bypasses verification entirely: the code is
		// not re-checked (it may have been rotated), but principal, writer and
		// terminal state are.
		return s.resumeCodeStart(ctx, scheduleID, bearerAttemptID, writerBinding...)
	}
	if pre.terminal() {
		return nil, assessmentConflict("ATTEMPT_TERMINAL", "The SAT attempt is already terminal and cannot accept this command.")
	}

	quotaBegan := time.Now()
	quotaErr := s.checkStartCodeQuotas(ctx, bearerAttemptID, pre.principalKey())
	observeStartCodeStage("quota", quotaBegan)
	if quotaErr != nil {
		return nil, quotaErr
	}
	// The first delivered base module row is seeded idempotently (the same
	// seeder bootstrap uses) so the start transaction only locks and activates.
	seedBegan := time.Now()
	seedErr := s.EnsureBaseModuleAttemptForSchedule(ctx, bearerAttemptID, scheduleID)
	observeStartCodeStage("seed", seedBegan)
	if seedErr != nil {
		return nil, seedErr
	}
	generationBegan := time.Now()
	var observedGeneration int
	generationErr := s.db.QueryRowContext(ctx, "SELECT generation FROM sat_session_start_codes WHERE schedule_id = ?", scheduleID).Scan(&observedGeneration)
	observeStartCodeStage("generation_probe", generationBegan)
	if generationErr == sql.ErrNoRows {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "The exam start code is temporarily unavailable.")
	}
	if generationErr != nil {
		return nil, generationErr
	}

	var runtimeExists bool
	probeBegan := time.Now()
	probeErr := s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM exam_session_runtimes WHERE schedule_id = ?)", scheduleID).Scan(&runtimeExists)
	observeStartCodeStage("runtime_probe", probeBegan)
	if probeErr != nil {
		return nil, probeErr
	}
	exclusive := false
	var releaseInitializer func()
	if !runtimeExists {
		// Initializer waiters hold no worker permit or DB connection. The
		// schedule-local initializer gate is reacquired before runtime work.
		releaseStartWorker()
		releaseStartWorker = nil
		initializerWaitBegan := time.Now()
		releaseInitializer, err = admission.acquireInitializer(ctx, scheduleID, admissionDeadline, req.AdmissionTiming)
		observeStartCodeStage("initializer_wait", initializerWaitBegan)
		if err != nil {
			return nil, satStartAdmissionWaitError(ctx, err)
		}
		if releaseInitializer != nil {
			defer func() {
				if releaseInitializer != nil {
					releaseInitializer()
				}
			}()
		}
		workerWaitBegan = time.Now()
		releaseStartWorker, workerErr = admission.acquireStartWorker(ctx, scheduleID, admissionDeadline, req.AdmissionTiming)
		observeStartCodeStage("start_worker_wait", workerWaitBegan)
		if workerErr != nil {
			return nil, satStartAdmissionWaitError(ctx, workerErr)
		}
		if releaseInitializer == nil {
			// Another local initializer already verified or created the runtime.
			// codeStartTx still verifies it under the database schedule lock.
			runtimeExists = true
		} else {
			probeBegan = time.Now()
			probeErr = s.db.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM exam_session_runtimes WHERE schedule_id = ?)", scheduleID).Scan(&runtimeExists)
			observeStartCodeStage("runtime_probe", probeBegan)
			if probeErr != nil {
				return nil, probeErr
			}
			if runtimeExists {
				admission.markRuntimeReady(scheduleID)
				releaseInitializer()
				releaseInitializer = nil
			} else {
				exclusive = true
			}
		}
	}

	var reservationID string
	var generation int
	for {
		reservationBegan := time.Now()
		var reservationErr error
		reservationID, generation, reservationErr = s.reserveStartCodeComparison(ctx, scheduleID, bearerAttemptID, observedGeneration)
		observeStartCodeStage("slot_claim", reservationBegan)
		if !errors.Is(reservationErr, errStartCodeCapacityFull) {
			if reservationErr != nil {
				return nil, reservationErr
			}
			break
		}
		if releaseInitializer != nil {
			releaseInitializer()
			releaseInitializer = nil
		}
		releaseStartWorker()
		releaseStartWorker = nil
		capacityWaitBegan := time.Now()
		waitErr := s.startCodeAdmission().waitForCapacity(ctx, scheduleID, admissionDeadline, req.AdmissionTiming)
		observeStartCodeStage("capacity_wait", capacityWaitBegan)
		if waitErr != nil {
			return nil, satStartAdmissionWaitError(ctx, waitErr)
		}
		if time.Until(admissionDeadline) <= 0 {
			return nil, satStartAdmissionWaitError(ctx, errStartCodeAdmissionDeadline)
		}
		workerWaitBegan = time.Now()
		releaseStartWorker, workerErr = admission.acquireStartWorker(ctx, scheduleID, admissionDeadline, req.AdmissionTiming)
		observeStartCodeStage("start_worker_wait", workerWaitBegan)
		if workerErr != nil {
			return nil, satStartAdmissionWaitError(ctx, workerErr)
		}
	}

	var preparedModuleID string
	if err := s.db.QueryRowContext(ctx,
		"SELECT module_id FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at, id LIMIT 1",
		bearerAttemptID).Scan(&preparedModuleID); err != nil {
		s.settleStartCodeReservation(scheduleID, reservationID, "released")
		return nil, err
	}
	assemblyBegan := time.Now()
	preparedSection, preparedRevision, err := s.selectedModuleSectionWithRevision(ctx, bearerAttemptID, scheduleID, versionID, preparedModuleID)
	observeStartCodeStage("state_content_preparation", assemblyBegan)
	if err != nil {
		s.settleStartCodeReservation(scheduleID, reservationID, "released")
		return nil, err
	}
	var entryAck *SatModuleEntryAck

	var hubEvents []liveupdates.Event
	var openedRuntime, replay bool
	run := func() error {
		return s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
			hubEvents, openedRuntime, replay, entryAck = nil, false, false, nil
			events, _, opened, rep, err := s.codeStartTx(ctx, t, scheduleID, bearerAttemptID, reservationID, generation, code, req.ControlEpoch, exclusive, preparedModuleID, preparedRevision, preparedSection, &entryAck, writerBinding...)
			if err != nil {
				return err
			}
			hubEvents, openedRuntime, replay = events, opened, rep
			return nil
		})
	}
	startTxBegan := time.Now()
	err = run()
	if errors.Is(err, errNeedExclusiveStart) {
		telemetry.IncCounter(telemetry.MSATStartCodeTxRetry, "direction", "shared_to_exclusive")
		exclusive = true
		err = run()
	}
	if errors.Is(err, errStartCodeRuntimeAlreadyExists) {
		telemetry.IncCounter(telemetry.MSATStartCodeTxRetry, "direction", "exclusive_to_shared")
		exclusive = false
		if releaseInitializer != nil {
			s.startCodeAdmission().markRuntimeReady(scheduleID)
			releaseInitializer()
			releaseInitializer = nil
		}
		err = run()
	}
	if releaseInitializer != nil {
		if err == nil {
			s.startCodeAdmission().markRuntimeReady(scheduleID)
		}
		releaseInitializer()
		releaseInitializer = nil
	}
	observeStartCodeStage("start_transaction", startTxBegan)
	switch {
	case errors.Is(err, errStartCodeMismatch):
		s.settleStartCodeReservation(scheduleID, reservationID, "failed")
		telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "invalid")
		return nil, startCodeInvalid()
	case errors.Is(err, errStartCodeReservationNotUsable):
		s.settleStartCodeReservation(scheduleID, reservationID, "failed")
		telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "busy")
		return nil, startCodeRateLimited("START_CODE_BUSY", time.Second)
	case err != nil:
		// Business refusals ran before (window/lifecycle) or after (writer,
		// epoch) a matching comparison: the slot is released, not failed. A
		// release that cannot be written stays pending and expires to failed.
		s.settleStartCodeReservation(scheduleID, reservationID, "released")
		if appErr, ok := apperrors.As(err); ok && appErr.Code == apperrors.CodeServiceUnavailable {
			telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "unavailable")
		} else {
			telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "blocked")
		}
		return nil, err
	}
	if openedRuntime && s.codeStartRuntime != nil {
		s.codeStartRuntime.InvalidateSnapshot(scheduleID)
	}
	if replay {
		telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "replay")
		return s.resumeCodeStart(ctx, scheduleID, bearerAttemptID, writerBinding...)
	}
	path := "existing_runtime"
	if openedRuntime {
		path = "first_runtime"
	}
	telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "accepted")
	telemetry.ObserveSeconds(telemetry.MSATStartCodeStartSeconds, time.Since(began).Seconds(), "path", path)
	s.publishHubEvents(hubEvents)
	// The entry ACK was built inside the start transaction and the authorized
	// section was prepared before it. No response assembly remains after commit.
	if entryAck == nil {
		telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "unavailable")
		unavailable := apperrors.New(apperrors.CodeServiceUnavailable, "The exam started, but its entry response could not be prepared. Checking your exam status…")
		unavailable.Retryable = true
		return nil, unavailable
	}
	return &SatCodeStartResponse{Kind: "started", Entry: entryAck}, nil
}

// codeStartTx is one attempt of the first-start transaction. exclusive selects
// the first-runtime path (schedule FOR UPDATE); the shared path returns
// errNeedExclusiveStart if it finds no runtime. A stale exclusive path returns
// errStartCodeRuntimeAlreadyExists so the same reservation can retry shared.
func (s *Service) codeStartTx(ctx context.Context, t tx.Tx, scheduleID, attemptID, reservationID string, reservedGeneration int, code string, controlEpoch int, exclusive bool, preparedModuleID string, preparedRevision int64, preparedSection *DeliverySection, preparedAck **SatModuleEntryAck, writerBinding ...string) ([]liveupdates.Event, string, bool, bool, error) {
	// 1. Access link policy (if the schedule is link-backed), shared.
	var link struct {
		lifecycle       string
		opensAt         sql.NullTime
		closesAt        sql.NullTime
		enabledSections sql.NullString
		present         bool
	}
	err := t.QueryRowContext(ctx,
		"SELECT lifecycle_state, opens_at, closes_at, enabled_sections FROM assessment_access_links WHERE schedule_id = ? FOR SHARE",
		scheduleID).Scan(&link.lifecycle, &link.opensAt, &link.closesAt, &link.enabledSections)
	switch {
	case err == nil:
		link.present = true
	case err != sql.ErrNoRows:
		return nil, "", false, false, err
	}
	// 2. Schedule: shared for later starts, exclusive for the first runtime.
	var sch *examruntime.StartSchedule
	lockBegan := time.Now()
	lockMode := "shared"
	if exclusive {
		lockMode = "exclusive"
		sch, err = examruntime.LockScheduleRow(ctx, t, scheduleID)
	} else {
		sch, err = examruntime.ShareScheduleRow(ctx, t, scheduleID)
	}
	telemetry.ObserveSeconds(telemetry.MSATStartCodeStageSeconds, time.Since(lockBegan).Seconds(), "stage", "schedule_lock", "mode", lockMode)
	if err != nil {
		return nil, "", false, false, err
	}
	if sch.SatStartMode != examruntime.SatStartModeAccessCode {
		return nil, "", false, false, assessmentConflict("START_MODE_CONFLICT", "This SAT session is started by the proctor, not with a start code.")
	}
	var startTime, endTime time.Time
	if err := t.QueryRowContext(ctx, "SELECT start_time, end_time FROM exam_schedules WHERE id = ?", scheduleID).Scan(&startTime, &endTime); err != nil {
		return nil, "", false, false, err
	}
	// 3. Code row (shared): rotation holds it exclusively, so the generation
	// accepted here is the one current at commit.
	current, err := satstartcode.ReadTx(ctx, t, scheduleID, " FOR SHARE")
	if err != nil {
		return nil, "", false, false, err
	}
	// 4. The candidate's attempt.
	a, err := scanCodeStartAttempt(t.QueryRowContext(ctx,
		"SELECT "+codeStartAttemptColumns+" FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE", attemptID, scheduleID))
	if err != nil {
		return nil, "", false, false, err
	}
	if a.acceptedAt.Valid {
		// A concurrent duplicate committed first: resume, never restart.
		if err := enforceWriterSessionTx(ctx, t, scheduleID, attemptID, writerBinding...); err != nil {
			return nil, "", false, false, err
		}
		if _, err := releaseStartCodeReservationTx(ctx, t, scheduleID, reservationID, attemptID); err != nil {
			return nil, "", false, false, err
		}
		return nil, "", false, true, nil
	}
	if !a.required {
		return nil, "", false, false, assessmentConflict("START_MODE_CONFLICT", "This SAT session is started by the proctor, not with a start code.")
	}
	if a.terminal() {
		return nil, "", false, false, assessmentConflict("ATTEMPT_TERMINAL", "The SAT attempt is already terminal and cannot accept this command.")
	}
	// 5. Lock the reservation before checking its lease. This serializes start
	// validation with the sweeper and lets the authoritative time be sampled
	// after any wait for that row lock.
	var resState string
	var resAttempt string
	var resGeneration int
	var leaseExpires time.Time
	if err := t.QueryRowContext(ctx,
		"SELECT state, attempt_id, generation, lease_expires_at FROM sat_start_code_reservations WHERE id = ? AND schedule_id = ? FOR UPDATE",
		reservationID, scheduleID).Scan(&resState, &resAttempt, &resGeneration, &leaseExpires); err != nil {
		if err == sql.ErrNoRows {
			return nil, "", false, false, errStartCodeReservationNotUsable
		}
		return nil, "", false, false, err
	}
	if resState != "pending" || resAttempt != attemptID {
		return nil, "", false, false, errStartCodeReservationNotUsable
	}
	var slotState, slotAttempt string
	if err := t.QueryRowContext(ctx,
		"SELECT state, attempt_id FROM sat_start_code_reservation_slots WHERE schedule_id = ? AND generation = ? AND reservation_id = ? FOR UPDATE",
		scheduleID, resGeneration, reservationID).Scan(&slotState, &slotAttempt); err != nil {
		if err == sql.ErrNoRows {
			return nil, "", false, false, errStartCodeReservationNotUsable
		}
		return nil, "", false, false, err
	}
	if slotState != "pending" || slotAttempt != attemptID {
		return nil, "", false, false, errStartCodeReservationNotUsable
	}
	now, err := dbTimeTx(ctx, t)
	if err != nil {
		return nil, "", false, false, err
	}
	if !now.Before(leaseExpires) {
		return nil, "", false, false, errStartCodeReservationNotUsable
	}
	if resGeneration != reservedGeneration || current.Generation != reservedGeneration {
		return nil, "", false, false, assessmentConflict("START_CODE_ROTATED", "The exam start code changed. Enter the current code.")
	}
	// 6. Lifecycle and the effective window: schedule ∩ link, open inclusive,
	// close exclusive, judged by DB time.
	switch sch.Status {
	case "scheduled", "live":
	default:
		return nil, "", false, false, startWindowClosed()
	}
	opensAt, closesAt := effectiveStartWindow(startTime, endTime, link.present, link.opensAt, link.closesAt)
	if link.present {
		switch link.lifecycle {
		case "paused":
			return nil, "", false, false, assessmentConflict("START_LINK_PAUSED", "New starts are paused for this exam. Wait for your proctor.")
		case "revoked":
			return nil, "", false, false, assessmentConflict("START_LINK_REVOKED", "This exam link is no longer available.")
		}
	}
	if now.Before(opensAt) {
		return nil, "", false, false, startWindowNotOpen(opensAt)
	}
	if !now.Before(closesAt) {
		return nil, "", false, false, startWindowClosed()
	}
	// 8. Existing attempt controls.
	switch a.proctorStatus {
	case "paused":
		return nil, "", false, false, assessmentConflict("ATTEMPT_PROCTOR_BLOCKED", "Your SAT attempt is paused by the proctor.")
	case "terminated":
		return nil, "", false, false, assessmentConflict("ATTEMPT_PROCTOR_BLOCKED", "Your SAT attempt has been terminated by the proctor.")
	}
	if err := enforceWriterSessionTx(ctx, t, scheduleID, attemptID, writerBinding...); err != nil {
		return nil, "", false, false, err
	}
	epoch := controlEpoch
	if err := enforceControlEpochTx(ctx, t, attemptID, &epoch); err != nil {
		return nil, "", false, false, err
	}
	// 7. The comparison itself: constant time over validated strings.
	if !satstartcode.Equal(code, current.Value) {
		return nil, "", false, false, errStartCodeMismatch
	}
	// Admitted candidates are pinned to the schedule's release; a mismatch is
	// a staff configuration conflict, never a silent rebind.
	if !a.versionID.Valid || a.versionID.String != sch.PublishedVersionID {
		return nil, "", false, false, assessmentConflict("START_CODE_RELEASE_CONFLICT", "This session's exam release changed. Ask your proctor for help.")
	}
	// 9. Runtime: reuse, or open it on the exclusive path.
	var runtimeStatus, timingModel string
	lockRuntime := " FOR SHARE"
	runtimeLockMode := "shared"
	if exclusive {
		lockRuntime = " FOR UPDATE"
		runtimeLockMode = "exclusive"
	}
	runtimeLockBegan := time.Now()
	err = t.QueryRowContext(ctx, "SELECT status, COALESCE(timing_model, '') FROM exam_session_runtimes WHERE schedule_id = ?"+lockRuntime, scheduleID).Scan(&runtimeStatus, &timingModel)
	telemetry.ObserveSeconds(telemetry.MSATStartCodeStageSeconds, time.Since(runtimeLockBegan).Seconds(), "stage", "runtime_lock", "mode", runtimeLockMode)
	if exclusive && err == nil {
		return nil, "", false, false, errStartCodeRuntimeAlreadyExists
	}
	openedRuntime := false
	switch {
	case err == sql.ErrNoRows:
		if !exclusive {
			return nil, "", false, false, errNeedExclusiveStart
		}
		if s.codeStartRuntime == nil || s.codeStartPlanner == nil {
			return nil, "", false, false, apperrors.New(apperrors.CodeServiceUnavailable, "The SAT start service is unavailable.")
		}
		if _, err := s.codeStartRuntime.OpenForCodeStartInTx(ctx, t, sch, s.codeStartPlanner); err != nil {
			return nil, "", false, false, err
		}
		openedRuntime = true
		runtimeStatus, timingModel = examruntime.StatusLive, examruntime.TimingModelPersonal
		if err := t.QueryRowContext(ctx, "SELECT COALESCE(timing_model, '') FROM exam_session_runtimes WHERE schedule_id = ?", scheduleID).Scan(&timingModel); err != nil {
			return nil, "", false, false, err
		}
	case err != nil:
		return nil, "", false, false, err
	}
	if !examruntime.IsSatPersonal(timingModel) {
		return nil, "", false, false, assessmentConflict("START_CODE_TIMING_CONFLICT", "This SAT session is not configured for individual starts.")
	}
	switch runtimeStatus {
	case examruntime.StatusLive:
	case examruntime.StatusPaused:
		return nil, "", false, false, assessmentConflict("RUNTIME_PAUSED", "The SAT session is paused by the proctor.")
	default:
		return nil, "", false, false, startWindowClosed()
	}
	// 10. The candidate's first delivered module: the seeded base row. Any
	// module that already started without acceptance is an integrity breach.
	var startedWithout bool
	if err := t.QueryRowContext(ctx,
		"SELECT EXISTS(SELECT 1 FROM assessment_module_attempts WHERE attempt_id = ? AND started_at IS NOT NULL)",
		attemptID).Scan(&startedWithout); err != nil {
		return nil, "", false, false, err
	}
	if startedWithout {
		return nil, "", false, false, apperrors.New(apperrors.CodeAssessmentConflict, "This SAT attempt has an inconsistent start record. Ask your proctor for help.")
	}
	var firstModuleID string
	if err := t.QueryRowContext(ctx,
		"SELECT module_id FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY created_at, id LIMIT 1",
		attemptID).Scan(&firstModuleID); err != nil {
		if err == sql.ErrNoRows {
			return nil, "", false, false, apperrors.New(apperrors.CodeNotFound, "Module attempt not found for this module.")
		}
		return nil, "", false, false, err
	}
	if firstModuleID != preparedModuleID {
		return nil, "", false, false, assessmentConflict("START_CODE_RELEASE_CONFLICT", "The session's first module changed. Refresh and try again.")
	}
	module, err := lockModuleAttemptTx(ctx, t, attemptID, firstModuleID)
	if err != nil {
		return nil, "", false, false, err
	}
	if module.state != "not_started" {
		return nil, "", false, false, apperrors.New(apperrors.CodeAssessmentConflict, "This SAT module cannot be started in its current state.")
	}
	var currentRevision int64
	var publishScope sql.NullString
	if err := t.QueryRowContext(ctx,
		"SELECT revision, sat_publish_scope FROM exam_versions WHERE id = ? FOR SHARE",
		a.versionID.String).Scan(&currentRevision, &publishScope); err != nil {
		return nil, "", false, false, err
	}
	if currentRevision != preparedRevision || preparedSection == nil {
		return nil, "", false, false, assessmentConflict("START_CODE_RELEASE_CONFLICT", "The session's exam release changed. Refresh and try again.")
	}
	scope := examdomain.IntersectSectionScopes(
		examdomain.ParseSATPublishScope(publishScope.String),
		examdomain.ParseStoredSectionScope(link.enabledSections),
	)
	if !examdomain.AllowsSection(scope, preparedSection.SectionKey) {
		return nil, "", false, false, apperrors.New(apperrors.CodeNotFound, "Selected module content not found.")
	}
	startAt, err := dbTimeTx(ctx, t)
	if err != nil {
		return nil, "", false, false, err
	}
	// Runtime planning may have crossed the admission cutoff. The clock and
	// eligibility use the same final database timestamp; rollback also removes
	// a runtime created by this request when the window has just closed.
	if !startAt.Before(closesAt) {
		return nil, "", false, false, startWindowClosed()
	}
	events, _, _, err := s.activatePersonalModuleTx(ctx, t, scheduleID, attemptID, module, startAt, false)
	if err != nil {
		return nil, "", false, false, err
	}
	res, err := t.ExecContext(ctx,
		"UPDATE student_attempts SET sat_start_code_accepted_at = ?, sat_start_code_generation = ? WHERE id = ? AND sat_start_code_required = 1 AND sat_start_code_accepted_at IS NULL",
		startAt, current.Generation, attemptID)
	if err != nil {
		return nil, "", false, false, err
	}
	if n, err := res.RowsAffected(); err != nil {
		return nil, "", false, false, err
	} else if n != 1 {
		return nil, "", false, false, apperrors.New(apperrors.CodeAssessmentConflict, "The SAT exam was started by another request. Refresh and continue.")
	}
	if err := satstartcode.AuditTx(ctx, t, scheduleID, "student:"+attemptID, satstartcode.AuditFirstStart, &attemptID, map[string]any{
		"generation": current.Generation, "acceptedAt": startAt, "moduleId": module.moduleID, "openedRuntime": openedRuntime,
	}); err != nil {
		return nil, "", false, false, err
	}
	if _, err := releaseStartCodeReservationTx(ctx, t, scheduleID, reservationID, attemptID); err != nil {
		return nil, "", false, false, err
	}
	ack, err := s.entryStateBoundWithQueryer(ctx, t, scheduleID, attemptID, module.moduleID)
	if err != nil {
		return nil, "", false, false, err
	}
	ack.SelectedSection = preparedSection
	*preparedAck = ack
	return events, module.moduleID, openedRuntime, false, nil
}

// effectiveStartWindow intersects the schedule window with the backing link
// window. An anytime link (no opens/closes) still honors the schedule end.
func effectiveStartWindow(scheduleStart, scheduleEnd time.Time, linkPresent bool, linkOpens, linkCloses sql.NullTime) (time.Time, time.Time) {
	opens, closes := scheduleStart.UTC(), scheduleEnd.UTC()
	if linkPresent {
		if linkOpens.Valid && linkOpens.Time.UTC().After(opens) {
			opens = linkOpens.Time.UTC()
		}
		if linkCloses.Valid && linkCloses.Time.UTC().Before(closes) {
			closes = linkCloses.Time.UTC()
		}
	}
	return opens, closes
}

// resumeCodeStart answers a started attempt's replay with the authoritative
// projection at its current module/break. Principal (bearer), writer and
// terminal state are checked; the code is not.
func (s *Service) resumeCodeStart(ctx context.Context, scheduleID, attemptID string, writerBinding ...string) (*SatCodeStartResponse, error) {
	if err := s.runner.WithTxRC(ctx, func(ctx context.Context, t tx.Tx) error {
		a, err := scanCodeStartAttempt(t.QueryRowContext(ctx,
			"SELECT "+codeStartAttemptColumns+" FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE", attemptID, scheduleID))
		if err != nil {
			return err
		}
		if a.terminal() {
			return assessmentConflict("ATTEMPT_TERMINAL", "The SAT attempt is already terminal and cannot accept this command.")
		}
		return enforceWriterSessionTx(ctx, t, scheduleID, attemptID, writerBinding...)
	}); err != nil {
		return nil, err
	}
	out, err := s.Bootstrap(ctx, scheduleID, attemptID, scheduleID)
	if err != nil {
		return nil, err
	}
	return &SatCodeStartResponse{Kind: "resume", Bootstrap: out}, nil
}

// checkStartCodeQuotas applies the stable per-attempt and per-principal
// fixed-window quotas in the distributed counter table, judged by DB time.
// Unlike the HTTP tier limiter this fails CLOSED: no process-local fallback.
func (s *Service) checkStartCodeQuotas(ctx context.Context, attemptID, principal string) error {
	quotas := []struct {
		route  string
		key    string
		limit  int
		window time.Duration
	}{
		{"sat_start_code_attempt", attemptID, startCodeAttemptLimit, startCodeAttemptWindow},
		{"sat_start_code_principal", principal, startCodePrincipalLimit, startCodePrincipalWindow},
	}
	countRequest := s.countStartCodeRequest
	if provider, ok := s.db.(interface {
		Conn(context.Context) (*sql.Conn, error)
	}); ok {
		conn, err := provider.Conn(ctx)
		if err != nil {
			return startCodeQuotaUnavailable()
		}
		defer func() { _ = conn.Close() }()
		if !tx.SessionReady(s.db) {
			if _, err := conn.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
				return startCodeQuotaUnavailable()
			}
		}
		countRequest = func(ctx context.Context, route, key string, limit int, window time.Duration) (bool, time.Duration, error) {
			return countStartCodeRequestOnConn(ctx, conn, route, key, limit, window)
		}
	}
	for _, q := range quotas {
		allowed, retry, err := countRequest(ctx, q.route, q.key, q.limit, q.window)
		if err != nil {
			return startCodeQuotaUnavailable()
		}
		if !allowed {
			telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "rate_limited")
			return startCodeRateLimited("START_CODE_RATE_LIMITED", retry)
		}
	}
	return nil
}

func startCodeQuotaUnavailable() error {
	telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "unavailable")
	unavailable := apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
	unavailable.Retryable = true
	return unavailable
}

func (s *Service) countStartCodeRequest(ctx context.Context, route, key string, limit int, window time.Duration) (bool, time.Duration, error) {
	var allowed bool
	var retry time.Duration
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		now, err := dbTimeTx(ctx, t)
		if err != nil {
			return err
		}
		windowStart := now.Truncate(window)
		if _, err := t.ExecContext(ctx,
			"INSERT INTO distributed_rate_limit_counters (route_key, bucket_key, window_start, request_count, expires_at) VALUES (?, ?, ?, 1, ?) ON DUPLICATE KEY UPDATE request_count = request_count + 1",
			route, key, windowStart, windowStart.Add(window)); err != nil {
			return err
		}
		var count int
		if err := t.QueryRowContext(ctx,
			"SELECT request_count FROM distributed_rate_limit_counters WHERE route_key = ? AND bucket_key = ? AND window_start = ?",
			route, key, windowStart).Scan(&count); err != nil {
			return err
		}
		allowed = count <= limit
		retry = windowStart.Add(window).Sub(now)
		return nil
	})
	return allowed, retry, err
}

func countStartCodeRequestOnConn(ctx context.Context, conn *sql.Conn, route, key string, limit int, window time.Duration) (bool, time.Duration, error) {
	var now time.Time
	if err := conn.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return false, 0, err
	}
	now = now.UTC()
	windowStart := now.Truncate(window)
	if _, err := conn.ExecContext(ctx,
		"INSERT INTO distributed_rate_limit_counters (route_key, bucket_key, window_start, request_count, expires_at) VALUES (?, ?, ?, LAST_INSERT_ID(1), ?) ON DUPLICATE KEY UPDATE request_count = LAST_INSERT_ID(request_count + 1)",
		route, key, windowStart, windowStart.Add(window)); err != nil {
		return false, 0, err
	}
	var count int
	if err := conn.QueryRowContext(ctx, "SELECT LAST_INSERT_ID()").Scan(&count); err != nil {
		return false, 0, err
	}
	return count <= limit, windowStart.Add(window).Sub(now), nil
}

// reserveStartCodeComparison claims one durable inventory row before any code
// decryption/comparison. Different candidates lock different attempt and slot
// rows; the fixed inventory, not a generation-wide mutex, enforces the budget.
func (s *Service) reserveStartCodeComparison(ctx context.Context, scheduleID, attemptID string, expectedGeneration int) (string, int, error) {
	id := uuid.NewString()
	generation := expectedGeneration
	claimBegan := time.Now()
	var refusal error
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		generation = expectedGeneration
		refusal = nil
		// Match the start transaction's link -> schedule -> code -> attempt
		// ordering. The code row is shared, so independent claims do not queue
		// behind one another; rotation still excludes claims.
		var linked string
		err := t.QueryRowContext(ctx,
			"SELECT schedule_id FROM assessment_access_links WHERE schedule_id = ? FOR SHARE",
			scheduleID).Scan(&linked)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		schedule, err := examruntime.ShareScheduleRow(ctx, t, scheduleID)
		if err != nil {
			return err
		}
		if schedule.SatStartMode != examruntime.SatStartModeAccessCode {
			return assessmentConflict("START_MODE_CONFLICT", "This SAT session is started by the proctor, not with a start code.")
		}
		var currentGeneration int
		err = t.QueryRowContext(ctx,
			"SELECT generation FROM sat_session_start_codes WHERE schedule_id = ? FOR SHARE",
			scheduleID).Scan(&currentGeneration)
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeServiceUnavailable, "The exam start code is temporarily unavailable.")
		}
		if err != nil {
			return err
		}
		if currentGeneration != expectedGeneration {
			return assessmentConflict("START_CODE_ROTATED", "The exam start code changed. Enter the current code.")
		}
		generation = currentGeneration
		var lockedAttempt string
		if err := t.QueryRowContext(ctx,
			"SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
			attemptID, scheduleID).Scan(&lockedAttempt); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		now, err := dbTimeTx(ctx, t)
		if err != nil {
			return err
		}
		now = now.UTC()
		if err := expireStartCodeReservationsTx(ctx, t, scheduleID, generation, now, satstartcode.ReservationSlotsPerGeneration); err != nil {
			return err
		}
		// The unique (schedule, attempt) slot is read without a lock first;
		// then we always lock reservation -> slot, matching start and sweep.
		var activeGeneration int
		var activeReservationID string
		err = t.QueryRowContext(ctx,
			"SELECT generation, reservation_id FROM sat_start_code_reservation_slots WHERE schedule_id = ? AND attempt_id = ? AND state = 'pending'",
			scheduleID, attemptID).Scan(&activeGeneration, &activeReservationID)
		if err != nil && err != sql.ErrNoRows {
			return err
		}
		if err == nil {
			var activeState, activeAttempt string
			var activeLease time.Time
			err = t.QueryRowContext(ctx,
				"SELECT state, attempt_id, lease_expires_at FROM sat_start_code_reservations WHERE id = ? AND schedule_id = ? AND generation = ? FOR UPDATE",
				activeReservationID, scheduleID, activeGeneration).Scan(&activeState, &activeAttempt, &activeLease)
			if err != nil {
				return err
			}
			var slotState, slotAttempt string
			var slotReservation string
			err = t.QueryRowContext(ctx,
				"SELECT state, attempt_id, reservation_id FROM sat_start_code_reservation_slots WHERE schedule_id = ? AND generation = ? AND reservation_id = ? FOR UPDATE",
				scheduleID, activeGeneration, activeReservationID).Scan(&slotState, &slotAttempt, &slotReservation)
			if err != nil {
				return err
			}
			if activeState == "pending" && activeAttempt == attemptID &&
				slotState == "pending" && slotAttempt == attemptID && slotReservation == activeReservationID {
				if now.Before(activeLease) {
					refusal = startCodeRateLimited("START_CODE_BUSY", activeLease.Sub(now))
					return nil
				}
				if _, err := failStartCodeReservationTx(ctx, t, scheduleID, activeReservationID, now); err != nil {
					return err
				}
			} else if activeState == "pending" || slotState == "pending" {
				return apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
			}
		}
		windowStart := now.Truncate(startCodeScheduleWindow)
		var inventory, pending, failed int
		if err := t.QueryRowContext(ctx,
			`SELECT COUNT(*),
				COUNT(CASE WHEN state = 'pending' THEN 1 END),
				COUNT(CASE WHEN state = 'failed' AND window_start = ? THEN 1 END)
			FROM sat_start_code_reservation_slots
			WHERE schedule_id = ? AND generation = ?`,
			windowStart, scheduleID, generation).Scan(&inventory, &pending, &failed); err != nil {
			return err
		}
		if inventory != satstartcode.ReservationSlotsPerGeneration {
			return apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
		}
		if failed >= startCodeScheduleFailureLimit {
			retryAfter := windowStart.Add(startCodeScheduleWindow).Sub(now)
			refusal = startCodeRateLimited("START_CODE_COOLDOWN", retryAfter)
			return nil
		}
		if pending+failed >= startCodeScheduleFailureLimit {
			refusal = errStartCodeCapacityFull
			return nil
		}
		var slotNo int
		err = t.QueryRowContext(ctx,
			`SELECT slot_no FROM sat_start_code_reservation_slots
			WHERE schedule_id = ? AND generation = ?
				AND (state = 'free' OR (state = 'failed' AND window_start < ?))
			ORDER BY slot_no LIMIT 1 FOR UPDATE SKIP LOCKED`,
			scheduleID, generation, windowStart).Scan(&slotNo)
		if err == sql.ErrNoRows {
			// A different transaction may have locked every reusable slot while
			// this one observed capacity. Wait briefly and re-count; never spin.
			refusal = errStartCodeCapacityFull
			return nil
		}
		if err != nil {
			return err
		}
		leaseExpiresAt := now.Add(startCodeReservationLease)
		if _, err := t.ExecContext(ctx,
			`INSERT INTO sat_start_code_reservations
			(id, schedule_id, generation, attempt_id, window_start, lease_expires_at, state, created_at)
			VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
			id, scheduleID, generation, attemptID, windowStart, leaseExpiresAt, now); err != nil {
			return err
		}
		result, err := t.ExecContext(ctx,
			`UPDATE sat_start_code_reservation_slots
			SET state = 'pending', reservation_id = ?, attempt_id = ?, window_start = ?,
				lease_expires_at = ?, updated_at = UTC_TIMESTAMP(6)
			WHERE schedule_id = ? AND generation = ? AND slot_no = ?
				AND (state = 'free' OR (state = 'failed' AND window_start < ?))`,
			id, attemptID, windowStart, leaseExpiresAt, scheduleID, generation, slotNo, windowStart)
		if err != nil {
			return err
		}
		if changed, err := result.RowsAffected(); err != nil {
			return err
		} else if changed != 1 {
			return errStartCodeCapacityFull
		}
		return nil
	})
	observeStartCodeStage("reservation_claim", claimBegan)
	if err == nil && refusal != nil {
		err = refusal
	}
	if err != nil {
		if errors.Is(err, errStartCodeCapacityFull) {
			return "", 0, err
		}
		if appErr, ok := apperrors.As(err); ok {
			if appErr.Code == apperrors.CodeRateLimited {
				reason, _ := appErr.Details["reason"].(string)
				outcome := "rate_limited"
				if reason == "START_CODE_BUSY" {
					outcome = "busy"
				}
				telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", outcome)
			}
			return "", 0, err
		}
		telemetry.IncCounter(telemetry.MSATStartCodeVerification, "outcome", "unavailable")
		unavailable := apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
		unavailable.Retryable = true
		return "", 0, unavailable
	}
	return id, generation, nil
}

// failStartCodeReservationTx expires one pending reservation and its slot
// atomically. window_start is retained so an expired comparison is charged to
// the original fixed window, even when cleanup happens later.
func failStartCodeReservationTx(ctx context.Context, t tx.Tx, scheduleID, reservationID string, now time.Time) (bool, error) {
	var generation int
	var state string
	if err := t.QueryRowContext(ctx,
		"SELECT generation, state FROM sat_start_code_reservations WHERE id = ? AND schedule_id = ? FOR UPDATE",
		reservationID, scheduleID).Scan(&generation, &state); err != nil {
		if err == sql.ErrNoRows {
			return false, nil
		}
		return false, err
	}
	if state != "pending" {
		return false, nil
	}
	var slotState string
	if err := t.QueryRowContext(ctx,
		"SELECT state FROM sat_start_code_reservation_slots WHERE schedule_id = ? AND generation = ? AND reservation_id = ? FOR UPDATE",
		scheduleID, generation, reservationID).Scan(&slotState); err != nil {
		return false, err
	}
	if slotState != "pending" {
		return false, apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
	}
	if _, err := t.ExecContext(ctx,
		"UPDATE sat_start_code_reservations SET state = 'failed', settled_at = ? WHERE id = ? AND state = 'pending'",
		now, reservationID); err != nil {
		return false, err
	}
	result, err := t.ExecContext(ctx,
		`UPDATE sat_start_code_reservation_slots
		SET state = 'failed', reservation_id = NULL, attempt_id = NULL, lease_expires_at = NULL, updated_at = UTC_TIMESTAMP(6)
		WHERE schedule_id = ? AND generation = ? AND reservation_id = ? AND state = 'pending'`,
		scheduleID, generation, reservationID)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if changed != 1 {
		return false, apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
	}
	return true, nil
}

// releaseStartCodeReservationTx releases a successful comparison in the
// start transaction, so the candidate does not pay for a second DB round trip
// after their timer has begun.
func releaseStartCodeReservationTx(ctx context.Context, t tx.Tx, scheduleID, reservationID, attemptID string) (bool, error) {
	var generation int
	var state, reservedAttempt string
	err := t.QueryRowContext(ctx,
		"SELECT generation, state, attempt_id FROM sat_start_code_reservations WHERE id = ? AND schedule_id = ? FOR UPDATE",
		reservationID, scheduleID).Scan(&generation, &state, &reservedAttempt)
	if err == sql.ErrNoRows || (err == nil && state != "pending") {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if reservedAttempt != attemptID {
		return false, apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
	}
	var slotState, slotAttempt string
	if err := t.QueryRowContext(ctx,
		"SELECT state, attempt_id FROM sat_start_code_reservation_slots WHERE schedule_id = ? AND generation = ? AND reservation_id = ? FOR UPDATE",
		scheduleID, generation, reservationID).Scan(&slotState, &slotAttempt); err != nil {
		return false, err
	}
	if slotState != "pending" || slotAttempt != attemptID {
		return false, apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
	}
	if _, err := t.ExecContext(ctx,
		"UPDATE sat_start_code_reservations SET state = 'released', settled_at = UTC_TIMESTAMP(6) WHERE id = ? AND state = 'pending'",
		reservationID); err != nil {
		return false, err
	}
	result, err := t.ExecContext(ctx,
		`UPDATE sat_start_code_reservation_slots
		SET state = 'free', reservation_id = NULL, attempt_id = NULL,
			window_start = NULL, lease_expires_at = NULL, updated_at = UTC_TIMESTAMP(6)
		WHERE schedule_id = ? AND generation = ? AND reservation_id = ? AND state = 'pending'`,
		scheduleID, generation, reservationID)
	if err != nil {
		return false, err
	}
	changed, err := result.RowsAffected()
	if err != nil {
		return false, err
	}
	if changed != 1 {
		return false, apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
	}
	return true, nil
}

func expireStartCodeReservationsTx(ctx context.Context, t tx.Tx, scheduleID string, generation int, now time.Time, limit int) error {
	rows, err := t.QueryContext(ctx,
		`SELECT id FROM sat_start_code_reservations
		WHERE schedule_id = ? AND generation = ? AND state = 'pending' AND lease_expires_at <= ?
		ORDER BY lease_expires_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
		scheduleID, generation, now, limit)
	if err != nil {
		return err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, id := range ids {
		if _, err := failStartCodeReservationTx(ctx, t, scheduleID, id, now); err != nil {
			return err
		}
	}
	return nil
}

// settleStartCodeReservation moves both the durable ledger and slot in one
// short transaction independent of request cancellation. A failed settlement
// remains pending and expires conservatively to failed.
func (s *Service) settleStartCodeReservation(scheduleID, reservationID, state string) {
	settlementBegan := time.Now()
	defer func() { observeStartCodeStage("settlement", settlementBegan) }()
	if state != "failed" && state != "released" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	changed := false
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		var generation int
		var currentState string
		err := t.QueryRowContext(ctx,
			"SELECT generation, state FROM sat_start_code_reservations WHERE id = ? AND schedule_id = ? FOR UPDATE",
			reservationID, scheduleID).Scan(&generation, &currentState)
		if err == sql.ErrNoRows || (err == nil && currentState != "pending") {
			return nil
		}
		if err != nil {
			return err
		}
		var slotState string
		if err := t.QueryRowContext(ctx,
			"SELECT state FROM sat_start_code_reservation_slots WHERE schedule_id = ? AND generation = ? AND reservation_id = ? FOR UPDATE",
			scheduleID, generation, reservationID).Scan(&slotState); err != nil {
			return err
		}
		if slotState != "pending" {
			return apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
		}
		if _, err := t.ExecContext(ctx,
			"UPDATE sat_start_code_reservations SET state = ?, settled_at = UTC_TIMESTAMP(6) WHERE id = ? AND state = 'pending'",
			state, reservationID); err != nil {
			return err
		}
		nextSlotState := "free"
		if state == "failed" {
			nextSlotState = "failed"
		}
		result, err := t.ExecContext(ctx,
			`UPDATE sat_start_code_reservation_slots
			SET state = ?, reservation_id = NULL, attempt_id = NULL, lease_expires_at = NULL,
				window_start = CASE WHEN ? = 'free' THEN NULL ELSE window_start END,
				updated_at = UTC_TIMESTAMP(6)
			WHERE schedule_id = ? AND generation = ? AND reservation_id = ? AND state = 'pending'`,
			nextSlotState, nextSlotState, scheduleID, generation, reservationID)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected != 1 {
			return apperrors.New(apperrors.CodeServiceUnavailable, "Start code verification is temporarily unavailable.")
		}
		changed = true
		return nil
	})
	if err == nil && changed {
		s.startCodeAdmission().notifySchedule(scheduleID)
	}
}

// SweepStartCodeReservations marks each expired log + slot failed atomically.
// It can run on any worker instance; SKIP LOCKED divides the batch safely.
func (s *Service) SweepStartCodeReservations(ctx context.Context, limit int64) (int64, error) {
	if limit < 1 {
		limit = 500
	}
	var expired int64
	schedules := make(map[string]struct{})
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		expired = 0
		clear(schedules)
		now, err := dbTimeTx(ctx, t)
		if err != nil {
			return err
		}
		rows, err := t.QueryContext(ctx,
			`SELECT id, schedule_id FROM sat_start_code_reservations
			WHERE state = 'pending' AND lease_expires_at <= ?
			ORDER BY lease_expires_at, id LIMIT ? FOR UPDATE SKIP LOCKED`,
			now, limit)
		if err != nil {
			return err
		}
		type expiredReservation struct{ id, scheduleID string }
		batch := make([]expiredReservation, 0, limit)
		for rows.Next() {
			var item expiredReservation
			if err := rows.Scan(&item.id, &item.scheduleID); err != nil {
				rows.Close()
				return err
			}
			batch = append(batch, item)
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return err
		}
		if err := rows.Close(); err != nil {
			return err
		}
		for _, item := range batch {
			changed, err := failStartCodeReservationTx(ctx, t, item.scheduleID, item.id, now)
			if err != nil {
				return err
			}
			if changed {
				expired++
				schedules[item.scheduleID] = struct{}{}
			}
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM sat_start_code_reservations WHERE state <> 'pending' AND created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL ? SECOND) ORDER BY created_at LIMIT ?",
		int64(startCodeReservationRetention/time.Second), limit); err != nil {
		return expired, err
	}
	for scheduleID := range schedules {
		s.startCodeAdmission().notifySchedule(scheduleID)
	}
	return expired, nil
}

// satStartPolicy derives the entry object for one attempt. gated reports
// that the candidate has not redeemed the code: no module content, media or
// mutation may reach them yet.
func (s *Service) satStartPolicy(ctx context.Context, scheduleID string, control attemptControl, now time.Time) (*SatStartPolicy, bool, error) {
	if !control.codeRequired {
		// The start mode is frozen on the attempt at admission: proctor-mode
		// attempts (including every pre-existing one) keep the room Start.
		return &SatStartPolicy{Mode: satstartcode.ModeProctor}, false, nil
	}
	proctorStatus := control.proctorStatus
	policy := &SatStartPolicy{Mode: satstartcode.ModeAccessCode}
	serverNow := now.UTC()
	policy.ServerNow = &serverNow
	if control.codeAcceptedAt != nil {
		policy.State = SatStartStateStarted
		return policy, false, nil
	}
	var scheduleStatus string
	var startTime, endTime time.Time
	if err := s.db.QueryRowContext(ctx,
		"SELECT status, start_time, end_time FROM exam_schedules WHERE id = ?",
		scheduleID).Scan(&scheduleStatus, &startTime, &endTime); err != nil {
		return nil, true, err
	}
	var link struct {
		lifecycle         string
		opensAt, closesAt sql.NullTime
	}
	linkPresent := true
	if err := s.db.QueryRowContext(ctx,
		"SELECT lifecycle_state, opens_at, closes_at FROM assessment_access_links WHERE schedule_id = ?",
		scheduleID).Scan(&link.lifecycle, &link.opensAt, &link.closesAt); err != nil {
		if err != sql.ErrNoRows {
			return nil, true, err
		}
		linkPresent = false
	}
	opens, closes := effectiveStartWindow(startTime, endTime, linkPresent, link.opensAt, link.closesAt)
	policy.OpensAt, policy.ClosesAt = &opens, &closes
	deliveryStatus := control.deliveryStatus
	terminal := control.submittedAt != nil || deliveryStatus == "submitted" || deliveryStatus == "terminated" ||
		deliveryStatus == "locked" || deliveryStatus == "cancelled" || proctorStatus == "terminated" ||
		control.phase == "post-exam"
	if terminal || (scheduleStatus != "scheduled" && scheduleStatus != "live") || !serverNow.Before(closes) {
		policy.State = SatStartStateClosed
		return policy, true, nil
	}
	policy.State = SatStartStateCodeRequired
	block := func(reason string) { policy.BlockedReason = &reason }
	switch {
	case linkPresent && link.lifecycle == "revoked":
		block(SatStartBlockedRevoked)
	case linkPresent && link.lifecycle == "paused":
		block(SatStartBlockedPaused)
	case serverNow.Before(opens):
		block(SatStartBlockedNotOpen)
		wait := int(opens.Sub(serverNow).Round(time.Second) / time.Second)
		policy.RetryAfterSeconds = &wait
	default:
		var runtimeStatus string
		err := s.db.QueryRowContext(ctx, "SELECT status FROM exam_session_runtimes WHERE schedule_id = ?", scheduleID).Scan(&runtimeStatus)
		if err != nil && err != sql.ErrNoRows {
			return nil, true, err
		}
		if (err == nil && runtimeStatus == examruntime.StatusPaused) || proctorStatus == "paused" {
			block(SatStartBlockedPaused)
		}
	}
	return policy, true, nil
}

// StudentContentGated reports whether SAT question content must be withheld
// from a student projection of this schedule: code-start sessions withhold it
// until the candidate's own redemption, and an unresolved attempt fails closed.
// Shared by the V1 session/static projections and media authorization.
func (s *Service) StudentContentGated(ctx context.Context, scheduleID, attemptID string) (bool, error) {
	var mode string
	if err := s.db.QueryRowContext(ctx, "SELECT COALESCE(sat_start_mode, 'proctor') FROM exam_schedules WHERE id = ?", scheduleID).Scan(&mode); err != nil {
		if err == sql.ErrNoRows {
			return true, nil
		}
		return true, err
	}
	if mode != satstartcode.ModeAccessCode {
		return false, nil
	}
	if strings.TrimSpace(attemptID) == "" {
		return true, nil
	}
	var required bool
	var acceptedAt sql.NullTime
	if err := s.db.QueryRowContext(ctx,
		"SELECT sat_start_code_required, sat_start_code_accepted_at FROM student_attempts WHERE id = ?", attemptID).Scan(&required, &acceptedAt); err != nil {
		if err == sql.ErrNoRows {
			return true, nil
		}
		return true, err
	}
	return required && !acceptedAt.Valid, nil
}

// withholdAllModuleContent delivers every module as metadata only: before the
// code is redeemed nothing gated (questions, instructions, stimulus, media
// references) may reach the browser. Returns a fresh tree; the version cache's
// shared tree is never mutated.
func withholdAllModuleContent(sections []DeliverySection) []DeliverySection {
	out := make([]DeliverySection, 0, len(sections))
	for _, section := range sections {
		modules := make([]DeliveryModule, 0, len(section.Modules))
		for _, module := range section.Modules {
			module.Questions = []DeliveredQuestion{}
			module.Instructions = nil
			module.ContentWithheld = true
			modules = append(modules, module)
		}
		section.Modules = modules
		section.Instructions = nil
		out = append(out, section)
	}
	return out
}

package attempts

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"regexp"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// Transfer states (attempt_device_transfers.state).
const (
	TransferPending    = "pending"
	TransferApproved   = "approved"
	TransferCommitted  = "committed"
	TransferDenied     = "denied"
	TransferCancelled  = "cancelled"
	TransferExpired    = "expired"
	TransferConflicted = "conflicted"
)

// Approval kinds.
const (
	ApprovalCurrentWriter = "current_writer"
	ApprovalProctor       = "proctor"
)

// TransferPolicy carries the deployment knobs for the workflow.
type TransferPolicy struct {
	// Enabled gates NEW requests only. Rollback keeps already-open requests
	// resolvable (decide/cancel/commit/status) and never weakens ownership.
	Enabled     bool
	RequestTTL  time.Duration
	ApprovalTTL time.Duration
}

func (p TransferPolicy) requestTTL() time.Duration {
	if p.RequestTTL <= 0 {
		return 10 * time.Minute
	}
	return p.RequestTTL
}

func (p TransferPolicy) approvalTTL() time.Duration {
	if p.ApprovalTTL <= 0 {
		return 2 * time.Minute
	}
	return p.ApprovalTTL
}

// TransferView is the student/proctor-safe projection of a request: it
// never carries a client session id, bearer, or answer content.
type TransferView struct {
	RequestID                   string     `json:"requestId"`
	OperationID                 string     `json:"operationId"`
	AttemptID                   string     `json:"attemptId"`
	ScheduleID                  string     `json:"scheduleId"`
	State                       string     `json:"state"`
	PolicyStage                 string     `json:"policyStage"`
	ReasonCode                  string     `json:"reasonCode"`
	ExpectedLeaseEpoch          uint64     `json:"expectedLeaseEpoch"`
	RequestedAt                 time.Time  `json:"requestedAt"`
	ExpiresAt                   time.Time  `json:"expiresAt"`
	ApprovalKind                *string    `json:"approvalKind"`
	ApprovedAt                  *time.Time `json:"approvedAt"`
	ApprovalExpiresAt           *time.Time `json:"approvalExpiresAt"`
	UnconfirmedRiskAcknowledged bool       `json:"unconfirmedRiskAcknowledged"`
	DecisionReason              *string    `json:"decisionReason"`
	DecidedAt                   *time.Time `json:"decidedAt"`
	ResultingLeaseEpoch         *uint64    `json:"resultingLeaseEpoch"`
	CommittedAt                 *time.Time `json:"committedAt"`
}

// transferRow is the full stored row (internal only).
type transferRow struct {
	TransferView
	RequestHash       string
	ActiveAttemptID   sql.NullString
	RequestedByUserID string
	RequestedByAuth   string
	TargetSession     string
	ExpectedOwner     sql.NullString
}

const transferColumns = `id, operation_id, request_hash, attempt_id, schedule_id, active_attempt_id, requested_by_user_id, requested_by_auth_session_id, target_client_session_id, expected_owner_session_id, expected_lease_epoch, policy_stage, state, reason_code, requested_at, expires_at, approval_kind, approved_at, approval_expires_at, unconfirmed_risk_acknowledged, decision_reason, decided_at, resulting_lease_epoch, committed_at`

func scanTransfer(row interface{ Scan(dest ...any) error }) (transferRow, error) {
	var t transferRow
	var approvalKind, decisionReason sql.NullString
	var approvedAt, approvalExpires, decidedAt, committedAt sql.NullTime
	var resulting sql.NullInt64
	err := row.Scan(&t.RequestID, &t.OperationID, &t.RequestHash, &t.AttemptID, &t.ScheduleID, &t.ActiveAttemptID,
		&t.RequestedByUserID, &t.RequestedByAuth, &t.TargetSession, &t.ExpectedOwner, &t.ExpectedLeaseEpoch,
		&t.PolicyStage, &t.State, &t.ReasonCode, &t.RequestedAt, &t.ExpiresAt, &approvalKind, &approvedAt,
		&approvalExpires, &t.UnconfirmedRiskAcknowledged, &decisionReason, &decidedAt, &resulting, &committedAt)
	if err != nil {
		return t, err
	}
	t.RequestedAt, t.ExpiresAt = t.RequestedAt.UTC(), t.ExpiresAt.UTC()
	if approvalKind.Valid {
		s := approvalKind.String
		t.ApprovalKind = &s
	}
	if decisionReason.Valid {
		s := decisionReason.String
		t.DecisionReason = &s
	}
	t.ApprovedAt = nullTimePtr(approvedAt)
	t.ApprovalExpiresAt = nullTimePtr(approvalExpires)
	t.DecidedAt = nullTimePtr(decidedAt)
	t.CommittedAt = nullTimePtr(committedAt)
	if resulting.Valid {
		v := uint64(resulting.Int64)
		t.ResultingLeaseEpoch = &v
	}
	return t, nil
}

func nullTimePtr(t sql.NullTime) *time.Time {
	if !t.Valid {
		return nil
	}
	v := t.Time.UTC()
	return &v
}

func lockTransfer(ctx context.Context, q tx.Tx, requestID string) (transferRow, error) {
	t, err := scanTransfer(q.QueryRowContext(ctx, `SELECT `+transferColumns+` FROM attempt_device_transfers WHERE id = ? FOR UPDATE`, requestID))
	if err == sql.ErrNoRows {
		return t, apperrors.New(apperrors.CodeNotFound, "Transfer request not found.")
	}
	return t, err
}

// transferAttemptID resolves the attempt of a request without locking, so the
// caller can take the attempt lock first (lock order: attempt, then request).
func transferAttemptID(ctx context.Context, q tx.Tx, requestID string) (string, error) {
	var attemptID string
	err := q.QueryRowContext(ctx, `SELECT attempt_id FROM attempt_device_transfers WHERE id = ?`, requestID).Scan(&attemptID)
	if err == sql.ErrNoRows {
		return "", apperrors.New(apperrors.CodeNotFound, "Transfer request not found.")
	}
	return attemptID, err
}

func (t transferRow) open() bool {
	return t.State == TransferPending || t.State == TransferApproved
}

// expireIfDue lazily moves a lapsed open request to expired (clearing the
// active marker). Reads never extend expiry. Returns whether it expired.
func expireIfDue(ctx context.Context, q tx.Tx, t *transferRow, now time.Time) (bool, error) {
	due := (t.State == TransferPending && !now.Before(t.ExpiresAt)) ||
		(t.State == TransferApproved && t.ApprovalExpiresAt != nil && !now.Before(*t.ApprovalExpiresAt))
	if !due {
		return false, nil
	}
	if err := setTransferTerminal(ctx, q, t, TransferExpired, now); err != nil {
		return false, err
	}
	telemetry.IncCounter(telemetry.MSATTransferTotal, "action", "expire", "outcome", "expired")
	return true, nil
}

func setTransferTerminal(ctx context.Context, q tx.Tx, t *transferRow, state string, now time.Time) error {
	if _, err := q.ExecContext(ctx, `UPDATE attempt_device_transfers SET state = ?, active_attempt_id = NULL WHERE id = ?`, state, t.RequestID); err != nil {
		return err
	}
	t.State = state
	t.ActiveAttemptID = sql.NullString{}
	return nil
}

func transferError(code apperrors.Code, msg, reason string) *apperrors.Error {
	e := apperrors.New(code, msg)
	if reason != "" {
		e.Details = map[string]any{"reason": reason}
	}
	return e
}

func auditTransfer(ctx context.Context, q tx.Tx, scheduleID, attemptID, actor, action string, payload map[string]any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = q.ExecContext(ctx, `INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
		uuid.NewString(), scheduleID, actor, action, attemptID, string(raw))
	return err
}

var (
	operationIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,64}$`)
	reasonCodePattern  = regexp.MustCompile(`^[a-z0-9_]{1,64}$`)
)

// RequestTransferCommand is a blocked browser's transfer request. The
// requester is the authenticated student session (user + auth session id);
// TargetSessionID is the browser-owned writer identity that would receive
// ownership on commit.
type RequestTransferCommand struct {
	OperationID        string
	AttemptID          string
	ScheduleID         string
	UserID             string
	AuthSessionID      string
	TargetSessionID    string
	ExpectedLeaseEpoch uint64
	ReasonCode         string
}

func (c RequestTransferCommand) hash() string {
	raw, _ := json.Marshal(map[string]any{
		"attemptId": c.AttemptID, "targetSessionId": c.TargetSessionID,
		"expectedLeaseEpoch": c.ExpectedLeaseEpoch, "reasonCode": c.ReasonCode,
	})
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

func (c RequestTransferCommand) validate() error {
	if !operationIDPattern.MatchString(c.OperationID) {
		return apperrors.New(apperrors.CodeValidation, "operationId must be 8-64 URL-safe characters.")
	}
	if err := ValidateAttemptID(c.AttemptID); err != nil {
		return err
	}
	if s := strings.TrimSpace(c.TargetSessionID); s == "" || len(s) > MaxSessionLen {
		return apperrors.New(apperrors.CodeValidation, "clientSessionId is required.")
	}
	if c.ExpectedLeaseEpoch == 0 {
		return apperrors.New(apperrors.CodeValidation, "expectedLeaseEpoch is required.")
	}
	if !reasonCodePattern.MatchString(c.ReasonCode) {
		return apperrors.New(apperrors.CodeValidation, "reasonCode must be a short snake_case code.")
	}
	if c.UserID == "" || c.AuthSessionID == "" {
		return apperrors.New(apperrors.CodeUnauthorized, "A student session is required.")
	}
	return nil
}

// RequestTransfer opens (or returns the identical outstanding) transfer
// request for a blocked browser. It never changes ownership and never grants
// answer access. One outstanding request per attempt: a different target or
// requester conflicts instead of silently replacing it.
func (s *Service) RequestTransfer(ctx context.Context, cmd RequestTransferCommand, pol TransferPolicy) (TransferView, error) {
	if err := cmd.validate(); err != nil {
		return TransferView{}, err
	}
	var out TransferView
	err := s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		res, err := requestTransferInTx(ctx, q, cmd, pol)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	telemetry.IncCounter(telemetry.MSATTransferTotal, "action", "request", "outcome", transferOutcome(out, err))
	return out, err
}

func transferOutcome(v TransferView, err error) string {
	if err != nil {
		if e, ok := apperrors.As(err); ok {
			return strings.ToLower(string(e.Code))
		}
		return "error"
	}
	return v.State
}

func requestTransferInTx(ctx context.Context, q tx.Tx, cmd RequestTransferCommand, pol TransferPolicy) (TransferView, error) {
	row, err := lockOwnershipRow(ctx, q, cmd.AttemptID)
	if err != nil {
		return TransferView{}, err
	}
	if row.ScheduleID != cmd.ScheduleID || !row.UserID.Valid || row.UserID.String != cmd.UserID {
		return TransferView{}, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	now, err := dbTime(ctx, q)
	if err != nil {
		return TransferView{}, err
	}
	hash := cmd.hash()
	requester := RequesterRef{UserID: cmd.UserID, AuthSessionID: cmd.AuthSessionID, ScheduleID: cmd.ScheduleID, ClientSessionID: cmd.TargetSessionID}
	// Idempotent retry by operation id (checked under the attempt lock).
	existing, err := scanTransfer(q.QueryRowContext(ctx, `SELECT `+transferColumns+` FROM attempt_device_transfers WHERE operation_id = ? FOR UPDATE`, cmd.OperationID))
	switch {
	case err == nil:
		if existing.RequestHash != hash || existing.AttemptID != cmd.AttemptID || !requester.owns(existing) {
			return TransferView{}, transferError(apperrors.CodeTransferConflict, "This operation id was already used for a different transfer request.", "operation_reused")
		}
		if _, err := expireIfDue(ctx, q, &existing, now); err != nil {
			return TransferView{}, err
		}
		return existing.TransferView, nil
	case err != sql.ErrNoRows:
		return TransferView{}, err
	}
	if !row.enforced() {
		return TransferView{}, transferError(apperrors.CodeTransferConflict, "Device transfer is not available for this attempt.", "not_single_writer")
	}
	if row.terminal() {
		return TransferView{}, apperrors.New(apperrors.CodeAttemptNotWritable, "Attempt is closed.")
	}
	if row.owner() == cmd.TargetSessionID {
		return TransferView{}, transferError(apperrors.CodeTransferConflict, "This browser already owns the attempt.", "already_owner")
	}
	// Outstanding request for the attempt (the unique active marker).
	active, err := scanTransfer(q.QueryRowContext(ctx, `SELECT `+transferColumns+` FROM attempt_device_transfers WHERE active_attempt_id = ? FOR UPDATE`, cmd.AttemptID))
	switch {
	case err == nil:
		expired, err := expireIfDue(ctx, q, &active, now)
		if err != nil {
			return TransferView{}, err
		}
		if !expired {
			if active.TargetSession == cmd.TargetSessionID && requester.owns(active) {
				return active.TransferView, nil
			}
			return TransferView{}, transferError(apperrors.CodeTransferConflict, "Another device-transfer request is already open for this attempt.", "request_outstanding")
		}
	case err != sql.ErrNoRows:
		return TransferView{}, err
	}
	if !pol.Enabled {
		return TransferView{}, transferError(apperrors.CodeTransferConflict, "Device transfer requests are currently disabled. Ask your proctor for help.", "transfer_disabled")
	}
	if cmd.ExpectedLeaseEpoch != row.LeaseEpoch {
		return TransferView{}, transferError(apperrors.CodeTransferConflict, "The attempt changed owner; reload and try again.", "lease_changed")
	}
	stage, err := policyStage(ctx, q, row.ID)
	if err != nil {
		return TransferView{}, err
	}
	var expectedOwner any
	if o := row.owner(); o != "" {
		expectedOwner = o
	}
	id := uuid.NewString()
	expires := now.Add(pol.requestTTL())
	if _, err := q.ExecContext(ctx, `INSERT INTO attempt_device_transfers (id, operation_id, request_hash, attempt_id, schedule_id, active_attempt_id, requested_by_user_id, requested_by_auth_session_id, target_client_session_id, expected_owner_session_id, expected_lease_epoch, policy_stage, state, reason_code, requested_at, expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
		id, cmd.OperationID, hash, row.ID, row.ScheduleID, row.ID, cmd.UserID, cmd.AuthSessionID, cmd.TargetSessionID, expectedOwner, row.LeaseEpoch, stage, TransferPending, cmd.ReasonCode, now, expires); err != nil {
		if isDup(err) {
			// A concurrent request won the active marker or the operation id.
			return TransferView{}, transferError(apperrors.CodeTransferConflict, "Another device-transfer request is already open for this attempt.", "request_outstanding")
		}
		return TransferView{}, err
	}
	if err := auditTransfer(ctx, q, row.ScheduleID, row.ID, cmd.UserID, "DEVICE_TRANSFER_REQUESTED", map[string]any{
		"requestId": id, "policyStage": stage, "reasonCode": cmd.ReasonCode, "expectedLeaseEpoch": row.LeaseEpoch,
	}); err != nil {
		return TransferView{}, err
	}
	created, err := lockTransfer(ctx, q, id)
	if err != nil {
		return TransferView{}, err
	}
	return created.TransferView, nil
}

// RequesterRef identifies the blocked browser that owns a request: the same
// authenticated student, under the same schedule, presenting either the
// student session that opened the request or the request's target writer
// session (the browser-owned identity survives a re-entry that rotates the
// cookie session).
type RequesterRef struct {
	UserID          string
	AuthSessionID   string
	ScheduleID      string
	ClientSessionID string
}

func (r RequesterRef) owns(t transferRow) bool {
	if r.UserID == "" || t.RequestedByUserID != r.UserID || t.ScheduleID != r.ScheduleID {
		return false
	}
	return (r.AuthSessionID != "" && t.RequestedByAuth == r.AuthSessionID) ||
		(r.ClientSessionID != "" && t.TargetSession == r.ClientSessionID)
}

// TransferStatus returns a request to its requester, applying lazy expiry.
func (s *Service) TransferStatus(ctx context.Context, requestID string, who RequesterRef) (TransferView, error) {
	var out TransferView
	err := s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		attemptID, err := transferAttemptID(ctx, q, requestID)
		if err != nil {
			return err
		}
		if _, err := lockOwnershipRow(ctx, q, attemptID); err != nil {
			return err
		}
		t, err := lockTransfer(ctx, q, requestID)
		if err != nil {
			return err
		}
		if !who.owns(t) {
			return apperrors.New(apperrors.CodeNotFound, "Transfer request not found.")
		}
		now, err := dbTime(ctx, q)
		if err != nil {
			return err
		}
		if _, err := expireIfDue(ctx, q, &t, now); err != nil {
			return err
		}
		out = t.TransferView
		return nil
	})
	return out, err
}

// CancelTransfer lets the requester withdraw an uncommitted request. A
// terminal request is returned unchanged (cancel is idempotent).
func (s *Service) CancelTransfer(ctx context.Context, requestID string, who RequesterRef) (TransferView, error) {
	var out TransferView
	err := s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		attemptID, err := transferAttemptID(ctx, q, requestID)
		if err != nil {
			return err
		}
		if _, err := lockOwnershipRow(ctx, q, attemptID); err != nil {
			return err
		}
		t, err := lockTransfer(ctx, q, requestID)
		if err != nil {
			return err
		}
		if !who.owns(t) {
			return apperrors.New(apperrors.CodeNotFound, "Transfer request not found.")
		}
		now, err := dbTime(ctx, q)
		if err != nil {
			return err
		}
		if _, err := expireIfDue(ctx, q, &t, now); err != nil {
			return err
		}
		if t.open() {
			if err := setTransferTerminal(ctx, q, &t, TransferCancelled, now); err != nil {
				return err
			}
			if err := auditTransfer(ctx, q, t.ScheduleID, t.AttemptID, who.UserID, "DEVICE_TRANSFER_CANCELLED", map[string]any{"requestId": t.RequestID}); err != nil {
				return err
			}
		}
		out = t.TransferView
		return nil
	})
	telemetry.IncCounter(telemetry.MSATTransferTotal, "action", "cancel", "outcome", transferOutcome(out, err))
	return out, err
}

// PendingTransferForWriter returns the open request (if any) for the attempt
// the bearer currently owns, so the authorized browser can confirm or ignore
// it. A stale/non-owner bearer is refused.
func (s *Service) PendingTransferForWriter(ctx context.Context, bearer, attemptID string) (*TransferView, error) {
	claims, err := crypto.VerifyAttemptToken(s.secret, s.clock.Now(), bearer)
	if err != nil || claims.AttemptID != attemptID {
		return nil, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
	}
	var out *TransferView
	err = s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		out = nil
		row, err := lockOwnershipRow(ctx, q, attemptID)
		if err != nil {
			return err
		}
		if err := s.requireCurrentWriter(ctx, q, row, claims); err != nil {
			return err
		}
		t, err := scanTransfer(q.QueryRowContext(ctx, `SELECT `+transferColumns+` FROM attempt_device_transfers WHERE active_attempt_id = ? FOR UPDATE`, attemptID))
		if err == sql.ErrNoRows {
			return nil
		}
		if err != nil {
			return err
		}
		now, err := dbTime(ctx, q)
		if err != nil {
			return err
		}
		if expired, err := expireIfDue(ctx, q, &t, now); err != nil || expired {
			return err
		}
		view := t.TransferView
		out = &view
		return nil
	})
	return out, err
}

// requireCurrentWriter proves the bearer is the live writer: unrevoked token
// row, matching session, current lease.
func (s *Service) requireCurrentWriter(ctx context.Context, q tx.Tx, row ownershipRow, claims crypto.AttemptClaims) error {
	if claims.ScheduleID != row.ScheduleID || !row.UserID.Valid || claims.UserID != row.UserID.String {
		return apperrors.New(apperrors.CodeAttemptTokenInvalid, "Attempt credential mismatch.")
	}
	if err := s.validateTokenSession(ctx, q, claims); err != nil {
		return err
	}
	if row.owner() != claims.ClientSessionID || claims.LeaseEpoch == nil || *claims.LeaseEpoch != row.LeaseEpoch {
		return leaseFenced()
	}
	return nil
}

// ConfirmTransferByWriter is the pre-start self-service approval: the
// currently authorized session confirms handing the attempt to the requested
// target. After any timed module starts, only an assigned proctor approves.
func (s *Service) ConfirmTransferByWriter(ctx context.Context, bearer, requestID string, pol TransferPolicy) (TransferView, error) {
	claims, err := crypto.VerifyAttemptToken(s.secret, s.clock.Now(), bearer)
	if err != nil {
		return TransferView{}, apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid attempt credential.")
	}
	var out TransferView
	err = s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		attemptID, err := transferAttemptID(ctx, q, requestID)
		if err != nil {
			return err
		}
		if claims.AttemptID != attemptID {
			return apperrors.New(apperrors.CodeNotFound, "Transfer request not found.")
		}
		row, err := lockOwnershipRow(ctx, q, attemptID)
		if err != nil {
			return err
		}
		if err := s.requireCurrentWriter(ctx, q, row, claims); err != nil {
			return err
		}
		t, err := lockTransfer(ctx, q, requestID)
		if err != nil {
			return err
		}
		now, err := dbTime(ctx, q)
		if err != nil {
			return err
		}
		if expired, err := expireIfDue(ctx, q, &t, now); err != nil {
			return err
		} else if expired {
			return transferError(apperrors.CodeTransferExpired, "The transfer request expired.", "request_expired")
		}
		if t.State == TransferApproved {
			out = t.TransferView
			return nil
		}
		if t.State != TransferPending {
			return transferError(apperrors.CodeTransferConflict, "The transfer request is no longer open.", t.State)
		}
		if row.terminal() {
			return apperrors.New(apperrors.CodeAttemptNotWritable, "Attempt is closed.")
		}
		stage, err := policyStage(ctx, q, row.ID)
		if err != nil {
			return err
		}
		if stage != StagePreStart {
			return transferError(apperrors.CodeTransferApprovalRequired, "The exam has started; a proctor must approve this device change.", "proctor_required")
		}
		approvalExpires := now.Add(pol.approvalTTL())
		if _, err := q.ExecContext(ctx, `UPDATE attempt_device_transfers SET state = ?, approval_kind = ?, approved_by = ?, approved_at = ?, approval_expires_at = ? WHERE id = ?`,
			TransferApproved, ApprovalCurrentWriter, claims.UserID, now, approvalExpires, t.RequestID); err != nil {
			return err
		}
		if err := auditTransfer(ctx, q, t.ScheduleID, t.AttemptID, claims.UserID, "DEVICE_TRANSFER_APPROVED", map[string]any{"requestId": t.RequestID, "approvalKind": ApprovalCurrentWriter}); err != nil {
			return err
		}
		updated, err := lockTransfer(ctx, q, t.RequestID)
		if err != nil {
			return err
		}
		out = updated.TransferView
		return nil
	})
	telemetry.IncCounter(telemetry.MSATTransferTotal, "action", "confirm", "outcome", transferOutcome(out, err))
	return out, err
}

// ProctorDecision is an assigned proctor's approve/deny. Authorization
// (role + schedule assignment) is enforced by the caller before dispatch.
type ProctorDecision struct {
	RequestID  string
	ScheduleID string
	ActorID    string
	Approve    bool
	Reason     string
	// AcknowledgeUnconfirmedRisk must be true to approve: the old device may
	// hold answers the server never confirmed, and they will not transfer.
	AcknowledgeUnconfirmedRisk bool
}

// DecideTransfer records a proctor approval or denial. Approval is bound to
// the request's target session and expected owner/lease; it changes no
// ownership until the target commits it.
func (s *Service) DecideTransfer(ctx context.Context, d ProctorDecision, pol TransferPolicy) (TransferView, error) {
	if len(d.Reason) > MaxReasonLen || len(d.Reason) > 255 {
		return TransferView{}, apperrors.New(apperrors.CodeValidation, "Reason too long.")
	}
	if d.Approve && !d.AcknowledgeUnconfirmedRisk {
		return TransferView{}, transferError(apperrors.CodeTransferApprovalRequired, "Acknowledge that unconfirmed answers on the old device will not transfer.", "risk_acknowledgement_required")
	}
	var out TransferView
	err := s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		attemptID, err := transferAttemptID(ctx, q, d.RequestID)
		if err != nil {
			return err
		}
		row, err := lockOwnershipRow(ctx, q, attemptID)
		if err != nil {
			return err
		}
		t, err := lockTransfer(ctx, q, d.RequestID)
		if err != nil {
			return err
		}
		if t.ScheduleID != d.ScheduleID || row.ScheduleID != d.ScheduleID {
			return apperrors.New(apperrors.CodeNotFound, "Transfer request not found.")
		}
		now, err := dbTime(ctx, q)
		if err != nil {
			return err
		}
		if expired, err := expireIfDue(ctx, q, &t, now); err != nil {
			return err
		} else if expired {
			return transferError(apperrors.CodeTransferExpired, "The transfer request expired.", "request_expired")
		}
		wantState := TransferDenied
		if d.Approve {
			wantState = TransferApproved
		}
		if t.State == wantState {
			out = t.TransferView // identical retry
			return nil
		}
		if !t.open() {
			return transferError(apperrors.CodeTransferConflict, "The transfer request is no longer open.", t.State)
		}
		if d.Approve {
			if row.terminal() {
				return apperrors.New(apperrors.CodeAttemptNotWritable, "Attempt is closed.")
			}
			approvalExpires := now.Add(pol.approvalTTL())
			if _, err := q.ExecContext(ctx, `UPDATE attempt_device_transfers SET state = ?, approval_kind = ?, approved_by = ?, approved_at = ?, approval_expires_at = ?, unconfirmed_risk_acknowledged = TRUE, decision_reason = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
				TransferApproved, ApprovalProctor, d.ActorID, now, approvalExpires, nullableString(d.Reason), d.ActorID, now, t.RequestID); err != nil {
				return err
			}
		} else {
			if _, err := q.ExecContext(ctx, `UPDATE attempt_device_transfers SET state = ?, active_attempt_id = NULL, decision_reason = ?, decided_by = ?, decided_at = ? WHERE id = ?`,
				TransferDenied, nullableString(d.Reason), d.ActorID, now, t.RequestID); err != nil {
				return err
			}
		}
		action := "DEVICE_TRANSFER_DENIED"
		if d.Approve {
			action = "DEVICE_TRANSFER_APPROVED"
		}
		if err := auditTransfer(ctx, q, t.ScheduleID, t.AttemptID, d.ActorID, action, map[string]any{
			"requestId": t.RequestID, "approvalKind": ApprovalProctor, "policyStage": t.PolicyStage,
			"unconfirmedRiskAcknowledged": d.Approve, "reason": d.Reason,
		}); err != nil {
			return err
		}
		updated, err := lockTransfer(ctx, q, t.RequestID)
		if err != nil {
			return err
		}
		out = updated.TransferView
		return nil
	})
	action := "deny"
	if d.Approve {
		action = "approve"
	}
	telemetry.IncCounter(telemetry.MSATTransferTotal, "action", action, "outcome", transferOutcome(out, err))
	return out, err
}

func nullableString(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// CommitTransferCommand redeems an approved request from the target browser.
type CommitTransferCommand struct {
	RequestID       string
	TargetSessionID string
	Requester       RequesterRef
}

// TransferCommit is the committed (or recovered) transfer with the target's
// fresh writer credential.
type TransferCommit struct {
	Transfer   TransferView
	Admission  Admission
	Recovered  bool
	finalError error
}

// IssuerForAttempt builds the credential issuer once the transaction has
// resolved which attempt a request belongs to.
type IssuerForAttempt func(attemptID string) CredentialIssuer

// CommitTransfer atomically moves ownership to the approved target: lease
// increments, the target becomes the active session, every other attempt
// session is revoked, the credential is issued, and the request is marked
// committed — all in one transaction. A committed request recovers its
// credential only while the target still owns the resulting lease; it can
// never reclaim ownership after a later transfer.
func (s *Service) CommitTransfer(ctx context.Context, cmd CommitTransferCommand, issuerFor IssuerForAttempt) (TransferCommit, error) {
	if s := strings.TrimSpace(cmd.TargetSessionID); s == "" || len(s) > MaxSessionLen {
		return TransferCommit{}, apperrors.New(apperrors.CodeValidation, "clientSessionId is required.")
	}
	var out TransferCommit
	err := s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		res, err := commitTransferInTx(ctx, q, cmd, issuerFor)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err == nil && out.finalError != nil {
		// The refusal's state change (conflicted/expired) committed above.
		err = out.finalError
	}
	outcome := transferOutcome(out.Transfer, err)
	if err == nil && out.Recovered {
		outcome = "recovered"
	}
	telemetry.IncCounter(telemetry.MSATTransferTotal, "action", "commit", "outcome", outcome)
	if err != nil {
		return TransferCommit{Transfer: out.Transfer}, err
	}
	return out, nil
}

func commitTransferInTx(ctx context.Context, q tx.Tx, cmd CommitTransferCommand, issuerFor IssuerForAttempt) (TransferCommit, error) {
	attemptID, err := transferAttemptID(ctx, q, cmd.RequestID)
	if err != nil {
		return TransferCommit{}, err
	}
	row, err := lockOwnershipRow(ctx, q, attemptID)
	if err != nil {
		return TransferCommit{}, err
	}
	t, err := lockTransfer(ctx, q, cmd.RequestID)
	if err != nil {
		return TransferCommit{}, err
	}
	if !cmd.Requester.owns(t) || t.TargetSession != cmd.TargetSessionID {
		return TransferCommit{}, apperrors.New(apperrors.CodeNotFound, "Transfer request not found.")
	}
	now, err := dbTime(ctx, q)
	if err != nil {
		return TransferCommit{}, err
	}
	admission := Admission{AttemptID: row.ID, ClientSessionID: t.TargetSession, SingleWriter: true, Outcome: AdmissionAuthorized}
	if t.State == TransferCommitted {
		// Receipt recovery: only while this target still owns that lease.
		if t.ResultingLeaseEpoch == nil || row.owner() != t.TargetSession || row.LeaseEpoch != *t.ResultingLeaseEpoch || row.terminal() {
			return TransferCommit{Transfer: t.TransferView}, transferError(apperrors.CodeTransferConflict, "This transfer was superseded by a later ownership change.", "superseded")
		}
		admission.LeaseEpoch = row.LeaseEpoch
		admission.PolicyStage, err = policyStage(ctx, q, row.ID)
		if err != nil {
			return TransferCommit{}, err
		}
		if issuerFor != nil {
			admission.Token, admission.ExpiresAt, err = issuerFor(row.ID)(ctx, q, row.LeaseEpoch)
			if err != nil {
				return TransferCommit{}, err
			}
		}
		return TransferCommit{Transfer: t.TransferView, Admission: admission, Recovered: true}, nil
	}
	if expired, err := expireIfDue(ctx, q, &t, now); err != nil {
		return TransferCommit{}, err
	} else if expired {
		return TransferCommit{Transfer: t.TransferView, finalError: transferError(apperrors.CodeTransferExpired, "The transfer approval expired. Request again.", "approval_expired")}, nil
	}
	switch t.State {
	case TransferPending:
		return TransferCommit{Transfer: t.TransferView}, transferError(apperrors.CodeTransferApprovalRequired, "The transfer has not been approved yet.", "awaiting_approval")
	case TransferApproved:
	default:
		return TransferCommit{Transfer: t.TransferView}, transferError(apperrors.CodeTransferConflict, "The transfer request is no longer open.", t.State)
	}
	conflict := func(reason, msg string, code apperrors.Code) (TransferCommit, error) {
		if err := setTransferTerminal(ctx, q, &t, TransferConflicted, now); err != nil {
			return TransferCommit{}, err
		}
		if err := auditTransfer(ctx, q, t.ScheduleID, t.AttemptID, cmd.Requester.UserID, "DEVICE_TRANSFER_CONFLICTED", map[string]any{"requestId": t.RequestID, "reason": reason}); err != nil {
			return TransferCommit{}, err
		}
		return TransferCommit{Transfer: t.TransferView, finalError: transferError(code, msg, reason)}, nil
	}
	if row.terminal() {
		return conflict("attempt_closed", "The attempt is closed.", apperrors.CodeTransferConflict)
	}
	expectedOwner := ""
	if t.ExpectedOwner.Valid {
		expectedOwner = t.ExpectedOwner.String
	}
	if row.LeaseEpoch != t.ExpectedLeaseEpoch || row.owner() != expectedOwner {
		return conflict("lease_changed", "The attempt changed owner after approval; request again.", apperrors.CodeTransferConflict)
	}
	if t.ApprovalKind != nil && *t.ApprovalKind == ApprovalCurrentWriter {
		stage, err := policyStage(ctx, q, row.ID)
		if err != nil {
			return TransferCommit{}, err
		}
		if stage != StagePreStart {
			return conflict("proctor_required", "The exam started before this transfer completed; a proctor must approve it.", apperrors.CodeTransferApprovalRequired)
		}
	}
	newLease := row.LeaseEpoch + 1
	if newLease == 0 {
		return TransferCommit{}, apperrors.New(apperrors.CodeBadRequest, "Lease epoch overflow.")
	}
	if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET lease_epoch = ?, active_client_session_id = ?, revision = revision + 1 WHERE id = ?`, newLease, t.TargetSession, row.ID); err != nil {
		return TransferCommit{}, err
	}
	if _, err := q.ExecContext(ctx, `UPDATE attempt_sessions SET revoked_at = ?, revocation_reason = 'device_transfer' WHERE attempt_id = ? AND client_session_id <> ? AND revoked_at IS NULL`, now, row.ID, t.TargetSession); err != nil {
		return TransferCommit{}, err
	}
	if _, err := q.ExecContext(ctx, `UPDATE attempt_device_transfers SET state = ?, active_attempt_id = NULL, resulting_lease_epoch = ?, committed_at = ? WHERE id = ?`, TransferCommitted, newLease, now, t.RequestID); err != nil {
		return TransferCommit{}, err
	}
	if err := auditTransfer(ctx, q, t.ScheduleID, t.AttemptID, cmd.Requester.UserID, "DEVICE_TRANSFER_COMMITTED", map[string]any{
		"requestId": t.RequestID, "approvalKind": t.ApprovalKind, "fromLeaseEpoch": row.LeaseEpoch, "toLeaseEpoch": newLease,
	}); err != nil {
		return TransferCommit{}, err
	}
	admission.LeaseEpoch = newLease
	admission.PolicyStage, err = policyStage(ctx, q, row.ID)
	if err != nil {
		return TransferCommit{}, err
	}
	if issuerFor != nil {
		admission.Token, admission.ExpiresAt, err = issuerFor(row.ID)(ctx, q, newLease)
		if err != nil {
			return TransferCommit{}, err
		}
	}
	committed, err := lockTransfer(ctx, q, t.RequestID)
	if err != nil {
		return TransferCommit{}, err
	}
	return TransferCommit{Transfer: committed.TransferView, Admission: admission}, nil
}

// ProctorTransferItem is one open request in a proctor's review queue.
type ProctorTransferItem struct {
	TransferView
	CandidateID      string     `json:"candidateId"`
	CandidateName    string     `json:"candidateName"`
	LastServerSaveAt *time.Time `json:"lastServerSaveAt"`
}

// ListOpenTransfers returns pending/approved requests for one schedule
// (lazy expiry is applied on the next locked transition; expired-but-unswept
// rows are filtered by time here).
func (s *Service) ListOpenTransfers(ctx context.Context, q interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}, scheduleID string) ([]ProctorTransferItem, error) {
	rows, err := q.QueryContext(ctx, `SELECT `+prefixed("t.", transferColumns)+`, a.candidate_id, a.candidate_name, (SELECT MAX(r.updated_at) FROM attempt_responses_v2 r WHERE r.attempt_id = t.attempt_id)
		FROM attempt_device_transfers t JOIN student_attempts a ON a.id = t.attempt_id
		WHERE t.schedule_id = ? AND t.state IN ('pending', 'approved')
		  AND ((t.state = 'pending' AND t.expires_at > UTC_TIMESTAMP(6)) OR (t.state = 'approved' AND t.approval_expires_at > UTC_TIMESTAMP(6)))
		ORDER BY t.requested_at ASC LIMIT 200`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []ProctorTransferItem{}
	for rows.Next() {
		var item ProctorTransferItem
		var lastSave sql.NullTime
		scanner := rowScanner{rows: rows, extra: []any{&item.CandidateID, &item.CandidateName, &lastSave}}
		t, err := scanTransfer(scanner)
		if err != nil {
			return nil, err
		}
		item.TransferView = t.TransferView
		item.LastServerSaveAt = nullTimePtr(lastSave)
		out = append(out, item)
	}
	return out, rows.Err()
}

type rowScanner struct {
	rows  *sql.Rows
	extra []any
}

func (r rowScanner) Scan(dest ...any) error {
	return r.rows.Scan(append(dest, r.extra...)...)
}

func prefixed(prefix, cols string) string {
	parts := strings.Split(cols, ",")
	for i, p := range parts {
		parts[i] = prefix + strings.TrimSpace(p)
	}
	return strings.Join(parts, ", ")
}

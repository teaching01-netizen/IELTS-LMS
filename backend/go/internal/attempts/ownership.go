package attempts

import (
	"context"
	"database/sql"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// WriterPolicySATSingleWriter is the ownership policy snapshotted onto a SAT
// attempt by its first admission claim (student_attempts.writer_policy). An
// attempt carrying it keeps one authorized writer session and refuses
// competing entry even if the deployment flag is later disabled.
const WriterPolicySATSingleWriter = "sat_single_writer_v1"

// AdmissionOutcome is the result of one admission decision.
type AdmissionOutcome string

const (
	// AdmissionAuthorized: this session owns (or just claimed) the attempt and
	// receives a writer credential at the authoritative lease.
	AdmissionAuthorized AdmissionOutcome = "authorized"
	// AdmissionBlocked: another session owns the attempt. No credential, no
	// protected content; the browser may request a device transfer.
	AdmissionBlocked AdmissionOutcome = "blocked"
	// AdmissionClosed: the attempt is terminal. The credential only reads the
	// closed attempt (every write path refuses terminal attempts).
	AdmissionClosed AdmissionOutcome = "closed"
)

// Transfer policy stages (attempt_device_transfers.policy_stage).
const (
	StagePreStart  = "pre_start"
	StagePostStart = "post_start"
)

// AdmitCommand asks for writer authority for one browser-owned session.
type AdmitCommand struct {
	AttemptID       string
	UserID          string
	ClientSessionID string
	// SingleWriterEnabled is the deployment flag. It only decides whether a
	// NEW claim snapshots the policy; an already-snapshotted attempt stays
	// enforced either way.
	SingleWriterEnabled bool
}

// CredentialIssuer persists the attempt_sessions row and signs the bearer
// inside the admission transaction, so the credential commits atomically
// with the ownership decision it was issued for.
type CredentialIssuer func(ctx context.Context, q tx.Tx, lease uint64) (token string, expiresAt time.Time, err error)

// Admission is the committed admission decision.
type Admission struct {
	Outcome         AdmissionOutcome `json:"outcome"`
	AttemptID       string           `json:"attemptId"`
	ClientSessionID string           `json:"-"`
	LeaseEpoch      uint64           `json:"leaseEpoch"`
	// SingleWriter reports whether the attempt is under the single-writer
	// policy (only then can entry be blocked or a transfer be requested).
	SingleWriter bool `json:"singleWriter"`
	// PolicyStage is pre_start until any timed module starts.
	PolicyStage string    `json:"policyStage,omitempty"`
	Token       string    `json:"-"`
	ExpiresAt   time.Time `json:"-"`
}

// ownershipRow is the locked student_attempts subset ownership decisions need.
type ownershipRow struct {
	ID             string
	ScheduleID     string
	UserID         sql.NullString
	DeliveryStatus string
	Phase          string
	SubmittedAt    sql.NullTime
	ProctorStatus  string
	ActiveSession  sql.NullString
	LeaseEpoch     uint64
	WriterPolicy   sql.NullString
	ProviderKey    string
}

func (r ownershipRow) owner() string {
	if !r.ActiveSession.Valid {
		return ""
	}
	return strings.TrimSpace(r.ActiveSession.String)
}

// terminal reports a closed attempt: no ownership change or new writer.
func (r ownershipRow) terminal() bool {
	switch r.DeliveryStatus {
	case "submitted", "terminated", "locked", "cancelled":
		return true
	}
	return r.Phase == "post-exam" || r.SubmittedAt.Valid || r.ProctorStatus == "terminated"
}

func (r ownershipRow) enforced() bool {
	return r.WriterPolicy.Valid && r.WriterPolicy.String == WriterPolicySATSingleWriter
}

// lockOwnershipRow takes the attempt row lock that serializes admission,
// transfer, saves, submit, and module start for this attempt. Provider is a
// non-locking subquery (a locking read does not lock rows of a nested
// subquery), so one attempt never exclusively locks a room-wide row.
func lockOwnershipRow(ctx context.Context, q tx.Tx, attemptID string) (ownershipRow, error) {
	var r ownershipRow
	var delivery, phase, proctor sql.NullString
	err := q.QueryRowContext(ctx, `SELECT id, schedule_id, user_id, delivery_status, phase, submitted_at, proctor_status, active_client_session_id, lease_epoch, writer_policy, COALESCE((SELECT provider_key FROM exam_entities WHERE id = student_attempts.exam_id), '') FROM student_attempts WHERE id = ? FOR UPDATE`, attemptID).
		Scan(&r.ID, &r.ScheduleID, &r.UserID, &delivery, &phase, &r.SubmittedAt, &proctor, &r.ActiveSession, &r.LeaseEpoch, &r.WriterPolicy, &r.ProviderKey)
	if err == sql.ErrNoRows {
		return r, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	if err != nil {
		return r, err
	}
	r.DeliveryStatus = delivery.String
	r.Phase = phase.String
	r.ProctorStatus = proctor.String
	if r.ProctorStatus == "" {
		r.ProctorStatus = "active"
	}
	return r, nil
}

// policyStage reports pre_start until any timed module of the attempt has
// started. The module rows are read FOR SHARE after the attempt lock: a
// concurrent module start either committed first (visible here) or waits for
// this transaction, so a pre-start decision cannot commit across a start.
func policyStage(ctx context.Context, q tx.Tx, attemptID string) (string, error) {
	rows, err := q.QueryContext(ctx, `SELECT started_at FROM assessment_module_attempts WHERE attempt_id = ? FOR SHARE`, attemptID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	started := false
	for rows.Next() {
		var at sql.NullTime
		if err := rows.Scan(&at); err != nil {
			return "", err
		}
		if at.Valid {
			started = true
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if started {
		return StagePostStart, nil
	}
	return StagePreStart, nil
}

// Admit is the single admission boundary for writer credentials (entry,
// session bootstrap, credential refresh). In one transaction it locks the
// attempt, decides authorized/blocked/closed, and — only for authorized or
// closed — issues the credential at the authoritative lease (never a
// hardcoded epoch). Non-SAT attempts and SAT attempts admitted while the
// policy is disabled keep the legacy behaviour (credential for any session at
// the current lease; first write claims the writer slot).
func (s *Service) Admit(ctx context.Context, cmd AdmitCommand, issue CredentialIssuer) (Admission, error) {
	if err := ValidateAttemptID(cmd.AttemptID); err != nil {
		return Admission{}, err
	}
	session := strings.TrimSpace(cmd.ClientSessionID)
	if session == "" || len(session) > MaxSessionLen {
		return Admission{}, apperrors.New(apperrors.CodeValidation, "clientSessionId is required.")
	}
	var out Admission
	err := s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		res, err := admitInTx(ctx, q, cmd, session, issue)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	if err == nil {
		telemetry.IncCounter(telemetry.MSATAdmissionTotal, "outcome", string(out.Outcome))
	}
	return out, err
}

func admitInTx(ctx context.Context, q tx.Tx, cmd AdmitCommand, session string, issue CredentialIssuer) (Admission, error) {
	row, err := lockOwnershipRow(ctx, q, cmd.AttemptID)
	if err != nil {
		return Admission{}, err
	}
	enforced := row.enforced()
	claimable := !enforced && cmd.SingleWriterEnabled && row.ProviderKey == string(ProviderSAT)
	// Identity ownership is independent of the single-writer rollout. Public
	// codes and profile fields cannot claim a historical, unbound attempt.
	if strings.TrimSpace(cmd.UserID) == "" {
		return Admission{}, apperrors.New(apperrors.CodeUnauthorized, "An authenticated student principal is required.")
	}
	if row.UserID.Valid && row.UserID.String != "" && row.UserID.String != cmd.UserID {
		return Admission{}, apperrors.New(apperrors.CodeForbidden, "This student ID is checked in with a different account.")
	}
	if !row.UserID.Valid || row.UserID.String == "" {
		var registrationUser, registrationActor sql.NullString
		err := q.QueryRowContext(ctx, `SELECT sr.user_id, sr.actor_id FROM schedule_registrations sr JOIN student_attempts sa ON sa.registration_id = sr.id AND sa.schedule_id = sr.schedule_id WHERE sa.id = ? FOR SHARE`, row.ID).Scan(&registrationUser, &registrationActor)
		if err != nil && err != sql.ErrNoRows {
			return Admission{}, err
		}
		if err == sql.ErrNoRows || !((registrationUser.Valid && registrationUser.String == cmd.UserID) || (registrationActor.Valid && registrationActor.String == cmd.UserID)) {
			return Admission{}, apperrors.New(apperrors.CodeForbidden, "This sitting has no verified ownership association.")
		}
		if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = '')`, cmd.UserID, row.ID); err != nil {
			return Admission{}, err
		}
	}
	out := Admission{AttemptID: row.ID, ClientSessionID: session, LeaseEpoch: row.LeaseEpoch, SingleWriter: enforced || claimable}
	switch {
	case row.terminal():
		out.Outcome = AdmissionClosed
	case !enforced && !claimable:
		out.Outcome = AdmissionAuthorized
	case row.owner() == "":
		// Unowned writable attempt: claim it and snapshot the policy.
		if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET active_client_session_id = ?, writer_policy = ?, revision = revision + 1 WHERE id = ?`, session, WriterPolicySATSingleWriter, row.ID); err != nil {
			return Admission{}, err
		}
		out.SingleWriter = true
		out.Outcome = AdmissionAuthorized
	case row.owner() == session:
		if claimable {
			if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET writer_policy = ? WHERE id = ? AND writer_policy IS NULL`, WriterPolicySATSingleWriter, row.ID); err != nil {
				return Admission{}, err
			}
		}
		out.Outcome = AdmissionAuthorized
	default:
		if claimable {
			// The owner predates the policy (it claimed through a first write).
			// Snapshot now so the competing session stays blocked.
			if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET writer_policy = ? WHERE id = ? AND writer_policy IS NULL`, WriterPolicySATSingleWriter, row.ID); err != nil {
				return Admission{}, err
			}
		}
		out.Outcome = AdmissionBlocked
	}
	if out.SingleWriter {
		stage, err := policyStage(ctx, q, row.ID)
		if err != nil {
			return Admission{}, err
		}
		out.PolicyStage = stage
	}
	if out.Outcome == AdmissionBlocked || issue == nil {
		return out, nil
	}
	token, expiresAt, err := issue(ctx, q, row.LeaseEpoch)
	if err != nil {
		return Admission{}, err
	}
	out.Token, out.ExpiresAt = token, expiresAt
	return out, nil
}

// WriterPolicyOf reports whether an attempt is under the single-writer
// policy and its current owner session. Read-side callers use it to withhold
// writer identities and protected content from non-owner browsers.
func WriterPolicyOf(ctx context.Context, q interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}, attemptID string) (enforced bool, owner string, err error) {
	var policy, active sql.NullString
	err = q.QueryRowContext(ctx, `SELECT writer_policy, active_client_session_id FROM student_attempts WHERE id = ?`, attemptID).Scan(&policy, &active)
	if err == sql.ErrNoRows {
		return false, "", nil
	}
	if err != nil {
		return false, "", err
	}
	return policy.Valid && policy.String == WriterPolicySATSingleWriter, strings.TrimSpace(active.String), nil
}

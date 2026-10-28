package attempts

// Writer authority for staff-assisted device recovery.
//
// The recovery control is attempt-owned and independent of the SAT
// single-writer policy: a held IELTS or ACT attempt must refuse ordinary
// admission just as firmly as a SAT one. This file is the only place that
// interprets the control for writer authority. Delivery owns grant
// lifecycle; runtime owns clocks; terminalization owns completion history.
//
// Lock order is unchanged: callers take the student_attempts row lock before
// any helper here. The helpers never take a room-wide lock.

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"fmt"
	"strings"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Recovery authority errors. Delivery maps them onto the shared error
// envelope; they are not new base error codes.
var (
	ErrNoRecoveryControl    = errors.New("attempts: no recovery control")
	ErrRecoveryHeld         = errors.New("attempts: recovery hold refuses ordinary writer authority")
	ErrRecoveryFocus        = errors.New("attempts: recovery writer is not the focused target")
	ErrRecoveryRunStale     = errors.New("attempts: recovery run generation is stale")
	ErrRecoveryControlState = errors.New("attempts: recovery control is not in a fenceable state")
)

// RecoveryAuthority is the attempt-owned projection every trusted entry
// boundary reads. It deliberately carries no answer data.
type RecoveryAuthority struct {
	Control            *examdomain.RecoveryControl
	ActiveSessionID    string
	LeaseEpoch         uint64
	ControlEpoch       uint64
	TerminalGeneration uint64
	WriterPolicy       string
}

// Held reports whether the attempt is fenced with no authorized writer.
func (a RecoveryAuthority) Held() bool {
	return a.Control != nil && a.Control.Phase != examdomain.RecoveryPhaseWorking
}

// Working reports whether a focused recovery writer is active.
func (a RecoveryAuthority) Working() bool {
	return a.Control != nil && a.Control.Phase == examdomain.RecoveryPhaseWorking
}

const recoveryAuthorityColumns = `COALESCE(recovery_control, ''), active_client_session_id, lease_epoch, control_epoch, terminal_generation, COALESCE(writer_policy, '')`

func scanRecoveryAuthority(row interface{ Scan(dest ...any) error }) (RecoveryAuthority, error) {
	var raw sql.NullString
	var active, policy sql.NullString
	var authority RecoveryAuthority
	if err := row.Scan(&raw, &active, &authority.LeaseEpoch, &authority.ControlEpoch, &authority.TerminalGeneration, &policy); err != nil {
		return RecoveryAuthority{}, err
	}
	control, err := examdomain.ParseRecoveryControl([]byte(raw.String))
	if err != nil {
		return RecoveryAuthority{}, err
	}
	authority.Control = control
	authority.ActiveSessionID = strings.TrimSpace(active.String)
	authority.WriterPolicy = strings.TrimSpace(policy.String)
	return authority, nil
}

// ReadRecoveryAuthority reads the control without locking. Callers use it on
// read paths; write paths call it after lockAttempt/lockOwnershipRow so the
// value cannot change underneath the decision.
func ReadRecoveryAuthority(ctx context.Context, q tx.Tx, attemptID string) (RecoveryAuthority, error) {
	authority, err := scanRecoveryAuthority(q.QueryRowContext(ctx,
		`SELECT `+recoveryAuthorityColumns+` FROM student_attempts WHERE id = ?`, attemptID))
	if err == sql.ErrNoRows {
		return RecoveryAuthority{}, fmt.Errorf("attempts: attempt %s not found", attemptID)
	}
	return authority, err
}

// FenceForRecoveryInTx is the issue/restore fence. It must run after the
// attempt row lock and in the same transaction as the grant insert, so a
// failure anywhere rolls the whole transfer back.
//
// The control must already describe the committed destination phase
// (normally held, or returning for restore). The fence:
//   - persists the new control,
//   - clears the writer slot,
//   - advances lease and control epochs exactly once,
//   - revokes every live attempt credential with the transfer reason,
//   - cancels any open student-originated transfer request (staff recovery
//     supersedes it).
//
// It never sets revoked_at back to NULL and never resurrects a bearer.
func FenceForRecoveryInTx(ctx context.Context, q tx.Tx, attemptID string, control examdomain.RecoveryControl) (leaseEpoch, controlEpoch uint64, err error) {
	if err := control.Validate(); err != nil {
		return 0, 0, err
	}
	switch control.Phase {
	case examdomain.RecoveryPhaseHeld, examdomain.RecoveryPhaseReturning:
	default:
		return 0, 0, fmt.Errorf("%w: phase %q", ErrRecoveryControlState, control.Phase)
	}
	raw, err := json.Marshal(control)
	if err != nil {
		return 0, 0, err
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE student_attempts
		SET recovery_control = ?,
		    active_client_session_id = NULL,
		    lease_epoch = lease_epoch + 1,
		    control_epoch = control_epoch + 1,
		    revision = revision + 1,
		    updated_at = UTC_TIMESTAMP(6)
		WHERE id = ?`, string(raw), attemptID); err != nil {
		return 0, 0, err
	}
	if err := q.QueryRowContext(ctx,
		`SELECT lease_epoch, control_epoch FROM student_attempts WHERE id = ?`, attemptID).
		Scan(&leaseEpoch, &controlEpoch); err != nil {
		return 0, 0, err
	}
	// Every credential minted for the old writer loses authority immediately.
	// The existing V2 save gate returns LEASE_FENCED for this reason, which is
	// the signal the old browser needs to stop and preserve local drafts.
	if _, err := q.ExecContext(ctx, `
		UPDATE attempt_sessions
		SET revoked_at = UTC_TIMESTAMP(6), revocation_reason = 'device_transfer'
		WHERE attempt_id = ? AND revoked_at IS NULL`, attemptID); err != nil {
		return 0, 0, err
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE attempt_device_transfers
		SET state = 'cancelled', active_attempt_id = NULL,
		    decided_at = COALESCE(decided_at, UTC_TIMESTAMP(6)),
		    updated_at = UTC_TIMESTAMP(6)
		WHERE attempt_id = ? AND state IN ('pending', 'approved')`, attemptID); err != nil {
		return 0, 0, err
	}
	return leaseEpoch, controlEpoch, nil
}

// ActivateRecoveryInTx turns a claimed grant into working authority. It runs
// after Begin has applied the provider clock and before credentials are
// minted, inside the same transaction. The helper:
//   - persists the working control and its frozen successor plan,
//   - binds the new browser's client-session identity,
//   - advances lease and control epochs exactly once,
//   - revokes every previously live attempt credential.
//
// It never clears revoked_at and never resurrects an old bearer.
func ActivateRecoveryInTx(ctx context.Context, q tx.Tx, attemptID, clientSessionID string, control examdomain.RecoveryControl) (leaseEpoch, controlEpoch uint64, err error) {
	attemptID = strings.TrimSpace(attemptID)
	clientSessionID = strings.TrimSpace(clientSessionID)
	if attemptID == "" || clientSessionID == "" {
		return 0, 0, fmt.Errorf("%w: attempt and client session are required", ErrRecoveryControlState)
	}
	if err := control.Validate(); err != nil {
		return 0, 0, err
	}
	if control.Phase != examdomain.RecoveryPhaseWorking {
		return 0, 0, fmt.Errorf("%w: phase %q", ErrRecoveryControlState, control.Phase)
	}
	raw, err := json.Marshal(control)
	if err != nil {
		return 0, 0, err
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE student_attempts
		SET recovery_control = ?,
		    active_client_session_id = ?,
		    lease_epoch = lease_epoch + 1,
		    control_epoch = control_epoch + 1,
		    revision = revision + 1,
		    updated_at = UTC_TIMESTAMP(6)
		WHERE id = ?`, string(raw), clientSessionID, attemptID); err != nil {
		return 0, 0, err
	}
	if err := q.QueryRowContext(ctx,
		`SELECT lease_epoch, control_epoch FROM student_attempts WHERE id = ?`, attemptID).
		Scan(&leaseEpoch, &controlEpoch); err != nil {
		return 0, 0, err
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE attempt_sessions
		SET revoked_at = UTC_TIMESTAMP(6), revocation_reason = 'device_recovery'
		WHERE attempt_id = ? AND revoked_at IS NULL`, attemptID); err != nil {
		return 0, 0, err
	}
	return leaseEpoch, controlEpoch, nil
}

// AuthorizeRecoveryFocus validates that one browser may write the one stage a
// working recovery focuses, at the current run generation. Owner equality is
// enforced separately against the locked attempt row.
func AuthorizeRecoveryFocus(control *examdomain.RecoveryControl, sessionID string, target examdomain.RecoveryTarget, runGeneration uint64) error {
	if control == nil {
		return ErrNoRecoveryControl
	}
	if control.Phase != examdomain.RecoveryPhaseWorking {
		return ErrRecoveryHeld
	}
	if strings.TrimSpace(sessionID) == "" || !control.Target.Equal(target) {
		return ErrRecoveryFocus
	}
	if control.FocusRunGeneration != runGeneration {
		return ErrRecoveryRunStale
	}
	return nil
}

// RecoveryControlFromRow parses the raw JSON of one locked attempt row. The
// helper exists for callers that already selected the column and do not need
// the rest of RecoveryAuthority.
func RecoveryControlFromRow(raw []byte) (*examdomain.RecoveryControl, error) {
	return examdomain.ParseRecoveryControl(raw)
}

// ensureRecoveryWritable consumes the same focused deadline used by runtime
// projections, independent of the room cursor. Administrative room stops and
// pauses retain authority; only natural expiry can be continued individually.
func ensureRecoveryWritable(a AttemptState, gate RuntimeGate, now time.Time) error {
	c := a.RecoveryControl
	if c == nil || c.Phase != examdomain.RecoveryPhaseWorking {
		return leaseFenced()
	}
	if gate.Status != "" && gate.Status != "live" && !(gate.Status == "completed" && gate.CompletionReason == "time_expired") {
		return &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, HTTPStatus: 422, Message: "Exam runtime is not live."}
	}
	if c.FocusDeadlineAt == nil || !now.Before(*c.FocusDeadlineAt) {
		return &apperrors.Error{Code: apperrors.CodeDeadlineExpired, HTTPStatus: 422, Message: "Recovery deadline has passed."}
	}
	return nil
}

func ensureRecoveryQuestion(a AttemptState, owner QuestionOwner, questionID string) error {
	c := a.RecoveryControl
	if c == nil || c.Phase != examdomain.RecoveryPhaseWorking || owner.SectionKey != c.Target.SectionKey || (c.Target.ModuleID != "" && owner.ModuleID != c.Target.ModuleID) {
		return moduleRejection(apperrors.CodeAttemptNotWritable, "Only the recovery stage can be worked on.", "RECOVERY_FOCUS", questionID, owner.ModuleID)
	}
	return nil
}

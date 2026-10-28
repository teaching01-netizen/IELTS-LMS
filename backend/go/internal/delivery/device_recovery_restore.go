package delivery

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"

	"example.com/ielts-proctoring/internal/attempts"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	platformcrypto "example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

type RestoreOriginalDeviceRequest struct {
	OperationID          string `json:"operationId"`
	ExpectedLeaseEpoch   uint64 `json:"expectedLeaseEpoch"`
	ExpectedControlEpoch uint64 `json:"expectedControlEpoch"`
}

// RestoreOriginalDevice designates the original browser; it never resurrects
// its revoked token or authorizes its old offline queue. That browser must
// prove its original signed binding and explicitly Continue with a new ID.
func (s *Service) RestoreOriginalDevice(ctx context.Context, scheduleID, attemptID, actorID string, req RestoreOriginalDeviceRequest) (*DeviceRecoveryOptions, error) {
	if !recoveryOperationIDPattern.MatchString(req.OperationID) || strings.TrimSpace(actorID) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "A stable operation ID is required.")
	}
	if !s.recoverySecretsReady() {
		return nil, recoveryUnavailable("RECOVERY_UNAVAILABLE", "Recovery is unavailable.")
	}
	random, err := platformcrypto.NewRecoveryLinkSecret()
	if err != nil {
		return nil, err
	}
	grantID := uuid.NewString()
	encoded, _ := json.Marshal(struct {
		Action, Attempt string
		Request         RestoreOriginalDeviceRequest
	}{"restore_original", attemptID, req})
	sum := sha256.Sum256(encoded)
	requestHash := hex.EncodeToString(sum[:])
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		row, err := loadRecoveryAttempt(ctx, q, scheduleID, attemptID, true)
		if err != nil {
			return err
		}
		now, err := dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		prior, err := loadRecoveryGrantByOperation(ctx, q, req.OperationID)
		if err != nil {
			return err
		}
		if prior != nil {
			if prior.AttemptID != attemptID || prior.ScheduleID != scheduleID || prior.IssuedByUserID != actorID || prior.RequestHash != requestHash {
				return recoveryConflict("OPERATION_ID_CONFLICT", "This operation belongs to a different recovery decision.", nil)
			}
			if row.Control == nil || row.Control.ActiveGrantID != prior.ID {
				return recoveryConflict("RECOVERY_SUPERSEDED", "The restore decision was superseded.", nil)
			}
			return nil
		}
		if row.LeaseEpoch != req.ExpectedLeaseEpoch || row.ControlEpoch != req.ExpectedControlEpoch {
			return recoveryConflict("RECOVERY_STALE", "The sitting changed. Refresh before restoring the original device.", nil)
		}
		if row.Control == nil || row.Control.OriginalSessionID == "" {
			return recoveryConflict("RECOVERY_INELIGIBLE", "The original browser has no recoverable binding. Issue a new QR and code.", nil)
		}
		facts, err := s.loadRecoveryTargetFacts(ctx, q, row, now)
		if err != nil {
			return err
		}
		target, ok := matchRecoveryTarget(facts, row.ProviderKey, row.Control.Target)
		if !ok {
			return recoveryConflict("RECOVERY_INELIGIBLE", "The original stage is unavailable.", nil)
		}
		reason, err := loadRecoveryReceiptReason(ctx, q, row.ID, row.TerminalGeneration)
		if err != nil {
			return err
		}
		if eligibility := classifyRecoveryTarget(row, reason, target); !eligibility.Eligible {
			return recoveryConflict(eligibility.Reason, recoveryIneligibleMessage(eligibility.Reason), nil)
		}
		previous, err := loadLatestRecoveryGrant(ctx, q, attemptID)
		if err != nil {
			return err
		}
		var award *int
		if previous != nil && previous.StartedAt == nil {
			award = previous.RequestedRemainingSeconds
		}
		if _, err := supersedeRecoveryGrants(ctx, q, attemptID, now); err != nil {
			return err
		}
		if previous != nil {
			if _, err := q.ExecContext(ctx, `UPDATE attempt_device_recovery_grants SET state='restored',restored_at=?,restored_by=?,updated_at=UTC_TIMESTAMP(6) WHERE id=? AND state='replaced'`, now, actorID, previous.ID); err != nil {
				return err
			}
		}
		c := *row.Control
		c.Phase = examdomain.RecoveryPhaseReturning
		c.ActiveGrantID = grantID
		lease, epoch, err := attempts.FenceForRecoveryInTx(ctx, q, attemptID, c)
		if err != nil {
			return err
		}
		_, err = q.ExecContext(ctx, `INSERT INTO attempt_device_recovery_grants (id,attempt_id,schedule_id,issued_by_user_id,operation_id,request_hash,active_attempt_id,state,target_section_key,target_module_attempt_id,target_module_id,requested_remaining_seconds,expected_control_epoch,expected_lease_epoch,grant_revision,link_secret_hash,code_mac,failed_code_count,issued_at,expires_at,restored_at,restored_by) VALUES (?,?,?,?,?,?,?,'issued',?,?,?,?,?,?,1,?,?,0,?,?,?,?)`, grantID, attemptID, scheduleID, actorID, req.OperationID, requestHash, attemptID, c.Target.SectionKey, nullIfEmpty(c.Target.ModuleAttemptID), nullIfEmpty(c.Target.ModuleID), recoveryNullInt(award), row.ControlEpoch, row.LeaseEpoch, platformcrypto.RecoveryLinkHash(s.recoverySecret, random), platformcrypto.RecoveryCodeMAC(s.recoverySecret, grantID, attemptID, random), now, now.Add(recoveryClaimTTL), now, actorID)
		if err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{"grantId": grantID, "target": c.Target, "leaseEpoch": lease, "controlEpoch": epoch, "originalSessionId": c.OriginalSessionID})
		_, err = q.ExecContext(ctx, `INSERT INTO session_audit_logs (id,schedule_id,actor,action_type,target_student_id,payload,created_at) VALUES (?,?,?,'DEVICE_RECOVERY_RESTORE_REQUESTED',?,?,UTC_TIMESTAMP(6))`, uuid.NewString(), scheduleID, actorID, attemptID, string(payload))
		return err
	})
	if err != nil {
		return nil, err
	}
	return s.RecoveryOptions(ctx, scheduleID, attemptID)
}

// PrepareOriginalDeviceRecovery accepts only server-verified original bearer
// claims plus the authenticated original principal. Possession of a UUID is
// never proof. Revocation is intentionally not reversed: Continue mints both
// a fresh bearer and a fresh client-session identity.
func (s *Service) PrepareOriginalDeviceRecovery(ctx context.Context, scheduleID, attemptID, userID string, original platformcrypto.AttemptClaims, req ClaimDeviceRecoveryRequest) (*RecoveryReadyView, error) {
	if original.AttemptID != attemptID || original.ScheduleID != scheduleID || original.UserID != userID || original.TokenID == "" || original.ClientSessionID == "" || !recoveryOperationIDPattern.MatchString(req.OperationID) || len(req.BrowserProof) < 16 || len(req.BrowserProof) > 512 {
		return nil, recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "The original browser proof is unavailable. Ask staff for a new QR and code.")
	}
	var grantID string
	var finalErr error
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		finalErr = nil
		row, err := loadRecoveryAttempt(ctx, q, scheduleID, attemptID, true)
		if err != nil {
			return err
		}
		if row.UserID.String != userID || row.Control == nil || row.Control.OriginalSessionID != original.ClientSessionID {
			return recoveryConflict("RECOVERY_SUPERSEDED", "Staff have not designated this browser for return.", nil)
		}
		c := *row.Control
		grantID = c.ActiveGrantID
		grant, err := loadRecoveryGrantByID(ctx, q, grantID, true)
		if err != nil {
			return err
		}
		if grant == nil || grant.RestoredBy == "" {
			return recoveryConflict("RECOVERY_SUPERSEDED", "The restore decision is no longer active.", nil)
		}
		now, err := dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		if grant.State == recoveryGrantClaimed || grant.State == recoveryGrantStarted {
			if !s.claimProofMatches(grant, req.BrowserProof) || grant.ClaimOperationID != req.OperationID {
				return recoveryConflict("RECOVERY_SUPERSEDED", "Another browser is using this restore decision.", nil)
			}
			return nil
		}
		if grant.State != recoveryGrantIssued || c.Phase != examdomain.RecoveryPhaseReturning {
			return recoveryConflict("RECOVERY_SUPERSEDED", "The restore decision is no longer active.", nil)
		}
		if !now.Before(grant.ExpiresAt) {
			if err := expireRecoveryGrant(ctx, q, grant.ID); err != nil {
				return err
			}
			finalErr = recoveryConflict("RECOVERY_EXPIRED", "The restore window expired. Ask staff for a new QR and code.", nil)
			return nil
		}
		// Confirm the signed original token really existed for this sitting,
		// although it remains revoked and cannot write any answers.
		var recorded string
		err = q.QueryRowContext(ctx, `SELECT client_session_id FROM attempt_sessions WHERE token_id=? AND attempt_id=? AND user_id=?`, original.TokenID, attemptID, userID).Scan(&recorded)
		if err != nil && !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if err != nil || recorded != c.OriginalSessionID {
			return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "The original browser proof is unavailable.")
		}
		if err := s.claimRecoveryGrant(ctx, q, grant, req, now); err != nil {
			return err
		}
		c.Phase = examdomain.RecoveryPhaseHeld
		raw, err := json.Marshal(c)
		if err != nil {
			return err
		}
		_, err = q.ExecContext(ctx, `UPDATE student_attempts SET recovery_control=?,revision=revision+1,updated_at=UTC_TIMESTAMP(6) WHERE id=?`, string(raw), attemptID)
		return err
	})
	if err != nil {
		return nil, err
	}
	if finalErr != nil {
		return nil, finalErr
	}
	return s.ReadyDeviceRecovery(ctx, grantID, req.BrowserProof)
}

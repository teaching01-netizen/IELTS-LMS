package delivery

import (
	"context"
	"strings"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// ReadyDeviceRecovery refreshes preparation using the browser-bound proof.
// It neither consumes another code nor extends the fixed claim window.
func (s *Service) ReadyDeviceRecovery(ctx context.Context, grantID, browserProof string) (*RecoveryReadyView, error) {
	grantID, browserProof = strings.TrimSpace(grantID), strings.TrimSpace(browserProof)
	if grantID == "" || len(browserProof) < 16 || len(browserProof) > 512 {
		return nil, recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
	}
	if !s.recoverySecretsReady() {
		return nil, recoveryUnavailable("RECOVERY_SECRET_UNAVAILABLE", "Recovery credentials are not configured on this deployment.")
	}
	var out *RecoveryReadyView
	var finalErr error
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		// A retry starts with no decision from a rolled-back transaction.
		out, finalErr = nil, nil
		head, err := loadRecoveryGrantByID(ctx, q, grantID, false)
		if err != nil {
			return err
		}
		if head == nil {
			return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
		}
		row, err := loadRecoveryAttempt(ctx, q, head.ScheduleID, head.AttemptID, true)
		if err != nil {
			return err
		}
		grant, err := loadRecoveryGrantByID(ctx, q, grantID, true)
		if err != nil {
			return err
		}
		now, err := dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		if !s.claimProofMatches(grant, browserProof) {
			return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
		}
		if row.Control == nil || row.Control.ActiveGrantID != grant.ID || !row.Control.Target.Equal(grant.Target) {
			return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery code is no longer active.", nil)
		}
		switch grant.State {
		case recoveryGrantClaimed:
			if row.Control.Phase != examdomain.RecoveryPhaseHeld {
				return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery code is no longer active.", nil)
			}
			if grant.ClaimExpiresAt == nil || !now.Before(*grant.ClaimExpiresAt) {
				if err := expireRecoveryGrant(ctx, q, grant.ID); err != nil {
					return err
				}
				finalErr = recoveryConflict("RECOVERY_EXPIRED", "The preparation window expired. Ask staff for a new recovery code.", nil)
				return nil
			}
		case recoveryGrantStarted:
			if row.Control.Phase != examdomain.RecoveryPhaseWorking || grant.ResultingLeaseEpoch == nil || row.LeaseEpoch != *grant.ResultingLeaseEpoch || row.ActiveSession.String != grant.TargetClientSessionID {
				return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery browser no longer owns the sitting.", nil)
			}
		case recoveryGrantExpired:
			return recoveryConflict("RECOVERY_EXPIRED", "The preparation window expired. Ask staff for a new recovery code.", nil)
		default:
			return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery code is no longer active.", nil)
		}
		facts, err := s.loadRecoveryTargetFacts(ctx, q, row, now)
		if err != nil {
			return err
		}
		fact, ok := matchRecoveryTarget(facts, row.ProviderKey, grant.Target)
		if !ok {
			return recoveryConflict("RECOVERY_SUPERSEDED", "The selected stage is unavailable.", nil)
		}
		reason, err := loadRecoveryReceiptReason(ctx, q, row.ID, row.TerminalGeneration)
		if err != nil {
			return err
		}
		if eligibility := classifyRecoveryTarget(row, reason, fact); !eligibility.Eligible {
			return recoveryConflict(eligibility.Reason, recoveryIneligibleMessage(eligibility.Reason), nil)
		}
		checkpoint, err := loadRecoveryCheckpoint(ctx, q, row.ID)
		if err != nil {
			return err
		}
		manifest, err := loadRecoveryManifest(ctx, q, row, fact)
		if err != nil {
			return err
		}
		out = readyRecoveryView(row, grant, fact, checkpoint, manifest, now)
		return nil
	})
	if err != nil {
		return nil, err
	}
	if finalErr != nil {
		return nil, finalErr
	}
	if out == nil {
		return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Recovery preparation is unavailable.")
	}
	return out, nil
}

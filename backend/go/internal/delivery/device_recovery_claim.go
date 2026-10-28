package delivery

// Staff-assisted exam recovery: claim and preparation.
//
// Claim is the student's first explicit action. It proves possession of the
// link secret AND the out-of-band code, binds one browser proof, consumes the
// code and clears the staff-only replay capsule. Until this succeeds the API
// reveals nothing about the sitting: no candidate name, no exam title, no
// questions and no attempt credential.
//
// The claim window is deliberately short (ten minutes). Begin must happen
// inside it; a grant that is never claimed simply expires. Wrong-code counts
// and lazy expiry are written before the refusal is returned, so a failed
// claim still commits its failure accounting.

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	platformcrypto "example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satpublish"
)

const (
	// recoveryClaimTTL bounds preparation after the code is consumed. Begin
	// must commit inside it; the window is not extended by polling.
	recoveryClaimTTL = 10 * time.Minute
	// recoveryClaimMaxWindow is the hard cap from claimed_at, so a future
	// configuration change cannot turn the preparation window into an
	// unbounded reservation.
	recoveryClaimMaxWindow = 30 * time.Minute
	// recoveryCodeMaxAttempts is the persisted wrong-code budget. The fifth
	// wrong code locks the grant and releases the live marker; the attempt's
	// recovery control stays held so staff can reissue.
	recoveryCodeMaxAttempts = 5
)

// ClaimDeviceRecovery verifies the link secret + code, binds the browser
// proof, and returns the sanitized ready projection. A lost response replays
// with the same operation id and proof; a different browser gets nothing.
func (s *Service) ClaimDeviceRecovery(ctx context.Context, grantID string, req ClaimDeviceRecoveryRequest) (*RecoveryReadyView, error) {
	grantID = strings.TrimSpace(grantID)
	if err := validateClaimDeviceRecovery(grantID, &req); err != nil {
		return nil, err
	}
	if !s.recoverySecretsReady() {
		return nil, recoveryUnavailable("RECOVERY_SECRET_UNAVAILABLE", "Recovery credentials are not configured on this deployment.")
	}
	var out *RecoveryReadyView
	var finalErr error
	err := s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		out, finalErr = nil, nil
		// Resolve the attempt identity without a lock first: the global lock
		// order is attempt -> runtime/control -> grant, never grant ->
		// attempt.
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
		if grant == nil || grant.AttemptID != head.AttemptID || grant.ScheduleID != head.ScheduleID {
			return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
		}
		// The link secret is checked before anything else: a grant id alone
		// (it is in the URL path) must not reveal whether the grant is live,
		// superseded or expired, and a wrong link never consumes one of the
		// five code attempts.
		if !platformcrypto.RecoverySecretMatches(
			platformcrypto.RecoveryLinkHash(s.recoverySecret, req.LinkSecret), grant.LinkSecretHash) {
			return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
		}
		if row.Control == nil || row.Control.ActiveGrantID != grant.ID || !row.Control.Target.Equal(grant.Target) {
			return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery code is no longer active.", nil)
		}
		switch grant.State {
		case recoveryGrantIssued:
			if !now.Before(grant.ExpiresAt) {
				if err := expireRecoveryGrant(ctx, q, grant.ID); err != nil {
					return err
				}
				finalErr = recoveryConflict("RECOVERY_EXPIRED", "This recovery code has expired. Ask staff for a new one.", nil)
				return nil
			}
			expectedCode := platformcrypto.RecoveryCodeMAC(s.recoverySecret, grant.ID, grant.AttemptID, req.Code)
			if !platformcrypto.RecoverySecretMatches(expectedCode, grant.CodeMAC) {
				remaining, err := recordRecoveryWrongCode(ctx, q, grant)
				if err != nil {
					return err
				}
				if remaining <= 0 {
					finalErr = recoveryConflict("RECOVERY_CODE_LOCKED", "Too many incorrect codes. Ask staff for a new recovery code.", map[string]any{
						"attemptsRemaining": 0,
					})
				} else {
					finalErr = recoveryInvalidCode(remaining)
				}
				return nil
			}
			if err := s.claimRecoveryGrant(ctx, q, grant, req, now); err != nil {
				return err
			}
		case recoveryGrantClaimed:
			if grant.ClaimExpiresAt != nil && !now.Before(*grant.ClaimExpiresAt) {
				if err := expireRecoveryGrant(ctx, q, grant.ID); err != nil {
					return err
				}
				finalErr = recoveryConflict("RECOVERY_EXPIRED", "The preparation window expired. Ask staff for a new recovery code.", nil)
				return nil
			}
			if !s.claimProofMatches(grant, req.BrowserProof) {
				finalErr = recoveryConflict("RECOVERY_CLAIMED", "This recovery code is already being used by another browser.", nil)
				return nil
			}
			if grant.ClaimOperationID != "" && grant.ClaimOperationID != req.OperationID {
				finalErr = recoveryConflict("OPERATION_ID_CONFLICT", "This browser already claimed the code with a different operation. Reload the recovery page.", nil)
				return nil
			}
			if grant.ClaimOperationID == "" {
				// A grant claimed before the operation id column existed
				// adopts the retrying operation rather than dead-ending a
				// perfectly valid preparation window.
				if _, err := q.ExecContext(ctx,
					`UPDATE attempt_device_recovery_grants SET claim_operation_id = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ?`,
					req.OperationID, grant.ID); err != nil {
					return err
				}
				grant.ClaimOperationID = req.OperationID
			}
		case recoveryGrantStarted:
			if !s.claimProofMatches(grant, req.BrowserProof) {
				finalErr = recoveryConflict("RECOVERY_CLAIMED", "This recovery code has already been used.", nil)
				return nil
			}
		case recoveryGrantLocked:
			return recoveryConflict("RECOVERY_CODE_LOCKED", "Too many incorrect codes. Ask staff for a new recovery code.", nil)
		case recoveryGrantExpired:
			return recoveryConflict("RECOVERY_EXPIRED", "This recovery code has expired. Ask staff for a new one.", nil)
		case recoveryGrantReplaced, recoveryGrantRestored:
			return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery code is no longer active.", nil)
		default:
			return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery code is no longer active.", nil)
		}

		// The grant is now claimed (or replayed). Re-derive the selected stage
		// from trusted provider facts so a version change or an administrative
		// close cannot leave the browser with a stale award.
		facts, err := s.loadRecoveryTargetFacts(ctx, q, row, now)
		if err != nil {
			return err
		}
		fact, ok := matchRecoveryTarget(facts, row.ProviderKey, grant.Target)
		if !ok {
			return recoveryConflict("RECOVERY_SUPERSEDED", "The selected section is no longer part of this sitting. Ask staff for a new recovery code.", nil)
		}
		receipt, err := loadRecoveryReceiptReason(ctx, q, row.ID, row.TerminalGeneration)
		if err != nil {
			return err
		}
		if eligibility := classifyRecoveryTarget(row, receipt, fact); !eligibility.Eligible {
			reason := eligibility.Reason
			if reason == "" {
				reason = RecoveryReasonIneligible
			}
			return recoveryConflict(reason, recoveryIneligibleMessage(reason), nil)
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
	return out, nil
}

func validateClaimDeviceRecovery(grantID string, req *ClaimDeviceRecoveryRequest) error {
	if grantID == "" {
		return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
	}
	req.OperationID = strings.TrimSpace(req.OperationID)
	req.LinkSecret = strings.TrimSpace(req.LinkSecret)
	req.Code = strings.TrimSpace(req.Code)
	req.BrowserProof = strings.TrimSpace(req.BrowserProof)
	if !recoveryOperationIDPattern.MatchString(req.OperationID) {
		return apperrors.New(apperrors.CodeValidation, "operationId must be 8-64 URL-safe characters.")
	}
	if req.LinkSecret == "" || len(req.LinkSecret) > 256 {
		return recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
	}
	if req.BrowserProof == "" || len(req.BrowserProof) < 16 || len(req.BrowserProof) > 512 {
		return apperrors.New(apperrors.CodeValidation, "browserProof is required.")
	}
	if !isSixDigitCode(req.Code) {
		return apperrors.New(apperrors.CodeValidation, "The recovery code must be six digits.")
	}
	return nil
}

func isSixDigitCode(code string) bool {
	if len(code) != 6 {
		return false
	}
	for i := 0; i < len(code); i++ {
		if code[i] < '0' || code[i] > '9' {
			return false
		}
	}
	return true
}

func recoveryInvalid(reason, message string) *apperrors.Error {
	err := apperrors.New(apperrors.CodeValidation, message)
	err.Details = map[string]any{"reason": reason}
	err.Retryable = false
	return err
}

func recoveryInvalidCode(_ int) *apperrors.Error {
	err := recoveryInvalid("RECOVERY_INVALID_CREDENTIALS", "This recovery code is not valid.")
	err.Retryable = false
	return err
}

func (s *Service) claimProofMatches(grant *recoveryGrantRow, browserProof string) bool {
	if grant == nil || grant.ClaimProofHash == "" {
		return false
	}
	return platformcrypto.RecoverySecretMatches(
		grant.ClaimProofHash,
		platformcrypto.RecoveryClaimProofHash(s.recoverySecret, grant.ID, browserProof))
}

// claimRecoveryGrant consumes the code and binds the browser proof. The grant
// row is already locked; the update is fenced on the issued state so a
// concurrent mutation cannot double-claim.
func (s *Service) claimRecoveryGrant(ctx context.Context, q tx.Tx, grant *recoveryGrantRow, req ClaimDeviceRecoveryRequest, now time.Time) error {
	claimExpires := now.Add(recoveryClaimTTL)
	if cap := now.Add(recoveryClaimMaxWindow); claimExpires.After(cap) {
		claimExpires = cap
	}
	proofHash := platformcrypto.RecoveryClaimProofHash(s.recoverySecret, grant.ID, req.BrowserProof)
	clientSessionID := uuid.NewString()
	res, err := q.ExecContext(ctx, `
		UPDATE attempt_device_recovery_grants
		SET state = 'claimed', claim_operation_id = ?, claim_proof_hash = ?,
		    target_client_session_id = ?, claimed_at = ?, claim_expires_at = ?,
		    grant_revision = grant_revision + 1, sealed_issuance = NULL,
		    updated_at = UTC_TIMESTAMP(6)
		WHERE id = ? AND state = 'issued'`,
		req.OperationID, proofHash, clientSessionID, now, claimExpires, grant.ID)
	if err != nil {
		return err
	}
	if affected, err := res.RowsAffected(); err == nil && affected == 0 {
		return recoveryConflict("RECOVERY_SUPERSEDED", "This recovery code was replaced or consumed. Ask staff for a new one.", nil)
	}
	grant.State = recoveryGrantClaimed
	grant.ClaimOperationID = req.OperationID
	grant.ClaimProofHash = proofHash
	grant.TargetClientSessionID = clientSessionID
	grant.ClaimedAt = &now
	grant.ClaimExpiresAt = &claimExpires
	grant.SealedIssuance = nil
	grant.GrantRevision++
	return nil
}

// recordRecoveryWrongCode persists the wrong-code budget. The fifth wrong
// code locks the grant and releases the attempt's live marker; the recovery
// control intentionally stays held so staff can issue a replacement.
func recordRecoveryWrongCode(ctx context.Context, q tx.Tx, grant *recoveryGrantRow) (int, error) {
	newCount := grant.FailedCodeCount + 1
	if newCount > recoveryCodeMaxAttempts {
		newCount = recoveryCodeMaxAttempts
	}
	remaining := recoveryCodeMaxAttempts - newCount
	if remaining < 0 {
		remaining = 0
	}
	if newCount >= recoveryCodeMaxAttempts {
		if _, err := q.ExecContext(ctx, `
			UPDATE attempt_device_recovery_grants
			SET failed_code_count = ?, state = 'locked', active_attempt_id = NULL,
			    sealed_issuance = NULL, updated_at = UTC_TIMESTAMP(6)
			WHERE id = ?`, newCount, grant.ID); err != nil {
			return 0, err
		}
		grant.FailedCodeCount = newCount
		grant.State = recoveryGrantLocked
		return 0, nil
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE attempt_device_recovery_grants
		SET failed_code_count = ?, updated_at = UTC_TIMESTAMP(6)
		WHERE id = ?`, newCount, grant.ID); err != nil {
		return 0, err
	}
	grant.FailedCodeCount = newCount
	return remaining, nil
}

func expireRecoveryGrant(ctx context.Context, q tx.Tx, grantID string) error {
	_, err := q.ExecContext(ctx, `
		UPDATE attempt_device_recovery_grants
		SET state = 'expired', active_attempt_id = NULL, sealed_issuance = NULL,
		    updated_at = UTC_TIMESTAMP(6)
		WHERE id = ? AND state IN ('issued', 'claimed')`, grantID)
	return err
}

// loadRecoveryCheckpoint reads resume metadata only. It never reads answer
// content, so the ready view remains a preparation surface.
func loadRecoveryCheckpoint(ctx context.Context, q tx.Tx, attemptID string) (RecoveryCheckpointStatus, error) {
	var out RecoveryCheckpointStatus
	var last sql.NullTime
	if err := q.QueryRowContext(ctx,
		`SELECT COUNT(*), MAX(updated_at) FROM attempt_responses_v2 WHERE attempt_id = ?`,
		attemptID).Scan(&out.ResponsesSaved, &last); err != nil {
		return out, err
	}
	out.LastServerSaveAt = nullTime(last)
	rows, err := q.QueryContext(ctx, `
		SELECT section_key, part_id, media_revision, position_ms, client_sequence,
		       run_generation, updated_at
		FROM attempt_audio_checkpoints
		WHERE attempt_id = ?
		ORDER BY section_key, part_id, media_revision`, attemptID)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	for rows.Next() {
		var item RecoveryAudioCheckpoint
		if err := rows.Scan(&item.SectionKey, &item.PartID, &item.MediaRevision,
			&item.PositionMS, &item.ClientSequence, &item.RunGeneration, &item.UpdatedAt); err != nil {
			return out, err
		}
		item.UpdatedAt = item.UpdatedAt.UTC()
		out.Audio = append(out.Audio, item)
	}
	return out, rows.Err()
}

// loadRecoveryManifest enumerates the pinned target's delivery identities and
// managed-media assets. Rich content is parsed for asset ids only and then
// discarded; no question text, option text or answer leaves this function.
func loadRecoveryManifest(ctx context.Context, q tx.Tx, row recoveryAttemptRow, fact recoveryTargetFact) (RecoveryReadyManifest, error) {
	out := RecoveryReadyManifest{PublishedVersionID: row.PublishedVersionID}
	query := `
		SELECT eq.id, m.id, s.section_key,
		       CAST(r.stimulus AS CHAR), CAST(r.prompt AS CHAR),
		       CAST(r.answer_definition AS CHAR)
		FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
		WHERE s.exam_version_id = ?`
	args := []any{row.PublishedVersionID}
	if row.ProviderKey == examdomain.ProviderSAT {
		query += " AND m.id = ?"
		args = append(args, fact.Target.ModuleID)
	} else {
		query += " AND s.section_key = ?"
		args = append(args, fact.Target.SectionKey)
	}
	query += " ORDER BY s.display_order, m.display_order, eq.display_order, eq.id"
	rows, err := q.QueryContext(ctx, query, args...)
	if err != nil {
		return out, err
	}
	defer rows.Close()
	sections := map[string]bool{}
	modules := map[string]bool{}
	questions := map[string]bool{}
	assets := map[string]bool{}
	for rows.Next() {
		var questionID, moduleID, sectionKey, stimulus, prompt, answer string
		if err := rows.Scan(&questionID, &moduleID, &sectionKey, &stimulus, &prompt, &answer); err != nil {
			return out, err
		}
		if !sections[sectionKey] {
			sections[sectionKey] = true
			out.SectionKeys = append(out.SectionKeys, sectionKey)
		}
		if !modules[moduleID] {
			modules[moduleID] = true
			out.ModuleIDs = append(out.ModuleIDs, moduleID)
		}
		if !questions[questionID] {
			questions[questionID] = true
			out.QuestionIDs = append(out.QuestionIDs, questionID)
		}
		for _, raw := range []struct {
			path string
			body string
		}{
			{"stimulus", stimulus},
			{"prompt", prompt},
		} {
			for _, ref := range satpublish.CollectRichContentAssetReferences(raw.body, "examQuestion:"+questionID+":"+raw.path, questionID) {
				if !assets[ref.AssetID] {
					assets[ref.AssetID] = true
					out.MediaAssetIDs = append(out.MediaAssetIDs, ref.AssetID)
				}
			}
		}
		for _, assetID := range answerMediaAssetIDs(answer) {
			if !assets[assetID] {
				assets[assetID] = true
				out.MediaAssetIDs = append(out.MediaAssetIDs, assetID)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return out, err
	}
	sort.Strings(out.MediaAssetIDs)
	return out, nil
}

func answerMediaAssetIDs(raw string) []string {
	var object map[string]json.RawMessage
	if json.Unmarshal([]byte(raw), &object) != nil {
		return nil
	}
	var options []struct {
		Content json.RawMessage `json:"content"`
	}
	if json.Unmarshal(object["options"], &options) != nil {
		return nil
	}
	var out []string
	for _, option := range options {
		refs := satpublish.CollectRichContentAssetReferences(string(option.Content), "answer.options", "")
		for _, ref := range refs {
			out = append(out, ref.AssetID)
		}
	}
	return out
}

func readyRecoveryView(row recoveryAttemptRow, grant *recoveryGrantRow, fact recoveryTargetFact, checkpoint RecoveryCheckpointStatus, manifest RecoveryReadyManifest, now time.Time) *RecoveryReadyView {
	policy := RecoveryTimePolicy{
		Mode:               "original_deadline",
		OriginalDeadlineAt: fact.Deadline,
		RemainingSeconds:   fact.RemainingSeconds,
	}
	if grant.RequestedRemainingSeconds != nil {
		policy.Mode = "awarded"
		policy.AwardedSeconds = grant.RequestedRemainingSeconds
		award := int64(*grant.RequestedRemainingSeconds)
		policy.RemainingSeconds = &award
	}
	return &RecoveryReadyView{
		GrantID:       grant.ID,
		State:         grant.State,
		GrantRevision: grant.GrantRevision,
		CandidateName: row.CandidateName,
		ExamTitle:     row.ExamTitle,
		ProviderKey:   row.ProviderKey,
		Target: RecoveryReadyTarget{
			SectionKey:         fact.Target.SectionKey,
			Label:              fact.Label,
			ModuleAttemptID:    fact.Target.ModuleAttemptID,
			ModuleID:           fact.Target.ModuleID,
			State:              fact.State,
			ClosureReason:      fact.Reason,
			OriginalDeadlineAt: fact.Deadline,
		},
		TimePolicy:     policy,
		ClaimedAt:      grant.ClaimedAt,
		ClaimExpiresAt: grant.ClaimExpiresAt,
		StartedAt:      grant.StartedAt,
		ServerNow:      now,
		Checkpoint:     checkpoint,
		Manifest:       manifest,
	}
}

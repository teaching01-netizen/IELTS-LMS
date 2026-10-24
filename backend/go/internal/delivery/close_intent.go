package delivery

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/lifecycle"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// SATCloseIntentRequest registers the full frozen answer frontier before the
// client sends bounded chunks through the normal V2 response endpoint.
type SATCloseIntentRequest struct {
	Protocol        string              `json:"protocol"`
	ModuleID        string              `json:"moduleId"`
	ModuleAttemptID string              `json:"moduleAttemptId"`
	RegistrationID  string              `json:"registrationId"`
	LeaseEpoch      uint64              `json:"leaseEpoch"`
	ControlEpoch    uint64              `json:"controlEpoch"`
	Answers         []ModuleCloseAnswer `json:"answers"`
}

// SATCloseIntentReceipt confirms only immutable frontier registration. It
// does not acknowledge any answer or submission.
type SATCloseIntentReceipt struct {
	RegistrationID   string    `json:"registrationId"`
	ModuleAttemptID  string    `json:"moduleAttemptId"`
	ManifestHash     string    `json:"manifestHash"`
	BoundaryPhase    string    `json:"boundaryPhase"`
	BoundaryRevision uint64    `json:"boundaryRevision"`
	RegisteredAt     time.Time `json:"registeredAt"`
	Replayed         bool      `json:"replayed,omitempty"`
}

type storedSATCloseIntent struct {
	registrationID string
	manifestHash   string
	manifest       []ModuleCloseAnswer
}

func loadSATCloseIntentTx(ctx context.Context, q tx.Tx, moduleAttemptID string) (*storedSATCloseIntent, error) {
	var out storedSATCloseIntent
	var raw string
	err := q.QueryRowContext(ctx, `
		SELECT registration_id, manifest_hash, CAST(manifest AS CHAR)
		FROM assessment_module_close_intents WHERE module_attempt_id = ?`, moduleAttemptID).
		Scan(&out.registrationID, &out.manifestHash, &raw)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := json.Unmarshal([]byte(raw), &out.manifest); err != nil {
		return nil, err
	}
	hash, err := attempts.HashResponse(out.manifest)
	if err != nil {
		return nil, err
	}
	if hash != out.manifestHash {
		return nil, apperrors.New(apperrors.CodeConflict, "The registered SAT recovery frontier failed its integrity check.")
	}
	return &out, nil
}

func equalFrozenManifest(a, b []ModuleCloseAnswer) bool {
	left, errLeft := normalizeFrozenManifest(a)
	right, errRight := normalizeFrozenManifest(b)
	if errLeft != nil || errRight != nil || len(left) != len(right) {
		return false
	}
	for i := range left {
		if left[i] != right[i] {
			return false
		}
	}
	return true
}

func normalizeFrozenManifest(answers []ModuleCloseAnswer) ([]ModuleCloseAnswer, error) {
	if len(answers) > maxCloseManifest {
		return nil, apperrors.New(apperrors.CodeValidation, "The close manifest is too large.")
	}
	normalized := append([]ModuleCloseAnswer(nil), answers...)
	sort.Slice(normalized, func(i, j int) bool { return normalized[i].QuestionID < normalized[j].QuestionID })
	for i, answer := range normalized {
		if strings.TrimSpace(answer.QuestionID) == "" || strings.TrimSpace(answer.WriteID) == "" ||
			len(answer.WriteID) > attempts.MaxWriteIDLen || answer.ClientVersion < 1 ||
			(i > 0 && answer.QuestionID == normalized[i-1].QuestionID) {
			return nil, apperrors.New(apperrors.CodeValidation, "The close manifest requires unique question IDs, exact write IDs, and positive versions.")
		}
		if len(answer.ContentHash) != 64 {
			return nil, apperrors.New(apperrors.CodeValidation, "Every frozen answer requires a canonical content hash.")
		}
		decoded, err := hex.DecodeString(answer.ContentHash)
		if err != nil || len(decoded) != 32 || strings.ToLower(answer.ContentHash) != answer.ContentHash {
			return nil, apperrors.New(apperrors.CodeValidation, "The close manifest contains an invalid content hash.")
		}
	}
	return normalized, nil
}

func (s *Service) RegisterSATCloseIntent(
	ctx context.Context,
	bearerScheduleID, bearerAttemptID, urlScheduleID string,
	req SATCloseIntentRequest,
	claims crypto.AttemptClaims,
	writerBinding ...string,
) (*SATCloseIntentReceipt, error) {
	if urlScheduleID != bearerScheduleID || claims.ScheduleID != bearerScheduleID || claims.AttemptID != bearerAttemptID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	req.Protocol = strings.TrimSpace(req.Protocol)
	req.ModuleID = strings.TrimSpace(req.ModuleID)
	req.ModuleAttemptID = strings.TrimSpace(req.ModuleAttemptID)
	req.RegistrationID = strings.TrimSpace(req.RegistrationID)
	if req.Protocol != attempts.SATRecoveryPolicyV1 || req.ModuleID == "" || req.ModuleAttemptID == "" ||
		req.RegistrationID == "" || len(req.RegistrationID) > 64 || req.LeaseEpoch == 0 || req.ControlEpoch == 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "A supported protocol, module, operation ID, and current epochs are required.")
	}
	answers, err := normalizeFrozenManifest(req.Answers)
	if err != nil {
		return nil, err
	}
	req.Answers = answers
	manifestHash, err := attempts.HashResponse(answers)
	if err != nil {
		return nil, err
	}
	requestHash, err := lifecycle.Hash("sat_close_intent", req)
	if err != nil {
		return nil, err
	}
	scheduleID, _, provider, _, err := s.startModuleBinding(ctx, bearerScheduleID, bearerAttemptID)
	if err != nil {
		return nil, err
	}
	if provider != "sat" || scheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}
	var receipt *SATCloseIntentReceipt
	var terminalErr error
	var recoveryTransitions []satBoundaryTransition
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		receipt, terminalErr = nil, nil
		recoveryTransitions = nil
		var authoritySnapshot attemptAuthoritySnapshot
		workErr := s.ensureAttemptCanWorkWithAuthorityTx(ctx, t, scheduleID, bearerAttemptID, nil, &authoritySnapshot)
		if workErr != nil {
			if e, ok := apperrors.As(workErr); !ok || e.Code != apperrors.CodeAssessmentConflict {
				return workErr
			}
		}
		if err := enforceWriterSessionWithAuthorityTx(ctx, t, scheduleID, bearerAttemptID, writerBinding, &authoritySnapshot); err != nil {
			return err
		}
		policy, err := satRecoveryPolicyTx(ctx, t, bearerAttemptID)
		if err != nil {
			return err
		}
		if policy == nil || policy.Version != req.Protocol {
			return assessmentConflict("RECOVERY_PROTOCOL_UNAVAILABLE", "This SAT session does not use frozen recovery closes.")
		}
		module, err := lockModuleAttemptTx(ctx, t, bearerAttemptID, req.ModuleID)
		if err != nil {
			return err
		}
		if module.id != req.ModuleAttemptID {
			return assessmentConflict("MODULE_ATTEMPT_MISMATCH", "The module attempt does not match this module.")
		}
		boundary, err := ensureSatModuleBoundaryAndLockTx(ctx, t, bearerAttemptID, module.id, policy)
		if err != nil {
			return err
		}
		if boundary == nil || boundary.attemptID != bearerAttemptID || boundary.policyVersion != policy.Version {
			return apperrors.New(apperrors.CodeConflict, "SAT recovery boundary is unavailable.")
		}
		var existingID, existingRequestHash, existingManifestHash, existingReceipt sql.NullString
		err = t.QueryRowContext(ctx, `
			SELECT registration_id, request_hash, manifest_hash, CAST(receipt AS CHAR)
			FROM assessment_module_close_intents WHERE module_attempt_id = ?`, module.id).
			Scan(&existingID, &existingRequestHash, &existingManifestHash, &existingReceipt)
		if err == nil {
			if !existingID.Valid || existingID.String != req.RegistrationID || !existingRequestHash.Valid || existingRequestHash.String != requestHash {
				return assessmentConflict("CLOSE_FRONTIER_ALREADY_REGISTERED", "A different frozen answer frontier is already registered for this module.")
			}
			if err := json.Unmarshal([]byte(existingReceipt.String), &receipt); err != nil {
				return err
			}
			if existingManifestHash.String != manifestHash {
				return assessmentConflict("CLOSE_REGISTRATION_MISMATCH", "The registered answer frontier does not match this request.")
			}
			receipt.Replayed = true
			return nil
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return err
		}
		if workErr != nil {
			return workErr
		}
		if module.state != "active" && module.state != "review" {
			return assessmentConflict("MODULE_NOT_ACTIVE", "The SAT module is not active.")
		}
		if module.startedAt == nil || module.pausedAt != nil {
			return assessmentConflict("MODULE_NOT_ACTIVE", "The SAT module is not active.")
		}
		currentLease, currentControl := uint64(authoritySnapshot.leaseEpoch), uint64(authoritySnapshot.controlEpoch)
		if req.LeaseEpoch != currentLease || (claims.LeaseEpoch != nil && *claims.LeaseEpoch != currentLease) {
			return apperrors.New(apperrors.CodeLeaseFenced, "The answer writer is no longer current.")
		}
		if req.ControlEpoch != currentControl {
			return apperrors.New(apperrors.CodeControlEpochStale, "The exam control state changed.")
		}
		now, err := dbTimeTx(ctx, t)
		if err != nil {
			return err
		}
		if boundary.phase == "working" && boundary.workDeadline != nil && !now.Before(*boundary.workDeadline) {
			if err := setSatBoundaryPhaseTx(ctx, t, module.id, "working", "collecting", boundary.recoveryDeadline); err != nil {
				return err
			}
			recoveryTransitions = append(recoveryTransitions, satBoundaryTransition{from: "working", to: "collecting"})
			boundary.phase = "collecting"
			boundary.revision++
		}
		if boundary.phase != "collecting" || boundary.workDeadline == nil || now.Before(*boundary.workDeadline) {
			return assessmentConflict("MODULE_NOT_EXPIRED", "The SAT module clock has not run out yet.")
		}
		if boundary.recoveryDeadline == nil || !now.Before(*boundary.recoveryDeadline) {
			if err := setSatBoundaryPhaseTx(ctx, t, module.id, "collecting", "blocked", nil); err != nil {
				return err
			}
			recoveryTransitions = append(recoveryTransitions, satBoundaryTransition{from: "collecting", to: "blocked"})
			terminalErr = assessmentConflict("RECOVERY_EXPIRED", "The SAT connection recovery period has ended.")
			return nil
		}
		if len(answers) > 0 {
			ids := make([]any, 0, len(answers)+1)
			ids = append(ids, req.ModuleID)
			for _, answer := range answers {
				ids = append(ids, answer.QuestionID)
			}
			rows, err := t.QueryContext(ctx, "SELECT id FROM assessment_exam_questions WHERE module_id = ? AND id IN ("+sqlPlaceholders(len(answers))+")", ids...)
			if err != nil {
				return err
			}
			found := make(map[string]bool, len(answers))
			for rows.Next() {
				var id string
				if err := rows.Scan(&id); err != nil {
					rows.Close()
					return err
				}
				found[id] = true
			}
			if err := rows.Err(); err != nil {
				rows.Close()
				return err
			}
			rows.Close()
			if len(found) != len(answers) {
				return apperrors.New(apperrors.CodeValidation, "The close manifest names a question outside this module.")
			}
		}
		manifestJSON, err := json.Marshal(answers)
		if err != nil {
			return err
		}
		revision := boundary.revision + 1
		receipt = &SATCloseIntentReceipt{
			RegistrationID: req.RegistrationID, ModuleAttemptID: module.id, ManifestHash: manifestHash,
			BoundaryPhase: "collecting", BoundaryRevision: revision, RegisteredAt: now.UTC(),
		}
		receiptJSON, err := json.Marshal(receipt)
		if err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx, `
			INSERT INTO assessment_module_close_intents
				(module_attempt_id, attempt_id, registration_id, request_hash, manifest_hash, manifest, receipt, registered_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
			module.id, bearerAttemptID, req.RegistrationID, requestHash, manifestHash, string(manifestJSON), string(receiptJSON), now.UTC()); err != nil {
			return err
		}
		res, err := t.ExecContext(ctx, `UPDATE assessment_module_boundaries
			SET revision = revision + 1 WHERE module_attempt_id = ? AND phase = 'collecting'`, module.id)
		if err != nil {
			return err
		}
		if changed, err := res.RowsAffected(); err != nil {
			return err
		} else if changed != 1 {
			return assessmentConflict("BOUNDARY_UNSETTLED", "The SAT recovery boundary changed during registration.")
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	for _, transition := range recoveryTransitions {
		recordSATRecoveryBoundaryTransition(transition)
	}
	if terminalErr != nil {
		recordSATRecoveryRegistration("expired")
		return nil, terminalErr
	}
	if receipt != nil && receipt.Replayed {
		recordSATRecoveryRegistration("replayed")
	} else if receipt != nil {
		recordSATRecoveryRegistration("registered")
	}
	return receipt, nil
}

// AuthorizeFrozenSATBatch implements attempts.FrozenSATBatchAuthorizer. It is
// called under attempt and runtime locks by the shared V2 write path, then
// locks the module and boundary in the established order before checking each
// command against the registered frontier.
func (s *Service) AuthorizeFrozenSATBatch(
	ctx context.Context,
	q tx.Tx,
	claims crypto.AttemptClaims,
	cmd attempts.SaveResponsesCommand,
	now time.Time,
) (string, error) {
	if cmd.ModuleClose == nil || claims.AttemptID != cmd.AttemptID || cmd.ModuleClose.ModuleAttemptID == "" {
		return "", apperrors.New(apperrors.CodeAttemptTokenInvalid, "Invalid SAT recovery write context.")
	}
	var moduleID string
	if err := q.QueryRowContext(ctx, `SELECT module_id FROM assessment_module_attempts
		WHERE id = ? AND attempt_id = ?`, cmd.ModuleClose.ModuleAttemptID, cmd.AttemptID).Scan(&moduleID); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", apperrors.New(apperrors.CodeNotFound, "SAT module attempt not found.")
		}
		return "", err
	}
	module, err := lockModuleAttemptTx(ctx, q, cmd.AttemptID, moduleID)
	if err != nil {
		return "", err
	}
	if module.id != cmd.ModuleClose.ModuleAttemptID || (module.state != "active" && module.state != "review") {
		return "", assessmentConflict("MODULE_NOT_ACTIVE", "The registered SAT module is not active.")
	}
	boundary, err := lockSatModuleBoundaryTx(ctx, q, module.id)
	if err != nil {
		return "", err
	}
	if boundary == nil || boundary.attemptID != cmd.AttemptID || boundary.phase != "collecting" ||
		boundary.policyVersion != attempts.SATRecoveryPolicyV1 || boundary.recoveryDeadline == nil || !now.Before(*boundary.recoveryDeadline) {
		return "", assessmentConflict("BOUNDARY_RECOVERY_EXPIRED", "The frozen answer recovery period has ended.")
	}
	var policy *attempts.SATDeliveryPolicy
	policy, err = satRecoveryPolicyTx(ctx, q, cmd.AttemptID)
	if err != nil {
		return "", err
	}
	if policy == nil || policy.Version != boundary.policyVersion {
		return "", apperrors.New(apperrors.CodeConflict, "SAT recovery policy is unavailable.")
	}
	var attemptID, storedManifestHash, rawManifest string
	if err := q.QueryRowContext(ctx, `
		SELECT attempt_id, manifest_hash, CAST(manifest AS CHAR)
		FROM assessment_module_close_intents WHERE module_attempt_id = ?`, module.id).
		Scan(&attemptID, &storedManifestHash, &rawManifest); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return "", assessmentConflict("CLOSE_FRONTIER_NOT_REGISTERED", "Register the complete frozen answer frontier before uploading recovery chunks.")
		}
		return "", err
	}
	if attemptID != cmd.AttemptID || storedManifestHash != cmd.ModuleClose.ManifestHash {
		return "", assessmentConflict("CLOSE_REGISTRATION_MISMATCH", "The recovery chunk does not match the registered answer frontier.")
	}
	var manifest []ModuleCloseAnswer
	if err := json.Unmarshal([]byte(rawManifest), &manifest); err != nil {
		return "", err
	}
	canonicalHash, err := attempts.HashResponse(manifest)
	if err != nil {
		return "", err
	}
	if canonicalHash != storedManifestHash {
		return "", apperrors.New(apperrors.CodeConflict, "The registered SAT recovery frontier failed its integrity check.")
	}
	byQuestion := make(map[string]ModuleCloseAnswer, len(manifest))
	for _, entry := range manifest {
		byQuestion[entry.QuestionID] = entry
	}
	for _, command := range cmd.Commands {
		entry, ok := byQuestion[command.QuestionID]
		if !ok || entry.WriteID != command.WriteID || uint64(entry.ClientVersion) != command.ClientVersion {
			return "", assessmentConflict("CLOSE_CHUNK_OUTSIDE_FRONTIER", "A recovery chunk contains an answer outside the registered frontier.")
		}
		contentHash, err := attempts.HashResponsePayload(command.Response)
		if err != nil {
			return "", err
		}
		if contentHash != entry.ContentHash {
			return "", assessmentConflict("CLOSE_CHUNK_CONTENT_MISMATCH", "A recovery chunk does not match the registered answer content.")
		}
	}
	return module.moduleID, nil
}

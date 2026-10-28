package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"sort"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/lifecycle"
	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// ModuleCloseRequest is the browser's confirmation that every answer it holds
// for a module whose clock has run out has been sent (docs/sat-m1-m2-handoff-
// plan.md, Phase 3). Answers is the manifest: the latest write the browser
// holds for each question it has a value for.
type ModuleCloseRequest struct {
	Protocol        string                     `json:"protocol,omitempty"`
	ModuleID        string                     `json:"moduleId"`
	ModuleAttemptID string                     `json:"moduleAttemptId"`
	CloseID         string                     `json:"closeId"`
	LeaseEpoch      uint64                     `json:"leaseEpoch,omitempty"`
	ControlEpoch    uint64                     `json:"controlEpoch,omitempty"`
	Answers         []ModuleCloseAnswer        `json:"answers"`
	FinalCommands   []attempts.ResponseCommand `json:"finalCommands,omitempty"`
}

// ModuleCloseAnswer is one manifest entry.
type ModuleCloseAnswer struct {
	QuestionID    string `json:"questionId"`
	WriteID       string `json:"writeId"`
	ClientVersion int64  `json:"clientVersion"`
	ContentHash   string `json:"contentHash,omitempty"`
}

// SatModuleCloseAck is the compact close answer: the attempt's module rows
// after the close and the follow-up module's section. While the follow-up
// waits for the browser (client_start) that section is metadata only; its
// questions arrive with StartModule(needContent), which starts its clock.
type SatModuleCloseAck struct {
	Closed           bool             `json:"closed"`
	ControlEpoch     int              `json:"controlEpoch"`
	ScheduleID       string           `json:"scheduleId"`
	AttemptID        string           `json:"attemptId"`
	ModuleID         string           `json:"moduleId"`
	ModuleAttemptID  string           `json:"moduleAttemptId"`
	RouteBasis       string           `json:"routeBasis,omitempty"`
	AlreadyClosed    bool             `json:"alreadyClosed"`
	ModuleAttempts   []ModuleAttempt  `json:"moduleAttempts"`
	NextModuleID     *string          `json:"nextModuleId"`
	SelectedSection  *DeliverySection `json:"selectedSection,omitempty"`
	ServerNow        time.Time        `json:"serverNow"`
	FinalAcks        []attempts.Ack   `json:"finalAcks,omitempty"`
	ResponseRevision uint64           `json:"responseRevision,omitempty"`
	BoundaryPhase    string           `json:"boundaryPhase,omitempty"`
	selectedRoute    string
	lateAnswerCount  int
}

// Close outcomes (telemetry label vocabulary).
const (
	closeOutcomeClosed        = "closed"
	closeOutcomeAlreadyClosed = "already_closed"
	closeOutcomeNotExpired    = "not_expired"
	closeOutcomeWritesPending = "writes_pending"
)

// maxCloseManifest bounds the manifest to one SAT module's question count
// with headroom; a larger body is malformed.
const maxCloseManifest = 200
const maxFrozenCloseCommands = 400

// CloseModule routes a personal SAT module as soon as its browser confirms
// its final answers, instead of waiting out the close window.
//
// Invariants (docs/sat-m1-m2-handoff-plan.md §4.1):
//   - I2: the module closes only at or after its deadline, and only when every
//     manifest write is durable; the score is computed in the same transaction
//     that locks the module, under the attempt row lock every V2 write also
//     takes first, so no answer can land between scoring and locking.
//   - I3: one route decision per attempt — the module CAS
//     (state IN active/review) and uq_assessment_route_decision; a duplicate or
//     racing close (or the reconciler) sees the module locked and answers with
//     the current state.
//
// Lock order matches ReconcileAttemptTimeout and StartModule: attempt FOR
// UPDATE -> runtime FOR SHARE -> module row FOR UPDATE.
func (s *Service) CloseModule(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string, req ModuleCloseRequest, writerBinding ...string) (*SatModuleCloseAck, error) {
	return s.closeModule(ctx, bearerScheduleID, bearerAttemptID, urlScheduleID, req, nil, writerBinding...)
}

// CloseModuleRecovery carries claims that were verified by the HTTP edge.
// Only the new pinned protocol can use them to apply final commands in the
// close transaction; legacy callers retain the manifest-only behavior.
func (s *Service) CloseModuleRecovery(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string, req ModuleCloseRequest, claims crypto.AttemptClaims, writerBinding ...string) (*SatModuleCloseAck, error) {
	return s.closeModule(ctx, bearerScheduleID, bearerAttemptID, urlScheduleID, req, &claims, writerBinding...)
}

func (s *Service) closeModule(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string, req ModuleCloseRequest, claims *crypto.AttemptClaims, writerBinding ...string) (*SatModuleCloseAck, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	if strings.TrimSpace(req.ModuleID) == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "moduleId is required.")
	}
	if strings.TrimSpace(req.ModuleAttemptID) == "" || strings.TrimSpace(req.CloseID) == "" || len(req.CloseID) > 64 {
		return nil, apperrors.New(apperrors.CodeValidation, "moduleAttemptId and closeId are required.")
	}
	if len(req.Answers) > maxCloseManifest {
		return nil, apperrors.New(apperrors.CodeValidation, "The close manifest is too large.")
	}
	if len(req.FinalCommands) > maxFrozenCloseCommands {
		return nil, apperrors.New(apperrors.CodeValidation, "The frozen answer set is too large to recover safely.")
	}
	req.Answers = append([]ModuleCloseAnswer(nil), req.Answers...)
	sort.Slice(req.Answers, func(i, j int) bool { return req.Answers[i].QuestionID < req.Answers[j].QuestionID })
	for i, answer := range req.Answers {
		if strings.TrimSpace(answer.QuestionID) == "" || strings.TrimSpace(answer.WriteID) == "" || len(answer.WriteID) > 64 || answer.ClientVersion < 1 || (i > 0 && answer.QuestionID == req.Answers[i-1].QuestionID) {
			return nil, apperrors.New(apperrors.CodeValidation, "The close manifest requires unique question IDs, exact write IDs, and positive versions.")
		}
	}
	if req.Protocol != "" && req.Protocol != attempts.SATRecoveryPolicyV1 {
		return nil, apperrors.New(apperrors.CodeValidation, "Unsupported SAT module-close protocol.")
	}
	if req.Protocol == attempts.SATRecoveryPolicyV1 {
		if claims == nil || req.LeaseEpoch == 0 || req.ControlEpoch == 0 {
			return nil, apperrors.New(apperrors.CodeBadRequest, "The recovery close requires an authenticated session and current epochs.")
		}
		normalized, err := normalizeFrozenManifest(req.Answers)
		if err != nil {
			return nil, err
		}
		req.Answers = normalized
		if err := validateFrozenCloseCommands(req); err != nil {
			return nil, err
		}
	}
	requestHash, err := lifecycle.Hash("close_module", req)
	if err != nil {
		return nil, err
	}
	if !hasSATCloseAdmission(ctx) {
		if s.satCloseAdmission == nil {
			return nil, apperrors.New(apperrors.CodeServiceUnavailable, "Module close is temporarily unavailable; please retry.")
		}
		releaseClose, err := s.satCloseAdmission.acquire(ctx)
		if err != nil {
			return nil, err
		}
		defer releaseClose()
	}
	scheduleID, _, providerKey, versionID, err := s.startModuleBinding(ctx, bearerScheduleID, bearerAttemptID)
	if err != nil {
		return nil, err
	}
	if providerKey != "sat" {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}

	var (
		hubEvents           []liveupdates.Event
		nextModuleID        string
		alreadyClosed       bool
		sealed              bool
		sealCreated         bool
		needsComplete       bool
		finalAcks           []attempts.Ack
		responseRevision    uint64
		boundaryPhase       string
		boundaryRecoveryErr error
		recoveryTransitions []satBoundaryTransition
	)
	var committedAck *SatModuleCloseAck
	scope := lifecycle.Scope{ScheduleID: scheduleID, AttemptID: bearerAttemptID}
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		hubEvents, nextModuleID, alreadyClosed, sealed, sealCreated, needsComplete = nil, "", false, false, false, false
		finalAcks, responseRevision, boundaryPhase, boundaryRecoveryErr = nil, 0, "", nil
		recoveryTransitions = nil
		committedAck = nil
		var runtimeSnapshot moduleTimingRuntimeSnapshot
		var authoritySnapshot attemptAuthoritySnapshot
		workErr := s.ensureAttemptCanWorkWithAuthorityTx(ctx, t, scheduleID, bearerAttemptID, &runtimeSnapshot, &authoritySnapshot)
		if workErr != nil {
			e, ok := apperrors.As(workErr)
			if !ok || e.Code != apperrors.CodeAssessmentConflict {
				return workErr
			}
		}
		if err := enforceWriterSessionWithAuthorityTx(ctx, t, scheduleID, bearerAttemptID, writerBinding, &authoritySnapshot); err != nil {
			return err
		}
		stored, err := lifecycle.Load(ctx, t, scope, req.CloseID, "close_module", requestHash)
		if err != nil {
			return err
		}
		if stored != nil {
			if err := json.Unmarshal(stored, &committedAck); err != nil {
				return err
			}
			alreadyClosed = true
			return nil
		}
		recoveryPolicy := runtimeSnapshot.recoveryPolicy
		storeClose := func() error {
			var err error
			committedAck, err = s.withTxDatabase(t).closeAck(ctx, scheduleID, bearerAttemptID, versionID, req.ModuleID, nextModuleID, alreadyClosed, recoveryPolicy != nil)
			if err != nil {
				return err
			}
			committedAck.FinalAcks = append([]attempts.Ack(nil), finalAcks...)
			committedAck.ResponseRevision = responseRevision
			committedAck.BoundaryPhase = boundaryPhase
			return lifecycle.Store(ctx, t, scope, req.CloseID, "close_module", requestHash, committedAck)
		}
		if !runtimeSnapshot.exists {
			if workErr != nil {
				return workErr
			}
			return assessmentConflict("RUNTIME_NOT_LIVE", "The SAT session has not been started by the proctor.")
		}
		if !examruntime.IsSatPersonal(runtimeSnapshot.timingModel.String) {
			// Cohort clocks close on the shared section boundary; the close
			// window there stays SATSaveGrace and the reconciler routes.
			return assessmentConflict("CLOSE_UNSUPPORTED", "This SAT session closes modules on the shared section clock.")
		}
		if recoveryPolicy != nil && (req.Protocol != recoveryPolicy.Version || claims == nil || s.frozenResponseApplier == nil) {
			return assessmentConflict("RECOVERY_PROTOCOL_REQUIRED", "This SAT session requires the frozen recovery close protocol.")
		}
		if recoveryPolicy != nil {
			if err := enforceControlEpochValue(bearerAttemptID, authoritySnapshot.controlEpoch, req.ControlEpoch); err != nil {
				return err
			}
		}
		if recoveryPolicy == nil && req.Protocol != "" {
			return assessmentConflict("RECOVERY_PROTOCOL_UNAVAILABLE", "This SAT session does not use frozen recovery closes.")
		}
		module, err := lockModuleAttemptTx(ctx, t, bearerAttemptID, req.ModuleID)
		if err != nil {
			return err
		}
		if req.ModuleAttemptID != "" && req.ModuleAttemptID != module.id {
			return assessmentConflict("MODULE_ATTEMPT_MISMATCH", "The module attempt does not match this module.")
		}
		switch module.state {
		case "locked", "submitted":
			alreadyClosed = true
			return storeClose()
		case "active", "review":
		default:
			return assessmentConflict("MODULE_NOT_ACTIVE", "The SAT module is not active.")
		}
		if workErr != nil {
			return workErr
		}
		now, err := dbTimeTx(ctx, t)
		if err != nil {
			return err
		}
		var boundary *satModuleBoundary
		if recoveryPolicy != nil {
			boundary, err = ensureSatModuleBoundaryAndLockTx(ctx, t, bearerAttemptID, module.id, recoveryPolicy)
			if err != nil {
				return err
			}
			if boundary == nil || boundary.policyVersion != recoveryPolicy.Version {
				return apperrors.New(apperrors.CodeConflict, "SAT recovery boundary is unavailable.")
			}
			registered, err := loadSATCloseIntentTx(ctx, t, module.id)
			if err != nil {
				return err
			}
			if registered != nil && (registered.registrationID != req.CloseID || !equalFrozenManifest(req.Answers, registered.manifest)) {
				return assessmentConflict("CLOSE_REGISTRATION_MISMATCH", "The close does not match the registered frozen answer frontier.")
			}
			if boundary.phase == "working" && boundary.workDeadline != nil && !now.Before(*boundary.workDeadline) {
				if err := setSatBoundaryPhaseTx(ctx, t, module.id, "working", "collecting", boundary.recoveryDeadline); err != nil {
					return err
				}
				recoveryTransitions = append(recoveryTransitions, satBoundaryTransition{from: "working", to: "collecting"})
				boundary.phase = "collecting"
			}
			if boundary.phase == "collecting" && boundary.recoveryDeadline != nil && !now.Before(*boundary.recoveryDeadline) {
				if err := setSatBoundaryPhaseTx(ctx, t, module.id, "collecting", "blocked", nil); err != nil {
					return err
				}
				recoveryTransitions = append(recoveryTransitions, satBoundaryTransition{from: "collecting", to: "blocked"})
				boundaryRecoveryErr = assessmentConflict("RECOVERY_EXPIRED", "The SAT connection recovery period has ended.")
				return nil
			}
		}
		deadline := moduleDeadline(module.availableAt, module.startedAt, module.allocatedSeconds, module.accumulatedPausedSeconds, module.extensionSeconds)
		if recoveryPolicy != nil && boundary != nil {
			deadline = boundary.workDeadline
		}
		if module.startedAt == nil || module.pausedAt != nil || deadline == nil || now.Before(*deadline) {
			conflict := assessmentConflict("MODULE_NOT_EXPIRED", "The SAT module clock has not run out yet.")
			details := map[string]any{"reason": "MODULE_NOT_EXPIRED", "serverNow": now}
			if deadline != nil {
				details["deadlineAt"] = *deadline
			}
			conflict.Details = details
			return conflict
		}
		if recoveryPolicy != nil {
			if boundary.phase != "collecting" {
				return assessmentConflict("BOUNDARY_NOT_COLLECTING", "The SAT module recovery boundary is not accepting answers.")
			}
			if boundary.recoveryDeadline == nil || !now.Before(*boundary.recoveryDeadline) {
				return assessmentConflict("RECOVERY_EXPIRED", "The SAT connection recovery period has ended.")
			}
			finalAcks, responseRevision, err = s.applyFrozenCloseCommandsTx(ctx, t, *claims, req, module.moduleID)
			if err != nil {
				return err
			}
		}
		pending, err := pendingCloseWritesTx(ctx, t, bearerAttemptID, module.moduleID, req.Answers)
		if err != nil {
			return err
		}
		if len(pending) > 0 {
			conflict := assessmentConflict("CLOSE_WRITES_PENDING", "Some answers have not reached the server yet.")
			conflict.Details = map[string]any{"reason": "CLOSE_WRITES_PENDING", "questionIds": pending}
			return conflict
		}
		if recoveryPolicy != nil {
			manifestBytes, err := json.Marshal(req.Answers)
			if err != nil {
				return err
			}
			manifestHash, err := attempts.HashResponse(req.Answers)
			if err != nil {
				return err
			}
			if _, err := t.ExecContext(ctx, `
				UPDATE assessment_module_boundaries
				SET phase = 'settled', next_action_at = NULL, final_manifest = ?, manifest_hash = ?, revision = revision + 1
				WHERE module_attempt_id = ? AND run_generation = (SELECT ma_run.run_generation FROM assessment_module_attempts ma_run WHERE ma_run.id = assessment_module_boundaries.module_attempt_id) AND phase = 'collecting'`, string(manifestBytes), manifestHash, module.id); err != nil {
				return err
			}
			recoveryTransitions = append(recoveryTransitions, satBoundaryTransition{from: "collecting", to: "settled"})
			boundaryPhase = "settled"
		}
		followup := &moduleFollowupContext{recoveryControl: runtimeSnapshot.recoveryControl,
			timingModel:    runtimeSnapshot.timingModel.String,
			handoffMode:    runtimeSnapshot.handoffMode.String,
			recoveryPolicy: recoveryPolicy,
		}
		next, err := s.finalizeModuleWithBasisTx(ctx, t, bearerAttemptID, module, "time_expired", routeBasisClientConfirmed, followup)
		if err != nil {
			return err
		}
		if next != nil {
			nextModuleID = next.id
		} else if s.satTerminalizerInTx != nil {
			// The last module closed: seal on this transaction, exactly as the
			// reconciler does when it finalizes the final module.
			created, err := s.satTerminalizerInTx(ctx, t, scheduleID, bearerAttemptID)
			if err != nil {
				return err
			}
			sealed, sealCreated = true, created
		} else {
			needsComplete = true
		}
		rev, err := s.appendModuleEventsTx(ctx, t, scheduleID, bearerAttemptID, liveEventModuleSubmitted)
		if err != nil {
			return err
		}
		hubEvents = dualModuleEvents(scheduleID, bearerAttemptID, rev, liveEventModuleSubmitted)
		return storeClose()
	})
	if err != nil {
		if e, ok := apperrors.As(err); ok {
			switch e.Details["reason"] {
			case "MODULE_NOT_EXPIRED":
				telemetry.IncCounter(telemetry.MSATModuleCloseRequestTotal, "basis", routeBasisClientConfirmed, "outcome", closeOutcomeNotExpired)
			case "CLOSE_WRITES_PENDING":
				telemetry.IncCounter(telemetry.MSATModuleCloseRequestTotal, "basis", routeBasisClientConfirmed, "outcome", closeOutcomeWritesPending)
				telemetry.IncCounter(telemetry.MSATCloseWritesPendingTotal)
			}
		}
		return nil, err
	}
	for _, transition := range recoveryTransitions {
		recordSATRecoveryBoundaryTransition(transition)
	}
	if boundaryRecoveryErr != nil {
		return nil, boundaryRecoveryErr
	}
	s.publishHubEvents(hubEvents)
	if sealed {
		outcome := telemetry.FinalizeReplayed
		if sealCreated {
			outcome = telemetry.FinalizeCompleted
		}
		telemetry.IncCounter(telemetry.MSATFinalizeTotal, "outcome", outcome)
	}
	if needsComplete && s.completer != nil {
		if err := s.completer(ctx, scheduleID, bearerAttemptID); err != nil {
			return nil, apperrors.New(apperrors.CodeRecoveryFailed, "Assessment completion needs a retry.")
		}
	}
	outcome := closeOutcomeClosed
	if alreadyClosed {
		outcome = closeOutcomeAlreadyClosed
	}
	telemetry.IncCounter(telemetry.MSATModuleCloseRequestTotal, "basis", routeBasisClientConfirmed, "outcome", outcome)
	slog.InfoContext(ctx, "SAT module close", "attempt_id", bearerAttemptID,
		"module_attempt_id", req.ModuleAttemptID, "close_id", req.CloseID,
		"route_basis", committedAck.RouteBasis, "late_answer_count", committedAck.lateAnswerCount,
		"selected_route", committedAck.selectedRoute, "outcome", outcome)
	return committedAck, nil
}

func validateFrozenCloseCommands(req ModuleCloseRequest) error {
	manifest := make(map[string]ModuleCloseAnswer, len(req.Answers))
	for _, answer := range req.Answers {
		manifest[answer.QuestionID] = answer
	}
	seenWrites := make(map[string]struct{}, len(req.FinalCommands))
	for _, command := range req.FinalCommands {
		if err := attempts.ValidateCommand(command); err != nil {
			return err
		}
		if _, duplicate := seenWrites[command.WriteID]; duplicate {
			return apperrors.New(apperrors.CodeValidation, "The frozen answer set contains a duplicate write.")
		}
		seenWrites[command.WriteID] = struct{}{}
		latest, ok := manifest[command.QuestionID]
		if !ok || int64(command.ClientVersion) != latest.ClientVersion || command.WriteID != latest.WriteID {
			return apperrors.New(apperrors.CodeValidation, "The frozen commands do not match the declared answer frontier.")
		}
		if latest.ContentHash != "" {
			contentHash, err := attempts.HashResponsePayload(command.Response)
			if err != nil {
				return err
			}
			if contentHash != latest.ContentHash {
				return apperrors.New(apperrors.CodeValidation, "The frozen command content does not match the declared answer frontier.")
			}
		}
	}
	return nil
}

func (s *Service) applyFrozenCloseCommandsTx(ctx context.Context, t tx.Tx, claims crypto.AttemptClaims, req ModuleCloseRequest, moduleID string) ([]attempts.Ack, uint64, error) {
	if len(req.FinalCommands) == 0 {
		var revision uint64
		if err := t.QueryRowContext(ctx, "SELECT response_revision FROM student_attempts WHERE id = ?", claims.AttemptID).Scan(&revision); err != nil {
			return nil, 0, err
		}
		return nil, revision, nil
	}
	if s.frozenResponseApplier == nil {
		return nil, 0, apperrors.New(apperrors.CodeServiceUnavailable, "SAT frozen answer recovery is unavailable.")
	}
	var acks []attempts.Ack
	var responseRevision uint64
	for start := 0; start < len(req.FinalCommands); start += attempts.MaxBatchCommands {
		end := start + attempts.MaxBatchCommands
		if end > len(req.FinalCommands) {
			end = len(req.FinalCommands)
		}
		cmd := attempts.SaveResponsesCommand{
			AttemptID:  claims.AttemptID,
			LeaseEpoch: req.LeaseEpoch, ControlEpoch: req.ControlEpoch,
			Commands: req.FinalCommands[start:end], BearerTokenID: claims.TokenID,
		}
		result, err := s.frozenResponseApplier(ctx, t, claims, cmd, moduleID)
		if err != nil {
			return nil, 0, err
		}
		acks = append(acks, result.Acks...)
		responseRevision = result.ResponseRevision
	}
	return acks, responseRevision, nil
}

// pendingCloseWritesTx requires the manifest's exact write, not a comparable
// version from an unrelated writer. The projection and immutable ledger must
// agree on originating lease, version and canonical response hash.
func pendingCloseWritesTx(ctx context.Context, t tx.Tx, attemptID, moduleID string, manifest []ModuleCloseAnswer) ([]string, error) {
	if len(manifest) == 0 {
		return nil, nil
	}
	ids := []any{attemptID, moduleID}
	seen := make(map[string]bool, len(manifest))
	for _, entry := range manifest {
		if strings.TrimSpace(entry.QuestionID) == "" || strings.TrimSpace(entry.WriteID) == "" || len(entry.WriteID) > 64 || entry.ClientVersion < 1 || seen[entry.QuestionID] {
			return nil, apperrors.New(apperrors.CodeValidation, "The close manifest requires unique question ids, write ids and positive client versions.")
		}
		seen[entry.QuestionID] = true
		ids = append(ids, entry.QuestionID)
	}
	rows, err := t.QueryContext(ctx,
		"SELECT eq.id, v.client_version, v.lease_epoch, v.client_write_id, v.response_hash, l.client_write_id, l.client_version, l.lease_epoch, l.response_hash FROM assessment_exam_questions eq LEFT JOIN attempt_responses_v2 v ON v.attempt_id = ? AND v.module_id = eq.module_id AND v.question_id = eq.id LEFT JOIN attempt_mutations_v2 l ON l.attempt_id = v.attempt_id AND l.client_write_id = v.client_write_id AND l.question_id = eq.id WHERE eq.module_id = ? AND eq.id IN ("+sqlPlaceholders(len(manifest))+")", ids...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	type durableWrite struct {
		version, lease, ledgerVersion, ledgerLease sql.NullInt64
		write, hash, ledgerWrite, ledgerHash       sql.NullString
	}
	stored := make(map[string]durableWrite, len(manifest))
	for rows.Next() {
		var questionID string
		var durable durableWrite
		if err := rows.Scan(&questionID, &durable.version, &durable.lease, &durable.write, &durable.hash, &durable.ledgerWrite, &durable.ledgerVersion, &durable.ledgerLease, &durable.ledgerHash); err != nil {
			return nil, err
		}
		stored[questionID] = durable
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var pending []string
	for _, entry := range manifest {
		durable, belongs := stored[entry.QuestionID]
		if !belongs {
			return nil, apperrors.New(apperrors.CodeValidation, "The close manifest names a question outside this module.")
		}
		if !durable.version.Valid || durable.version.Int64 != entry.ClientVersion ||
			!durable.write.Valid || durable.write.String != entry.WriteID ||
			!durable.ledgerWrite.Valid || durable.ledgerWrite.String != entry.WriteID ||
			!durable.ledgerVersion.Valid || durable.ledgerVersion.Int64 != entry.ClientVersion ||
			!durable.lease.Valid || !durable.ledgerLease.Valid || durable.lease.Int64 != durable.ledgerLease.Int64 ||
			!durable.hash.Valid || !durable.ledgerHash.Valid || durable.hash.String != durable.ledgerHash.String {
			pending = append(pending, entry.QuestionID)
			continue
		}
		if entry.ContentHash != "" && durable.hash.String != entry.ContentHash {
			return nil, apperrors.New(apperrors.CodeConflict, "A registered answer differs from the canonical server response.")
		}
	}
	return pending, nil
}

// closeAck projects the attempt's module rows and the close-specific facts in
// one indexed read, then loads only the follow-up module's section. No
// reconcile, no responses, no full bootstrap: this answer is on the path every
// student takes at the same instant.
func (s *Service) closeAck(ctx context.Context, scheduleID, attemptID, versionID, moduleID, nextModuleID string, alreadyClosed, withholdRecoveryContent bool) (*SatModuleCloseAck, error) {
	projection, err := s.loadCloseAckProjection(ctx, attemptID, moduleID)
	if err != nil {
		return nil, err
	}
	ack := &SatModuleCloseAck{
		Closed:          true,
		ScheduleID:      scheduleID,
		AttemptID:       attemptID,
		ModuleID:        moduleID,
		AlreadyClosed:   alreadyClosed,
		ModuleAttempts:  projection.moduleAttempts,
		ServerNow:       projection.serverNow,
		ControlEpoch:    projection.controlEpoch,
		RouteBasis:      projection.routeBasis.String,
		lateAnswerCount: projection.lateAnswerCount,
		selectedRoute:   projection.selectedRoute.String,
	}
	for _, attempt := range projection.moduleAttempts {
		if attempt.ModuleID == moduleID {
			ack.ModuleAttemptID = attempt.ID
		}
	}
	if nextModuleID == "" {
		// A replayed close learns the follow-up from the rows: the first open
		// module after the closed one.
		for _, attempt := range projection.moduleAttempts {
			if attempt.State == "not_started" || attempt.State == "active" || attempt.State == "review" {
				nextModuleID = attempt.ModuleID
				break
			}
		}
	}
	if nextModuleID != "" {
		ack.NextModuleID = &nextModuleID
		nextModuleState := ""
		for _, attempt := range projection.moduleAttempts {
			if attempt.ModuleID == nextModuleID {
				nextModuleState = attempt.State
				break
			}
		}
		// Recovery closes keep unstarted content behind the authenticated Start
		// transaction. Build the response stub from module metadata only instead
		// of loading every question and then throwing that content away below.
		var section *DeliverySection
		if withholdRecoveryContent && nextModuleState != "active" && nextModuleState != "review" {
			section, err = s.selectedModuleSectionMetadata(ctx, attemptID, scheduleID, versionID, nextModuleID)
		} else {
			section, err = s.selectedModuleSection(ctx, attemptID, scheduleID, versionID, nextModuleID)
		}
		if err != nil {
			return nil, err
		}
		sections := []DeliverySection{*section}
		if withholdRecoveryContent {
			sections = withholdUnstartedModuleContent(sections, projection.moduleAttempts)
		} else {
			sections = withholdAwaitingModuleContent(sections, projection.moduleAttempts)
		}
		ack.SelectedSection = &sections[0]
	}
	return ack, nil
}

type closeAckProjection struct {
	moduleAttempts  []ModuleAttempt
	serverNow       time.Time
	controlEpoch    int
	routeBasis      sql.NullString
	lateAnswerCount int
	selectedRoute   sql.NullString
}

// loadCloseAckProjection combines reads that all use the same attempt and
// close module. The route decision is unique for a base module within an
// attempt's section, so this join does not multiply module-attempt rows.
func (s *Service) loadCloseAckProjection(ctx context.Context, attemptID, moduleID string) (closeAckProjection, error) {
	projection := closeAckProjection{moduleAttempts: []ModuleAttempt{}}
	rows, err := s.db.QueryContext(ctx, `
		SELECT ma.id, ma.module_id, ma.state, ma.allocated_seconds, ma.available_at,
			ma.started_at, ma.paused_at, ma.accumulated_paused_seconds,
			ma.extension_seconds, ma.completion_reason, ma.raw_correct,
			ma.operational_question_count, ma.tool_state, ma.revision,
			ma.entry_generation, ma.entry_starts_at, ma.entry_confirmed_at,
			ma.entry_entered_at, ma.auto_start_at,
			COALESCE(sa.control_epoch, 0), rd.route_basis,
			COALESCE(rd.late_answer_count, 0), rd.selected_route, UTC_TIMESTAMP(6)
		FROM assessment_module_attempts ma
		JOIN student_attempts sa ON sa.id = ma.attempt_id
		LEFT JOIN assessment_route_decisions rd
			ON rd.attempt_id = ma.attempt_id AND rd.base_module_id = ?
		WHERE ma.attempt_id = ?
		ORDER BY ma.created_at, ma.id`, moduleID, attemptID)
	if err != nil {
		return closeAckProjection{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var m ModuleAttempt
		var availableAt, startedAt, pausedAt, entryStartsAt, entryConfirmedAt, entryEnteredAt, autoStartAt sql.NullTime
		var completionReason, toolState sql.NullString
		var rawCorrect, operationalCount sql.NullInt64
		var entryGeneration int
		if err := rows.Scan(&m.ID, &m.ModuleID, &m.State, &m.AllocatedSeconds,
			&availableAt, &startedAt, &pausedAt, &m.AccumulatedPausedSeconds,
			&m.ExtensionSeconds, &completionReason, &rawCorrect, &operationalCount,
			&toolState, &m.Revision, &entryGeneration, &entryStartsAt, &entryConfirmedAt,
			&entryEnteredAt, &autoStartAt, &projection.controlEpoch, &projection.routeBasis,
			&projection.lateAnswerCount, &projection.selectedRoute, &projection.serverNow); err != nil {
			return closeAckProjection{}, err
		}
		m.AvailableAt = nullTime(availableAt)
		m.StartedAt = nullTime(startedAt)
		m.PausedAt = nullTime(pausedAt)
		m.CompletionReason = nullString(completionReason)
		m.RawCorrect = nullInt(rawCorrect)
		m.OperationalQuestionCount = nullInt(operationalCount)
		m.ToolState = rawJSON(toolState)
		if len(m.ToolState) == 0 {
			m.ToolState = json.RawMessage("{}")
		}
		m.EntryGeneration = &entryGeneration
		m.EntryStartsAt = nullTime(entryStartsAt)
		m.EntryConfirmedAt = nullTime(entryConfirmedAt)
		m.EntryEnteredAt = nullTime(entryEnteredAt)
		m.AutoStartAt = nullTime(autoStartAt)
		m.DeadlineAt, m.RemainingSeconds = computeModuleTiming(
			m.AvailableAt, m.StartedAt, m.PausedAt, m.AllocatedSeconds,
			m.AccumulatedPausedSeconds, m.ExtensionSeconds, projection.serverNow)
		projection.moduleAttempts = append(projection.moduleAttempts, m)
	}
	if err := rows.Err(); err != nil {
		return closeAckProjection{}, err
	}
	if len(projection.moduleAttempts) == 0 {
		return closeAckProjection{}, apperrors.New(apperrors.CodeNotFound, "Module attempt not found for this assessment.")
	}
	projection.serverNow = projection.serverNow.UTC()
	return projection, nil
}

// dbNow reads the authoritative database instant outside a transaction.
func (s *Service) dbNow(ctx context.Context) (time.Time, error) {
	var now time.Time
	if err := s.db.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return time.Time{}, err
	}
	return now.UTC(), nil
}

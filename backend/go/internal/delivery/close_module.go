package delivery

import (
	"context"
	"database/sql"
	"log/slog"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// ModuleCloseRequest is the browser's confirmation that every answer it holds
// for a module whose clock has run out has been sent (docs/sat-m1-m2-handoff-
// plan.md, Phase 3). Answers is the manifest: the latest write the browser
// holds for each question it has a value for.
type ModuleCloseRequest struct {
	ModuleID        string              `json:"moduleId"`
	ModuleAttemptID string              `json:"moduleAttemptId"`
	CloseID         string              `json:"closeId"`
	Answers         []ModuleCloseAnswer `json:"answers"`
}

// ModuleCloseAnswer is one manifest entry.
type ModuleCloseAnswer struct {
	QuestionID    string `json:"questionId"`
	WriteID       string `json:"writeId"`
	ClientVersion int64  `json:"clientVersion"`
}

// SatModuleCloseAck is the compact close answer: the attempt's module rows
// after the close and the follow-up module's section. While the follow-up
// waits for the browser (client_start) that section is metadata only; its
// questions arrive with StartModule(needContent), which starts its clock.
type SatModuleCloseAck struct {
	Closed          bool             `json:"closed"`
	ControlEpoch    int              `json:"controlEpoch"`
	ScheduleID      string           `json:"scheduleId"`
	AttemptID       string           `json:"attemptId"`
	ModuleID        string           `json:"moduleId"`
	ModuleAttemptID string           `json:"moduleAttemptId"`
	RouteBasis      string           `json:"routeBasis,omitempty"`
	AlreadyClosed   bool             `json:"alreadyClosed"`
	ModuleAttempts  []ModuleAttempt  `json:"moduleAttempts"`
	NextModuleID    *string          `json:"nextModuleId"`
	SelectedSection *DeliverySection `json:"selectedSection,omitempty"`
	ServerNow       time.Time        `json:"serverNow"`
	selectedRoute   string
	lateAnswerCount int
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

	var (
		hubEvents     []liveupdates.Event
		nextModuleID  string
		alreadyClosed bool
		sealed        bool
		sealCreated   bool
		needsComplete bool
	)
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		hubEvents, nextModuleID, alreadyClosed, sealed, sealCreated, needsComplete = nil, "", false, false, false, false
		workErr := s.ensureAttemptCanWorkTx(ctx, t, scheduleID, bearerAttemptID)
		if workErr != nil {
			e, ok := apperrors.As(workErr)
			if !ok || e.Code != apperrors.CodeAssessmentConflict {
				return workErr
			}
		}
		if err := enforceWriterSessionTx(ctx, t, scheduleID, bearerAttemptID, writerBinding...); err != nil {
			return err
		}
		var timingModel sql.NullString
		if err := t.QueryRowContext(ctx,
			"SELECT timing_model FROM exam_session_runtimes WHERE schedule_id = ? FOR SHARE", scheduleID).Scan(&timingModel); err != nil {
			return err
		}
		if !examruntime.IsSatPersonal(timingModel.String) {
			// Cohort clocks close on the shared section boundary; the close
			// window there stays SATSaveGrace and the reconciler routes.
			return assessmentConflict("CLOSE_UNSUPPORTED", "This SAT session closes modules on the shared section clock.")
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
			return nil
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
		deadline := moduleDeadline(module.availableAt, module.startedAt, module.allocatedSeconds, module.accumulatedPausedSeconds, module.extensionSeconds)
		if module.startedAt == nil || module.pausedAt != nil || deadline == nil || now.Before(*deadline) {
			conflict := assessmentConflict("MODULE_NOT_EXPIRED", "The SAT module clock has not run out yet.")
			details := map[string]any{"reason": "MODULE_NOT_EXPIRED", "serverNow": now}
			if deadline != nil {
				details["deadlineAt"] = *deadline
			}
			conflict.Details = details
			telemetry.IncCounter(telemetry.MSATModuleCloseRequestTotal, "basis", routeBasisClientConfirmed, "outcome", closeOutcomeNotExpired)
			return conflict
		}
		pending, err := pendingCloseWritesTx(ctx, t, bearerAttemptID, module.moduleID, req.Answers)
		if err != nil {
			return err
		}
		if len(pending) > 0 {
			conflict := assessmentConflict("CLOSE_WRITES_PENDING", "Some answers have not reached the server yet.")
			conflict.Details = map[string]any{"reason": "CLOSE_WRITES_PENDING", "questionIds": pending}
			telemetry.IncCounter(telemetry.MSATModuleCloseRequestTotal, "basis", routeBasisClientConfirmed, "outcome", closeOutcomeWritesPending)
			telemetry.IncCounter(telemetry.MSATCloseWritesPendingTotal)
			return conflict
		}
		next, err := s.finalizeModuleWithBasisTx(ctx, t, bearerAttemptID, module, "time_expired", routeBasisClientConfirmed)
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
		return nil
	})
	if err != nil {
		return nil, err
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
	ack, err := s.closeAck(ctx, scheduleID, bearerAttemptID, versionID, req.ModuleID, nextModuleID, alreadyClosed)
	if err == nil {
		slog.InfoContext(ctx, "SAT module close", "attempt_id", bearerAttemptID,
			"module_attempt_id", req.ModuleAttemptID, "close_id", req.CloseID,
			"route_basis", ack.RouteBasis, "late_answer_count", ack.lateAnswerCount,
			"selected_route", ack.selectedRoute, "outcome", outcome)
	}
	return ack, err
}

// pendingCloseWritesTx returns the manifest questions whose listed write is
// not yet durable for this module: no row, a row in another module, or a row
// older than the listed client version. Runs under the attempt row lock, so
// no write can land between this check and the finalize that follows it.
func pendingCloseWritesTx(ctx context.Context, t tx.Tx, attemptID, moduleID string, manifest []ModuleCloseAnswer) ([]string, error) {
	if len(manifest) == 0 {
		return nil, nil
	}
	ids := []any{attemptID, moduleID}
	seen := make(map[string]bool, len(manifest))
	for _, entry := range manifest {
		if strings.TrimSpace(entry.QuestionID) == "" || entry.ClientVersion < 1 || seen[entry.QuestionID] {
			return nil, apperrors.New(apperrors.CodeValidation, "The close manifest requires unique question ids and positive client versions.")
		}
		seen[entry.QuestionID] = true
		ids = append(ids, entry.QuestionID)
	}
	rows, err := t.QueryContext(ctx,
		"SELECT eq.id, v.client_version FROM assessment_exam_questions eq LEFT JOIN attempt_responses_v2 v ON v.attempt_id = ? AND v.module_id = eq.module_id AND v.question_id = eq.id WHERE eq.module_id = ? AND eq.id IN ("+sqlPlaceholders(len(manifest))+")", ids...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stored := make(map[string]sql.NullInt64, len(manifest))
	for rows.Next() {
		var questionID string
		var version sql.NullInt64
		if err := rows.Scan(&questionID, &version); err != nil {
			return nil, err
		}
		stored[questionID] = version
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	var pending []string
	for _, entry := range manifest {
		version, belongs := stored[entry.QuestionID]
		if !belongs {
			return nil, apperrors.New(apperrors.CodeValidation, "The close manifest names a question outside this module.")
		}
		if !version.Valid || version.Int64 < entry.ClientVersion {
			pending = append(pending, entry.QuestionID)
		}
	}
	return pending, nil
}

// closeAck projects the attempt's module rows after the close (one indexed
// read plus the personal offer columns) and the follow-up module's section.
// No reconcile, no responses, no full bootstrap: this answer is on the path
// every student takes at the same instant.
func (s *Service) closeAck(ctx context.Context, scheduleID, attemptID, versionID, moduleID, nextModuleID string, alreadyClosed bool) (*SatModuleCloseAck, error) {
	now, err := s.dbNow(ctx)
	if err != nil {
		return nil, err
	}
	moduleAttempts, err := s.loadModuleAttempts(ctx, attemptID, now)
	if err != nil {
		return nil, err
	}
	if err := s.loadPersonalEntryOffers(ctx, attemptID, moduleAttempts); err != nil {
		return nil, err
	}
	ack := &SatModuleCloseAck{
		Closed:         true,
		ScheduleID:     scheduleID,
		AttemptID:      attemptID,
		ModuleID:       moduleID,
		AlreadyClosed:  alreadyClosed,
		ModuleAttempts: moduleAttempts,
		ServerNow:      now,
	}
	if err := s.db.QueryRowContext(ctx, "SELECT COALESCE(control_epoch, 0) FROM student_attempts WHERE id = ?", attemptID).Scan(&ack.ControlEpoch); err != nil {
		return nil, err
	}
	for _, attempt := range moduleAttempts {
		if attempt.ModuleID == moduleID {
			ack.ModuleAttemptID = attempt.ID
		}
	}
	if nextModuleID == "" {
		// A replayed close learns the follow-up from the rows: the first open
		// module after the closed one.
		for _, attempt := range moduleAttempts {
			if attempt.State == "not_started" || attempt.State == "active" || attempt.State == "review" {
				nextModuleID = attempt.ModuleID
				break
			}
		}
	}
	if nextModuleID != "" {
		ack.NextModuleID = &nextModuleID
		section, err := s.selectedModuleSection(ctx, attemptID, scheduleID, versionID, nextModuleID)
		if err != nil {
			return nil, err
		}
		narrowed := withholdAwaitingModuleContent([]DeliverySection{*section}, moduleAttempts)
		ack.SelectedSection = &narrowed[0]
	}
	if err := s.closeRouteBasis(ctx, attemptID, moduleID, ack); err != nil {
		return nil, err
	}
	return ack, nil
}

// closeRouteBasis reports how the closed module was routed (audit + client
// telemetry); a module without a decision (non-adaptive) has none.
func (s *Service) closeRouteBasis(ctx context.Context, attemptID, moduleID string, ack *SatModuleCloseAck) error {
	var basis sql.NullString
	err := s.db.QueryRowContext(ctx,
		"SELECT route_basis, COALESCE(late_answer_count, 0), selected_route FROM assessment_route_decisions WHERE attempt_id = ? AND base_module_id = ?",
		attemptID, moduleID).Scan(&basis, &ack.lateAnswerCount, &ack.selectedRoute)
	if err == sql.ErrNoRows {
		return nil
	}
	if err != nil {
		return err
	}
	ack.RouteBasis = basis.String
	return nil
}

// dbNow reads the authoritative database instant outside a transaction.
func (s *Service) dbNow(ctx context.Context) (time.Time, error) {
	var now time.Time
	if err := s.db.QueryRowContext(ctx, "SELECT UTC_TIMESTAMP(6)").Scan(&now); err != nil {
		return time.Time{}, err
	}
	return now.UTC(), nil
}

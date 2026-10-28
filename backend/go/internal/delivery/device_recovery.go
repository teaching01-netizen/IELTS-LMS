package delivery

// Staff-assisted device recovery: staff issuance and preview.
//
// Issuance is one transaction that proves the selected closure, fences the old
// writer, records a held control, and stores a single-use grant with an
// encrypted staff reveal capsule. Every failure rolls the fence back, so a
// partial transfer can never strand a candidate or leak a half-issued code.
//
// This file intentionally does not mint student credentials or move clocks.
// Continue (the student's explicit action) owns those decisions; issuance only
// establishes who may attempt a continuation and with what time policy.

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	platformcrypto "example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

const (
	// recoveryGrantTTL is the issuance window (engineering default, matching
	// the existing transfer request TTL). It is not a product setting.
	recoveryGrantTTL = 10 * time.Minute
	// recoveryPathPrefix is the student route prefix. The link secret travels
	// in the fragment, never the path or query string.
	recoveryPathPrefix = "/student/recover/"
)

var recoveryOperationIDPattern = regexp.MustCompile(`^[A-Za-z0-9._:-]{8,64}$`)

// SetStaffDeviceRecovery wires the rollout gate and the deployment secret used
// to derive recovery credential verifiers. The capability is enabled only
// when the gate is on AND a secret is present; existing grants stay readable
// when it is off because options/status do not consult this switch.
func (s *Service) SetStaffDeviceRecovery(enabled bool, secret []byte) *Service {
	copied := append([]byte(nil), secret...)
	s.staffRecoveryEnabled = enabled && len(copied) >= 32
	s.recoverySecret = copied
	return s
}

func (s *Service) recoveryConfigured() bool {
	return s != nil && s.staffRecoveryEnabled && len(s.recoverySecret) >= 32
}

// recoverySecretsReady reports whether the deployment can open an issued
// capsule. It deliberately ignores the rollout gate: disabling NEW issuance
// must not destroy a staff member's ability to replay the response of a code
// that was already committed.
func (s *Service) recoverySecretsReady() bool {
	return s != nil && len(s.recoverySecret) >= 32
}

// RecoveryOptions returns the staff preview for one attempt. It is readable
// while new issuance is disabled: an already-held or working recovery must
// remain resolvable across a rollback.
func (s *Service) RecoveryOptions(ctx context.Context, scheduleID, attemptID string) (*DeviceRecoveryOptions, error) {
	scheduleID = strings.TrimSpace(scheduleID)
	attemptID = strings.TrimSpace(attemptID)
	if scheduleID == "" || attemptID == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "scheduleId and attemptId are required.")
	}
	var now time.Time
	var out *DeviceRecoveryOptions
	err := s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		row, err := loadRecoveryAttempt(ctx, q, scheduleID, attemptID, false)
		if err != nil {
			return err
		}
		now, err = dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		receipt, err := loadRecoveryReceiptReason(ctx, q, attemptID, row.TerminalGeneration)
		if err != nil {
			return err
		}
		facts, err := s.loadRecoveryTargetFacts(ctx, q, row, now)
		if err != nil {
			return err
		}
		targets := make([]DeviceRecoveryTarget, 0, len(facts))
		aggregate := RecoveryEligibility{Class: RecoveryClosureUnknown, Reason: RecoveryReasonIneligible}
		if len(facts) == 0 {
			aggregate.Reason = RecoveryReasonTargetRequired
		}
		for _, fact := range facts {
			eligibility := classifyRecoveryTarget(row, receipt, fact)
			targets = append(targets, DeviceRecoveryTarget{
				SectionKey:         fact.Target.SectionKey,
				Label:              fact.Label,
				ModuleAttemptID:    fact.Target.ModuleAttemptID,
				ModuleID:           fact.Target.ModuleID,
				State:              fact.State,
				ClosureReason:      fact.Reason,
				OriginalDeadlineAt: fact.Deadline,
				RemainingSeconds:   fact.RemainingSeconds,
				Current:            fact.Current,
				Eligibility:        eligibility,
			})
			if eligibility.Eligible {
				aggregate = RecoveryEligibility{Eligible: true, Class: eligibility.Class}
				continue
			}
			if !aggregate.Eligible && aggregate.Reason == RecoveryReasonIneligible && eligibility.Reason != "" {
				aggregate.Class = eligibility.Class
				aggregate.Reason = eligibility.Reason
			}
		}
		lastSave, err := loadLastServerSave(ctx, q, attemptID)
		if err != nil {
			return err
		}
		grant, err := loadLatestRecoveryGrant(ctx, q, attemptID)
		if err != nil {
			return err
		}
		var grantStatus *DeviceRecoveryGrantStatus
		if grant != nil {
			status := grant.status(now, s.recoverySecretsReady())
			grantStatus = &status
		}
		var reveal *IssuedDeviceRecovery
		if grant != nil && grantStatus != nil && grantStatus.SecretsAvailable {
			capsule, err := openRecoveryIssuance(s.recoverySecret, grant)
			if err != nil {
				return err
			}
			reveal = &IssuedDeviceRecovery{Grant: *grantStatus, LinkSecret: capsule.LinkSecret, Code: capsule.Code, RecoveryPath: recoveryPath(grant.ID, capsule.LinkSecret), ServerNow: now, Replayed: true}
		}
		out = &DeviceRecoveryOptions{IssuanceEnabled: s.staffRecoveryEnabled, Issuance: reveal,
			AttemptID:          row.ID,
			ScheduleID:         row.ScheduleID,
			CandidateName:      row.CandidateName,
			ProviderKey:        row.ProviderKey,
			ExamTitle:          row.ExamTitle,
			LeaseEpoch:         row.LeaseEpoch,
			ControlEpoch:       row.ControlEpoch,
			TerminalGeneration: row.TerminalGeneration,
			ServerNow:          now,
			LastServerSaveAt:   lastSave,
			Control:            publicRecoveryControl(row.Control),
			Eligibility:        aggregate,
			Targets:            targets,
			Grant:              grantStatus,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// IssueDeviceRecovery creates or replaces the transfer grant for one attempt.
//
// The same operation id replays the committed result without extending its
// expiry. A different operation id is a fresh staff decision and therefore
// requires current expected epochs: two concurrent staff members cannot both
// win, and a stale dialog can never overwrite a newer transfer.
func (s *Service) IssueDeviceRecovery(ctx context.Context, scheduleID, attemptID, actorID string, req IssueDeviceRecoveryRequest) (*IssuedDeviceRecovery, error) {
	scheduleID = strings.TrimSpace(scheduleID)
	attemptID = strings.TrimSpace(attemptID)
	actorID = strings.TrimSpace(actorID)
	if err := validateIssueDeviceRecovery(scheduleID, attemptID, actorID, &req); err != nil {
		return nil, err
	}
	var now time.Time
	requestHash := recoveryIssueRequestHash(attemptID, req)
	// Credential material is generated once per request. A transient retry
	// rolls back completely, so regenerating would give the same committed
	// grant different secrets only if the previous attempt was not durable.
	linkSecret, err := platformcrypto.NewRecoveryLinkSecret()
	if err != nil {
		return nil, err
	}
	code, err := platformcrypto.NewRecoveryCode()
	if err != nil {
		return nil, err
	}
	var out *IssuedDeviceRecovery
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		row, err := loadRecoveryAttempt(ctx, q, scheduleID, attemptID, true)
		if err != nil {
			return err
		}
		now, err = dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		existing, err := loadRecoveryGrantByOperation(ctx, q, req.OperationID)
		if err != nil {
			return err
		}
		if existing != nil {
			if existing.AttemptID != attemptID || existing.ScheduleID != scheduleID ||
				existing.IssuedByUserID != actorID || existing.RequestHash != requestHash {
				return recoveryConflict("OPERATION_ID_CONFLICT", "This operation ID was already used for a different recovery request.", nil)
			}
			status := existing.status(now, s.recoverySecretsReady())
			replay := &IssuedDeviceRecovery{Grant: status, ServerNow: now, Replayed: true}
			if recoveryGrantLive(status.State) && status.SecretsAvailable {
				issuance, err := openRecoveryIssuance(s.recoverySecret, existing)
				if err != nil {
					return err
				}
				replay.LinkSecret = issuance.LinkSecret
				replay.Code = issuance.Code
				replay.RecoveryPath = recoveryPath(existing.ID, issuance.LinkSecret)
			}
			out = replay
			return nil
		}
		if !s.recoveryConfigured() {
			return recoveryUnavailable("RECOVERY_DISABLED", "Staff-assisted device recovery is not enabled on this deployment.")
		}
		if row.LeaseEpoch != req.ExpectedLeaseEpoch || row.ControlEpoch != req.ExpectedControlEpoch {
			return recoveryConflict("RECOVERY_STALE", "The attempt changed since this dialog was loaded. Refresh and try again.", map[string]any{
				"leaseEpoch":   row.LeaseEpoch,
				"controlEpoch": row.ControlEpoch,
			})
		}
		receipt, err := loadRecoveryReceiptReason(ctx, q, attemptID, row.TerminalGeneration)
		if err != nil {
			return err
		}
		facts, err := s.loadRecoveryTargetFacts(ctx, q, row, now)
		if err != nil {
			return err
		}
		fact, ok := matchRecoveryTarget(facts, row.ProviderKey, req.Target)
		if !ok {
			return recoveryConflict(RecoveryReasonIneligible, "The selected section is not part of this sitting.", nil)
		}
		eligibility := classifyRecoveryTarget(row, receipt, fact)
		if !eligibility.Eligible {
			reason := eligibility.Reason
			if reason == "" {
				reason = RecoveryReasonIneligible
			}
			return recoveryConflict(reason, recoveryIneligibleMessage(reason), nil)
		}
		clock, err := examruntime.PlanRecoveryClock(now, fact.Deadline, req.RemainingSeconds)
		if err != nil {
			reason := examruntime.RecoveryReason(err)
			if reason == "" {
				reason = RecoveryReasonIneligible
			}
			return recoveryConflict(reason, recoveryTimeMessage(reason), nil)
		}

		grantID := uuid.NewString()
		control, replacedGrantID, err := s.prepareRecoveryControl(ctx, q, row, fact.Target, grantID, now)
		if err != nil {
			return err
		}
		leaseEpoch, controlEpoch, err := attempts.FenceForRecoveryInTx(ctx, q, attemptID, control)
		if err != nil {
			return err
		}
		expiresAt := now.Add(recoveryGrantTTL)
		issuance := recoveryIssuanceCapsule{
			LinkSecret: linkSecret,
			Code:       code,
			IssuedAt:   now,
			ExpiresAt:  expiresAt,
		}
		capsule, err := json.Marshal(issuance)
		if err != nil {
			return err
		}
		sealed, err := platformcrypto.SealRecoveryIssuance(s.recoverySecret, grantID, attemptID, capsule)
		if err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO attempt_device_recovery_grants
			(id, attempt_id, schedule_id, issued_by_user_id, operation_id, request_hash,
			 active_attempt_id, state, target_section_key, target_module_attempt_id,
			 target_module_id, requested_remaining_seconds, expected_control_epoch,
			 expected_lease_epoch, grant_revision, link_secret_hash, code_mac,
			 failed_code_count, issued_at, expires_at, sealed_issuance)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'issued', ?, ?, ?, ?, ?, ?, 1, ?, ?, 0, ?, ?, ?)`,
			grantID, attemptID, scheduleID, actorID, req.OperationID, requestHash,
			attemptID, fact.Target.SectionKey, nullIfEmpty(fact.Target.ModuleAttemptID),
			nullIfEmpty(fact.Target.ModuleID), recoveryNullInt(req.RemainingSeconds),
			row.ControlEpoch, row.LeaseEpoch,
			platformcrypto.RecoveryLinkHash(s.recoverySecret, linkSecret),
			platformcrypto.RecoveryCodeMAC(s.recoverySecret, grantID, attemptID, code),
			now, expiresAt, sealed); err != nil {
			return err
		}
		action := "DEVICE_RECOVERY_ISSUED"
		if replacedGrantID != "" {
			action = "DEVICE_RECOVERY_REISSUED"
		}
		auditPayload := map[string]any{
			"grantId":              grantID,
			"replacedGrantId":      replacedGrantID,
			"target":               fact.Target,
			"remainingSeconds":     req.RemainingSeconds,
			"expectedLeaseEpoch":   row.LeaseEpoch,
			"expectedControlEpoch": row.ControlEpoch,
			"leaseEpoch":           leaseEpoch,
			"controlEpoch":         controlEpoch,
			"expiresAt":            expiresAt,
			"originalDeadlineAt":   fact.Deadline,
			"awardedSeconds":       clock.AwardedSeconds,
		}
		payload, err := json.Marshal(auditPayload)
		if err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO session_audit_logs
			(id, schedule_id, actor, action_type, target_student_id, payload, created_at)
			VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6))`,
			uuid.NewString(), scheduleID, actorID, action, attemptID, string(payload)); err != nil {
			return err
		}
		out = &IssuedDeviceRecovery{
			Grant: DeviceRecoveryGrantStatus{
				GrantID:                   grantID,
				State:                     recoveryGrantIssued,
				Target:                    fact.Target,
				RequestedRemainingSeconds: req.RemainingSeconds,
				GrantRevision:             1,
				IssuedAt:                  now,
				ExpiresAt:                 expiresAt,
				SecretsAvailable:          true,
			},
			LinkSecret:   linkSecret,
			Code:         code,
			RecoveryPath: recoveryPath(grantID, linkSecret),
			ServerNow:    now,
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

func validateIssueDeviceRecovery(scheduleID, attemptID, actorID string, req *IssueDeviceRecoveryRequest) error {
	if scheduleID == "" || attemptID == "" {
		return apperrors.New(apperrors.CodeValidation, "scheduleId and attemptId are required.")
	}
	if actorID == "" || len(actorID) > 255 {
		return apperrors.New(apperrors.CodeValidation, "actorId is required.")
	}
	req.OperationID = strings.TrimSpace(req.OperationID)
	if !recoveryOperationIDPattern.MatchString(req.OperationID) {
		return apperrors.New(apperrors.CodeValidation, "operationId must be 8-64 URL-safe characters.")
	}
	req.Target = req.Target.Normalized()
	if req.Target.Empty() {
		return apperrors.New(apperrors.CodeValidation, "A recovery target is required.")
	}
	if err := req.Target.Validate(""); err != nil {
		return apperrors.New(apperrors.CodeValidation, "The recovery target is invalid.")
	}
	if req.RemainingSeconds != nil {
		if *req.RemainingSeconds < 1 || *req.RemainingSeconds > examruntime.MaxRecoveryAwardSeconds {
			return recoveryConflict(examruntime.ReasonRecoveryInvalidTime, "Remaining time must be between 1 and 86400 seconds.", nil)
		}
		award := *req.RemainingSeconds
		req.RemainingSeconds = &award
	}
	return nil
}

func recoveryIssueRequestHash(attemptID string, req IssueDeviceRecoveryRequest) string {
	// Struct field order is fixed by the type, and the target is already
	// normalized, so identical semantic requests hash identically across
	// processes and retries.
	payload := struct {
		AttemptID            string                    `json:"attemptId"`
		Target               examdomain.RecoveryTarget `json:"target"`
		ExpectedLeaseEpoch   uint64                    `json:"expectedLeaseEpoch"`
		ExpectedControlEpoch uint64                    `json:"expectedControlEpoch"`
		RemainingSeconds     *int                      `json:"remainingSeconds"`
	}{
		AttemptID:            attemptID,
		Target:               req.Target,
		ExpectedLeaseEpoch:   req.ExpectedLeaseEpoch,
		ExpectedControlEpoch: req.ExpectedControlEpoch,
		RemainingSeconds:     req.RemainingSeconds,
	}
	raw, _ := json.Marshal(payload)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// recoveryAttemptRow is the locked attempt projection issuance needs. Provider
// comes from a non-locking subquery so the exam entity row is never locked by
// a candidate-owned transaction.
type recoveryAttemptRow struct {
	ID                 string
	ScheduleID         string
	ExamID             string
	PublishedVersionID string
	CandidateName      string
	ExamTitle          string
	DeliveryStatus     string
	Phase              string
	SubmittedAt        sql.NullTime
	ProctorStatus      string
	ActiveSession      sql.NullString
	LeaseEpoch         uint64
	ControlEpoch       uint64
	TerminalGeneration uint64
	Control            *examdomain.RecoveryControl
	ProviderKey        string
	ExamType           string
	UpdatedAt          time.Time
	UserID             sql.NullString
	OrganizationID     sql.NullString
}

func (r recoveryAttemptRow) open() bool {
	if r.SubmittedAt.Valid {
		return false
	}
	switch r.DeliveryStatus {
	case "submitted", "terminated", "locked", "cancelled":
		return false
	}
	return r.Phase != "post-exam" && r.ProctorStatus != "terminated"
}

func (r recoveryAttemptRow) closureFacts(receiptReason string) ClosureFacts {
	facts := ClosureFacts{
		Provider:      r.ProviderKey,
		ReceiptReason: receiptReason,
		Cancelled:     r.DeliveryStatus == "cancelled",
		ProctorEnded:  r.ProctorStatus == "terminated",
	}
	facts.Open = r.open() && normalizeClosureReason(receiptReason) == ""
	if !facts.Open && normalizeClosureReason(receiptReason) == "" {
		facts.UnknownClosure = true
	}
	return facts
}

func loadRecoveryAttempt(ctx context.Context, q tx.Tx, scheduleID, attemptID string, forUpdate bool) (recoveryAttemptRow, error) {
	query := `
		SELECT a.id, a.schedule_id, a.exam_id, a.published_version_id,
		       a.candidate_name, a.exam_title, a.delivery_status, a.phase,
		       a.submitted_at, CASE WHEN a.proctor_status = 'terminated' AND a.proctor_updated_by IS NULL AND EXISTS (SELECT 1 FROM attempt_terminalizations terminal WHERE terminal.attempt_id = a.id AND terminal.terminal_generation = a.terminal_generation AND terminal.reason = 'time_expired' AND terminal.actor_kind = 'system') THEN 'active' ELSE COALESCE(a.proctor_status, 'active') END,
		       a.active_client_session_id, a.lease_epoch, a.control_epoch,
		       a.terminal_generation, COALESCE(a.recovery_control, ''),
		       COALESCE((SELECT e.provider_key FROM exam_entities e WHERE e.id = a.exam_id), ''),
		       COALESCE((SELECT e.exam_type FROM exam_entities e WHERE e.id = a.exam_id), ''),
		       a.updated_at, a.user_id, a.organization_id
		FROM student_attempts a
		WHERE a.id = ? AND a.schedule_id = ?`
	if forUpdate {
		query += " FOR UPDATE"
	}
	var row recoveryAttemptRow
	var submitted sql.NullTime
	var active sql.NullString
	var rawControl, provider, examType sql.NullString
	var userID, organizationID sql.NullString
	err := q.QueryRowContext(ctx, query, attemptID, scheduleID).Scan(
		&row.ID, &row.ScheduleID, &row.ExamID, &row.PublishedVersionID,
		&row.CandidateName, &row.ExamTitle, &row.DeliveryStatus, &row.Phase,
		&submitted, &row.ProctorStatus, &active, &row.LeaseEpoch, &row.ControlEpoch,
		&row.TerminalGeneration, &rawControl, &provider, &examType, &row.UpdatedAt,
		&userID, &organizationID)
	if err == sql.ErrNoRows {
		return row, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	if err != nil {
		return row, err
	}
	row.SubmittedAt = submitted
	row.ActiveSession = active
	row.UserID = userID
	row.OrganizationID = organizationID
	row.ProviderKey = strings.ToLower(strings.TrimSpace(provider.String))
	if row.ProviderKey == "" {
		row.ProviderKey = examdomain.ProviderIELTS
	}
	row.ProviderKey = examdomain.EffectiveProviderKey(row.ProviderKey, examType.String)
	control, err := examdomain.ParseRecoveryControl([]byte(rawControl.String))
	if err != nil {
		// A corrupt authority record must fail closed; it can never fall back
		// to ordinary admission or a guessed phase.
		return row, fmt.Errorf("delivery: recovery control for attempt %s: %w", attemptID, err)
	}
	row.Control = control
	return row, nil
}

func loadRecoveryReceiptReason(ctx context.Context, q tx.Tx, attemptID string, generation uint64) (string, error) {
	var reason string
	err := q.QueryRowContext(ctx,
		`SELECT reason FROM attempt_terminalizations WHERE attempt_id = ? AND terminal_generation = ? LIMIT 1`,
		attemptID, generation).Scan(&reason)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(reason), nil
}

func loadLastServerSave(ctx context.Context, q tx.Tx, attemptID string) (*time.Time, error) {
	var last sql.NullTime
	if err := q.QueryRowContext(ctx,
		`SELECT MAX(updated_at) FROM attempt_responses_v2 WHERE attempt_id = ?`, attemptID).Scan(&last); err != nil {
		return nil, err
	}
	if !last.Valid {
		return nil, nil
	}
	v := last.Time.UTC()
	return &v, nil
}

// recoveryTargetFact is one trusted candidate stage plus the closure evidence
// used to decide whether staff may reopen it.
type recoveryTargetFact struct {
	Target           examdomain.RecoveryTarget
	Label            string
	State            string
	Reason           string
	Deadline         *time.Time
	RemainingSeconds *int64
	Current          bool
}

func (s *Service) loadRecoveryTargetFacts(ctx context.Context, q tx.Tx, row recoveryAttemptRow, now time.Time) ([]recoveryTargetFact, error) {
	switch row.ProviderKey {
	case examdomain.ProviderSAT:
		return loadSATRecoveryTargets(ctx, q, row, now)
	case examdomain.ProviderIELTS:
		model, err := recoveryTimingModel(ctx, q, row.ScheduleID)
		if err != nil {
			return nil, err
		}
		if examruntime.IsIELTSPersonal(model) {
			return loadIELTSRecoveryTargets(ctx, q, row, now)
		}
		return s.loadRuntimeRecoveryTargets(ctx, q, row, now)
	case examdomain.ProviderACT:
		return s.loadRuntimeRecoveryTargets(ctx, q, row, now)
	default:
		return nil, recoveryConflict(RecoveryReasonIneligible, "This provider does not support staff-assisted recovery.", nil)
	}
}

func recoveryTimingModel(ctx context.Context, q tx.Tx, scheduleID string) (string, error) {
	var model sql.NullString
	err := q.QueryRowContext(ctx,
		`SELECT timing_model FROM exam_session_runtimes WHERE schedule_id = ?`, scheduleID).Scan(&model)
	if err == sql.ErrNoRows {
		return examruntime.TimingModelLegacy, nil
	}
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(model.String) == "" {
		return examruntime.TimingModelLegacy, nil
	}
	return model.String, nil
}

func loadSATRecoveryTargets(ctx context.Context, q tx.Tx, row recoveryAttemptRow, now time.Time) ([]recoveryTargetFact, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT ma.id, ma.module_id, ma.state, ma.allocated_seconds, ma.started_at,
		       ma.available_at, ma.paused_at, ma.accumulated_paused_seconds,
		       ma.extension_seconds, COALESCE(ma.completion_reason, ''),
		       sec.section_key, sec.title, m.title
		FROM assessment_module_attempts ma
		JOIN assessment_modules m ON m.id = ma.module_id
		JOIN assessment_sections sec ON sec.id = m.section_id
		WHERE ma.attempt_id = ? AND sec.exam_version_id = ?
		ORDER BY sec.display_order, m.display_order, ma.id`, row.ID, row.PublishedVersionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []recoveryTargetFact{}
	for rows.Next() {
		var moduleAttemptID, moduleID, state, sectionKey, sectionTitle, moduleTitle string
		var allocated, accumulated, extension int
		var startedAt, availableAt, pausedAt sql.NullTime
		var reason sql.NullString
		if err := rows.Scan(&moduleAttemptID, &moduleID, &state, &allocated, &startedAt,
			&availableAt, &pausedAt, &accumulated, &extension, &reason,
			&sectionKey, &sectionTitle, &moduleTitle); err != nil {
			return nil, err
		}
		started := nullTime(startedAt)
		available := nullTime(availableAt)
		paused := nullTime(pausedAt)
		deadline, remaining := computeModuleTiming(available, started, paused, allocated, accumulated, extension, now)
		label := strings.TrimSpace(sectionTitle)
		if title := strings.TrimSpace(moduleTitle); title != "" {
			if label != "" {
				label += " — " + title
			} else {
				label = title
			}
		}
		out = append(out, recoveryTargetFact{
			Target: examdomain.RecoveryTarget{
				SectionKey:      sectionKey,
				ModuleAttemptID: moduleAttemptID,
				ModuleID:        moduleID,
			},
			Label:            label,
			State:            state,
			Reason:           strings.TrimSpace(reason.String),
			Deadline:         deadline,
			RemainingSeconds: remaining,
			Current:          state == "active" || state == "review",
		})
	}
	return out, rows.Err()
}

func loadIELTSRecoveryTargets(ctx context.Context, q tx.Tx, row recoveryAttemptRow, now time.Time) ([]recoveryTargetFact, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT section_key, state, COALESCE(completion_reason, ''), deadline_at, started_at
		FROM ielts_attempt_section_timelines
		WHERE attempt_id = ?
		ORDER BY section_order, section_key`, row.ID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []recoveryTargetFact{}
	for rows.Next() {
		var sectionKey, state string
		var reason sql.NullString
		var deadline, started sql.NullTime
		if err := rows.Scan(&sectionKey, &state, &reason, &deadline, &started); err != nil {
			return nil, err
		}
		d := nullTime(deadline)
		var remaining *int64
		if d != nil {
			v := int64(examruntime.RecoveryRemainingSeconds(now, d))
			remaining = &v
		}
		out = append(out, recoveryTargetFact{
			Target:           examdomain.RecoveryTarget{SectionKey: sectionKey},
			Label:            humanizeSectionKey(sectionKey),
			State:            state,
			Reason:           strings.TrimSpace(reason.String),
			Deadline:         d,
			RemainingSeconds: remaining,
			Current:          state == "active",
		})
	}
	return out, rows.Err()
}

func (s *Service) loadRuntimeRecoveryTargets(ctx context.Context, q tx.Tx, row recoveryAttemptRow, now time.Time) ([]recoveryTargetFact, error) {
	runtime, err := proctor.LoadSessionRuntimeByStatus(ctx, q, row.ScheduleID, "live")
	if err != nil {
		return nil, err
	}
	current := ""
	if runtime.ActiveSectionKey != nil {
		current = *runtime.ActiveSectionKey
	} else if runtime.CurrentSectionKey != nil {
		current = *runtime.CurrentSectionKey
	}
	out := []recoveryTargetFact{}
	for _, section := range runtime.Sections {
		deadline := runtimeSectionDeadline(section)
		focused := row.Control != nil && row.Control.Target.SectionKey == section.SectionKey && row.Control.FocusDeadlineAt != nil
		if focused {
			deadline = row.Control.FocusDeadlineAt
		}
		var remaining *int64
		if deadline != nil {
			ref := now
			if section.PausedAt != nil {
				ref = section.PausedAt.UTC()
			}
			v := int64(examruntime.RecoveryRemainingSeconds(ref, deadline))
			remaining = &v
		}
		reason := ""
		if section.CompletionReason != nil {
			reason = strings.TrimSpace(*section.CompletionReason)
		}
		label := strings.TrimSpace(section.Label)
		if label == "" {
			label = humanizeSectionKey(section.SectionKey)
		}
		state := section.Status
		isCurrent := current != "" && section.SectionKey == current
		if focused && row.open() {
			state = "active"
			reason = ""
			isCurrent = true
		}
		out = append(out, recoveryTargetFact{
			Target:           examdomain.RecoveryTarget{SectionKey: section.SectionKey},
			Label:            label,
			State:            state,
			Reason:           reason,
			Deadline:         deadline,
			RemainingSeconds: remaining,
			Current:          isCurrent,
		})
	}
	return out, nil
}

func runtimeSectionDeadline(section proctor.SessionRuntimeSection) *time.Time {
	if section.ActualStartAt != nil {
		seconds := int64(section.PlannedDurationMinutes+section.ExtensionMinutes)*60 + int64(section.AccumulatedPausedSeconds)
		if seconds < 0 {
			seconds = 0
		}
		d := section.ActualStartAt.UTC().Add(time.Duration(seconds) * time.Second)
		return &d
	}
	if section.ProjectedEndAt != nil {
		d := section.ProjectedEndAt.UTC()
		return &d
	}
	return nil
}

func matchRecoveryTarget(facts []recoveryTargetFact, provider string, requested examdomain.RecoveryTarget) (recoveryTargetFact, bool) {
	requested = requested.Normalized()
	if err := requested.Validate(provider); err != nil {
		return recoveryTargetFact{}, false
	}
	if provider != examdomain.ProviderSAT {
		if requested.ModuleAttemptID != "" || requested.ModuleID != "" {
			return recoveryTargetFact{}, false
		}
		for _, fact := range facts {
			if fact.Target.SectionKey == requested.SectionKey {
				return fact, true
			}
		}
		return recoveryTargetFact{}, false
	}
	// SAT modules are the selectable unit: a section may contain Module 1 and
	// an adaptive Module 2, so a section-only request is ambiguous.
	if requested.ModuleAttemptID == "" {
		return recoveryTargetFact{}, false
	}
	for _, fact := range facts {
		if fact.Target.ModuleAttemptID == requested.ModuleAttemptID &&
			fact.Target.ModuleID == requested.ModuleID &&
			fact.Target.SectionKey == requested.SectionKey {
			return fact, true
		}
	}
	return recoveryTargetFact{}, false
}

func classifyRecoveryTarget(row recoveryAttemptRow, receiptReason string, fact recoveryTargetFact) RecoveryEligibility {
	facts := row.closureFacts(receiptReason)
	facts.TargetReason = fact.Reason
	targetReason := normalizeClosureReason(fact.Reason)
	if !facts.Open && normalizeClosureReason(receiptReason) == closureReasonTimeExpired && (row.ProviderKey == examdomain.ProviderACT || (row.Control != nil && row.Control.Phase == examdomain.RecoveryPhaseWorking && row.Control.Target.Equal(fact.Target))) {
		// The timeout receipt seals this attempt-owned focused run. A shared
		// room cursor may still name an earlier run of the same section.
		targetReason = closureReasonTimeExpired
		facts.TargetReason = closureReasonTimeExpired
	}
	if !facts.Open {
		// A closed sitting may only be reopened on the selected stage's own
		// timeout provenance. Some other stage finishing (or a manual/admin
		// close) never becomes a timeout because the attempt clock elapsed.
		switch targetReason {
		case closureReasonTimeExpired:
		case closureReasonStudentSubmit:
			facts.TargetManualSubmit = true
		case closureReasonAutoStop, closureReasonProctorComplete, closureReasonProctorEnd,
			closureReasonProctorForceSub, closureReasonProctorTerm:
			facts.TargetControlledEnd = true
		default:
			facts.TargetUnknown = true
		}
	} else if targetReason == "" && !fact.Current {
		// The sitting is live, but this stage has neither an active writer nor
		// timeout evidence: it is an unstarted/finished successor that ordinary
		// delivery already owns.
		facts.TargetUnknown = true
	}
	return ClassifyRecoveryClosure(facts)
}

func (s *Service) prepareRecoveryControl(ctx context.Context, q tx.Tx, row recoveryAttemptRow, target examdomain.RecoveryTarget, grantID string, now time.Time) (examdomain.RecoveryControl, string, error) {
	replaced, err := supersedeRecoveryGrants(ctx, q, row.ID, now)
	if err != nil {
		return examdomain.RecoveryControl{}, "", err
	}
	control := examdomain.NewRecoveryControl(uuid.NewString(), row.ActiveSession.String, target)
	if row.Control != nil {
		control = *row.Control
		if !row.Control.Target.Equal(target) {
			control.FocusDeadlineAt = nil
			control.FocusStartedAt = nil
			control.FocusPausedAt = nil
		}
		if row.Control.Phase == examdomain.RecoveryPhaseWorking {
			// A new transfer captures the current writer as its original device;
			// the continuation stages still belong to this same sitting.
			control.ID = uuid.NewString()
			control.OriginalSessionID = row.ActiveSession.String
		}
		control.ActiveGrantID = grantID
		control.Target = target.Normalized()
		control.Phase = examdomain.RecoveryPhaseHeld
		// Preserve suspended continuation values across reissues. They were
		// captured when the rewind began and must not be re-awarded or lost.
		// Preserve the original browser identity captured by the first
		// transfer. A reissue rotates authority, never the identity.
		if strings.TrimSpace(control.OriginalSessionID) == "" {
			control.OriginalSessionID = strings.TrimSpace(row.ActiveSession.String)
		}
	} else {
		control.ActiveGrantID = grantID
	}
	return control, replaced, nil
}

func supersedeRecoveryGrants(ctx context.Context, q tx.Tx, attemptID string, now time.Time) (string, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id FROM attempt_device_recovery_grants
		WHERE attempt_id = ? AND (active_attempt_id = ? OR state IN ('issued', 'claimed', 'started'))
		ORDER BY issued_at, id
		FOR UPDATE`, attemptID, attemptID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	replaced := ""
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return "", err
		}
		if replaced == "" {
			replaced = id
		}
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if replaced == "" {
		return "", nil
	}
	if _, err := q.ExecContext(ctx, `
		UPDATE attempt_device_recovery_grants
		SET state = CASE
		        WHEN state = 'issued' AND expires_at <= ? THEN 'expired'
		        WHEN state = 'claimed' AND claim_expires_at IS NOT NULL AND claim_expires_at <= ? THEN 'expired'
		        ELSE 'replaced'
		    END,
		    active_attempt_id = NULL,
		    sealed_issuance = NULL,
		    updated_at = UTC_TIMESTAMP(6)
		WHERE attempt_id = ? AND state IN ('issued', 'claimed', 'started')`, now, now, attemptID); err != nil {
		return "", err
	}
	return replaced, nil
}

// ---------------------------------------------------------------------------
// Grant rows and replay
// ---------------------------------------------------------------------------

const recoveryGrantColumns = `id, attempt_id, schedule_id, issued_by_user_id, operation_id,
	request_hash, state, target_section_key, target_module_attempt_id, target_module_id,
	requested_remaining_seconds, expected_control_epoch, expected_lease_epoch,
	grant_revision, failed_code_count, issued_at, expires_at, sealed_issuance,
	claim_proof_hash, claim_operation_id, target_client_session_id, claimed_at,
	claim_expires_at, started_at, resulting_lease_epoch, begin_operation_id,
	begin_receipt, restored_at, restored_by, link_secret_hash, code_mac`

type recoveryGrantRow struct {
	ID                        string
	AttemptID                 string
	ScheduleID                string
	IssuedByUserID            string
	OperationID               string
	RequestHash               string
	State                     string
	Target                    examdomain.RecoveryTarget
	RequestedRemainingSeconds *int
	ExpectedControlEpoch      uint64
	ExpectedLeaseEpoch        uint64
	GrantRevision             uint64
	FailedCodeCount           int
	IssuedAt                  time.Time
	ExpiresAt                 time.Time
	SealedIssuance            []byte
	ClaimProofHash            string
	ClaimOperationID          string
	TargetClientSessionID     string
	ClaimedAt                 *time.Time
	ClaimExpiresAt            *time.Time
	StartedAt                 *time.Time
	ResultingLeaseEpoch       *uint64
	BeginOperationID          string
	BeginReceipt              []byte
	RestoredAt                *time.Time
	RestoredBy                string
	LinkSecretHash            string
	CodeMAC                   string
}

func scanRecoveryGrant(scanner interface{ Scan(dest ...any) error }) (recoveryGrantRow, error) {
	var row recoveryGrantRow
	var sectionKey string
	var moduleAttemptID, moduleID sql.NullString
	var remaining sql.NullInt64
	var capsule []byte
	var claimProof, claimOperation, targetClientSession, beginOperation, restoredBy sql.NullString
	var linkHash, codeMAC sql.NullString
	var beginReceipt []byte
	var resultingLease sql.NullInt64
	var claimedAt, claimExpiresAt, startedAt, restoredAt sql.NullTime
	if err := scanner.Scan(&row.ID, &row.AttemptID, &row.ScheduleID, &row.IssuedByUserID,
		&row.OperationID, &row.RequestHash, &row.State, &sectionKey, &moduleAttemptID, &moduleID,
		&remaining, &row.ExpectedControlEpoch, &row.ExpectedLeaseEpoch, &row.GrantRevision,
		&row.FailedCodeCount, &row.IssuedAt, &row.ExpiresAt, &capsule,
		&claimProof, &claimOperation, &targetClientSession, &claimedAt,
		&claimExpiresAt, &startedAt, &resultingLease, &beginOperation,
		&beginReceipt, &restoredAt, &restoredBy, &linkHash, &codeMAC); err != nil {
		return row, err
	}
	row.Target = examdomain.RecoveryTarget{
		SectionKey:      sectionKey,
		ModuleAttemptID: strings.TrimSpace(moduleAttemptID.String),
		ModuleID:        strings.TrimSpace(moduleID.String),
	}
	if remaining.Valid {
		v := int(remaining.Int64)
		row.RequestedRemainingSeconds = &v
	}
	if resultingLease.Valid {
		v := uint64(resultingLease.Int64)
		row.ResultingLeaseEpoch = &v
	}
	row.SealedIssuance = capsule
	row.ClaimProofHash = strings.TrimSpace(claimProof.String)
	row.ClaimOperationID = strings.TrimSpace(claimOperation.String)
	row.TargetClientSessionID = strings.TrimSpace(targetClientSession.String)
	row.BeginOperationID = strings.TrimSpace(beginOperation.String)
	row.BeginReceipt = beginReceipt
	row.RestoredBy = strings.TrimSpace(restoredBy.String)
	row.LinkSecretHash = strings.TrimSpace(linkHash.String)
	row.CodeMAC = strings.TrimSpace(codeMAC.String)
	row.IssuedAt = row.IssuedAt.UTC()
	row.ExpiresAt = row.ExpiresAt.UTC()
	row.ClaimedAt = nullTime(claimedAt)
	row.ClaimExpiresAt = nullTime(claimExpiresAt)
	row.StartedAt = nullTime(startedAt)
	row.RestoredAt = nullTime(restoredAt)
	return row, nil
}

func (g recoveryGrantRow) status(now time.Time, secretsConfigured bool) DeviceRecoveryGrantStatus {
	state := g.State
	switch {
	case state == recoveryGrantIssued && !now.Before(g.ExpiresAt):
		state = recoveryGrantExpired
	case state == recoveryGrantClaimed && g.ClaimExpiresAt != nil && !now.Before(*g.ClaimExpiresAt):
		state = recoveryGrantExpired
	}
	if state == recoveryGrantIssued && g.RestoredBy != "" {
		state = recoveryGrantRestored
	}
	secrets := state == recoveryGrantIssued && len(g.SealedIssuance) > 0 && secretsConfigured
	return DeviceRecoveryGrantStatus{
		GrantID:                   g.ID,
		State:                     state,
		Target:                    g.Target,
		RequestedRemainingSeconds: g.RequestedRemainingSeconds,
		GrantRevision:             g.GrantRevision,
		FailedCodeCount:           g.FailedCodeCount,
		IssuedAt:                  g.IssuedAt,
		ExpiresAt:                 g.ExpiresAt,
		ClaimExpiresAt:            g.ClaimExpiresAt,
		ClaimedAt:                 g.ClaimedAt,
		StartedAt:                 g.StartedAt,
		SecretsAvailable:          secrets,
	}
}

func loadRecoveryGrantByOperation(ctx context.Context, q tx.Tx, operationID string) (*recoveryGrantRow, error) {
	row, err := scanRecoveryGrant(q.QueryRowContext(ctx,
		`SELECT `+recoveryGrantColumns+` FROM attempt_device_recovery_grants WHERE operation_id = ?`, operationID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// loadRecoveryGrantByID resolves one grant. Claim reads it once without a lock
// to learn the attempt identity, then locks the attempt before locking the
// grant, matching the global lock order.
func loadRecoveryGrantByID(ctx context.Context, q tx.Tx, grantID string, forUpdate bool) (*recoveryGrantRow, error) {
	query := `SELECT ` + recoveryGrantColumns + ` FROM attempt_device_recovery_grants WHERE id = ?`
	if forUpdate {
		query += " FOR UPDATE"
	}
	row, err := scanRecoveryGrant(q.QueryRowContext(ctx, query, grantID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

func loadLatestRecoveryGrant(ctx context.Context, q tx.Tx, attemptID string) (*recoveryGrantRow, error) {
	row, err := scanRecoveryGrant(q.QueryRowContext(ctx,
		`SELECT `+recoveryGrantColumns+` FROM attempt_device_recovery_grants
		 WHERE attempt_id = ? ORDER BY issued_at DESC, id DESC LIMIT 1`, attemptID))
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &row, nil
}

// recoveryIssuanceCapsule is the staff-only replay payload. It is encrypted
// with associated data binding it to one grant/attempt pair and is cleared as
// soon as the code is consumed or the grant is superseded.
type recoveryIssuanceCapsule struct {
	LinkSecret string    `json:"linkSecret"`
	Code       string    `json:"code"`
	IssuedAt   time.Time `json:"issuedAt"`
	ExpiresAt  time.Time `json:"expiresAt"`
}

func openRecoveryIssuance(secret []byte, grant *recoveryGrantRow) (recoveryIssuanceCapsule, error) {
	if grant == nil || len(grant.SealedIssuance) == 0 {
		return recoveryIssuanceCapsule{}, recoveryUnavailable("RECOVERY_SUPERSEDED", "The recovery code is no longer available; issue a new one.")
	}
	raw, err := platformcrypto.OpenRecoveryIssuance(secret, grant.ID, grant.AttemptID, grant.SealedIssuance)
	if err != nil {
		return recoveryIssuanceCapsule{}, fmt.Errorf("delivery: open recovery issuance %s: %w", grant.ID, err)
	}
	var capsule recoveryIssuanceCapsule
	if err := json.Unmarshal(raw, &capsule); err != nil {
		return recoveryIssuanceCapsule{}, fmt.Errorf("delivery: decode recovery issuance %s: %w", grant.ID, err)
	}
	if strings.TrimSpace(capsule.LinkSecret) == "" || strings.TrimSpace(capsule.Code) == "" {
		return recoveryIssuanceCapsule{}, errors.New("delivery: recovery issuance capsule is incomplete")
	}
	return capsule, nil
}

func recoveryPath(grantID, linkSecret string) string {
	if grantID == "" || linkSecret == "" {
		return ""
	}
	return recoveryPathPrefix + grantID + "#key=" + linkSecret
}

func publicRecoveryControl(control *examdomain.RecoveryControl) *RecoveryControlStatus {
	if control == nil {
		return nil
	}
	return &RecoveryControlStatus{
		ID:            control.ID,
		Phase:         control.Phase,
		Target:        control.Target,
		GrantID:       control.ActiveGrantID,
		RunGeneration: control.FocusRunGeneration,
	}
}

func humanizeSectionKey(key string) string {
	key = strings.TrimSpace(key)
	if key == "" {
		return ""
	}
	parts := strings.FieldsFunc(key, func(r rune) bool { return r == '-' || r == '_' })
	for i, part := range parts {
		if part == "" {
			continue
		}
		parts[i] = strings.ToUpper(part[:1]) + part[1:]
	}
	return strings.Join(parts, " ")
}

func nullIfEmpty(v string) any {
	v = strings.TrimSpace(v)
	if v == "" {
		return nil
	}
	return v
}

func recoveryNullInt(v *int) any {
	if v == nil {
		return nil
	}
	return *v
}

// ---------------------------------------------------------------------------
// Error envelope helpers
// ---------------------------------------------------------------------------

func recoveryConflict(reason, message string, details map[string]any) *apperrors.Error {
	err := assessmentConflict(reason, message)
	if reason == "RECOVERY_EXPIRED" {
		err.HTTPStatus = 410
	}
	if reason == "RECOVERY_CODE_LOCKED" {
		err.Code = apperrors.CodeRateLimited
		err.HTTPStatus = 429
	}
	if details != nil {
		for k, v := range details {
			err.Details[k] = v
		}
	}
	err.Retryable = false
	return err
}

func recoveryUnavailable(reason, message string) *apperrors.Error {
	err := apperrors.New(apperrors.CodeServiceUnavailable, message)
	err.Details = map[string]any{"reason": reason}
	err.Retryable = true
	return err
}

func recoveryIneligibleMessage(reason string) string {
	switch reason {
	case RecoveryReasonManualSubmit:
		return "The candidate submitted this stage; staff recovery cannot reopen it."
	case RecoveryReasonControlledEnd:
		return "This sitting was closed by an exam-control action, not by its clock."
	case RecoveryReasonTargetRequired:
		return "Select the section the candidate should continue."
	default:
		return "This sitting cannot be reopened because its timeout provenance is missing or contradictory."
	}
}

func recoveryTimeMessage(reason string) string {
	switch reason {
	case examruntime.ReasonRecoveryTimeRequired:
		return "The original countdown has ended. Enter the remaining time to award before issuing a code."
	case examruntime.ReasonRecoveryInvalidTime:
		return "Remaining time must be between 1 and 86400 seconds."
	default:
		return "The selected stage has no usable recovery clock."
	}
}

package attempts

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

// Submit handles the common submission preamble then diverges by provider:
// SAT takes the provisional two-phase path (no seal, submitted_at stays
// NULL); every other provider seals submitted/student_submit first and only
// then records the digest (plan 28-32).
func (s *Service) Submit(ctx context.Context, bearer string, cmd SubmitCommand, qr QuestionResolver, rl RuntimeLocker, provider Provider, sealer Sealer) (SubmitResult, error) {
	if err := ValidateAttemptID(cmd.AttemptID); err != nil {
		return SubmitResult{}, err
	}
	if cmd.SubmissionID == "" || len(cmd.SubmissionID) > MaxSubmissionIDLen {
		return SubmitResult{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Invalid submission id.", HTTPStatus: 400}
	}
	if cmd.LeaseEpoch == 0 {
		return SubmitResult{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Lease epoch must be positive.", HTTPStatus: 400}
	}
	// I2 (round 55): FinalCommands ride into saveInTx AFTER the attempt
	// lock + receipt probes — validate them at the envelope, before any
	// tx begins, same as ValidateSaveEnvelope. Control epoch 0 is legal
	// here (no racing pause to fence against); substitute 1 purely for
	// the shared positive-epoch gate — the real epoch flows into
	// saveInTx untouched.
	if len(cmd.FinalCommands) > 0 {
		ctrl := cmd.ExpectedControlEpoch
		if ctrl == 0 {
			ctrl = 1
		}
		if err := ValidateSaveEnvelope(SaveResponsesCommand{AttemptID: cmd.AttemptID, LeaseEpoch: cmd.LeaseEpoch, ControlEpoch: ctrl, Commands: cmd.FinalCommands}); err != nil {
			return SubmitResult{}, err
		}
	}
	claims, err := crypto.VerifyAttemptToken(s.secret, s.clock.Now(), bearer)
	if err != nil {
		return SubmitResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Invalid attempt credential.", HTTPStatus: 401}
	}
	var out SubmitResult
	// B1: hot submit path runs READ COMMITTED (same shape as SaveResponses).
	// E3: bounded RC retry (3) — receipt-first terminalization makes the
	// retried submit an outcome-only replay, never a double seal. The
	// absorbed count labels retried_accepted (same E3 slice as saves).
	retried, rerr := s.tx.WithTxRCRetryCounted(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		res, err := s.submitInTx(ctx, q, claims, cmd, qr, rl, provider, sealer)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	err = rerr
	if err != nil {
		outcome := v2BatchOutcome(err)
		telemetry.IncCounter(telemetry.MV2BatchTotal, "outcome", outcome)
		for range cmd.FinalCommands {
			telemetry.IncCounter(telemetry.MV2CommandsTotal, "outcome", outcome)
		}
		return out, err
	}
	if out.Replayed {
		telemetry.IncCounter(telemetry.MSubmitReplayTotal)
		telemetry.IncCounter(telemetry.MV2BatchTotal, "outcome", telemetry.OutcomeExactReplay)
		for range cmd.FinalCommands {
			telemetry.IncCounter(telemetry.MV2CommandsTotal, "outcome", telemetry.OutcomeExactReplay)
		}
	} else {
		outcome := successOutcome(false, retried)
		telemetry.IncCounter(telemetry.MV2BatchTotal, "outcome", outcome)
		for range cmd.FinalCommands {
			telemetry.IncCounter(telemetry.MV2CommandsTotal, "outcome", outcome)
		}
	}
	return out, nil
}

// Sealer is the terminalization boundary (plan 34). Implemented by the
// terminalization package; defined here to avoid an import cycle.
type Sealer interface {
	SealSubmitted(ctx context.Context, q tx.Tx, attemptID, scheduleID, submissionID, digest, provider string, actorID string, effectiveAt time.Time) error
}

func (s *Service) submitInTx(ctx context.Context, q tx.Tx, claims crypto.AttemptClaims, cmd SubmitCommand, qr QuestionResolver, rl RuntimeLocker, provider Provider, sealer Sealer) (SubmitResult, error) {
	attempt, err := lockAttempt(ctx, q, cmd.AttemptID)
	if err != nil {
		return SubmitResult{}, err
	}
	if attempt.ProtocolVersion != 2 {
		return SubmitResult{}, apperrors.New(apperrors.CodeConflict, "Protocol version unsupported.")
	}
	if claims.ScheduleID != attempt.ScheduleID || claims.UserID != attempt.UserID || claims.AttemptID != cmd.AttemptID {
		return SubmitResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Attempt credential mismatch.", HTTPStatus: 401}
	}
	if err := s.validateTokenSession(ctx, q, claims); err != nil {
		return SubmitResult{}, err
	}
	// Receipt replay: same submission ID + same request hash returns the
	// stored receipt (still requires the current lease).
	reqHash, err := HashResponse(submitRequestShape(cmd))
	if err != nil {
		return SubmitResult{}, err
	}
	if receipt, ok, err := loadSubmissionReceipt(ctx, q, cmd.AttemptID); err != nil {
		return SubmitResult{}, err
	} else if ok {
		if receipt.SubmissionID == cmd.SubmissionID && receipt.RequestHash == reqHash {
			if err := validateClaimLease(attempt, claims); err != nil {
				return SubmitResult{}, err
			}
			return receipt.Result, nil
		}
		return SubmitResult{}, &apperrors.Error{Code: apperrors.CodeSubmissionReplayMisuse, Message: "Submission identity already used.", HTTPStatus: 409, Details: map[string]any{"existingSubmissionId": receipt.SubmissionID}}
	}
	// Global submission-ID ownership.
	var ownerAttempt string
	err = q.QueryRowContext(ctx, `SELECT attempt_id FROM attempt_submissions_v2 WHERE submission_id=? FOR UPDATE`, cmd.SubmissionID).Scan(&ownerAttempt)
	if err == nil {
		return SubmitResult{}, &apperrors.Error{Code: apperrors.CodeSubmissionReplayMisuse, Message: "Submission identity already used.", HTTPStatus: 409, Details: map[string]any{"existingAttemptId": ownerAttempt}}
	} else if err != sql.ErrNoRows {
		return SubmitResult{}, err
	}
	// Epoch fencing (no replay bypass for submit preamble beyond receipt).
	if cmd.LeaseEpoch != attempt.LeaseEpoch {
		return SubmitResult{}, leaseFenced()
	}
	if err := ensureActiveSession(ctx, q, attempt, claims); err != nil {
		return SubmitResult{}, err
	}
	if cmd.ExpectedRevision != nil && *cmd.ExpectedRevision != attempt.ResponseRevision {
		return SubmitResult{}, &apperrors.Error{Code: apperrors.CodeVersionCollision, Message: "Response revision changed; refresh before submitting.", HTTPStatus: 409, Details: map[string]any{"expected": *cmd.ExpectedRevision, "current": attempt.ResponseRevision}}
	}
	// Runtime gate ALWAYS locked for submit (no replay bypass).
	var gate RuntimeGate
	if rl != nil {
		g, err := rl.Lock(ctx, q, attempt.ScheduleID)
		if err != nil {
			return SubmitResult{}, err
		}
		gate = g
	} else {
		now, err := dbTime(ctx, q)
		if err != nil {
			return SubmitResult{}, err
		}
		gate = RuntimeGate{Status: "live", ActiveSectionKey: "*", SectionLive: true, SectionStarted: true, Now: now}
	}
	now := gate.Now
	if now.IsZero() {
		now, err = dbTime(ctx, q)
		if err != nil {
			return SubmitResult{}, err
		}
	}
	if err := ensureWritable(attempt, gate, now); err != nil {
		return SubmitResult{}, err
	}
	// Apply final commands through the same fencing/version rules.
	if len(cmd.FinalCommands) > 0 {
		// Final commands fence on the client-supplied expected control
		// epoch so a pause/resume racing the submit cannot slip through
		// on a fresh-read epoch.
		saveCmd := SaveResponsesCommand{AttemptID: cmd.AttemptID, LeaseEpoch: cmd.LeaseEpoch, ControlEpoch: cmd.ExpectedControlEpoch, Commands: cmd.FinalCommands}
		if _, err := s.saveInTx(ctx, q, claims, saveCmd, qr, rl); err != nil {
			return SubmitResult{}, err
		}
		attempt, err = lockAttempt(ctx, q, cmd.AttemptID)
		if err != nil {
			return SubmitResult{}, err
		}
		now, err = dbTime(ctx, q)
		if err != nil {
			return SubmitResult{}, err
		}
	}
	digest, err := ComputeDigestInTx(ctx, q, cmd.AttemptID)
	if err != nil {
		return SubmitResult{}, err
	}
	if provider == ProviderSAT {
		// Provisional claim: NEVER sets submitted_at/final_submission.
		res, err := q.ExecContext(ctx, `UPDATE student_attempts SET delivery_status='submitted', phase='post-exam', response_revision=?, final_response_digest=?, revision=revision+1, control_epoch=control_epoch+1, updated_at=CURRENT_TIMESTAMP(6) WHERE id=? AND submitted_at IS NULL AND final_submission IS NULL AND COALESCE(delivery_status,'running') NOT IN ('terminated','locked','cancelled')`, attempt.ResponseRevision, digest, cmd.AttemptID)
		if err != nil {
			return SubmitResult{}, err
		}
		n, err := res.RowsAffected()
		if err != nil {
			return SubmitResult{}, err
		}
		if n != 1 {
			return SubmitResult{}, &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Attempt could not claim the provisional submit state.", HTTPStatus: 422}
		}
		result := SubmitResult{SubmissionID: cmd.SubmissionID, FinalDigest: digest, Provisional: true, ServerTime: now}
		if err := insertSubmissionReceipt(ctx, q, cmd, attempt, reqHash, digest, result, now); err != nil {
			return SubmitResult{}, err
		}
		return result, nil
	}
	// IELTS + ACT direct completion: seal FIRST, then digest.
	if sealer == nil {
		return SubmitResult{}, fmt.Errorf("sealer is required for provider %q", provider)
	}
	if err := sealer.SealSubmitted(ctx, q, cmd.AttemptID, attempt.ScheduleID, cmd.SubmissionID, digest, string(provider), claims.UserID, now); err != nil {
		return SubmitResult{}, err
	}
	if _, err := q.ExecContext(ctx, `UPDATE student_attempts SET response_revision=?, final_response_digest=? WHERE id=?`, attempt.ResponseRevision, digest, cmd.AttemptID); err != nil {
		return SubmitResult{}, err
	}
	result := SubmitResult{SubmissionID: cmd.SubmissionID, FinalDigest: digest, ServerTime: now}
	if err := insertSubmissionReceipt(ctx, q, cmd, attempt, reqHash, digest, result, now); err != nil {
		return SubmitResult{}, err
	}
	return result, nil
}

type storedReceipt struct {
	SubmissionID string
	RequestHash  string
	Result       SubmitResult
}

func loadSubmissionReceipt(ctx context.Context, q tx.Tx, attemptID string) (storedReceipt, bool, error) {
	var r storedReceipt
	var receiptJSON string
	var digest string
	var submittedAt time.Time
	err := q.QueryRowContext(ctx, `SELECT submission_id, request_hash, final_response_digest, CAST(receipt AS CHAR), submitted_at FROM attempt_submissions_v2 WHERE attempt_id=? FOR UPDATE`, attemptID).Scan(&r.SubmissionID, &r.RequestHash, &digest, &receiptJSON, &submittedAt)
	if err == sql.ErrNoRows {
		return r, false, nil
	}
	if err != nil {
		return r, false, err
	}
	r.Result = SubmitResult{SubmissionID: r.SubmissionID, FinalDigest: digest, Replayed: true, ServerTime: submittedAt.UTC()}
	var decoded struct {
		Provisional bool `json:"provisional"`
	}
	if receiptJSON != "" {
		_ = json.Unmarshal([]byte(receiptJSON), &decoded)
		r.Result.Provisional = decoded.Provisional
	}
	return r, true, nil
}

func insertSubmissionReceipt(ctx context.Context, q tx.Tx, cmd SubmitCommand, attempt AttemptState, reqHash, digest string, result SubmitResult, now time.Time) error {
	receiptJSON, _ := json.Marshal(map[string]any{"submissionId": result.SubmissionID, "provisional": result.Provisional, "digest": digest})
	actualRev := attempt.ResponseRevision
	// expected_attempt_revision is NOT NULL: a client that omits
	// expectedAttemptRevision means "no fence", recorded as the sealed
	// revision itself — never a nil INSERT arg (500 on strict MySQL).
	expected := actualRev
	if cmd.ExpectedRevision != nil {
		expected = *cmd.ExpectedRevision
	}
	if _, err := q.ExecContext(ctx, `INSERT INTO attempt_submissions_v2 (attempt_id, submission_id, lease_epoch, control_epoch, request_hash, expected_attempt_revision, attempt_revision, final_response_digest, receipt, submitted_at) VALUES (?,?,?,?,?,?,?,?,?,?)`, cmd.AttemptID, cmd.SubmissionID, cmd.LeaseEpoch, attempt.ControlEpoch, reqHash, expected, actualRev, digest, string(receiptJSON), now); err != nil {
		if isDup(err) {
			return &apperrors.Error{Code: apperrors.CodeSubmissionReplayMisuse, Message: "Submission identity already used.", HTTPStatus: 409}
		}
		return err
	}
	return nil
}

func submitRequestShape(cmd SubmitCommand) any {
	finals := make([]any, 0, len(cmd.FinalCommands))
	for _, c := range cmd.FinalCommands {
		finals = append(finals, commandToAny(cmd.LeaseEpoch, c))
	}
	var exp any
	if cmd.ExpectedRevision != nil {
		exp = *cmd.ExpectedRevision
	}
	return map[string]any{"submissionId": cmd.SubmissionID, "attemptId": cmd.AttemptID, "leaseEpoch": cmd.LeaseEpoch, "finalCommands": finals, "expectedAttemptRevision": exp}
}

// ComputeDigestInTx reads the projection hashes for the final digest.
func ComputeDigestInTx(ctx context.Context, q tx.Tx, attemptID string) (string, error) {
	rows, err := q.QueryContext(ctx, `SELECT question_id, response_hash FROM attempt_responses_v2 WHERE attempt_id=?`, attemptID)
	if err != nil {
		return "", err
	}
	defer rows.Close()
	m := map[string]string{}
	for rows.Next() {
		var qid, h string
		if err := rows.Scan(&qid, &h); err != nil {
			return "", err
		}
		m[qid] = h
	}
	if err := rows.Err(); err != nil {
		return "", err
	}
	if len(m) == 0 {
		return "", &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "No responses to submit.", HTTPStatus: 400}
	}
	return FinalDigest(m)
}

// Takeover increments the writer lease and revokes competing sessions.
func (s *Service) Takeover(ctx context.Context, bearer, attemptID, clientSessionID, reason string) (TakeoverResult, error) {
	if err := ValidateAttemptID(attemptID); err != nil {
		return TakeoverResult{}, err
	}
	if clientSessionID == "" || len(clientSessionID) > MaxSessionLen {
		return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Invalid client session.", HTTPStatus: 400}
	}
	if len(reason) > MaxReasonLen {
		return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Reason too long.", HTTPStatus: 400}
	}
	claims, err := crypto.VerifyAttemptToken(s.secret, s.clock.Now(), bearer)
	if err != nil {
		return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Invalid attempt credential.", HTTPStatus: 401}
	}
	var out TakeoverResult
	// B1: lease takeover is a single-row CAS + session revoke (RC-safe).
	// E3: bounded RC retry (3) — CAS re-reads the epoch, so a retried
	// takeover re-evaluates instead of double-fencing.
	err = s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		res, err := s.takeoverInTx(ctx, q, claims, attemptID, clientSessionID)
		if err != nil {
			return err
		}
		out = res
		return nil
	})
	return out, err
}

// TakeoverResult is the new writer credential.
type TakeoverResult struct {
	AttemptID       string    `json:"attemptId"`
	ClientSessionID string    `json:"clientSessionId"`
	LeaseEpoch      uint64    `json:"leaseEpoch"`
	ExpiresAt       time.Time `json:"expiresAt"`
	Token           string    `json:"token"`
}

func (s *Service) takeoverInTx(ctx context.Context, q tx.Tx, claims crypto.AttemptClaims, attemptID, clientSessionID string) (TakeoverResult, error) {
	attempt, err := lockAttempt(ctx, q, attemptID)
	if err != nil {
		return TakeoverResult{}, err
	}
	if claims.AttemptID != attemptID || claims.ScheduleID != attempt.ScheduleID || claims.UserID != attempt.UserID {
		return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeAttemptTokenInvalid, Message: "Attempt credential mismatch.", HTTPStatus: 401}
	}
	if err := s.validateTokenSession(ctx, q, claims); err != nil {
		return TakeoverResult{}, err
	}
	// No takeover after terminal closure or past grace.
	now, err := dbTime(ctx, q)
	if err != nil {
		return TakeoverResult{}, err
	}
	switch attempt.DeliveryStatus {
	case "submitted", "terminated", "locked", "cancelled":
		return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Attempt is closed.", HTTPStatus: 422}
	}
	if attempt.Phase == "post-exam" || attempt.SubmittedAt != nil {
		return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Attempt is closed.", HTTPStatus: 422}
	}
	if attempt.ClosingGraceUntil != nil && now.After(*attempt.ClosingGraceUntil) {
		return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeAttemptNotWritable, Message: "Response deadline has passed.", HTTPStatus: 422}
	}
	newLease := attempt.LeaseEpoch
	var active sql.NullString
	_ = q.QueryRowContext(ctx, `SELECT active_client_session_id FROM student_attempts WHERE id=?`, attemptID).Scan(&active)
	if !active.Valid || active.String != clientSessionID {
		newLease++
		if newLease == 0 {
			return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeBadRequest, Message: "Lease epoch overflow.", HTTPStatus: 400}
		}
	}
	expiresAt := now.Add(15 * time.Minute)
	newTokenID := uuid.NewString()
	if _, err := q.ExecContext(ctx, `INSERT INTO attempt_sessions (token_id, attempt_id, client_session_id, user_id, schedule_id, expires_at, revoked_at) VALUES (?,?,?,?,?,?,NULL) ON DUPLICATE KEY UPDATE token_id=VALUES(token_id), user_id=VALUES(user_id), schedule_id=VALUES(schedule_id), expires_at=VALUES(expires_at), revoked_at=NULL`, newTokenID, attemptID, clientSessionID, attempt.UserID, attempt.ScheduleID, expiresAt); err != nil {
		return TakeoverResult{}, err
	}
	if _, err := q.ExecContext(ctx, `UPDATE attempt_sessions SET revoked_at=?, reason='response_durability_lease_takeover' WHERE attempt_id=? AND client_session_id<>? AND revoked_at IS NULL`, now, attemptID, clientSessionID); err != nil {
		return TakeoverResult{}, err
	}
	if newLease != attempt.LeaseEpoch || !active.Valid || active.String != clientSessionID {
		res, err := q.ExecContext(ctx, `UPDATE student_attempts SET lease_epoch=?, active_client_session_id=?, revision=revision+1 WHERE id=?`, newLease, clientSessionID, attemptID)
		if err != nil {
			return TakeoverResult{}, err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return TakeoverResult{}, &apperrors.Error{Code: apperrors.CodeNotFound, Message: "Attempt not found.", HTTPStatus: 404}
		}
	}
	newClaims := crypto.AttemptClaims{TokenID: newTokenID, UserID: attempt.UserID, ScheduleID: attempt.ScheduleID, AttemptID: attemptID, ClientSessionID: clientSessionID, OrganizationID: attempt.OrganizationID, Exp: expiresAt.Unix()}
	newClaims.LeaseEpoch = &newLease
	tok, err := crypto.SignAttemptToken(s.secret, newClaims)
	if err != nil {
		return TakeoverResult{}, err
	}
	return TakeoverResult{AttemptID: attemptID, ClientSessionID: clientSessionID, LeaseEpoch: newLease, ExpiresAt: expiresAt, Token: tok}, nil
}

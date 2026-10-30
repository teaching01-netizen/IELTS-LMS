package attempts

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Draft evidence (exam-session continuity FR7) preserves answers a browser
// held but could not save before an answer window closed. It is a separate,
// provider-neutral ledger: recording evidence never changes responses, scores,
// clocks, or attempt state, and a claimed client time is provenance, not proof
// that the answer was timely. Only a staff review may classify it, once.

const (
	DispositionPending     = "pending"
	DispositionRelevant    = "relevant"
	DispositionNotRelevant = "not_relevant"
	maxEvidenceReasonLen   = 64
	maxReviewNoteLen       = 1000
)

// DraftEvidenceItem is one locally retained write with its original provenance.
type DraftEvidenceItem struct {
	WriteID          string          `json:"writeId"`
	QuestionID       string          `json:"questionId"`
	ClientVersion    uint64          `json:"clientVersion"`
	Response         ResponsePayload `json:"response"`
	OriginLeaseEpoch *uint64         `json:"originLeaseEpoch"`
	ClaimedClientAt  *time.Time      `json:"claimedClientAt"`
	Reason           string          `json:"reason"`
}

// DraftEvidenceAck reports newly recorded and exactly replayed items.
type DraftEvidenceAck struct {
	Recorded int `json:"recorded"`
	Replayed int `json:"replayed"`
}

// DraftEvidence is the staff review projection.
type DraftEvidence struct {
	ID               string          `json:"id"`
	AttemptID        string          `json:"attemptId"`
	WriteID          string          `json:"writeId"`
	QuestionID       string          `json:"questionId"`
	Response         ResponsePayload `json:"response"`
	ResponseHash     string          `json:"responseHash"`
	OriginLeaseEpoch *uint64         `json:"originLeaseEpoch"`
	ClientVersion    *uint64         `json:"clientVersion"`
	ClaimedClientAt  *time.Time      `json:"claimedClientAt"`
	ReceivedAt       time.Time       `json:"receivedAt"`
	Reason           string          `json:"reason"`
	Disposition      string          `json:"disposition"`
	ReviewedBy       *string         `json:"reviewedBy"`
	ReviewedAt       *time.Time      `json:"reviewedAt"`
	ReviewNote       *string         `json:"reviewNote"`
}

// RecordDraftEvidence stores retained drafts under a live exam credential.
// The credential is the authority (normal admission or staff-assisted
// recovery); the attempt lock serializes it with fencing, transfer, and
// revocation exactly like a save, but nothing is applied to the answer set.
func (s *Service) RecordDraftEvidence(ctx context.Context, bearer, attemptID string, items []DraftEvidenceItem) (DraftEvidenceAck, error) {
	if err := ValidateAttemptID(attemptID); err != nil {
		return DraftEvidenceAck{}, err
	}
	if err := validateDraftEvidence(items); err != nil {
		return DraftEvidenceAck{}, err
	}
	claims, err := crypto.VerifyAttemptToken(s.secret, s.clock.Now(), bearer)
	if err != nil {
		return DraftEvidenceAck{}, auth.AttemptCredentialError(err)
	}
	commands := make([]ResponseCommand, len(items))
	for i, item := range items {
		commands[i] = ResponseCommand{WriteID: item.WriteID, QuestionID: item.QuestionID, ClientVersion: item.ClientVersion, Response: item.Response}
	}
	payloads := preparePayloads(commands)
	for _, p := range payloads {
		if p.err != nil {
			return DraftEvidenceAck{}, apperrors.New(apperrors.CodeBadRequest, "Invalid evidence response.")
		}
	}
	var ack DraftEvidenceAck
	err = s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		ack = DraftEvidenceAck{}
		attempt, err := s.authorizeAccessTx(ctx, q, claims, attemptID)
		if err != nil {
			return err
		}
		now := s.clock.Now().UTC()
		for i, item := range items {
			if item.OriginLeaseEpoch != nil && *item.OriginLeaseEpoch > attempt.LeaseEpoch {
				return apperrors.New(apperrors.CodeValidation, "Evidence cannot originate from a future writer lease.")
			}
			var storedQuestion, storedHash string
			var storedVersion sql.NullInt64
			err := q.QueryRowContext(ctx, `SELECT question_id, response_hash, client_version FROM attempt_draft_evidence WHERE attempt_id = ? AND write_id = ?`, attemptID, item.WriteID).
				Scan(&storedQuestion, &storedHash, &storedVersion)
			if err == nil {
				if storedQuestion != item.QuestionID || storedHash != payloads[i].hash || !storedVersion.Valid || uint64(storedVersion.Int64) != item.ClientVersion {
					return apperrors.New(apperrors.CodeConflict, "This evidence write was already recorded with different content.")
				}
				ack.Replayed++
				continue
			}
			if err != sql.ErrNoRows {
				return err
			}
			var claimed any
			if item.ClaimedClientAt != nil {
				claimed = item.ClaimedClientAt.UTC()
			}
			if _, err := q.ExecContext(ctx, `INSERT INTO attempt_draft_evidence (id, attempt_id, schedule_id, write_id, question_id, response, response_hash, origin_lease_epoch, client_version, claimed_client_at, received_at, received_token_id, reason)
 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				uuid.NewString(), attemptID, attempt.ScheduleID, item.WriteID, item.QuestionID, string(payloads[i].canonical), payloads[i].hash,
				item.OriginLeaseEpoch, item.ClientVersion, claimed, now, claims.TokenID, item.Reason); err != nil {
				return err
			}
			ack.Recorded++
		}
		if ack.Recorded == 0 {
			return nil
		}
		_, err = q.ExecContext(ctx, `INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, 'system', 'DRAFT_EVIDENCE_RECORDED', ?, JSON_OBJECT('recorded', ?), UTC_TIMESTAMP(6))`,
			uuid.NewString(), attempt.ScheduleID, attemptID, ack.Recorded)
		return err
	})
	if err != nil {
		return DraftEvidenceAck{}, err
	}
	if ack.Recorded > 0 {
		telemetry.IncCounter(telemetry.MDraftEvidenceTotal, "outcome", "recorded")
	}
	return ack, nil
}

func validateDraftEvidence(items []DraftEvidenceItem) error {
	if len(items) == 0 || len(items) > MaxBatchCommands {
		return apperrors.New(apperrors.CodeBadRequest, "Evidence must contain between 1 and 100 items.")
	}
	seen := make(map[string]struct{}, len(items))
	for _, item := range items {
		if _, dup := seen[item.WriteID]; dup {
			return apperrors.New(apperrors.CodeBadRequest, "Duplicate write id in evidence.")
		}
		seen[item.WriteID] = struct{}{}
		if err := ValidateCommand(ResponseCommand{WriteID: item.WriteID, QuestionID: item.QuestionID, ClientVersion: item.ClientVersion, Response: item.Response}); err != nil {
			return err
		}
		if reason := strings.TrimSpace(item.Reason); reason == "" || len(reason) > maxEvidenceReasonLen {
			return apperrors.New(apperrors.CodeBadRequest, "Evidence requires a bounded reason.")
		}
	}
	return nil
}

// ListDraftEvidence returns an attempt's evidence for authorized staff review.
// The caller enforces staff role and schedule scope.
func (s *Service) ListDraftEvidence(ctx context.Context, scheduleID, attemptID string) ([]DraftEvidence, error) {
	var out []DraftEvidence
	err := s.tx.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		var err error
		out, err = listDraftEvidenceTx(ctx, q, scheduleID, attemptID)
		return err
	})
	return out, err
}

func listDraftEvidenceTx(ctx context.Context, q tx.Tx, scheduleID, attemptID string) ([]DraftEvidence, error) {
	rows, err := q.QueryContext(ctx, `SELECT id, attempt_id, write_id, question_id, CAST(response AS CHAR), response_hash, origin_lease_epoch, client_version, claimed_client_at, received_at, reason, disposition, reviewed_by, reviewed_at, review_note
 FROM attempt_draft_evidence WHERE schedule_id = ? AND attempt_id = ? ORDER BY received_at, id`, scheduleID, attemptID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []DraftEvidence{}
	for rows.Next() {
		var e DraftEvidence
		var raw string
		var lease, version sql.NullInt64
		var claimed, reviewedAt sql.NullTime
		var reviewedBy, note sql.NullString
		if err := rows.Scan(&e.ID, &e.AttemptID, &e.WriteID, &e.QuestionID, &raw, &e.ResponseHash, &lease, &version, &claimed, &e.ReceivedAt, &e.Reason, &e.Disposition, &reviewedBy, &reviewedAt, &note); err != nil {
			return nil, err
		}
		if err := json.Unmarshal([]byte(raw), &e.Response); err != nil {
			return nil, err
		}
		e.OriginLeaseEpoch, e.ClientVersion = nullUint(lease), nullUint(version)
		if claimed.Valid {
			t := claimed.Time.UTC()
			e.ClaimedClientAt = &t
		}
		if reviewedAt.Valid {
			t := reviewedAt.Time.UTC()
			e.ReviewedAt = &t
		}
		if reviewedBy.Valid {
			e.ReviewedBy = &reviewedBy.String
		}
		if note.Valid {
			e.ReviewNote = &note.String
		}
		e.ReceivedAt = e.ReceivedAt.UTC()
		out = append(out, e)
	}
	return out, rows.Err()
}

// ReviewDraftEvidence records the one-time staff disposition. Provenance is
// immutable and a decision cannot be overwritten; acting on relevant evidence
// (for example a grading adjustment) is a separate, audited staff action.
func (s *Service) ReviewDraftEvidence(ctx context.Context, scheduleID, attemptID, evidenceID, reviewerID, disposition, note string) error {
	if disposition != DispositionRelevant && disposition != DispositionNotRelevant {
		return apperrors.New(apperrors.CodeValidation, "Disposition must be relevant or not_relevant.")
	}
	note = strings.TrimSpace(note)
	if len(note) > maxReviewNoteLen {
		return apperrors.New(apperrors.CodeValidation, "Review note is too long.")
	}
	return s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		result, err := q.ExecContext(ctx, `UPDATE attempt_draft_evidence SET disposition = ?, reviewed_by = ?, reviewed_at = ?, review_note = NULLIF(?, '')
 WHERE id = ? AND attempt_id = ? AND schedule_id = ? AND disposition = 'pending'`, disposition, reviewerID, s.clock.Now().UTC(), note, evidenceID, attemptID, scheduleID)
		if err != nil {
			return err
		}
		affected, err := result.RowsAffected()
		if err != nil {
			return err
		}
		if affected == 1 {
			_, err = q.ExecContext(ctx, `INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, ?, 'DRAFT_EVIDENCE_REVIEWED', ?, JSON_OBJECT('evidenceId', ?, 'disposition', ?), UTC_TIMESTAMP(6))`,
				uuid.NewString(), scheduleID, reviewerID, attemptID, evidenceID, disposition)
			return err
		}
		var current string
		err = q.QueryRowContext(ctx, `SELECT disposition FROM attempt_draft_evidence WHERE id = ? AND attempt_id = ? AND schedule_id = ?`, evidenceID, attemptID, scheduleID).Scan(&current)
		if err == sql.ErrNoRows {
			return apperrors.New(apperrors.CodeNotFound, "Evidence not found.")
		}
		if err != nil {
			return err
		}
		if current == disposition {
			return nil // exact retry of the committed decision
		}
		return apperrors.New(apperrors.CodeConflict, "This evidence was already reviewed.")
	})
}

func nullUint(v sql.NullInt64) *uint64 {
	if !v.Valid || v.Int64 < 0 {
		return nil
	}
	u := uint64(v.Int64)
	return &u
}

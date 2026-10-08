package proctor

import (
	"context"
	"database/sql"
	"encoding/json"
	"sort"
	"strconv"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/lifecycle"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/google/uuid"
)

type LateEvidenceRow struct {
	ID                 string          `json:"id"`
	Sequence           string          `json:"sequence"`
	ModuleID           string          `json:"moduleId"`
	QuestionID         string          `json:"questionId"`
	WriteID            string          `json:"writeId"`
	Response           json.RawMessage `json:"response"`
	OriginLeaseEpoch   *int64          `json:"originLeaseEpoch"`
	ClientVersion      *int64          `json:"clientVersion"`
	ResponseHash       *string         `json:"responseHash"`
	RequestHash        *string         `json:"requestHash"`
	ClientMetadata     json.RawMessage `json:"clientMetadata"`
	ServerReceivedAt   time.Time       `json:"serverReceivedAt"`
	WouldChangeRoute   bool            `json:"wouldChangeRoute"`
	ProvenanceConflict bool            `json:"provenanceConflict"`
	ReviewedAt         *time.Time      `json:"reviewedAt"`
	ReviewedBy         *string         `json:"reviewedBy"`
	ReviewOutcome      *string         `json:"reviewOutcome"`
	ReviewNote         *string         `json:"reviewNote"`
}

type LateEvidencePage struct {
	Rows       []LateEvidenceRow `json:"rows"`
	NextCursor string            `json:"nextCursor"`
	HasMore    bool              `json:"hasMore"`
}

type LateEvidenceReviewRequest struct {
	OperationID string   `json:"operationId"`
	EvidenceIDs []string `json:"evidenceIds"`
	Outcome     string   `json:"outcome"`
	Note        string   `json:"note"`
}

func (s *Service) ListLateEvidence(ctx context.Context, actor Actor, scheduleID, attemptID, cursor string, limit int) (*LateEvidencePage, error) {
	if cursor == "" {
		cursor = "0"
	}
	after, err := strconv.ParseUint(cursor, 10, 64)
	if err != nil {
		return nil, apperrors.New(apperrors.CodeValidation, "Evidence cursor must be an unsigned sequence.")
	}
	if limit == 0 {
		limit = 50
	}
	if limit < 1 || limit > 100 {
		return nil, apperrors.New(apperrors.CodeValidation, "Evidence page size must be between 1 and 100.")
	}
	page := &LateEvidencePage{Rows: make([]LateEvidenceRow, 0, limit), NextCursor: cursor}
	err = s.tx.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeRead(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		var ownedID string
		if err := q.QueryRowContext(ctx, "SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ?", attemptID, scheduleID).Scan(&ownedID); err != nil {
			if err == sql.ErrNoRows {
				return notFound("Attempt not found.")
			}
			return err
		}
		rows, err := q.QueryContext(ctx, `SELECT e.id, e.evidence_seq, e.module_id, e.question_id, e.write_id, CAST(e.response AS CHAR), e.origin_lease_epoch, e.client_version, e.response_hash, e.request_hash, CAST(e.client_metadata AS CHAR), e.server_received_at, (e.would_change_route OR COALESCE(f.would_change_route, FALSE)), (e.provenance_conflict OR COALESCE(f.provenance_conflict, FALSE)), e.reviewed_at, e.reviewed_by, e.review_outcome, e.review_note FROM assessment_late_answer_evidence e LEFT JOIN assessment_late_evidence_frontiers f ON f.module_attempt_id = e.module_attempt_id AND f.question_id = e.question_id WHERE e.attempt_id = ? AND e.evidence_seq > ? ORDER BY e.evidence_seq ASC LIMIT ?`, attemptID, after, limit+1)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var row LateEvidenceRow
			var response string
			var lease, version sql.NullInt64
			var hash, requestHash, metadata, reviewedBy, outcome, note sql.NullString
			var reviewedAt sql.NullTime
			if err := rows.Scan(&row.ID, &row.Sequence, &row.ModuleID, &row.QuestionID, &row.WriteID, &response, &lease, &version, &hash, &requestHash, &metadata, &row.ServerReceivedAt, &row.WouldChangeRoute, &row.ProvenanceConflict, &reviewedAt, &reviewedBy, &outcome, &note); err != nil {
				return err
			}
			if len(page.Rows) == limit {
				page.HasMore = true
				break
			}
			row.Response = json.RawMessage(response)
			if lease.Valid {
				n := lease.Int64
				row.OriginLeaseEpoch = &n
			}
			if version.Valid {
				n := version.Int64
				row.ClientVersion = &n
			}
			if hash.Valid {
				v := hash.String
				row.ResponseHash = &v
			}
			if requestHash.Valid {
				v := requestHash.String
				row.RequestHash = &v
			}
			if metadata.Valid {
				row.ClientMetadata = json.RawMessage(metadata.String)
			}
			if reviewedAt.Valid {
				v := reviewedAt.Time.UTC()
				row.ReviewedAt = &v
			}
			if reviewedBy.Valid {
				v := reviewedBy.String
				row.ReviewedBy = &v
			}
			if outcome.Valid {
				v := outcome.String
				row.ReviewOutcome = &v
			}
			if note.Valid {
				v := note.String
				row.ReviewNote = &v
			}
			row.ServerReceivedAt = row.ServerReceivedAt.UTC()
			page.Rows = append(page.Rows, row)
			page.NextCursor = row.Sequence
		}
		return rows.Err()
	})
	if err != nil {
		return nil, err
	}
	return page, nil
}

// Review records an operational finding only. It never writes canonical
// answers, module scores, routing decisions, submission, or released results.
func (s *Service) ReviewLateEvidence(ctx context.Context, actor Actor, scheduleID, attemptID string, req LateEvidenceReviewRequest) error {
	if len(req.EvidenceIDs) == 0 || len(req.EvidenceIDs) > 100 {
		return apperrors.New(apperrors.CodeValidation, "Name between 1 and 100 evidence records.")
	}
	if req.Outcome != "acknowledged" && req.Outcome != "investigated" {
		return apperrors.New(apperrors.CodeValidation, "Review outcome must be acknowledged or investigated.")
	}
	req.Note = strings.TrimSpace(req.Note)
	if len(req.Note) > 2048 {
		return apperrors.New(apperrors.CodeValidation, "Review note exceeds 2048 bytes.")
	}
	req.EvidenceIDs = append([]string(nil), req.EvidenceIDs...)
	sort.Strings(req.EvidenceIDs)
	for i, id := range req.EvidenceIDs {
		if id == "" || (i > 0 && id == req.EvidenceIDs[i-1]) {
			return apperrors.New(apperrors.CodeValidation, "Evidence record ids must be non-empty and unique.")
		}
	}
	hash, err := lifecycle.Hash("review_late_evidence", struct {
		ActorID string
		Request LateEvidenceReviewRequest
	}{actor.ID, req})
	if err != nil {
		return err
	}
	scope := lifecycle.Scope{ScheduleID: scheduleID, AttemptID: attemptID}
	return s.tx.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeRead(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		var lockedID string
		if err := q.QueryRowContext(ctx, "SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE", attemptID, scheduleID).Scan(&lockedID); err != nil {
			if err == sql.ErrNoRows {
				return notFound("Attempt not found.")
			}
			return err
		}
		if receipt, err := lifecycle.Load(ctx, q, scope, req.OperationID, "review_late_evidence", hash); err != nil || receipt != nil {
			return err
		}
		args := make([]any, 1, len(req.EvidenceIDs)+1)
		args[0] = attemptID
		placeholders := make([]string, len(req.EvidenceIDs))
		for i, id := range req.EvidenceIDs {
			args = append(args, id)
			placeholders[i] = "?"
		}
		rows, err := q.QueryContext(ctx, "SELECT id FROM assessment_late_answer_evidence WHERE attempt_id = ? AND id IN ("+strings.Join(placeholders, ",")+")", args...)
		if err != nil {
			return err
		}
		count := 0
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				rows.Close()
				return err
			}
			count++
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return err
		}
		if count != len(req.EvidenceIDs) {
			return notFound("Evidence record not found.")
		}
		for _, id := range req.EvidenceIDs {
			if _, err := q.ExecContext(ctx, "INSERT INTO assessment_late_evidence_reviews (id, attempt_id, evidence_id, operation_id, actor_id, outcome, note) VALUES (?, ?, ?, ?, ?, ?, ?)", uuid.NewString(), attemptID, id, req.OperationID, actor.ID, req.Outcome, req.Note); err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, "UPDATE assessment_late_answer_evidence SET reviewed_at = UTC_TIMESTAMP(6), reviewed_by = ?, review_outcome = ?, review_note = ? WHERE id = ? AND attempt_id = ?", actor.ID, req.Outcome, req.Note, id, attemptID); err != nil {
				return err
			}
		}
		if err := insertAuditLog(ctx, q, scheduleID, actor.ID, "SAT_LATE_EVIDENCE_REVIEW", &attemptID, map[string]any{"operationId": req.OperationID, "evidenceIds": req.EvidenceIDs, "outcome": req.Outcome, "note": req.Note}); err != nil {
			return err
		}
		if err := s.emitRoster(ctx, q, scheduleID, "review_late_evidence", &attemptID, map[string]any{"operationId": req.OperationID}); err != nil {
			return err
		}
		return lifecycle.Store(ctx, q, scope, req.OperationID, "review_late_evidence", hash, map[string]any{"ok": true})
	})
}

package outbox

// WS-09 dead-letter quarantine for terminally-parked outbox rows.
//
// Contract: the terminal park UPDATE and the DLQ evidence INSERT commit in
// ONE transaction (markTerminal) so a terminal row never exists without
// queryable evidence. The parked outbox row is kept as-is (move semantics
// would change current reader behavior); the DLQ row is the operator's
// evidence. Every state change is transactional or single-statement atomic
// + idempotent: markTerminal runs once per event (failed_at rows are never
// re-claimed), QuarantineAttempt uses INSERT IGNORE behind
// UNIQUE(source_event_id, aggregate_id), and RequeueDeadLetter resolves
// exactly once behind the resolved_at guard.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"strings"

	"github.com/google/uuid"
)

// DeadLetter is one quarantined outbox row (outbox_dead_letters).
type DeadLetter struct {
	ID            string
	SourceEventID string
	AggregateKind string
	AggregateID   string
	Revision      int64
	Family        string
	Payload       json.RawMessage
	Error         string
	Attempts      int
	FailedAt      sql.NullTime
	RequeueToken  string
	ResolvedAt    sql.NullTime
}

// newRequeueToken mints the single-use DLQ requeue token (CHAR(64) UNIQUE).
func newRequeueToken() string {
	return strings.ReplaceAll(uuid.NewString(), "-", "")
}

// markTerminal parks the event row terminal and inserts the DLQ evidence
// row in one transaction, then counts + logs. A claim-token miss (0 rows)
// is a no-op success, preserving MarkFailed's historical behavior. The
// retry (non-terminal) path stays in MarkFailed, byte-identical.
func (r *Repository) markTerminal(ctx context.Context, claimToken, id string, attempts int, message string) error {
	startedTx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return err
	}
	committed := false
	defer func() {
		if !committed {
			_ = startedTx.Rollback()
		}
	}()
	if _, err := startedTx.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
		return err
	}
	var kind, aggregateID, family, payload string
	var revision int64
	if err := startedTx.QueryRowContext(ctx, `
		SELECT aggregate_kind, aggregate_id, revision, event_family, CAST(payload AS CHAR)
		FROM outbox_events
		WHERE id = ? AND claim_token = ?`, id, claimToken).Scan(&kind, &aggregateID, &revision, &family, &payload); err != nil {
		if err == sql.ErrNoRows {
			if err := startedTx.Commit(); err != nil {
				return err
			}
			committed = true
			return nil
		}
		return err
	}
	if _, err := startedTx.ExecContext(ctx, `
		UPDATE outbox_events
		SET claimed_at = NOW(), claim_token = NULL, claimed_by = NULL,
			claim_expires_at = DATE_ADD(NOW(), INTERVAL 365 DAY),
			next_attempt_at = NULL, failed_at = NOW(), last_error = ?
		WHERE id = ? AND claim_token = ?`, message, id, claimToken); err != nil {
		return err
	}
	requeueToken := newRequeueToken()
	if _, err := startedTx.ExecContext(ctx, `
		INSERT INTO outbox_dead_letters
			(id, source_event_id, aggregate_kind, aggregate_id, revision, event_family, payload, error, attempts, failed_at, requeue_token, resolved_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, NULL)`,
		uuid.NewString(), id, kind, aggregateID, revision, family, payload, message, attempts, requeueToken); err != nil {
		return err
	}
	if err := startedTx.Commit(); err != nil {
		return err
	}
	committed = true
	EmitTerminalTotal(family)
	log.Printf("outbox: event terminal event_id=%s aggregate=%s/%s family=%s attempts=%d requeue_token=%s err=%s",
		id, kind, aggregateID, family, attempts, requeueToken, message)
	return nil
}

// QuarantineAttempt records one poison batch attempt as its own DLQ row so
// a single bad attempt never burns the whole batch. INSERT IGNORE behind
// UNIQUE(source_event_id, aggregate_id) makes reseal replays idempotent:
// only the first insert counts + logs. Single-statement atomic.
func (r *Repository) QuarantineAttempt(ctx context.Context, source Event, attemptID, reason string, cause error) error {
	causeMsg := "<nil>"
	if cause != nil {
		causeMsg = cause.Error()
	}
	detail, _ := json.Marshal(map[string]any{
		"scheduleId":    source.AggregateID,
		"attemptId":     attemptID,
		"reason":        reason,
		"sourceEventId": source.ID,
	})
	res, err := r.db.ExecContext(ctx, `
		INSERT IGNORE INTO outbox_dead_letters
			(id, source_event_id, aggregate_kind, aggregate_id, revision, event_family, payload, error, attempts, failed_at, requeue_token, resolved_at)
		VALUES (?, ?, 'attempt', ?, ?, ?, ?, ?, ?, NOW(), ?, NULL)`,
		uuid.NewString(), source.ID, attemptID, source.Revision, source.Family, string(detail), causeMsg, source.PublishAttempts, newRequeueToken())
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 1 {
		EmitTerminalTotal(source.Family)
		log.Printf("outbox: attempt quarantined event_id=%s attempt_id=%s family=%s err=%s", source.ID, attemptID, source.Family, causeMsg)
	}
	return nil
}

// RequeueDeadLetter re-inserts one dead letter as a fresh outbox event and
// marks the letter resolved, atomically. The requeued payload carries the
// letter's requeue token (dlqRequeueToken) so the retry is traceable to
// exactly one DLQ row; a second requeue of the same letter fails closed
// (already resolved) instead of duplicating work. Returns the new event id.
func (r *Repository) RequeueDeadLetter(ctx context.Context, dlqID string) (string, error) {
	startedTx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", err
	}
	committed := false
	defer func() {
		if !committed {
			_ = startedTx.Rollback()
		}
	}()
	if _, err := startedTx.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
		return "", err
	}
	var kind, aggregateID, family, payload, token string
	var revision int64
	var resolved sql.NullTime
	if err := startedTx.QueryRowContext(ctx, `
		SELECT aggregate_kind, aggregate_id, revision, event_family, CAST(payload AS CHAR), requeue_token, resolved_at
		FROM outbox_dead_letters
		WHERE id = ? FOR UPDATE`, dlqID).Scan(&kind, &aggregateID, &revision, &family, &payload, &token, &resolved); err != nil {
		if err == sql.ErrNoRows {
			return "", fmt.Errorf("dead letter %s not found", dlqID)
		}
		return "", err
	}
	if resolved.Valid {
		return "", fmt.Errorf("dead letter %s already resolved", dlqID)
	}
	newID := uuid.NewString()
	if _, err := startedTx.ExecContext(ctx, `
		INSERT INTO outbox_events
			(id, aggregate_kind, aggregate_id, revision, event_family, payload, created_at, publish_attempts)
		VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)`,
		newID, kind, aggregateID, revision, family, withRequeueToken(payload, token)); err != nil {
		return "", err
	}
	res, err := startedTx.ExecContext(ctx, `
		UPDATE outbox_dead_letters SET resolved_at = NOW() WHERE id = ? AND resolved_at IS NULL`, dlqID)
	if err != nil {
		return "", err
	}
	if n, _ := res.RowsAffected(); n != 1 {
		return "", fmt.Errorf("dead letter %s concurrently resolved", dlqID)
	}
	if err := startedTx.Commit(); err != nil {
		return "", err
	}
	committed = true
	log.Printf("outbox: dead letter requeued dlq_id=%s event_id=%s aggregate=%s/%s family=%s", dlqID, newID, kind, aggregateID, family)
	return newID, nil
}

// withRequeueToken tags a requeued JSON-object payload with its DLQ token
// for operator traceability. Non-object payloads pass through untouched.
func withRequeueToken(payload, token string) string {
	var obj map[string]any
	if err := json.Unmarshal([]byte(payload), &obj); err != nil || obj == nil {
		return payload
	}
	obj["dlqRequeueToken"] = token
	raw, err := json.Marshal(obj)
	if err != nil {
		return payload
	}
	return string(raw)
}

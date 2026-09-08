// Package outbox implements the transactional outbox for the Go backend.
//
// Contract (mirrors backend/crates/infrastructure/src/outbox.rs):
// claim_batch(limit 100, lease 60s) claims due rows with one UPDATE guarded
// by published/failed/next_attempt/lease-expiry, then SELECTs by claim_token;
// mark_published clears the claim; retry uses 5s*2^(n-1) capped at 300s with
// terminal failure at >= 8 attempts; purge drops published rows older than
// 72h. Event families emitted by the application: only
// auto_submit_schedule_attempts_requested executes work; attempt_terminalized,
// runtime_changed, and roster_changed are live-update wakeups carried by the
// worker's notify fan-out.
package outbox

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// duePredicate is the shared due-row predicate (claim + skip-locked select).
const duePredicate = `published_at IS NULL
		  AND failed_at IS NULL
		  AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
		  AND (claimed_at IS NULL OR claim_expires_at < NOW())`

// Tunables mirror the Rust worker/infra constants.
const (
	ClaimLimit      = 100
	ClaimLeaseSecs  = 60
	MaxAttempts     = 8
	BaseBackoffSecs = 5
	MaxBackoffSecs  = 300
	PurgeAfterHours = 72
)

// Event families.
const (
	FamilyAutoSubmitScheduleAttempts = "auto_submit_schedule_attempts_requested"
	FamilyAttemptTerminalized        = "attempt_terminalized"
	FamilyRuntimeChanged             = "runtime_changed"
	FamilyRosterChanged              = "roster_changed"
)

// IsExecutable reports whether the worker runs application work for a family.
// Only the auto-submit family executes; the rest are wakeup notifications.
func IsExecutable(family string) bool { return family == FamilyAutoSubmitScheduleAttempts }

// SkipEnqueue tells wakeup-family call sites whether to skip the INSERT
// under exec-only mode (plan B4.1, OUTBOX_EXEC_ONLY). Executable families
// never skip; known wakeup families skip only when execOnly is on; UNKNOWN
// families never skip (fail open: a future executable family must be claimed,
// never silently dropped — update IsExecutable when adding one).
func SkipEnqueue(family string, execOnly bool) bool {
	if !execOnly {
		return false
	}
	switch family {
	case FamilyAutoSubmitScheduleAttempts:
		return false
	case FamilyAttemptTerminalized, FamilyRuntimeChanged, FamilyRosterChanged, "attempt_changed":
		return true
	default:
		return false
	}
}

// RetryDisposition is the outcome of a failed publish attempt.
type RetryDisposition int

const (
	// RetryAfter schedules next_attempt_at after the backoff.
	RetryAfter RetryDisposition = iota
	// Terminal marks the event failed; it will never be claimed again.
	Terminal
)

// BackoffFor returns the disposition and delay for a 1-based attempt count.
// attempts >= 8 is terminal; otherwise 5s*2^(n-1) capped at 300s.
func BackoffFor(attempts int) (RetryDisposition, time.Duration) {
	if attempts < 1 {
		attempts = 1
	}
	if attempts >= MaxAttempts {
		return Terminal, 0
	}
	delay := time.Duration(BaseBackoffSecs) * time.Second
	for i := 1; i < attempts; i++ {
		delay *= 2
		if delay >= time.Duration(MaxBackoffSecs)*time.Second {
			delay = time.Duration(MaxBackoffSecs) * time.Second
			break
		}
	}
	if delay > time.Duration(MaxBackoffSecs)*time.Second {
		delay = time.Duration(MaxBackoffSecs) * time.Second
	}
	return RetryAfter, delay
}

// Event is one outbox row.
type Event struct {
	ID              string
	AggregateKind   string
	AggregateID     string
	Revision        int64
	Family          string
	Payload         json.RawMessage
	CreatedAt       time.Time
	PublishAttempts int
	LastError       sql.NullString
	ClaimToken      sql.NullString
	NextAttemptAt   sql.NullTime
	FailedAt        sql.NullTime
}

// ClaimMode selects the claim SQL posture (plan B4.3). Update keeps the
// single UPDATE ... ORDER BY ... LIMIT claim (ship state); SkipLocked uses
// SELECT ... FOR UPDATE SKIP LOCKED + UPDATE by id (less InnoDB over-lock
// under multi-consumer claiming). Unknown values fail closed at ClaimBatch.
type ClaimMode string

const (
	// ClaimUpdate is the single-statement claim (ship default).
	ClaimUpdate ClaimMode = "update"
	// ClaimSkipLocked is the select-then-update claim (OUTBOX_CLAIM_MODE=skiplocked).
	ClaimSkipLocked ClaimMode = "skiplocked"
)

// Repository owns outbox SQL. The pool handle serves claim/mark/purge;
// EnqueueInTx runs inside the caller's transaction.
type Repository struct {
	db *sql.DB
	// claimPartitions/claimIndex select the MOD(CRC32(aggregate_id))
	// disjoint-lease partition (plan B4.3). 1/0 = today's single consumer.
	claimPartitions int
	claimIndex      int
	// claimMode selects update vs SKIP LOCKED claim SQL.
	claimMode ClaimMode
}

// NewRepository wires the pool explicitly.
func NewRepository(db *sql.DB) *Repository { return &Repository{db: db} }

// WithClaim selects partitioned claiming (plan B4.3, chainable): partitions
// N with this consumer holding index i (0-based), under mode. partitions < 1
// normalizes to 1 (today's single consumer); the index wraps mod N; the mode
// is preserved verbatim so an unknown value fails closed at ClaimBatch
// (never silently changing lock semantics).
func (r *Repository) WithClaim(partitions, index int, mode ClaimMode) *Repository {
	if partitions < 1 {
		partitions = 1
	}
	r.claimPartitions = partitions
	r.claimIndex = index % partitions
	if r.claimIndex < 0 {
		r.claimIndex += partitions
	}
	r.claimMode = mode
	return r
}

// partitionPredicate renders the disjoint-lease predicate (empty for the
// single-consumer posture, preserving today's claim SQL byte-for-byte).
func (r *Repository) partitionPredicate() string {
	if r == nil || r.claimPartitions < 2 {
		return ""
	}
	return "\n\t  AND MOD(CRC32(aggregate_id), " + itoa(r.claimPartitions) + ") = " + itoa(r.claimIndex)
}

func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	neg := n < 0
	if neg {
		n = -n
	}
	var buf [20]byte
	pos := len(buf)
	for n > 0 {
		pos--
		buf[pos] = byte('0' + n%10)
		n /= 10
	}
	if neg {
		pos--
		buf[pos] = '-'
	}
	return string(buf[pos:])
}

// EnqueueInTx inserts an event in the caller's transaction so business writes
// and the outbox row commit atomically.
func EnqueueInTx(ctx context.Context, t tx.Tx, aggregateKind, aggregateID string, revision int64, family string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	_, err = t.ExecContext(ctx, `
		INSERT INTO outbox_events
			(id, aggregate_kind, aggregate_id, revision, event_family, payload, created_at, publish_attempts)
		VALUES (?, ?, ?, ?, ?, ?, NOW(), 0)`,
		uuid.NewString(), aggregateKind, aggregateID, revision, family, string(raw))
	return err
}

// ClaimBatch claims up to limit due events under one claim token. Mode
// update (ship state): single UPDATE ... ORDER BY ... LIMIT ? with the due
// predicate. Mode skiplocked: SELECT ... FOR UPDATE SKIP LOCKED + UPDATE
// by id (less InnoDB over-locking under multi-consumer claiming; the
// claim_token=? guard keeps the UPDATE lost-update safe). Both bump
// publish_attempts so BackoffFor observes the new count. Partitioned
// consumers (WithClaim N>1) add AND MOD(CRC32(aggregate_id), N) = i so
// consumers hold disjoint leases. Unknown modes fail closed.
func (r *Repository) ClaimBatch(ctx context.Context, limit int, workerID string, leaseSecs int64) (string, []Event, error) {
	if limit < 1 {
		limit = ClaimLimit
	}
	if limit > ClaimLimit {
		limit = ClaimLimit
	}
	if leaseSecs < 1 {
		leaseSecs = ClaimLeaseSecs
	}
	mode := ClaimUpdate
	if r != nil && r.claimMode != "" {
		mode = r.claimMode
	}
	switch mode {
	case ClaimUpdate:
		return r.claimBatchUpdate(ctx, limit, workerID, leaseSecs)
	case ClaimSkipLocked:
		return r.claimBatchSkipLocked(ctx, limit, workerID, leaseSecs)
	default:
		return "", nil, fmt.Errorf("unknown outbox claim mode %q (want update|skiplocked)", string(mode))
	}
}

func (r *Repository) claimBatchUpdate(ctx context.Context, limit int, workerID string, leaseSecs int64) (string, []Event, error) {
	token := uuid.NewString()
	startedTx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = startedTx.Rollback()
		}
	}()
	if _, err := startedTx.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
		return "", nil, err
	}
	res, err := startedTx.ExecContext(ctx, `
		UPDATE outbox_events
		SET claimed_at = NOW(),
			claim_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
			claimed_by = ?,
			claim_token = ?,
			publish_attempts = publish_attempts + 1
		WHERE `+duePredicate+r.partitionPredicate()+`
		ORDER BY created_at ASC
		LIMIT ?`, leaseSecs, workerID, token, limit)
	if err != nil {
		return "", nil, err
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		if err := startedTx.Commit(); err != nil {
			return "", nil, err
		}
		committed = true
		return "", nil, nil
	}
	rows, err := startedTx.QueryContext(ctx, `
		SELECT id, aggregate_kind, aggregate_id, revision, event_family, payload,
			created_at, publish_attempts, last_error, claim_token, next_attempt_at, failed_at
		FROM outbox_events
		WHERE claim_token = ? AND published_at IS NULL
		ORDER BY created_at ASC`, token)
	if err != nil {
		return "", nil, err
	}
	var events []Event
	for rows.Next() {
		var e Event
		var payload string
		if err := rows.Scan(&e.ID, &e.AggregateKind, &e.AggregateID, &e.Revision, &e.Family,
			&payload, &e.CreatedAt, &e.PublishAttempts, &e.LastError, &e.ClaimToken,
			&e.NextAttemptAt, &e.FailedAt); err != nil {
			rows.Close()
			return "", nil, err
		}
		e.Payload = json.RawMessage(payload)
		events = append(events, e)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", nil, err
	}
	if err := startedTx.Commit(); err != nil {
		return "", nil, err
	}
	committed = true
	return token, events, nil
}

// claimBatchSkipLocked claims via SELECT ... FOR UPDATE SKIP LOCKED +
// UPDATE by id (plan B4.3, OUTBOX_CLAIM_MODE=skiplocked). Skipped-locked
// rows are invisible to this consumer's UPDATE, so concurrent partitions
// never block on each other's in-flight claims; the claim_token=? + due
// re-check in the UPDATE keeps a lease race lost-update safe. The
// SELECT runs inside the same RC tx as the UPDATE so locked rows stay
// locked until commit.
func (r *Repository) claimBatchSkipLocked(ctx context.Context, limit int, workerID string, leaseSecs int64) (string, []Event, error) {
	token := uuid.NewString()
	startedTx, err := r.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		return "", nil, err
	}
	committed := false
	defer func() {
		if !committed {
			_ = startedTx.Rollback()
		}
	}()
	if _, err := startedTx.ExecContext(ctx, "SET time_zone = '+00:00'"); err != nil {
		return "", nil, err
	}
	rows, err := startedTx.QueryContext(ctx, `
		SELECT id FROM outbox_events
		WHERE `+duePredicate+r.partitionPredicate()+`
		ORDER BY created_at ASC
		LIMIT ? FOR UPDATE SKIP LOCKED`, limit)
	if err != nil {
		return "", nil, err
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return "", nil, err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return "", nil, err
	}
	if len(ids) == 0 {
		if err := startedTx.Commit(); err != nil {
			return "", nil, err
		}
		committed = true
		return "", nil, nil
	}
	placeholders := strings.Repeat("?,", len(ids))
	placeholders = strings.TrimSuffix(placeholders, ",")
	args := make([]any, 0, len(ids)+4)
	args = append(args, leaseSecs, workerID, token)
	for _, id := range ids {
		args = append(args, id)
	}
	if _, err := startedTx.ExecContext(ctx, `
		UPDATE outbox_events
		SET claimed_at = NOW(),
			claim_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
			claimed_by = ?,
			claim_token = ?,
			publish_attempts = publish_attempts + 1
		WHERE id IN (`+placeholders+`) AND claim_token IS NULL AND `+duePredicate, args...); err != nil {
		return "", nil, err
	}
	events, err := selectByToken(ctx, startedTx, token)
	if err != nil {
		return "", nil, err
	}
	if err := startedTx.Commit(); err != nil {
		return "", nil, err
	}
	committed = true
	return token, events, nil
}

// selectByToken reads claimed rows for one token (shared by claim paths).
// The querier is *sql.Tx in practice (the claim tx); tx.Tx also satisfies it.
func selectByToken(ctx context.Context, q tx.Tx, token string) ([]Event, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT id, aggregate_kind, aggregate_id, revision, event_family, payload,
			created_at, publish_attempts, last_error, claim_token, next_attempt_at, failed_at
		FROM outbox_events
		WHERE claim_token = ? AND published_at IS NULL
		ORDER BY created_at ASC`, token)
	if err != nil {
		return nil, err
	}
	var events []Event
	for rows.Next() {
		var e Event
		var payload string
		if err := rows.Scan(&e.ID, &e.AggregateKind, &e.AggregateID, &e.Revision, &e.Family,
			&payload, &e.CreatedAt, &e.PublishAttempts, &e.LastError, &e.ClaimToken,
			&e.NextAttemptAt, &e.FailedAt); err != nil {
			rows.Close()
			return nil, err
		}
		e.Payload = json.RawMessage(payload)
		events = append(events, e)
	}
	rows.Close()
	return events, rows.Err()
}

// MarkPublished sets published_at and clears the claim for ids owned by token.
func (r *Repository) MarkPublished(ctx context.Context, claimToken string, ids []string) (int64, error) {
	if len(ids) == 0 || strings.TrimSpace(claimToken) == "" {
		return 0, nil
	}
	placeholders := strings.Repeat("?,", len(ids))
	placeholders = strings.TrimSuffix(placeholders, ",")
	query := "UPDATE outbox_events SET published_at = NOW(), last_error = NULL, " +
		"claim_token = NULL, claimed_by = NULL, claim_expires_at = NULL, next_attempt_at = NULL " +
		"WHERE claim_token = ? AND id IN (" + placeholders + ")"
	args := make([]any, 0, len(ids)+1)
	args = append(args, claimToken)
	for _, id := range ids {
		args = append(args, id)
	}
	res, err := r.db.ExecContext(ctx, query, args...)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// MarkFailed records a publish failure: retry dispositions schedule
// next_attempt_at with exponential backoff; terminal sets failed_at.
func (r *Repository) MarkFailed(ctx context.Context, claimToken, id string, attempts int, message string) (RetryDisposition, error) {
	disp, delay := BackoffFor(attempts)
	switch disp {
	case Terminal:
		_, err := r.db.ExecContext(ctx, `
			UPDATE outbox_events
			SET claimed_at = NOW(), claim_token = NULL, claimed_by = NULL,
				claim_expires_at = DATE_ADD(NOW(), INTERVAL 365 DAY),
				next_attempt_at = NULL, failed_at = NOW(), last_error = ?
			WHERE id = ? AND claim_token = ?`, message, id, claimToken)
		return Terminal, err
	default:
		secs := int64(delay / time.Second)
		if secs < 1 {
			secs = 1
		}
		_, err := r.db.ExecContext(ctx, `
			UPDATE outbox_events
			SET claimed_at = NOW(), claim_token = NULL, claimed_by = NULL,
				claim_expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
				next_attempt_at = DATE_ADD(NOW(), INTERVAL ? SECOND),
				failed_at = NULL, last_error = ?
			WHERE id = ? AND claim_token = ?`, secs, secs, message, id, claimToken)
		return RetryAfter, err
	}
}

// PurgePublished deletes published rows older than 72h, bounded by limit.
// OldestPendingAgeSeconds reports the age of the oldest unclaimed, // executable pending event; NULL (no rows) returns 0 without error.
func (r *Repository) OldestPendingAgeSeconds(ctx context.Context) (int64, error) {
	var age sql.NullInt64
	if err := r.db.QueryRowContext(ctx, "SELECT COALESCE(MAX(TIMESTAMPDIFF(SECOND, created_at, UTC_TIMESTAMP(6))), 0) FROM outbox_events WHERE published_at IS NULL AND claim_token IS NULL").Scan(&age); err != nil {
		return 0, err
	}
	if !age.Valid {
		return 0, nil
	}
	return age.Int64, nil
}

func (r *Repository) PurgePublished(ctx context.Context, limit int64) (int64, error) {
	if limit < 1 {
		limit = 1000
	}
	res, err := r.db.ExecContext(ctx, `
		DELETE FROM outbox_events
		WHERE published_at < DATE_SUB(NOW(), INTERVAL 72 HOUR)
		ORDER BY published_at ASC
		LIMIT ?`, limit)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

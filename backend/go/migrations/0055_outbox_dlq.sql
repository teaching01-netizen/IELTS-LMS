-- 0055_outbox_dlq.sql
-- WS-09 dead-letter quarantine for terminally-parked outbox rows.
--
-- The terminal park UPDATE (outbox.MarkFailed terminal path) and the DLQ
-- evidence INSERT commit in ONE transaction, so a terminal row never exists
-- without queryable evidence. The parked outbox row is kept as-is (readers
-- see no behavior change); the DLQ row is the operator's evidence for
-- poison events, quarantined fan-out attempts, and requeue operations.
--
-- Crash-retry safety: every DDL is existence-guarded (0017/0044/0045/0049
-- idiom) dispatched through PREPARE/EXECUTE, so a retry after a crash
-- executes only the missing pieces. The DLQ INSERTs themselves are
-- idempotent at the application layer (markTerminal runs once per event;
-- QuarantineAttempt uses INSERT IGNORE behind the per-attempt UNIQUE).
--
-- Index reasoning (WS-09c + WS-09): the fixed gauge predicate
-- (published_at IS NULL AND failed_at IS NULL AND next_attempt_at bounds)
-- stays covered by the existing idx_outbox_events_retry_eligible
-- (published_at, failed_at, next_attempt_at, claim_expires_at, created_at)
-- from 0030 — no new outbox index is needed. This file adds only the DLQ
-- table's own lookup index (resolved_at, failed_at) for the operator's
-- open-letters scan.

CREATE TABLE IF NOT EXISTS outbox_dead_letters (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    source_event_id VARCHAR(36) NOT NULL,
    aggregate_kind VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    event_family VARCHAR(50) NOT NULL,
    payload JSON NOT NULL,
    error TEXT,
    attempts INT NOT NULL DEFAULT 0,
    failed_at TIMESTAMP(6) NOT NULL,
    requeue_token CHAR(64) NOT NULL,
    resolved_at TIMESTAMP(6) NULL,
    UNIQUE KEY uq_outbox_dead_letters_requeue_token (requeue_token),
    UNIQUE KEY uq_outbox_dead_letters_source_attempt (source_event_id, aggregate_id),
    CONSTRAINT chk_outbox_dead_letters_attempts CHECK (attempts >= 0)
);

SET @dlq_idx_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'outbox_dead_letters'
      AND index_name = 'idx_outbox_dead_letters_open'
);
SET @dlq_idx_sql := IF(
    @dlq_idx_exists = 0,
    'CREATE INDEX idx_outbox_dead_letters_open ON outbox_dead_letters(resolved_at, failed_at)',
    'SELECT 1'
);
PREPARE dlq_idx_stmt FROM @dlq_idx_sql;
EXECUTE dlq_idx_stmt;
DEALLOCATE PREPARE dlq_idx_stmt;

-- 0076_attempt_device_transfers.sql
-- SAT session ownership and supervised device transfer
-- (docs/superpowers/plans/2026-10-06-sat-session-ownership-and-device-transfer.md).
--
-- Expand-only and re-runnable:
--
-- - student_attempts.writer_policy: the ownership policy snapshotted onto an
--   attempt the first time admission claims it. Once set it is enforced even
--   when the deployment flag is later disabled, so a policy can never weaken
--   mid-exam. NULL keeps the legacy (unenforced) behaviour.
-- - attempt_device_transfers: one row per transfer request. Ownership itself
--   stays on student_attempts (active_client_session_id + lease_epoch); this
--   table only records the request/approval/commit workflow and its audit
--   evidence. No bearer token or answer content is stored here.
--   active_attempt_id is a nullable unique marker: it equals attempt_id while
--   the request is pending/approved and is cleared on every terminal
--   transition, so at most one outstanding request exists per attempt without
--   depending on a cleanup worker.

SET @writer_policy_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND column_name = 'writer_policy'
);
SET @writer_policy_sql := IF(
    @writer_policy_exists = 0,
    'ALTER TABLE student_attempts ADD COLUMN writer_policy VARCHAR(32) NULL',
    'SELECT 1'
);
PREPARE writer_policy_stmt FROM @writer_policy_sql;
EXECUTE writer_policy_stmt;
DEALLOCATE PREPARE writer_policy_stmt;

CREATE TABLE IF NOT EXISTS attempt_device_transfers (
    id VARCHAR(36) PRIMARY KEY,
    operation_id VARCHAR(64) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    attempt_id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    active_attempt_id VARCHAR(36) NULL,
    requested_by_user_id VARCHAR(36) NOT NULL,
    requested_by_auth_session_id VARCHAR(36) NOT NULL,
    target_client_session_id VARCHAR(36) NOT NULL,
    expected_owner_session_id VARCHAR(36) NULL,
    expected_lease_epoch BIGINT NOT NULL,
    policy_stage VARCHAR(16) NOT NULL,
    state VARCHAR(16) NOT NULL,
    reason_code VARCHAR(64) NOT NULL,
    requested_at TIMESTAMP(6) NOT NULL,
    expires_at TIMESTAMP(6) NOT NULL,
    approval_kind VARCHAR(32) NULL,
    approved_by VARCHAR(255) NULL,
    approved_at TIMESTAMP(6) NULL,
    approval_expires_at TIMESTAMP(6) NULL,
    unconfirmed_risk_acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
    decision_reason VARCHAR(255) NULL,
    decided_by VARCHAR(255) NULL,
    decided_at TIMESTAMP(6) NULL,
    resulting_lease_epoch BIGINT NULL,
    committed_at TIMESTAMP(6) NULL,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_attempt_device_transfers_operation UNIQUE (operation_id),
    CONSTRAINT uq_attempt_device_transfers_active UNIQUE (active_attempt_id),
    CONSTRAINT fk_attempt_device_transfers_attempt FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT chk_attempt_device_transfers_state CHECK (
        state IN ('pending', 'approved', 'committed', 'denied', 'cancelled', 'expired', 'conflicted')
    ),
    CONSTRAINT chk_attempt_device_transfers_stage CHECK (policy_stage IN ('pre_start', 'post_start'))
);

-- Proctor review lists open requests per schedule; history reads by attempt.
SET @idx_transfer_schedule_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_device_transfers'
      AND index_name = 'idx_attempt_device_transfers_schedule_state'
);
SET @idx_transfer_schedule_sql := IF(
    @idx_transfer_schedule_exists = 0,
    'CREATE INDEX idx_attempt_device_transfers_schedule_state ON attempt_device_transfers (schedule_id, state, requested_at)',
    'SELECT 1'
);
PREPARE idx_transfer_schedule_stmt FROM @idx_transfer_schedule_sql;
EXECUTE idx_transfer_schedule_stmt;
DEALLOCATE PREPARE idx_transfer_schedule_stmt;

SET @idx_transfer_attempt_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_device_transfers'
      AND index_name = 'idx_attempt_device_transfers_attempt_requested'
);
SET @idx_transfer_attempt_sql := IF(
    @idx_transfer_attempt_exists = 0,
    'CREATE INDEX idx_attempt_device_transfers_attempt_requested ON attempt_device_transfers (attempt_id, requested_at)',
    'SELECT 1'
);
PREPARE idx_transfer_attempt_stmt FROM @idx_transfer_attempt_sql;
EXECUTE idx_transfer_attempt_stmt;
DEALLOCATE PREPARE idx_transfer_attempt_stmt;

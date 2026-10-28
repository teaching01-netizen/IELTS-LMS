-- 0105_staff_device_recovery.sql
-- Staff-assisted device transfer and exam continuation
-- (docs/superpowers/plans/2026-10-28-staff-assisted-exam-recovery.md).
--
-- Expand-only and re-runnable. Two attempt-owned fields:
--
-- - recovery_control: server-written transfer authority. Deliberately separate
--   from student_attempts.recovery, which carries the draft compatibility
--   contract and must never be reinterpreted by this feature. The column is
--   NULL for every existing sitting, so untouched attempts keep ordinary
--   admission.
-- - terminal_generation: the attempt's current completion generation. It only
--   advances when an already sealed sitting is actually reopened.
--
-- attempt_device_recovery_grants is separate from attempt_device_transfers:
-- a staff-issued grant has no student requester and no target browser at
-- issuance time. The grant stores a requested time policy, never a second
-- mutable countdown; the effective working deadline stays in the provider
-- clock. active_attempt_id is a nullable unique marker: it equals attempt_id
-- while a grant is issued/claimed/started and is cleared on every terminal
-- grant state, so at most one live grant exists per attempt without relying
-- on a cleanup worker. Expiring a grant never clears recovery_control.

SET @recovery_control_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND column_name = 'recovery_control'
);
SET @recovery_control_sql := IF(
    @recovery_control_exists = 0,
    'ALTER TABLE student_attempts ADD COLUMN recovery_control JSON NULL AFTER recovery',
    'SELECT 1'
);
PREPARE recovery_control_stmt FROM @recovery_control_sql;
EXECUTE recovery_control_stmt;
DEALLOCATE PREPARE recovery_control_stmt;

SET @terminal_generation_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND column_name = 'terminal_generation'
);
SET @terminal_generation_sql := IF(
    @terminal_generation_exists = 0,
    'ALTER TABLE student_attempts ADD COLUMN terminal_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE terminal_generation_stmt FROM @terminal_generation_sql;
EXECUTE terminal_generation_stmt;
DEALLOCATE PREPARE terminal_generation_stmt;

CREATE TABLE IF NOT EXISTS attempt_device_recovery_grants (
    id VARCHAR(36) PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    issued_by_user_id VARCHAR(255) NOT NULL,
    operation_id VARCHAR(64) NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    active_attempt_id VARCHAR(36) NULL,
    state VARCHAR(16) NOT NULL,
    target_section_key VARCHAR(64) NOT NULL,
    target_module_attempt_id VARCHAR(36) NULL,
    target_module_id VARCHAR(36) NULL,
    requested_remaining_seconds INT NULL,
    expected_control_epoch BIGINT UNSIGNED NOT NULL,
    expected_lease_epoch BIGINT UNSIGNED NOT NULL,
    grant_revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    link_secret_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    code_mac CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    failed_code_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
    issued_at TIMESTAMP(6) NOT NULL,
    expires_at TIMESTAMP(6) NOT NULL,
    sealed_issuance BLOB NULL,
    claim_proof_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    target_client_session_id VARCHAR(36) NULL,
    claimed_at TIMESTAMP(6) NULL,
    claim_expires_at TIMESTAMP(6) NULL,
    started_at TIMESTAMP(6) NULL,
    resulting_lease_epoch BIGINT UNSIGNED NULL,
    begin_operation_id VARCHAR(64) NULL,
    begin_receipt JSON NULL,
    restored_at TIMESTAMP(6) NULL,
    restored_by VARCHAR(255) NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_attempt_device_recovery_grants_operation
        UNIQUE (operation_id),
    CONSTRAINT uq_attempt_device_recovery_grants_active
        UNIQUE (active_attempt_id),
    CONSTRAINT fk_attempt_device_recovery_grants_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_attempt_device_recovery_grants_schedule
        FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    CONSTRAINT chk_attempt_device_recovery_grants_state CHECK (
        state IN ('issued', 'claimed', 'started', 'expired', 'replaced', 'restored', 'locked')
    ),
    CONSTRAINT chk_attempt_device_recovery_grants_remaining CHECK (
        requested_remaining_seconds IS NULL
        OR (requested_remaining_seconds BETWEEN 1 AND 86400)
    ),
    -- Six digits with at most five wrong attempts per grant. The bound is a
    -- persisted invariant, not a counter the caller may exceed.
    CONSTRAINT chk_attempt_device_recovery_grants_failed CHECK (failed_code_count <= 5),
    INDEX idx_attempt_device_recovery_grants_schedule
        (schedule_id, state, issued_at),
    INDEX idx_attempt_device_recovery_grants_attempt
        (attempt_id, issued_at)
);

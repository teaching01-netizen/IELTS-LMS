-- Exam Response Durability V2 Schema Migration
-- Defines the unified row-per-question projection, mutation/idempotency ledger,
-- and submission receipts for protocol v2 attempts.

-- 1. Extend student_attempts for v2 protocol ownership, lifecycle, and leasing
-- Add each column independently. A deployment can be interrupted after any
-- ALTER TABLE (DDL is not transactional in MySQL/TiDB); guarding the whole
-- group only by protocol_version leaves a partial schema that cannot be
-- repaired on retry.
SET @column_sql := IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'student_attempts'
       AND column_name = 'protocol_version') = 0,
    'ALTER TABLE student_attempts ADD COLUMN protocol_version INT NOT NULL DEFAULT 1',
    'SELECT 1'
);
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

SET @column_sql := IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'student_attempts'
       AND column_name = 'delivery_status') = 0,
    'ALTER TABLE student_attempts ADD COLUMN delivery_status VARCHAR(32) NOT NULL DEFAULT \'running\'',
    'SELECT 1'
);
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

SET @column_sql := IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'student_attempts'
       AND column_name = 'lease_epoch') = 0,
    'ALTER TABLE student_attempts ADD COLUMN lease_epoch BIGINT NOT NULL DEFAULT 1',
    'SELECT 1'
);
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

SET @column_sql := IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'student_attempts'
       AND column_name = 'control_epoch') = 0,
    'ALTER TABLE student_attempts ADD COLUMN control_epoch BIGINT NOT NULL DEFAULT 1',
    'SELECT 1'
);
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

SET @column_sql := IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'student_attempts'
       AND column_name = 'response_revision') = 0,
    'ALTER TABLE student_attempts ADD COLUMN response_revision BIGINT NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

SET @column_sql := IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'student_attempts'
       AND column_name = 'deadline_at') = 0,
    'ALTER TABLE student_attempts ADD COLUMN deadline_at TIMESTAMP(6) NULL',
    'SELECT 1'
);
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

SET @column_sql := IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'student_attempts'
       AND column_name = 'closing_grace_until') = 0,
    'ALTER TABLE student_attempts ADD COLUMN closing_grace_until TIMESTAMP(6) NULL',
    'SELECT 1'
);
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

SET @column_sql := IF(
    (SELECT COUNT(*) FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = 'student_attempts'
       AND column_name = 'final_response_digest') = 0,
    'ALTER TABLE student_attempts ADD COLUMN final_response_digest VARCHAR(64) NULL',
    'SELECT 1'
);
PREPARE column_stmt FROM @column_sql;
EXECUTE column_stmt;
DEALLOCATE PREPARE column_stmt;

-- Existing attempts remain v1. New attempts opt into v2 explicitly in the creation path.
-- Backfill lifecycle metadata without changing historical response data. The
-- column addition defaults old rows to `running`, so include that value when a
-- pre-existing submitted/terminated attempt is being repaired after a partial
-- migration run.
UPDATE student_attempts
SET delivery_status = CASE
        WHEN submitted_at IS NOT NULL THEN 'submitted'
        WHEN COALESCE(proctor_status, '') = 'terminated' THEN 'terminated'
        ELSE 'running'
    END
WHERE delivery_status IS NULL
   OR delivery_status = ''
   OR (delivery_status = 'running' AND submitted_at IS NOT NULL)
   OR (delivery_status = 'running' AND COALESCE(proctor_status, '') = 'terminated');

UPDATE student_attempts a
JOIN exam_schedules s ON s.id = a.schedule_id
SET a.organization_id = COALESCE(a.organization_id, s.organization_id)
WHERE a.organization_id IS NULL AND s.organization_id IS NOT NULL;

-- Preserve the legacy SAT projection as a compatibility/read-model while V2 is rolled out.
-- Focused infrastructure migrations may not create the provider-specific table;
-- in that case this compatibility alteration is a no-op and must remain
-- independently retryable when the table is introduced later.
SET @legacy_response_table_exists := (
    SELECT COUNT(*)
    FROM information_schema.tables
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_question_responses'
);
SET @legacy_write_id_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_question_responses'
      AND column_name = 'client_write_id'
);
SET @legacy_write_id_sql := IF(
    @legacy_response_table_exists = 1 AND @legacy_write_id_exists = 0,
    'ALTER TABLE assessment_question_responses ADD COLUMN client_write_id VARCHAR(128) NULL AFTER annotations',
    'SELECT 1'
);
PREPARE legacy_write_id_stmt FROM @legacy_write_id_sql;
EXECUTE legacy_write_id_stmt;
DEALLOCATE PREPARE legacy_write_id_stmt;

-- Runtime boundaries participate in the same response-write/grace decision as
-- V2 deadlines. The original runtime tables predate fractional timestamps;
-- widen them so a database-clock boundary cannot be rounded to a whole second.
ALTER TABLE exam_session_runtimes
    MODIFY COLUMN actual_start_at TIMESTAMP(6) NULL,
    MODIFY COLUMN actual_end_at TIMESTAMP(6) NULL,
    MODIFY COLUMN created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    MODIFY COLUMN updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6);

ALTER TABLE exam_session_runtime_sections
    MODIFY COLUMN available_at TIMESTAMP(6) NULL,
    MODIFY COLUMN actual_start_at TIMESTAMP(6) NULL,
    MODIFY COLUMN actual_end_at TIMESTAMP(6) NULL,
    MODIFY COLUMN paused_at TIMESTAMP(6) NULL,
    MODIFY COLUMN projected_start_at TIMESTAMP(6) NULL,
    MODIFY COLUMN projected_end_at TIMESTAMP(6) NULL;

ALTER TABLE cohort_control_events
    MODIFY COLUMN created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6);

-- 2. Canonical row-per-question response projection for protocol-v2 attempts
CREATE TABLE IF NOT EXISTS attempt_responses_v2 (
    attempt_id VARCHAR(36) NOT NULL,
    question_id VARCHAR(255) NOT NULL,
    module_id VARCHAR(255) NOT NULL,

    lease_epoch BIGINT NOT NULL CHECK (lease_epoch > 0),
    control_epoch BIGINT NOT NULL CHECK (control_epoch > 0),
    client_version BIGINT NOT NULL CHECK (client_version > 0),
    client_write_id VARCHAR(64) NOT NULL,

    request_hash VARCHAR(64) NOT NULL,
    response JSON NOT NULL,
    response_hash VARCHAR(64) NOT NULL,

    server_revision BIGINT NOT NULL CHECK (server_revision > 0),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),

    PRIMARY KEY (attempt_id, question_id),
    CONSTRAINT fk_attempt_responses_v2_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);

SET @index_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_responses_v2'
      AND index_name = 'idx_attempt_responses_v2_attempt_revision'
);
SET @index_sql := IF(
    @index_exists = 0,
    'CREATE INDEX idx_attempt_responses_v2_attempt_revision ON attempt_responses_v2(attempt_id, server_revision DESC)',
    'SELECT 1'
);
PREPARE index_stmt FROM @index_sql;
EXECUTE index_stmt;
DEALLOCATE PREPARE index_stmt;

-- 3. Immutable mutation & idempotency table enforcing write_id and version uniqueness
CREATE TABLE IF NOT EXISTS attempt_mutations_v2 (
    id VARCHAR(64) NOT NULL PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    client_write_id VARCHAR(64) NOT NULL,
    lease_epoch BIGINT NOT NULL CHECK (lease_epoch > 0),
    control_epoch BIGINT NOT NULL CHECK (control_epoch > 0),
    question_id VARCHAR(255) NOT NULL,
    client_version BIGINT NOT NULL CHECK (client_version > 0),
    request_hash VARCHAR(64) NOT NULL,
    response_hash VARCHAR(64) NOT NULL,
    outcome VARCHAR(32) NOT NULL,
    server_revision BIGINT NOT NULL,
    canonical_response JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_attempt_mutations_v2_write_id UNIQUE (attempt_id, client_write_id),
    CONSTRAINT uq_attempt_mutations_v2_version UNIQUE (attempt_id, lease_epoch, question_id, client_version),
    CONSTRAINT fk_attempt_mutations_v2_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);

SET @index_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_mutations_v2'
      AND index_name = 'idx_attempt_mutations_v2_lookup'
);
SET @index_sql := IF(
    @index_exists = 0,
    'CREATE INDEX idx_attempt_mutations_v2_lookup ON attempt_mutations_v2(attempt_id, question_id, created_at DESC)',
    'SELECT 1'
);
PREPARE index_stmt FROM @index_sql;
EXECUTE index_stmt;
DEALLOCATE PREPARE index_stmt;

-- 4. Immutable submission receipt ledger
CREATE TABLE IF NOT EXISTS attempt_submissions_v2 (
    attempt_id VARCHAR(36) NOT NULL PRIMARY KEY,
    submission_id VARCHAR(64) NOT NULL,
    lease_epoch BIGINT NOT NULL,
    control_epoch BIGINT NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    expected_attempt_revision BIGINT NOT NULL,
    attempt_revision BIGINT NOT NULL,
    final_response_digest VARCHAR(64) NOT NULL,
    receipt JSON NOT NULL,
    submitted_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_attempt_submissions_v2_submission UNIQUE (submission_id),
    CONSTRAINT fk_attempt_submissions_v2_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);

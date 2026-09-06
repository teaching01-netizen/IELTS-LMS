SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE outbox_events ADD COLUMN claim_token VARCHAR(64) NULL',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND COLUMN_NAME = 'claim_token'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE outbox_events ADD COLUMN claimed_by VARCHAR(128) NULL',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND COLUMN_NAME = 'claimed_by'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE outbox_events ADD COLUMN claim_expires_at TIMESTAMP NULL',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND COLUMN_NAME = 'claim_expires_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_outbox_events_claim_lease ON outbox_events(published_at, claim_expires_at, created_at ASC)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND INDEX_NAME = 'idx_outbox_events_claim_lease'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_outbox_events_claim_token ON outbox_events(claim_token)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND INDEX_NAME = 'idx_outbox_events_claim_token'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_student_attempts_schedule_updated_id ON student_attempts(schedule_id, updated_at DESC, id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempts'
      AND INDEX_NAME = 'idx_student_attempts_schedule_updated_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE UNIQUE INDEX idx_student_attempt_mutations_attempt_mutation_id ON student_attempt_mutations(attempt_id, client_mutation_id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempt_mutations'
      AND INDEX_NAME = 'idx_student_attempt_mutations_attempt_mutation_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE UNIQUE INDEX idx_student_attempt_mutations_attempt_session_mutation_id ON student_attempt_mutations(attempt_id, client_session_id, client_mutation_id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempt_mutations'
      AND INDEX_NAME = 'idx_student_attempt_mutations_attempt_session_mutation_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

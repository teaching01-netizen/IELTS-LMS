SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE outbox_events ADD COLUMN next_attempt_at TIMESTAMP NULL',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND COLUMN_NAME = 'next_attempt_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'ALTER TABLE outbox_events ADD COLUMN failed_at TIMESTAMP NULL',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND COLUMN_NAME = 'failed_at'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_outbox_events_retry_eligible ON outbox_events(published_at, failed_at, next_attempt_at, claim_expires_at, created_at ASC)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND INDEX_NAME = 'idx_outbox_events_retry_eligible'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

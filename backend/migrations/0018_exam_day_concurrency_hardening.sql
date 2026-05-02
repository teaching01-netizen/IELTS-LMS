-- Exam-day concurrency hardening: finalizer access paths, distributed limiter, and live-update bus

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_student_attempts_schedule_submitted_id ON student_attempts(schedule_id, submitted_at, id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempts'
      AND INDEX_NAME = 'idx_student_attempts_schedule_submitted_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_student_attempts_submitted_updated_id ON student_attempts(submitted_at, updated_at, id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempts'
      AND INDEX_NAME = 'idx_student_attempts_submitted_updated_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS distributed_rate_limit_counters (
    route_key VARCHAR(128) NOT NULL,
    bucket_key VARCHAR(255) NOT NULL,
    window_start TIMESTAMP NOT NULL,
    request_count INT NOT NULL DEFAULT 0,
    expires_at TIMESTAMP NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (route_key, bucket_key, window_start)
);

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_distributed_rate_limit_expires ON distributed_rate_limit_counters(expires_at)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'distributed_rate_limit_counters'
      AND INDEX_NAME = 'idx_distributed_rate_limit_expires'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS live_update_events (
    sequence_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    origin_instance_id VARCHAR(128) NOT NULL,
    event_kind VARCHAR(64) NOT NULL,
    event_target_id VARCHAR(255) NOT NULL,
    event_revision BIGINT NOT NULL DEFAULT 0,
    event_name VARCHAR(128) NOT NULL,
    event_payload JSON NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_live_update_events_origin_sequence ON live_update_events(origin_instance_id, sequence_id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'live_update_events'
      AND INDEX_NAME = 'idx_live_update_events_origin_sequence'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_live_update_events_created ON live_update_events(created_at)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'live_update_events'
      AND INDEX_NAME = 'idx_live_update_events_created'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

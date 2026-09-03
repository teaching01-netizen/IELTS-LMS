-- The parent IDs in the current schema are VARCHAR(36). Keep this migration
-- static because TiDB does not support the dynamic SQL/CTAS variants here.
CREATE TABLE IF NOT EXISTS student_attempt_presence (
    attempt_id VARCHAR(36) NOT NULL PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    client_session_id VARCHAR(36) NOT NULL,
    last_heartbeat_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat_status VARCHAR(20) NOT NULL DEFAULT 'ok',
    last_disconnect_at TIMESTAMP NULL,
    last_reconnect_at TIMESTAMP NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT student_attempt_presence_attempt_fk
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);

CREATE INDEX idx_student_attempt_presence_schedule_heartbeat
    ON student_attempt_presence(schedule_id, last_heartbeat_at DESC);

-- Proctoring coordination and audit tables
-- Note: Proctoring columns already added to student_attempts in 0006_delivery.sql

CREATE TABLE IF NOT EXISTS student_violation_events (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    attempt_id VARCHAR(36) NOT NULL,
    violation_type VARCHAR(255) NOT NULL,
    severity VARCHAR(50) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    description TEXT NOT NULL,
    payload JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_student_violation_events_schedule_created
    ON student_violation_events(schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_violation_events_attempt_created
    ON student_violation_events(attempt_id, created_at DESC);

CREATE TABLE IF NOT EXISTS proctor_presence (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    proctor_id VARCHAR(255) NOT NULL,
    proctor_name VARCHAR(255) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('active', 'left')),
    joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_heartbeat_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    left_at TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_proctor_presence_active
    ON proctor_presence(schedule_id, proctor_id, left_at);
CREATE INDEX IF NOT EXISTS idx_proctor_presence_schedule_heartbeat
    ON proctor_presence(schedule_id, last_heartbeat_at DESC);

CREATE TABLE IF NOT EXISTS session_audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    action_type VARCHAR(255) NOT NULL,
    target_student_id VARCHAR(36),
    payload JSON,
    acknowledged_at TIMESTAMP,
    acknowledged_by VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (target_student_id) REFERENCES student_attempts(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_session_audit_logs_schedule_created
    ON session_audit_logs(schedule_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_audit_logs_target_created
    ON session_audit_logs(target_student_id, created_at DESC);

CREATE TABLE IF NOT EXISTS session_notes (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    author VARCHAR(255) NOT NULL,
    category VARCHAR(50) NOT NULL CHECK (category IN ('general', 'incident', 'handover')),
    content TEXT NOT NULL,
    is_resolved BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_notes_schedule_created
    ON session_notes(schedule_id, created_at DESC);

CREATE TABLE IF NOT EXISTS violation_rules (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    trigger_type VARCHAR(50) NOT NULL CHECK (trigger_type IN ('violation_count', 'specific_violation_type', 'severity_threshold')),
    threshold INT NOT NULL CHECK (threshold > 0),
    specific_violation_type VARCHAR(255),
    specific_severity VARCHAR(50) CHECK (specific_severity IN ('low', 'medium', 'high', 'critical')),
    action VARCHAR(50) NOT NULL CHECK (action IN ('warn', 'pause', 'notify_proctor', 'terminate')),
    is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) NOT NULL,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_violation_rules_schedule_created
    ON violation_rules(schedule_id, created_at DESC);

-- Note: GRANT statements removed - using MySQL user management instead
-- Note: Triggers for updated_at removed - using ON UPDATE CURRENT_TIMESTAMP instead

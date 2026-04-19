-- Student delivery tables

CREATE TABLE IF NOT EXISTS student_attempts (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    registration_id VARCHAR(36),
    student_key VARCHAR(255) NOT NULL,
    organization_id VARCHAR(255),
    exam_id VARCHAR(36) NOT NULL,
    published_version_id VARCHAR(36) NOT NULL,
    exam_title VARCHAR(255) NOT NULL,
    candidate_id VARCHAR(255) NOT NULL,
    candidate_name VARCHAR(255) NOT NULL,
    candidate_email VARCHAR(255) NOT NULL,
    phase VARCHAR(50) NOT NULL CHECK (phase IN ('pre-check', 'lobby', 'exam', 'post-exam')),
    current_module VARCHAR(50) NOT NULL CHECK (current_module IN ('listening', 'reading', 'writing', 'speaking')),
    current_question_id VARCHAR(255),
    answers JSON NOT NULL,
    writing_answers JSON NOT NULL,
    flags JSON NOT NULL,
    violations_snapshot JSON NOT NULL,
    integrity JSON NOT NULL,
    recovery JSON NOT NULL,
    final_submission JSON,
    submitted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0,
    wcode VARCHAR(10) NOT NULL DEFAULT '',
    user_id VARCHAR(36),
    proctor_status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (proctor_status IN ('active', 'warned', 'paused', 'terminated', 'idle', 'connecting')),
    proctor_note TEXT,
    proctor_updated_at TIMESTAMP,
    proctor_updated_by VARCHAR(255),
    last_warning_id VARCHAR(255),
    last_acknowledged_warning_id VARCHAR(255),
    CONSTRAINT student_attempts_schedule_student_key UNIQUE (schedule_id, student_key),
    CONSTRAINT student_attempts_registration_unique UNIQUE (registration_id),
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (registration_id) REFERENCES schedule_registrations(id) ON DELETE SET NULL,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (published_version_id) REFERENCES exam_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_student_attempts_schedule_phase_updated
    ON student_attempts(schedule_id, phase, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_attempts_exam_updated
    ON student_attempts(exam_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_attempts_schedule_user
    ON student_attempts(schedule_id, user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_attempts_wcode ON student_attempts(wcode);

CREATE TABLE IF NOT EXISTS student_attempt_mutations (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    client_session_id VARCHAR(36) NOT NULL,
    mutation_type VARCHAR(255) NOT NULL,
    client_mutation_id VARCHAR(255) NOT NULL,
    mutation_seq BIGINT NOT NULL,
    payload JSON NOT NULL,
    client_timestamp TIMESTAMP NOT NULL,
    server_received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    applied_revision INT,
    applied_at TIMESTAMP,
    FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_student_attempt_mutations_attempt_session_seq
    ON student_attempt_mutations(attempt_id, client_session_id, mutation_seq);
CREATE INDEX IF NOT EXISTS idx_student_attempt_mutations_attempt_received
    ON student_attempt_mutations(attempt_id, server_received_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_attempt_mutations_schedule_received
    ON student_attempt_mutations(schedule_id, server_received_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_attempt_mutations_attempt_session_seq_desc
    ON student_attempt_mutations(attempt_id, client_session_id, mutation_seq DESC);
CREATE INDEX IF NOT EXISTS idx_student_attempt_mutations_server_received_at
    ON student_attempt_mutations(server_received_at);

CREATE TABLE IF NOT EXISTS student_heartbeat_events (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(50) NOT NULL CHECK (event_type IN ('heartbeat', 'disconnect', 'reconnect', 'lost')),
    payload JSON,
    client_timestamp TIMESTAMP NOT NULL,
    server_received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_student_heartbeat_events_attempt_received
    ON student_heartbeat_events(attempt_id, server_received_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_heartbeat_events_schedule_received
    ON student_heartbeat_events(schedule_id, server_received_at DESC);
CREATE INDEX IF NOT EXISTS idx_student_heartbeat_events_server_received_at
    ON student_heartbeat_events(server_received_at);

-- Note: Partitioning removed for simplicity - can be added later if needed for performance
-- Note: GRANT statements removed - using MySQL user management instead
-- Note: Triggers for updated_at removed - using ON UPDATE CURRENT_TIMESTAMP instead

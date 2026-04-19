-- First-party identity, sessions, and attempt-scoped execution credentials
-- Note: user_id columns already added to schedule_registrations, schedule_staff_assignments, and student_attempts in 0005_scheduling_and_access.sql and 0006_delivery.sql

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(36) PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255),
    role VARCHAR(50) NOT NULL CHECK (role IN ('admin', 'builder', 'proctor', 'grader', 'student')),
    state VARCHAR(50) NOT NULL CHECK (state IN ('active', 'disabled', 'locked', 'pending_activation')),
    failed_login_count INT NOT NULL DEFAULT 0,
    locked_until TIMESTAMP,
    last_login_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS user_password_credentials (
    user_id VARCHAR(36) PRIMARY KEY,
    password_hash VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS user_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    session_token_hash VARCHAR(255) NOT NULL UNIQUE,
    csrf_token VARCHAR(255) NOT NULL,
    role_snapshot VARCHAR(50) NOT NULL CHECK (role_snapshot IN ('admin', 'builder', 'proctor', 'grader', 'student')),
    issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    idle_timeout_at TIMESTAMP NOT NULL,
    user_agent_hash VARCHAR(255),
    ip_metadata JSON,
    revoked_at TIMESTAMP,
    revocation_reason TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_sessions_user_active
    ON user_sessions(user_id, expires_at DESC, revoked_at);

CREATE TABLE IF NOT EXISTS user_session_events (
    id VARCHAR(36) PRIMARY KEY,
    session_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    event_type VARCHAR(255) NOT NULL,
    metadata JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (session_id) REFERENCES user_sessions(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_user_session_events_session_created
    ON user_session_events(session_id, created_at DESC);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
    ON password_reset_tokens(expires_at ASC);

CREATE TABLE IF NOT EXISTS account_activation_tokens (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    token_hash VARCHAR(255) NOT NULL UNIQUE,
    expires_at TIMESTAMP NOT NULL,
    used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_account_activation_tokens_expires
    ON account_activation_tokens(expires_at ASC);

CREATE TABLE IF NOT EXISTS student_profiles (
    user_id VARCHAR(36) PRIMARY KEY,
    student_id VARCHAR(255) NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    institution VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX idx_student_profiles_student_id
    ON student_profiles(student_id);

CREATE TABLE IF NOT EXISTS staff_profiles (
    user_id VARCHAR(36) PRIMARY KEY,
    staff_code VARCHAR(255),
    full_name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attempt_sessions (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    attempt_id VARCHAR(36) NOT NULL,
    client_session_id VARCHAR(36) NOT NULL,
    token_id VARCHAR(255) NOT NULL UNIQUE,
    device_fingerprint_hash VARCHAR(255),
    issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    revocation_reason TEXT,
    CONSTRAINT attempt_sessions_attempt_client_unique UNIQUE (attempt_id, client_session_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attempt_sessions_user_active
    ON attempt_sessions(user_id, schedule_id, expires_at DESC, revoked_at);

-- Note: GRANT statements removed - using MySQL user management instead
-- Note: Triggers for updated_at removed - using ON UPDATE CURRENT_TIMESTAMP instead
-- Note: ALTER TABLE statements removed - user_id columns already added in previous migrations

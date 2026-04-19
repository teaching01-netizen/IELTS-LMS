-- Scheduling and runtime tables

CREATE TABLE IF NOT EXISTS exam_schedules (
    id CHAR(36) PRIMARY KEY,
    exam_id CHAR(36) NOT NULL,
    organization_id VARCHAR(255),
    exam_title VARCHAR(255) NOT NULL,
    published_version_id CHAR(36) NOT NULL,
    cohort_name VARCHAR(255) NOT NULL,
    institution VARCHAR(255),
    start_time TIMESTAMP NOT NULL,
    end_time TIMESTAMP NOT NULL,
    planned_duration_minutes INT NOT NULL,
    delivery_mode VARCHAR(50) NOT NULL CHECK (delivery_mode = 'proctor_start'),
    recurrence_type VARCHAR(50) NOT NULL DEFAULT 'none' CHECK (recurrence_type IN ('none', 'daily', 'weekly', 'monthly')),
    recurrence_interval INT NOT NULL DEFAULT 1 CHECK (recurrence_interval > 0),
    recurrence_end_date DATE,
    buffer_before_minutes INT,
    buffer_after_minutes INT,
    auto_start BOOLEAN NOT NULL DEFAULT FALSE,
    auto_stop BOOLEAN NOT NULL DEFAULT FALSE,
    status VARCHAR(50) NOT NULL CHECK (status IN ('scheduled', 'live', 'completed', 'cancelled')),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_by VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (published_version_id) REFERENCES exam_versions(id)
);

CREATE INDEX IF NOT EXISTS idx_exam_schedules_org_status_start ON exam_schedules(organization_id, status, start_time ASC);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_exam_start ON exam_schedules(exam_id, start_time DESC);
CREATE INDEX IF NOT EXISTS idx_exam_schedules_version ON exam_schedules(published_version_id);

CREATE TABLE IF NOT EXISTS schedule_registrations (
    id CHAR(36) PRIMARY KEY,
    schedule_id CHAR(36) NOT NULL,
    student_key VARCHAR(255) NOT NULL,
    actor_id VARCHAR(255),
    student_id VARCHAR(255) NOT NULL,
    student_name VARCHAR(255) NOT NULL,
    student_email VARCHAR(255),
    access_state VARCHAR(50) NOT NULL CHECK (access_state IN ('invited', 'checked_in', 'withdrawn', 'blocked', 'submitted')),
    allowed_from TIMESTAMP,
    allowed_until TIMESTAMP,
    extra_time_minutes INT NOT NULL DEFAULT 0,
    seat_label VARCHAR(255),
    metadata JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0,
    wcode VARCHAR(10) NOT NULL DEFAULT '',
    user_id CHAR(36),
    CONSTRAINT schedule_registrations_schedule_student_key UNIQUE (schedule_id, student_key),
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedule_registrations_schedule_actor_active
    ON schedule_registrations(schedule_id, actor_id);
CREATE INDEX IF NOT EXISTS idx_schedule_registrations_schedule_access_updated
    ON schedule_registrations(schedule_id, access_state, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_registrations_actor_updated
    ON schedule_registrations(actor_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_registrations_student_updated
    ON schedule_registrations(student_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_registrations_schedule_user_active
    ON schedule_registrations(schedule_id, user_id);
CREATE INDEX IF NOT EXISTS idx_schedule_registrations_wcode ON schedule_registrations(wcode);

CREATE TABLE IF NOT EXISTS schedule_staff_assignments (
    id CHAR(36) PRIMARY KEY,
    schedule_id CHAR(36) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('proctor', 'grader', 'admin_observer')),
    granted_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP,
    user_id CHAR(36),
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_schedule_staff_assignments_active
    ON schedule_staff_assignments(schedule_id, actor_id, role, revoked_at);
CREATE INDEX IF NOT EXISTS idx_schedule_staff_assignments_actor_role_created
    ON schedule_staff_assignments(actor_id, role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_schedule_staff_assignments_user_role_created
    ON schedule_staff_assignments(user_id, role, created_at DESC);

CREATE TABLE IF NOT EXISTS exam_session_runtimes (
    id CHAR(36) PRIMARY KEY,
    schedule_id CHAR(36) NOT NULL UNIQUE,
    exam_id CHAR(36) NOT NULL,
    status VARCHAR(50) NOT NULL CHECK (status IN ('not_started', 'live', 'paused', 'completed', 'cancelled')),
    plan_snapshot JSON NOT NULL,
    actual_start_at TIMESTAMP,
    actual_end_at TIMESTAMP,
    active_section_key VARCHAR(50),
    current_section_key VARCHAR(50),
    current_section_remaining_seconds INT NOT NULL DEFAULT 0,
    waiting_for_next_section BOOLEAN NOT NULL DEFAULT FALSE,
    is_overrun BOOLEAN NOT NULL DEFAULT FALSE,
    total_paused_seconds INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS exam_session_runtime_sections (
    id CHAR(36) PRIMARY KEY,
    runtime_id CHAR(36) NOT NULL,
    section_key VARCHAR(50) NOT NULL CHECK (section_key IN ('listening', 'reading', 'writing', 'speaking')),
    label VARCHAR(255) NOT NULL,
    section_order INT NOT NULL,
    planned_duration_minutes INT NOT NULL,
    gap_after_minutes INT NOT NULL DEFAULT 0,
    status VARCHAR(50) NOT NULL CHECK (status IN ('locked', 'live', 'paused', 'completed')),
    available_at TIMESTAMP,
    actual_start_at TIMESTAMP,
    actual_end_at TIMESTAMP,
    paused_at TIMESTAMP,
    accumulated_paused_seconds INT NOT NULL DEFAULT 0,
    extension_minutes INT NOT NULL DEFAULT 0,
    completion_reason VARCHAR(255),
    projected_start_at TIMESTAMP,
    projected_end_at TIMESTAMP,
    CONSTRAINT runtime_sections_runtime_section_key UNIQUE (runtime_id, section_key),
    FOREIGN KEY (runtime_id) REFERENCES exam_session_runtimes(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_runtime_sections_runtime_order
    ON exam_session_runtime_sections(runtime_id, section_order);

CREATE TABLE IF NOT EXISTS cohort_control_events (
    id CHAR(36) PRIMARY KEY,
    schedule_id CHAR(36) NOT NULL,
    runtime_id CHAR(36) NOT NULL,
    exam_id CHAR(36) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN ('start_runtime', 'pause_runtime', 'resume_runtime', 'extend_section', 'end_section_now', 'complete_runtime', 'auto_timeout')),
    section_key VARCHAR(50),
    minutes INT,
    reason VARCHAR(255),
    payload JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    FOREIGN KEY (runtime_id) REFERENCES exam_session_runtimes(id) ON DELETE CASCADE,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cohort_control_events_schedule_created
    ON cohort_control_events(schedule_id, created_at DESC);

-- Note: GRANT statements removed - using MySQL user management instead
-- Note: Triggers for updated_at removed - using ON UPDATE CURRENT_TIMESTAMP instead

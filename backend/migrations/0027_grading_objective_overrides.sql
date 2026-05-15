-- Schedule-scoped objective grading overrides + append-only audit events.
-- Scope: Reading + Listening objective questions.

CREATE TABLE IF NOT EXISTS grading_schedule_question_overrides (
    schedule_id VARCHAR(36) NOT NULL,
    question_id VARCHAR(512) NOT NULL,
    override_json JSON NOT NULL,
    updated_by_actor_id VARCHAR(255) NOT NULL,
    updated_by_actor_name VARCHAR(255) NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (schedule_id, question_id),
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE INDEX idx_grading_schedule_question_overrides_schedule_updated
    ON grading_schedule_question_overrides(schedule_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS grading_schedule_override_events (
    id VARCHAR(36) PRIMARY KEY,
    schedule_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    actor_name VARCHAR(255) NOT NULL,
    action VARCHAR(255) NOT NULL CHECK (
        action IN (
            'objective_override_upserted',
            'objective_override_deleted',
            'objective_regrade_triggered',
            'objective_regrade_completed'
        )
    ),
    payload_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE INDEX idx_grading_schedule_override_events_schedule_created
    ON grading_schedule_override_events(schedule_id, created_at DESC);

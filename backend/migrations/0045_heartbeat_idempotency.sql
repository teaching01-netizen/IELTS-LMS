-- Tenant identity is carried by the authenticated user, never by a request body.
ALTER TABLE users
    ADD COLUMN organization_id VARCHAR(255) NULL AFTER role;

CREATE INDEX idx_users_organization ON users(organization_id, role);

-- Heartbeat retries are identified by the attempt and the client mutation id.
-- The client id is not the event type: multiple heartbeat/disconnect events are valid.
ALTER TABLE student_heartbeat_events
    ADD COLUMN mutation_id VARCHAR(255) NULL AFTER schedule_id;

UPDATE student_heartbeat_events
SET mutation_id = UUID()
WHERE mutation_id IS NULL;

ALTER TABLE student_heartbeat_events
    MODIFY COLUMN mutation_id VARCHAR(255) NOT NULL,
    ADD CONSTRAINT uq_student_heartbeat_mutation UNIQUE (attempt_id, mutation_id);

CREATE INDEX idx_student_heartbeat_events_attempt_mutation
    ON student_heartbeat_events(attempt_id, mutation_id);

-- Tenant identity is carried by the authenticated user, never by a request body.
-- Prod safety: guard ADD COLUMN (partial shapes may pre-carry it).
SET @users_organization_id_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND column_name = 'organization_id'
);
SET @users_organization_id_sql := IF(
    @users_organization_id_exists = 0,
    'ALTER TABLE users ADD COLUMN organization_id VARCHAR(255) NULL AFTER role',
    'SELECT 1'
);
PREPARE users_organization_id_stmt FROM @users_organization_id_sql;
EXECUTE users_organization_id_stmt;
DEALLOCATE PREPARE users_organization_id_stmt;

SET @index_idx_users_organization_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND index_name = 'idx_users_organization'
);
SET @index_idx_users_organization_sql := IF(
    @index_idx_users_organization_exists = 0,
    'CREATE INDEX idx_users_organization ON users(organization_id, role)',
    'SELECT 1'
);
PREPARE index_idx_users_organization_stmt FROM @index_idx_users_organization_sql;
EXECUTE index_idx_users_organization_stmt;
DEALLOCATE PREPARE index_idx_users_organization_stmt;

-- Heartbeat retries are identified by the attempt and the client mutation id.
-- The client id is not the event type: multiple heartbeat/disconnect events are valid.
SET @heartbeat_mutation_id_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_heartbeat_events'
      AND column_name = 'mutation_id'
);
SET @heartbeat_mutation_id_sql := IF(
    @heartbeat_mutation_id_exists = 0,
    'ALTER TABLE student_heartbeat_events ADD COLUMN mutation_id VARCHAR(255) NULL AFTER schedule_id',
    'SELECT 1'
);
PREPARE heartbeat_mutation_id_stmt FROM @heartbeat_mutation_id_sql;
EXECUTE heartbeat_mutation_id_stmt;
DEALLOCATE PREPARE heartbeat_mutation_id_stmt;

UPDATE student_heartbeat_events
SET mutation_id = UUID()
WHERE mutation_id IS NULL;

SET @heartbeat_mutation_notnull_sql := (
    SELECT IF(COUNT(*) = 0,
        'ALTER TABLE student_heartbeat_events MODIFY COLUMN mutation_id VARCHAR(255) NOT NULL',
        'SELECT 1')
    FROM student_heartbeat_events
    WHERE mutation_id IS NULL
);
PREPARE heartbeat_mutation_notnull_stmt FROM @heartbeat_mutation_notnull_sql;
EXECUTE heartbeat_mutation_notnull_stmt;
DEALLOCATE PREPARE heartbeat_mutation_notnull_stmt;

-- Coexist with the prod-only legacy key uq_student_heartbeat_attempt_event_client_ts:
-- that key dedupes (attempt_id, event_type, client_timestamp); the new key
-- dedupes (attempt_id, mutation_id). Both stay; the write path keys retries
-- off mutation_id and never collides with the legacy key.
SET @heartbeat_mutation_uq_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'student_heartbeat_events'
      AND constraint_name = 'uq_student_heartbeat_mutation'
);
SET @heartbeat_mutation_uq_sql := IF(
    @heartbeat_mutation_uq_exists = 0,
    'ALTER TABLE student_heartbeat_events ADD CONSTRAINT uq_student_heartbeat_mutation UNIQUE (attempt_id, mutation_id)',
    'SELECT 1'
);
PREPARE heartbeat_mutation_uq_stmt FROM @heartbeat_mutation_uq_sql;
EXECUTE heartbeat_mutation_uq_stmt;
DEALLOCATE PREPARE heartbeat_mutation_uq_stmt;

SET @index_idx_student_heartbeat_events_attempt_mutation_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_heartbeat_events'
      AND index_name = 'idx_student_heartbeat_events_attempt_mutation'
);
SET @index_idx_student_heartbeat_events_attempt_mutation_sql := IF(
    @index_idx_student_heartbeat_events_attempt_mutation_exists = 0,
    'CREATE INDEX idx_student_heartbeat_events_attempt_mutation ON student_heartbeat_events(attempt_id, mutation_id)',
    'SELECT 1'
);
PREPARE index_idx_student_heartbeat_events_attempt_mutation_stmt FROM @index_idx_student_heartbeat_events_attempt_mutation_sql;
EXECUTE index_idx_student_heartbeat_events_attempt_mutation_stmt;
DEALLOCATE PREPARE index_idx_student_heartbeat_events_attempt_mutation_stmt;

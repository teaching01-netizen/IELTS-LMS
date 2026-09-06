-- Autosave durability hardening: explicit active-writer fencing.
-- Mutation idempotency remains keyed by (attempt_id, client_mutation_id).
SET @active_session_column_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND column_name = 'active_client_session_id'
);

SET @active_session_column_sql := IF(
    @active_session_column_exists = 0,
    'ALTER TABLE student_attempts ADD COLUMN active_client_session_id VARCHAR(255) NULL AFTER revision',
    'SELECT 1'
);
PREPARE active_session_column_stmt FROM @active_session_column_sql;
EXECUTE active_session_column_stmt;
DEALLOCATE PREPARE active_session_column_stmt;

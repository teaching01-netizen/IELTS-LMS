-- Normalize the names of the uniqueness guards used by startup verification.
-- The underlying unique constraints were introduced by earlier migrations; this
-- migration only makes their operational contract explicit.
SET @module_identity_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND index_name = 'module_attempt_identity'
);
SET @module_identity_legacy_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND index_name = 'uq_assessment_attempt_module'
);
SET @module_identity_rename_sql := IF(
    @module_identity_exists = 0 AND @module_identity_legacy_exists > 0,
    'ALTER TABLE assessment_module_attempts RENAME INDEX uq_assessment_attempt_module TO module_attempt_identity',
    'SELECT 1'
);
PREPARE module_identity_rename_stmt FROM @module_identity_rename_sql;
EXECUTE module_identity_rename_stmt;
DEALLOCATE PREPARE module_identity_rename_stmt;

SET @heartbeat_identity_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_heartbeat_events'
      AND index_name = 'heartbeat_mutation'
);
SET @heartbeat_identity_legacy_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_heartbeat_events'
      AND index_name = 'uq_student_heartbeat_mutation'
);
SET @heartbeat_identity_rename_sql := IF(
    @heartbeat_identity_exists = 0 AND @heartbeat_identity_legacy_exists > 0,
    'ALTER TABLE student_heartbeat_events RENAME INDEX uq_student_heartbeat_mutation TO heartbeat_mutation',
    'SELECT 1'
);
PREPARE heartbeat_identity_rename_stmt FROM @heartbeat_identity_rename_sql;
EXECUTE heartbeat_identity_rename_stmt;
DEALLOCATE PREPARE heartbeat_identity_rename_stmt;

-- Prod safety: guard ADD COLUMN (out-of-band SAT DDL left partial shapes).
SET @exam_schedules_provider_key_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_schedules'
      AND column_name = 'provider_key'
);
SET @exam_schedules_provider_key_sql := IF(
    @exam_schedules_provider_key_exists = 0,
    'ALTER TABLE exam_schedules ADD COLUMN provider_key VARCHAR(32) NULL AFTER exam_id',
    'SELECT 1'
);
PREPARE exam_schedules_provider_key_stmt FROM @exam_schedules_provider_key_sql;
EXECUTE exam_schedules_provider_key_stmt;
DEALLOCATE PREPARE exam_schedules_provider_key_stmt;

UPDATE exam_schedules schedules
JOIN exam_entities exams ON exams.id = schedules.exam_id
SET schedules.provider_key = exams.provider_key
WHERE schedules.provider_key IS NULL;

SET @chk_exam_schedules_provider_key_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_schedules'
      AND constraint_name = 'chk_exam_schedules_provider_key'
);
SET @chk_exam_schedules_provider_key_sql := IF(
    @chk_exam_schedules_provider_key_exists = 0,
    'ALTER TABLE exam_schedules MODIFY provider_key VARCHAR(32) NOT NULL, ADD CONSTRAINT chk_exam_schedules_provider_key CHECK (provider_key IN (\'ielts\', \'sat\'))',
    'SELECT 1'
);
PREPARE chk_exam_schedules_provider_key_stmt FROM @chk_exam_schedules_provider_key_sql;
EXECUTE chk_exam_schedules_provider_key_stmt;
DEALLOCATE PREPARE chk_exam_schedules_provider_key_stmt;

SET @index_idx_exam_schedules_provider_status_start_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_schedules'
      AND index_name = 'idx_exam_schedules_provider_status_start'
);
SET @index_idx_exam_schedules_provider_status_start_sql := IF(
    @index_idx_exam_schedules_provider_status_start_exists = 0,
    'CREATE INDEX idx_exam_schedules_provider_status_start ON exam_schedules(provider_key, status, start_time ASC)',
    'SELECT 1'
);
PREPARE index_idx_exam_schedules_provider_status_start_stmt FROM @index_idx_exam_schedules_provider_status_start_sql;
EXECUTE index_idx_exam_schedules_provider_status_start_stmt;
DEALLOCATE PREPARE index_idx_exam_schedules_provider_status_start_stmt;

SET @exam_session_runtimes_provider_key_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_session_runtimes'
      AND column_name = 'provider_key'
);
SET @exam_session_runtimes_provider_key_sql := IF(
    @exam_session_runtimes_provider_key_exists = 0,
    'ALTER TABLE exam_session_runtimes ADD COLUMN provider_key VARCHAR(32) NULL AFTER exam_id',
    'SELECT 1'
);
PREPARE exam_session_runtimes_provider_key_stmt FROM @exam_session_runtimes_provider_key_sql;
EXECUTE exam_session_runtimes_provider_key_stmt;
DEALLOCATE PREPARE exam_session_runtimes_provider_key_stmt;

UPDATE exam_session_runtimes runtimes
JOIN exam_entities exams ON exams.id = runtimes.exam_id
SET runtimes.provider_key = exams.provider_key
WHERE runtimes.provider_key IS NULL;

SET @chk_exam_session_runtimes_provider_key_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_session_runtimes'
      AND constraint_name = 'chk_exam_session_runtimes_provider_key'
);
SET @chk_exam_session_runtimes_provider_key_sql := IF(
    @chk_exam_session_runtimes_provider_key_exists = 0,
    'ALTER TABLE exam_session_runtimes MODIFY provider_key VARCHAR(32) NOT NULL, ADD CONSTRAINT chk_exam_session_runtimes_provider_key CHECK (provider_key IN (\'ielts\', \'sat\'))',
    'SELECT 1'
);
PREPARE chk_exam_session_runtimes_provider_key_stmt FROM @chk_exam_session_runtimes_provider_key_sql;
EXECUTE chk_exam_session_runtimes_provider_key_stmt;
DEALLOCATE PREPARE chk_exam_session_runtimes_provider_key_stmt;

SET @index_idx_exam_session_runtimes_provider_status_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_session_runtimes'
      AND index_name = 'idx_exam_session_runtimes_provider_status'
);
SET @index_idx_exam_session_runtimes_provider_status_sql := IF(
    @index_idx_exam_session_runtimes_provider_status_exists = 0,
    'CREATE INDEX idx_exam_session_runtimes_provider_status ON exam_session_runtimes(provider_key, status)',
    'SELECT 1'
);
PREPARE index_idx_exam_session_runtimes_provider_status_stmt FROM @index_idx_exam_session_runtimes_provider_status_sql;
EXECUTE index_idx_exam_session_runtimes_provider_status_stmt;
DEALLOCATE PREPARE index_idx_exam_session_runtimes_provider_status_stmt;

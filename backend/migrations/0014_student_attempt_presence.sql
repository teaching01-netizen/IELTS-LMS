SET @student_attempt_presence_attempt_id_type = (
    SELECT CONCAT(
        COLUMN_TYPE,
        IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', CHARACTER_SET_NAME)),
        IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE ', COLLATION_NAME))
    )
    FROM information_schema.columns
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempts'
      AND COLUMN_NAME = 'id'
    LIMIT 1
);

SET @student_attempt_presence_schedule_id_type = (
    SELECT CONCAT(
        COLUMN_TYPE,
        IF(CHARACTER_SET_NAME IS NULL, '', CONCAT(' CHARACTER SET ', CHARACTER_SET_NAME)),
        IF(COLLATION_NAME IS NULL, '', CONCAT(' COLLATE ', COLLATION_NAME))
    )
    FROM information_schema.columns
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'exam_schedules'
      AND COLUMN_NAME = 'id'
    LIMIT 1
);

SET @student_attempt_presence_attempt_id_type =
    COALESCE(@student_attempt_presence_attempt_id_type, 'VARCHAR(36)');
SET @student_attempt_presence_schedule_id_type =
    COALESCE(@student_attempt_presence_schedule_id_type, 'VARCHAR(36)');

SET @student_attempt_presence_create_sql = CONCAT(
    'CREATE TABLE IF NOT EXISTS student_attempt_presence (',
    'attempt_id ', @student_attempt_presence_attempt_id_type, ' NOT NULL PRIMARY KEY,',
    'schedule_id ', @student_attempt_presence_schedule_id_type, ' NOT NULL,',
    'client_session_id VARCHAR(36) NOT NULL,',
    'last_heartbeat_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,',
    'last_heartbeat_status VARCHAR(20) NOT NULL DEFAULT ''ok'',',
    'last_disconnect_at TIMESTAMP NULL,',
    'last_reconnect_at TIMESTAMP NULL,',
    'updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,',
    'CONSTRAINT student_attempt_presence_attempt_fk ',
    'FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE',
    ')'
);

PREPARE student_attempt_presence_create_stmt FROM @student_attempt_presence_create_sql;
EXECUTE student_attempt_presence_create_stmt;
DEALLOCATE PREPARE student_attempt_presence_create_stmt;

CREATE INDEX IF NOT EXISTS idx_student_attempt_presence_schedule_heartbeat
    ON student_attempt_presence(schedule_id, last_heartbeat_at DESC);

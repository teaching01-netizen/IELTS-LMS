-- Relax legacy W-code constraints and widen related columns for free-form access codes.

SET @has_schedule_reg_wcode_check := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'schedule_registrations'
      AND constraint_name = 'schedule_registrations_wcode_format'
);
SET @drop_schedule_reg_wcode_check := IF(
    @has_schedule_reg_wcode_check > 0,
    'ALTER TABLE schedule_registrations DROP CHECK schedule_registrations_wcode_format',
    'SELECT 1'
);
PREPARE stmt FROM @drop_schedule_reg_wcode_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @has_student_attempt_wcode_check := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND constraint_name = 'student_attempts_wcode_format'
);
SET @drop_student_attempt_wcode_check := IF(
    @has_student_attempt_wcode_check > 0,
    'ALTER TABLE student_attempts DROP CHECK student_attempts_wcode_format',
    'SELECT 1'
);
PREPARE stmt FROM @drop_student_attempt_wcode_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE schedule_registrations
    MODIFY wcode VARCHAR(512) NOT NULL DEFAULT '',
    MODIFY student_id VARCHAR(512) NOT NULL,
    MODIFY student_key VARCHAR(600) NOT NULL;

ALTER TABLE student_attempts
    MODIFY wcode VARCHAR(512) NOT NULL DEFAULT '',
    MODIFY candidate_id VARCHAR(512) NOT NULL,
    MODIFY student_key VARCHAR(600) NOT NULL;

ALTER TABLE student_admission_queue
    MODIFY wcode VARCHAR(512) NOT NULL,
    MODIFY queue_key VARCHAR(600) NOT NULL;

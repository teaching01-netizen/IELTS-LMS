-- Add ACT as a supported exam type and Science as a supported section key.
-- Existing IELTS rows remain unchanged; only their legacy CHECK constraints are widened.

SET @exam_type_check_name := (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.check_constraints AS cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE()
      AND tc.table_name = 'exam_entities'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%exam_type%'
    LIMIT 1
);
SET @drop_exam_type_check := IF(
    @exam_type_check_name IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE exam_entities DROP CHECK `', @exam_type_check_name, '`')
);
PREPARE stmt FROM @drop_exam_type_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE exam_entities
    ADD CONSTRAINT exam_entities_exam_type_check
    CHECK (exam_type IN ('Academic', 'General Training', 'ACT'));

SET @runtime_section_check_name := (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.check_constraints AS cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE()
      AND tc.table_name = 'exam_session_runtime_sections'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%section_key%'
    LIMIT 1
);
SET @drop_runtime_section_check := IF(
    @runtime_section_check_name IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE exam_session_runtime_sections DROP CHECK `', @runtime_section_check_name, '`')
);
PREPARE stmt FROM @drop_runtime_section_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE exam_session_runtime_sections
    ADD CONSTRAINT exam_session_runtime_sections_section_key_check
    CHECK (section_key IN ('listening', 'reading', 'writing', 'speaking', 'science'));

SET @attempt_module_check_name := (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.check_constraints AS cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE()
      AND tc.table_name = 'student_attempts'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%current_module%'
    LIMIT 1
);
SET @drop_attempt_module_check := IF(
    @attempt_module_check_name IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE student_attempts DROP CHECK `', @attempt_module_check_name, '`')
);
PREPARE stmt FROM @drop_attempt_module_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE student_attempts
    ADD CONSTRAINT student_attempts_current_module_check
    CHECK (current_module IN ('listening', 'reading', 'writing', 'speaking', 'science'));

SET @submission_section_check_name := (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.check_constraints AS cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE()
      AND tc.table_name = 'section_submissions'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%section%'
    LIMIT 1
);
SET @drop_submission_section_check := IF(
    @submission_section_check_name IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE section_submissions DROP CHECK `', @submission_section_check_name, '`')
);
PREPARE stmt FROM @drop_submission_section_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE section_submissions
    ADD CONSTRAINT section_submissions_section_check
    CHECK (section IN ('listening', 'reading', 'writing', 'speaking', 'science'));

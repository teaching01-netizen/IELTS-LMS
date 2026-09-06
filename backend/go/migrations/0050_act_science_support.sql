-- 0050_act_science_support.sql -- Go migration union: ACT exam type + science section.
-- Lineage: body extracted from origin/main:backend/migrations/0032_act_science_support.sql
-- (commit 8214dbf "feat: add ACT exam workflow"); header renumbered to 0050 so the
-- Go union runner (0001..0049 shared + 0050 epic) applies the widened ExamType ACT +
-- section science CHECK constraints after 0049_response_durability_v2.
-- Existing IELTS rows unchanged; only legacy CHECK constraints are widened.

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

-- Stage-suffixed keys (section_key:"m1"/":m2") come from the cohort_stage_v2
-- timing model: sat_runtime_stage_key(section_key, adaptive_role) derives
-- e.g. reading-writing:m1 (base) / :m2 (branch), and the same values are
-- persisted into exam_session_runtime_sections.section_key (verified against
-- live data: math, math:m1/m2, reading-writing, reading-writing:m1/m2).
-- They must be admitted here or any DB carrying SAT cohort rows rejects the
-- new CHECK on ALTER (MySQL validates existing rows). Plain SAT section keys
-- (math, reading-writing) are admitted for the same reason.
ALTER TABLE exam_session_runtime_sections
    ADD CONSTRAINT exam_session_runtime_sections_section_key_check
    CHECK (section_key IN ('listening', 'reading', 'writing', 'speaking', 'science',
        'math', 'reading-writing',
        'math:m1', 'math:m2',
        'reading-writing:m1', 'reading-writing:m2',
        'listening:m1', 'listening:m2',
        'reading:m1', 'reading:m2',
        'writing:m1', 'writing:m2',
        'speaking:m1', 'speaking:m2',
        'science:m1', 'science:m2'));

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

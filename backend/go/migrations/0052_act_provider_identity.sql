-- 0052_act_provider_identity.sql
-- ACT was added to exam entities and Science sections in 0050. Widen the
-- provider identity checks copied by 0039 so schedules/runtimes can carry
-- ACT without weakening the invariant for IELTS or SAT.

SET @schedule_provider_check_name := (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.check_constraints AS cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE()
      AND tc.table_name = 'exam_schedules'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%provider_key%'
    LIMIT 1
);
SET @drop_schedule_provider_check := IF(
    @schedule_provider_check_name IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE exam_schedules DROP CHECK `', @schedule_provider_check_name, '`')
);
PREPARE stmt FROM @drop_schedule_provider_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE exam_schedules
    ADD CONSTRAINT chk_exam_schedules_provider_key
    CHECK (provider_key IN ('ielts', 'sat', 'act'));

SET @runtime_provider_check_name := (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.check_constraints AS cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE()
      AND tc.table_name = 'exam_session_runtimes'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%provider_key%'
    LIMIT 1
);
SET @drop_runtime_provider_check := IF(
    @runtime_provider_check_name IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE exam_session_runtimes DROP CHECK `', @runtime_provider_check_name, '`')
);
PREPARE stmt FROM @drop_runtime_provider_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE exam_session_runtimes
    ADD CONSTRAINT chk_exam_session_runtimes_provider_key
    CHECK (provider_key IN ('ielts', 'sat', 'act'));

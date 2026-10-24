-- IELTS cohort-personal timing keeps one shared room release schedule while
-- preserving attempt-owned preparation and working deadlines. The v1 model
-- remains valid for sessions already captured under that rollout.

SET @chk_timing_exists := (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'exam_session_runtimes'
      AND constraint_name = 'chk_exam_session_runtime_timing_model'
);
SET @chk_timing_drop_sql := IF(@chk_timing_exists > 0,
    'ALTER TABLE exam_session_runtimes DROP CHECK chk_exam_session_runtime_timing_model',
    'SELECT 1');
PREPARE ielts_chk_drop_stmt FROM @chk_timing_drop_sql;
EXECUTE ielts_chk_drop_stmt;
DEALLOCATE PREPARE ielts_chk_drop_stmt;

SET @chk_timing_exists := (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'exam_session_runtimes'
      AND constraint_name = 'chk_exam_session_runtime_timing_model'
);
SET @chk_timing_add_sql := IF(@chk_timing_exists = 0,
    "ALTER TABLE exam_session_runtimes ADD CONSTRAINT chk_exam_session_runtime_timing_model CHECK (timing_model IN ('legacy_section_v1', 'cohort_stage_v2', 'cohort_section_v3', 'sat_personal_v1', 'ielts_personal_v1', 'ielts_cohort_personal_v2'))",
    'SELECT 1');
PREPARE ielts_chk_add_stmt FROM @chk_timing_add_sql;
EXECUTE ielts_chk_add_stmt;
DEALLOCATE PREPARE ielts_chk_add_stmt;

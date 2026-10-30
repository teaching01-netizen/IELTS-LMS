-- IELTS shared offline-capable timetable (docs/superpowers/plans/
-- 2026-10-30-ielts-shared-clock-offline-continuity.md). One committed room
-- schedule per runtime; NULL for every other timing model. Additive only.

SET @shared_schedule_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'exam_session_runtimes'
      AND column_name = 'ielts_shared_schedule'
);
SET @shared_schedule_sql := IF(@shared_schedule_exists = 0,
    'ALTER TABLE exam_session_runtimes ADD COLUMN ielts_shared_schedule JSON NULL',
    'SELECT 1');
PREPARE shared_schedule_stmt FROM @shared_schedule_sql;
EXECUTE shared_schedule_stmt;
DEALLOCATE PREPARE shared_schedule_stmt;

SET @chk_timing_exists := (
    SELECT COUNT(*) FROM information_schema.table_constraints
    WHERE table_schema = DATABASE() AND table_name = 'exam_session_runtimes'
      AND constraint_name = 'chk_exam_session_runtime_timing_model'
);
SET @chk_timing_drop_sql := IF(@chk_timing_exists > 0,
    'ALTER TABLE exam_session_runtimes DROP CHECK chk_exam_session_runtime_timing_model',
    'SELECT 1');
PREPARE shared_chk_drop_stmt FROM @chk_timing_drop_sql;
EXECUTE shared_chk_drop_stmt;
DEALLOCATE PREPARE shared_chk_drop_stmt;

ALTER TABLE exam_session_runtimes ADD CONSTRAINT chk_exam_session_runtime_timing_model
    CHECK (timing_model IN ('legacy_section_v1', 'cohort_stage_v2', 'cohort_section_v3', 'sat_personal_v1', 'ielts_personal_v1', 'ielts_cohort_personal_v2', 'ielts_shared_schedule_v1'));

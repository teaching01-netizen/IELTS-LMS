-- 0069_sat_personal_timing.sql
-- SAT full-entry-time personal timing model (sat_personal_v1).
--
-- - exam_schedules.sat_timing_model is nullable; NULL means the deployed
--   cohort model (cohort_section_v3 for SAT, legacy for others). Newly created
--   SAT schedules select sat_personal_v1. Never reinterpret an in-progress
--   attempt's timing model.
-- - assessment_attempt_breaks owns each attempt's scheduled break: its duration
--   is not consumed during server reconciliation, network delivery, or page
--   rendering. A zero-length break moves directly to the next module.
-- - assessment_module_attempts gains the future-start offer columns. started_at
--   remains NULL while an offer is only armed; entry_entered_at records the
--   first active frame acknowledgment.
-- - exam_session_runtimes.timing_model accepts sat_personal_v1.

SET @sat_timing_model_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_schedules'
      AND column_name = 'sat_timing_model'
);
SET @sat_timing_model_sql := IF(
    @sat_timing_model_exists = 0,
    'ALTER TABLE exam_schedules ADD COLUMN sat_timing_model VARCHAR(32) NULL AFTER provider_key',
    'SELECT 1'
);
PREPARE sat_timing_model_stmt FROM @sat_timing_model_sql;
EXECUTE sat_timing_model_stmt;
DEALLOCATE PREPARE sat_timing_model_stmt;

CREATE TABLE IF NOT EXISTS assessment_attempt_breaks (
    id VARCHAR(36) PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    after_section_id VARCHAR(36) NOT NULL,
    duration_seconds INT NOT NULL DEFAULT 0,
    state VARCHAR(16) NOT NULL DEFAULT 'pending',
    starts_at TIMESTAMP(6) NULL,
    deadline_at TIMESTAMP(6) NULL,
    entered_at TIMESTAMP(6) NULL,
    paused_at TIMESTAMP(6) NULL,
    accumulated_paused_seconds INT NOT NULL DEFAULT 0,
    entry_generation INT NOT NULL DEFAULT 0,
    entry_starts_at TIMESTAMP(6) NULL,
    entry_confirmed_at TIMESTAMP(6) NULL,
    entry_entered_at TIMESTAMP(6) NULL,
    revision INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_attempt_break_section UNIQUE (attempt_id, after_section_id),
    CONSTRAINT chk_attempt_break_state CHECK (state IN ('pending', 'armed', 'active', 'completed')),
    FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (after_section_id) REFERENCES assessment_sections(id)
);

SET @idx_break_active_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_attempt_breaks'
      AND index_name = 'idx_attempt_breaks_active'
);
SET @idx_break_active_sql := IF(
    @idx_break_active_exists = 0,
    'CREATE INDEX idx_attempt_breaks_active ON assessment_attempt_breaks(attempt_id, state, deadline_at)',
    'SELECT 1'
);
PREPARE idx_break_active_stmt FROM @idx_break_active_sql;
EXECUTE idx_break_active_stmt;
DEALLOCATE PREPARE idx_break_active_stmt;

SET @entry_starts_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'entry_starts_at'
);
SET @entry_starts_sql := IF(
    @entry_starts_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN entry_starts_at TIMESTAMP(6) NULL AFTER started_at, ADD COLUMN entry_confirmed_at TIMESTAMP(6) NULL AFTER entry_starts_at, ADD COLUMN entry_entered_at TIMESTAMP(6) NULL AFTER entry_confirmed_at, ADD COLUMN entry_generation INT NOT NULL DEFAULT 0 AFTER entry_entered_at',
    'SELECT 1'
);
PREPARE entry_starts_stmt FROM @entry_starts_sql;
EXECUTE entry_starts_stmt;
DEALLOCATE PREPARE entry_starts_stmt;

-- Allow the new timing model on runtime rows. The CHECK name is stable from
-- 0037/0038; drop and re-add to include sat_personal_v1.
SET @chk_timing_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_session_runtimes'
      AND constraint_name = 'chk_exam_session_runtime_timing_model'
);
SET @chk_timing_drop_sql := IF(
    @chk_timing_exists > 0,
    'ALTER TABLE exam_session_runtimes DROP CHECK chk_exam_session_runtime_timing_model',
    'SELECT 1'
);
PREPARE chk_timing_drop_stmt FROM @chk_timing_drop_sql;
EXECUTE chk_timing_drop_stmt;
DEALLOCATE PREPARE chk_timing_drop_stmt;

SET @chk_timing_add_sql := IF(
    @chk_timing_exists > 0,
    "ALTER TABLE exam_session_runtimes ADD CONSTRAINT chk_exam_session_runtime_timing_model CHECK (timing_model IN ('legacy_section_v1', 'cohort_stage_v2', 'cohort_section_v3', 'sat_personal_v1'))",
    'SELECT 1'
);
PREPARE chk_timing_add_stmt FROM @chk_timing_add_sql;
EXECUTE chk_timing_add_stmt;
DEALLOCATE PREPARE chk_timing_add_stmt;

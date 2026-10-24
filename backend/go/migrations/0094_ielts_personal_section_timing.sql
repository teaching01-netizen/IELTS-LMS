-- IELTS attempt-owned section clocks. The selected model and preparation
-- allowance are captured when a schedule/runtime is created so a rollout
-- change never reinterprets a session that has already started.

SET @ielts_model_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'exam_schedules'
      AND column_name = 'ielts_timing_model'
);
SET @ielts_model_sql := IF(@ielts_model_exists = 0,
    'ALTER TABLE exam_schedules ADD COLUMN ielts_timing_model VARCHAR(32) NULL AFTER sat_timing_model',
    'SELECT 1');
PREPARE ielts_model_stmt FROM @ielts_model_sql;
EXECUTE ielts_model_stmt;
DEALLOCATE PREPARE ielts_model_stmt;

SET @prep_seconds_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'exam_session_runtimes'
      AND column_name = 'ielts_preparation_seconds'
);
SET @prep_seconds_sql := IF(@prep_seconds_exists = 0,
    'ALTER TABLE exam_session_runtimes ADD COLUMN ielts_preparation_seconds INT NOT NULL DEFAULT 120 AFTER timing_model',
    'SELECT 1');
PREPARE prep_seconds_stmt FROM @prep_seconds_sql;
EXECUTE prep_seconds_stmt;
DEALLOCATE PREPARE prep_seconds_stmt;

SET @completion_reason_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'exam_session_runtimes'
      AND column_name = 'completion_reason'
);
SET @completion_reason_sql := IF(@completion_reason_exists = 0,
    'ALTER TABLE exam_session_runtimes ADD COLUMN completion_reason VARCHAR(255) NULL AFTER actual_end_at',
    'SELECT 1');
PREPARE completion_reason_stmt FROM @completion_reason_sql;
EXECUTE completion_reason_stmt;
DEALLOCATE PREPARE completion_reason_stmt;

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
SET @chk_timing_add_sql := IF(@chk_timing_exists > 0,
    "ALTER TABLE exam_session_runtimes ADD CONSTRAINT chk_exam_session_runtime_timing_model CHECK (timing_model IN ('legacy_section_v1', 'cohort_stage_v2', 'cohort_section_v3', 'sat_personal_v1', 'ielts_personal_v1'))",
    'SELECT 1');
PREPARE ielts_chk_add_stmt FROM @chk_timing_add_sql;
EXECUTE ielts_chk_add_stmt;
DEALLOCATE PREPARE ielts_chk_add_stmt;

CREATE TABLE IF NOT EXISTS ielts_attempt_section_timelines (
    id VARCHAR(36) PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    runtime_id VARCHAR(36) NOT NULL,
    section_key VARCHAR(64) NOT NULL,
    section_order INT NOT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'preparing',
    expected_start_at TIMESTAMP(6) NOT NULL,
    preparation_deadline_at TIMESTAMP(6) NOT NULL,
    started_at TIMESTAMP(6) NULL,
    deadline_at TIMESTAMP(6) NULL,
    finished_at TIMESTAMP(6) NULL,
    paused_at TIMESTAMP(6) NULL,
    accumulated_paused_seconds INT NOT NULL DEFAULT 0,
    failure_reason VARCHAR(64) NULL,
    revision INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_ielts_attempt_section UNIQUE (attempt_id, section_key),
    CONSTRAINT chk_ielts_timeline_state CHECK (state IN ('preparing', 'active', 'completed', 'unable')),
    FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (runtime_id) REFERENCES exam_session_runtimes(id) ON DELETE CASCADE
);

CREATE INDEX idx_ielts_timeline_runtime_order
    ON ielts_attempt_section_timelines(runtime_id, section_order, state);
CREATE INDEX idx_ielts_timeline_expiry
    ON ielts_attempt_section_timelines(state, deadline_at, preparation_deadline_at);

-- SAT configurable registration forms and Eva SIM
-- (docs/plans/SAT-configurable-forms-and-eva-sim.md).
--
-- Definitions live in exam_versions.config_snapshot.forms, pinned by the
-- attempt's published version. This table holds only the current accepted
-- answer set per (attempt, form). Embedded Eva never writes a row.
-- Additive and re-runnable; no backfill.
CREATE TABLE IF NOT EXISTS assessment_form_responses (
    attempt_id VARCHAR(36) NOT NULL,
    form_key VARCHAR(32) NOT NULL,
    answers JSON NOT NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    first_submitted_at TIMESTAMP(6) NOT NULL,
    updated_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (attempt_id, form_key),
    CONSTRAINT fk_assessment_form_responses_attempt
        FOREIGN KEY (attempt_id)
        REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT chk_assessment_form_responses_form_key
        CHECK (form_key IN ('registration', 'eva_sim')),
    CONSTRAINT chk_assessment_form_responses_revision
        CHECK (revision >= 1)
);

-- Explicit staff End Exam closure. NULL = not explicitly closed; automatic
-- completion never sets it.
SET @eva_closed_at_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_schedules'
      AND column_name = 'eva_sim_closed_at'
);
SET @eva_closed_at_sql := IF(
    @eva_closed_at_exists = 0,
    'ALTER TABLE exam_schedules ADD COLUMN eva_sim_closed_at TIMESTAMP(6) NULL',
    'SELECT 1'
);
PREPARE eva_closed_at_stmt FROM @eva_closed_at_sql;
EXECUTE eva_closed_at_stmt;
DEALLOCATE PREPARE eva_closed_at_stmt;

SET @eva_closed_by_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_schedules'
      AND column_name = 'eva_sim_closed_by'
);
SET @eva_closed_by_sql := IF(
    @eva_closed_by_exists = 0,
    'ALTER TABLE exam_schedules ADD COLUMN eva_sim_closed_by VARCHAR(255) NULL',
    'SELECT 1'
);
PREPARE eva_closed_by_stmt FROM @eva_closed_by_sql;
EXECUTE eva_closed_by_stmt;
DEALLOCATE PREPARE eva_closed_by_stmt;

-- Keyset pages for the staff response list start from attempts.
SET @form_page_schedule_exists := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND index_name = 'idx_student_attempts_schedule_form_page'
);
SET @form_page_schedule_sql := IF(
    @form_page_schedule_exists = 0,
    'CREATE INDEX idx_student_attempts_schedule_form_page ON student_attempts(schedule_id, id)',
    'SELECT 1'
);
PREPARE form_page_schedule_stmt FROM @form_page_schedule_sql;
EXECUTE form_page_schedule_stmt;
DEALLOCATE PREPARE form_page_schedule_stmt;

SET @form_page_exam_exists := (
    SELECT COUNT(*) FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND index_name = 'idx_student_attempts_exam_form_page'
);
SET @form_page_exam_sql := IF(
    @form_page_exam_exists = 0,
    'CREATE INDEX idx_student_attempts_exam_form_page ON student_attempts(exam_id, id)',
    'SELECT 1'
);
PREPARE form_page_exam_stmt FROM @form_page_exam_sql;
EXECUTE form_page_exam_stmt;
DEALLOCATE PREPARE form_page_exam_stmt;

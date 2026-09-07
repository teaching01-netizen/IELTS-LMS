
-- Cohort runtime section identifiers must be provider-neutral. Migration 0005
-- constrained this column to IELTS-only keys; SAT uses `reading-writing` and `math`.
-- Prod safety: the auto-generated CHECK name differs per engine/shape
-- (prod carries exam_session_runtime_sections_chk_2, not _chk_1).
-- Look the section_key CHECK up dynamically (0050/0052 idiom) instead.
SET @runtime_sections_section_check_name := (
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
SET @runtime_sections_section_drop_sql := IF(
    @runtime_sections_section_check_name IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE exam_session_runtime_sections DROP CHECK `', @runtime_sections_section_check_name, '`')
);
PREPARE runtime_sections_section_drop_stmt FROM @runtime_sections_section_drop_sql;
EXECUTE runtime_sections_section_drop_stmt;
DEALLOCATE PREPARE runtime_sections_section_drop_stmt;

SET @assessment_sections_revision_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_sections'
      AND column_name = 'revision'
);
SET @assessment_sections_revision_sql := IF(
    @assessment_sections_revision_exists = 0,
    'ALTER TABLE assessment_sections ADD COLUMN revision INT NOT NULL DEFAULT 0 AFTER tool_policy',
    'SELECT 1'
);
PREPARE assessment_sections_revision_stmt FROM @assessment_sections_revision_sql;
EXECUTE assessment_sections_revision_stmt;
DEALLOCATE PREPARE assessment_sections_revision_stmt;

SET @assessment_modules_revision_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_modules'
      AND column_name = 'revision'
);
SET @assessment_modules_revision_sql := IF(
    @assessment_modules_revision_exists = 0,
    'ALTER TABLE assessment_modules ADD COLUMN revision INT NOT NULL DEFAULT 0 AFTER tool_policy',
    'SELECT 1'
);
PREPARE assessment_modules_revision_stmt FROM @assessment_modules_revision_sql;
EXECUTE assessment_modules_revision_stmt;
DEALLOCATE PREPARE assessment_modules_revision_stmt;

SET @module_attempts_available_at_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'available_at'
);
SET @module_attempts_available_at_sql := IF(
    @module_attempts_available_at_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN available_at TIMESTAMP(6) NULL AFTER allocated_seconds',
    'SELECT 1'
);
PREPARE module_attempts_available_at_stmt FROM @module_attempts_available_at_sql;
EXECUTE module_attempts_available_at_stmt;
DEALLOCATE PREPARE module_attempts_available_at_stmt;

SET @module_attempts_paused_at_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'paused_at'
);
SET @module_attempts_paused_at_sql := IF(
    @module_attempts_paused_at_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN paused_at TIMESTAMP(6) NULL AFTER started_at',
    'SELECT 1'
);
PREPARE module_attempts_paused_at_stmt FROM @module_attempts_paused_at_sql;
EXECUTE module_attempts_paused_at_stmt;
DEALLOCATE PREPARE module_attempts_paused_at_stmt;

SET @module_attempts_accumulated_paused_seconds_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'accumulated_paused_seconds'
);
SET @module_attempts_accumulated_paused_seconds_sql := IF(
    @module_attempts_accumulated_paused_seconds_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN accumulated_paused_seconds INT NOT NULL DEFAULT 0 AFTER paused_at',
    'SELECT 1'
);
PREPARE module_attempts_accumulated_paused_seconds_stmt FROM @module_attempts_accumulated_paused_seconds_sql;
EXECUTE module_attempts_accumulated_paused_seconds_stmt;
DEALLOCATE PREPARE module_attempts_accumulated_paused_seconds_stmt;

SET @module_attempts_extension_seconds_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'extension_seconds'
);
SET @module_attempts_extension_seconds_sql := IF(
    @module_attempts_extension_seconds_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN extension_seconds INT NOT NULL DEFAULT 0 AFTER accumulated_paused_seconds',
    'SELECT 1'
);
PREPARE module_attempts_extension_seconds_stmt FROM @module_attempts_extension_seconds_sql;
EXECUTE module_attempts_extension_seconds_stmt;
DEALLOCATE PREPARE module_attempts_extension_seconds_stmt;

SET @module_attempts_completion_reason_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'completion_reason'
);
SET @module_attempts_completion_reason_sql := IF(
    @module_attempts_completion_reason_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN completion_reason VARCHAR(64) NULL AFTER locked_at',
    'SELECT 1'
);
PREPARE module_attempts_completion_reason_stmt FROM @module_attempts_completion_reason_sql;
EXECUTE module_attempts_completion_reason_stmt;
DEALLOCATE PREPARE module_attempts_completion_reason_stmt;

UPDATE assessment_module_attempts
SET available_at = COALESCE(available_at, started_at)
WHERE available_at IS NULL AND started_at IS NOT NULL;

SET @index_idx_assessment_module_attempts_active_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND index_name = 'idx_assessment_module_attempts_active'
);
SET @index_idx_assessment_module_attempts_active_sql := IF(
    @index_idx_assessment_module_attempts_active_exists = 0,
    'CREATE INDEX idx_assessment_module_attempts_active ON assessment_module_attempts(attempt_id, state, available_at)',
    'SELECT 1'
);
PREPARE index_idx_assessment_module_attempts_active_stmt FROM @index_idx_assessment_module_attempts_active_sql;
EXECUTE index_idx_assessment_module_attempts_active_stmt;
DEALLOCATE PREPARE index_idx_assessment_module_attempts_active_stmt;
CREATE TABLE IF NOT EXISTS assessment_route_decisions (
    id VARCHAR(36) PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    section_id VARCHAR(36) NOT NULL,
    base_module_attempt_id VARCHAR(36) NOT NULL,
    base_module_id VARCHAR(36) NOT NULL,
    selected_module_id VARCHAR(36) NOT NULL,
    selected_route VARCHAR(16) NOT NULL,
    raw_correct INT NOT NULL,
    operational_question_count INT NOT NULL,
    policy_key VARCHAR(64) NOT NULL,
    policy_revision INT NOT NULL,
    policy_config JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_assessment_route_decision UNIQUE (attempt_id, section_id),
    CONSTRAINT fk_route_decision_attempt FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_route_decision_section FOREIGN KEY (section_id) REFERENCES assessment_sections(id),
    CONSTRAINT fk_route_decision_base_attempt FOREIGN KEY (base_module_attempt_id) REFERENCES assessment_module_attempts(id),
    CONSTRAINT fk_route_decision_base_module FOREIGN KEY (base_module_id) REFERENCES assessment_modules(id),
    CONSTRAINT fk_route_decision_selected_module FOREIGN KEY (selected_module_id) REFERENCES assessment_modules(id),
    CONSTRAINT chk_route_decision_route CHECK (selected_route IN ('lower', 'higher'))
);

SET @index_idx_assessment_route_decisions_attempt_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_route_decisions'
      AND index_name = 'idx_assessment_route_decisions_attempt'
);
SET @index_idx_assessment_route_decisions_attempt_sql := IF(
    @index_idx_assessment_route_decisions_attempt_exists = 0,
    'CREATE INDEX idx_assessment_route_decisions_attempt ON assessment_route_decisions(attempt_id, created_at)',
    'SELECT 1'
);
PREPARE index_idx_assessment_route_decisions_attempt_stmt FROM @index_idx_assessment_route_decisions_attempt_sql;
EXECUTE index_idx_assessment_route_decisions_attempt_stmt;
DEALLOCATE PREPARE index_idx_assessment_route_decisions_attempt_stmt;

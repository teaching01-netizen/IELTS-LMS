-- Prod safety (verified 2026-09-06 against a prod clone): out-of-band SAT DDL
-- left exam_entities.provider_key present (VARCHAR(50)) while provider_exam_type
-- and every assessment_* table were missing and 0032 was never recorded.
-- Guard each ADD COLUMN so a re-run converges instead of aborting with
-- Error 1060 Duplicate column name. Same information_schema guard idiom as
-- 0035/0049 (PREPARE/EXECUTE dynamic DDL, skipped on TiDB trigger paths only).
SET @exam_entities_provider_key_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_entities'
      AND column_name = 'provider_key'
);
SET @exam_entities_provider_key_sql := IF(
    @exam_entities_provider_key_exists = 0,
    'ALTER TABLE exam_entities ADD COLUMN provider_key VARCHAR(32) NOT NULL DEFAULT \'ielts\' AFTER title',
    'SELECT 1'
);
PREPARE exam_entities_provider_key_stmt FROM @exam_entities_provider_key_sql;
EXECUTE exam_entities_provider_key_stmt;
DEALLOCATE PREPARE exam_entities_provider_key_stmt;

SET @exam_entities_provider_exam_type_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_entities'
      AND column_name = 'provider_exam_type'
);
SET @exam_entities_provider_exam_type_sql := IF(
    @exam_entities_provider_exam_type_exists = 0,
    'ALTER TABLE exam_entities ADD COLUMN provider_exam_type VARCHAR(64) NULL AFTER provider_key',
    'SELECT 1'
);
PREPARE exam_entities_provider_exam_type_stmt FROM @exam_entities_provider_exam_type_sql;
EXECUTE exam_entities_provider_exam_type_stmt;
DEALLOCATE PREPARE exam_entities_provider_exam_type_stmt;

UPDATE exam_entities
SET provider_exam_type = exam_type
WHERE provider_key = 'ielts'
  AND provider_exam_type IS NULL;

SET @exam_entities_provider_idx_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_entities'
      AND index_name = 'idx_exam_entities_provider_status_updated'
);
SET @exam_entities_provider_idx_sql := IF(
    @exam_entities_provider_idx_exists = 0,
    'CREATE INDEX idx_exam_entities_provider_status_updated ON exam_entities(provider_key, status, updated_at DESC)',
    'SELECT 1'
);
PREPARE exam_entities_provider_idx_stmt FROM @exam_entities_provider_idx_sql;
EXECUTE exam_entities_provider_idx_stmt;
DEALLOCATE PREPARE exam_entities_provider_idx_stmt;

CREATE TABLE IF NOT EXISTS assessment_sections (
    id VARCHAR(36) PRIMARY KEY,
    exam_version_id VARCHAR(36) NOT NULL,
    section_key VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    display_order INT NOT NULL,
    duration_seconds INT NOT NULL,
    break_after_seconds INT NOT NULL DEFAULT 0,
    instructions JSON NOT NULL,
    tool_policy JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_assessment_section_version
        FOREIGN KEY (exam_version_id) REFERENCES exam_versions(id) ON DELETE CASCADE,
    CONSTRAINT uq_assessment_section_key UNIQUE (exam_version_id, section_key)
);

SET @index_idx_assessment_sections_version_order_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'assessment_sections'
    AND index_name = 'idx_assessment_sections_version_order'
);
SET @index_idx_assessment_sections_version_order_sql := IF(
    @index_idx_assessment_sections_version_order_exists = 0,
    'CREATE INDEX idx_assessment_sections_version_order ON assessment_sections(exam_version_id, display_order)',
    'SELECT 1'
);
PREPARE index_idx_assessment_sections_version_order_stmt FROM @index_idx_assessment_sections_version_order_sql;
EXECUTE index_idx_assessment_sections_version_order_stmt;
DEALLOCATE PREPARE index_idx_assessment_sections_version_order_stmt;

CREATE TABLE IF NOT EXISTS assessment_modules (
    id VARCHAR(36) PRIMARY KEY,
    section_id VARCHAR(36) NOT NULL,
    module_key VARCHAR(64) NOT NULL,
    title VARCHAR(255) NOT NULL,
    display_order INT NOT NULL,
    duration_seconds INT NOT NULL,
    target_question_count INT NOT NULL,
    adaptive_role VARCHAR(32) NOT NULL DEFAULT 'none',
    instructions JSON NOT NULL,
    tool_policy JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_assessment_module_section
        FOREIGN KEY (section_id) REFERENCES assessment_sections(id) ON DELETE CASCADE,
    CONSTRAINT uq_assessment_module_key UNIQUE (section_id, module_key),
    CONSTRAINT chk_assessment_module_role CHECK (
        adaptive_role IN ('none', 'base', 'lower_branch', 'higher_branch')
    )
);

SET @index_idx_assessment_modules_section_order_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'assessment_modules'
    AND index_name = 'idx_assessment_modules_section_order'
);
SET @index_idx_assessment_modules_section_order_sql := IF(
    @index_idx_assessment_modules_section_order_exists = 0,
    'CREATE INDEX idx_assessment_modules_section_order ON assessment_modules(section_id, display_order)',
    'SELECT 1'
);
PREPARE index_idx_assessment_modules_section_order_stmt FROM @index_idx_assessment_modules_section_order_sql;
EXECUTE index_idx_assessment_modules_section_order_stmt;
DEALLOCATE PREPARE index_idx_assessment_modules_section_order_stmt;

CREATE TABLE IF NOT EXISTS assessment_questions (
    id VARCHAR(36) PRIMARY KEY,
    provider_key VARCHAR(32) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    archived_at TIMESTAMP(6) NULL
);

SET @index_idx_assessment_questions_provider_updated_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'assessment_questions'
    AND index_name = 'idx_assessment_questions_provider_updated'
);
SET @index_idx_assessment_questions_provider_updated_sql := IF(
    @index_idx_assessment_questions_provider_updated_exists = 0,
    'CREATE INDEX idx_assessment_questions_provider_updated ON assessment_questions(provider_key, updated_at DESC)',
    'SELECT 1'
);
PREPARE index_idx_assessment_questions_provider_updated_stmt FROM @index_idx_assessment_questions_provider_updated_sql;
EXECUTE index_idx_assessment_questions_provider_updated_stmt;
DEALLOCATE PREPARE index_idx_assessment_questions_provider_updated_stmt;

CREATE TABLE IF NOT EXISTS assessment_question_revisions (
    id VARCHAR(36) PRIMARY KEY,
    question_id VARCHAR(36) NOT NULL,
    semantic_revision INT NOT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'draft',
    question_type VARCHAR(64) NOT NULL,
    stimulus JSON NOT NULL,
    prompt JSON NOT NULL,
    answer_definition JSON NOT NULL,
    rationale JSON NOT NULL,
    metadata JSON NOT NULL,
    accessibility JSON NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    sealed_at TIMESTAMP(6),
    CONSTRAINT fk_question_revision_question
        FOREIGN KEY (question_id) REFERENCES assessment_questions(id) ON DELETE CASCADE,
    CONSTRAINT uq_question_semantic_revision UNIQUE (question_id, semantic_revision),
    CONSTRAINT chk_question_revision_state CHECK (state IN ('draft', 'sealed'))
);

SET @index_idx_question_revision_question_state_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'assessment_question_revisions'
    AND index_name = 'idx_question_revision_question_state'
);
SET @index_idx_question_revision_question_state_sql := IF(
    @index_idx_question_revision_question_state_exists = 0,
    'CREATE INDEX idx_question_revision_question_state ON assessment_question_revisions(question_id, state)',
    'SELECT 1'
);
PREPARE index_idx_question_revision_question_state_stmt FROM @index_idx_question_revision_question_state_sql;
EXECUTE index_idx_question_revision_question_state_stmt;
DEALLOCATE PREPARE index_idx_question_revision_question_state_stmt;

CREATE TABLE IF NOT EXISTS assessment_exam_questions (
    id VARCHAR(36) PRIMARY KEY,
    module_id VARCHAR(36) NOT NULL,
    question_id VARCHAR(36) NOT NULL,
    question_revision_id VARCHAR(36) NOT NULL,
    display_order INT NOT NULL,
    is_pretest BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_exam_question_module
        FOREIGN KEY (module_id) REFERENCES assessment_modules(id) ON DELETE CASCADE,
    CONSTRAINT fk_exam_question_question
        FOREIGN KEY (question_id) REFERENCES assessment_questions(id),
    CONSTRAINT fk_exam_question_revision
        FOREIGN KEY (question_revision_id) REFERENCES assessment_question_revisions(id),
    CONSTRAINT uq_exam_question_order UNIQUE (module_id, display_order)
);

SET @index_idx_exam_questions_module_order_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'assessment_exam_questions'
    AND index_name = 'idx_exam_questions_module_order'
);
SET @index_idx_exam_questions_module_order_sql := IF(
    @index_idx_exam_questions_module_order_exists = 0,
    'CREATE INDEX idx_exam_questions_module_order ON assessment_exam_questions(module_id, display_order)',
    'SELECT 1'
);
PREPARE index_idx_exam_questions_module_order_stmt FROM @index_idx_exam_questions_module_order_sql;
EXECUTE index_idx_exam_questions_module_order_stmt;
DEALLOCATE PREPARE index_idx_exam_questions_module_order_stmt;

CREATE TABLE IF NOT EXISTS assessment_routing_policies (
    id VARCHAR(36) PRIMARY KEY,
    section_id VARCHAR(36) NOT NULL,
    base_module_id VARCHAR(36) NOT NULL,
    lower_module_id VARCHAR(36) NOT NULL,
    higher_module_id VARCHAR(36) NOT NULL,
    policy_key VARCHAR(64) NOT NULL,
    policy_config JSON NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_assessment_routing_section UNIQUE (section_id),
    FOREIGN KEY (section_id) REFERENCES assessment_sections(id) ON DELETE CASCADE,
    FOREIGN KEY (base_module_id) REFERENCES assessment_modules(id),
    FOREIGN KEY (lower_module_id) REFERENCES assessment_modules(id),
    FOREIGN KEY (higher_module_id) REFERENCES assessment_modules(id)
);

CREATE TABLE IF NOT EXISTS assessment_scoring_policies (
    id VARCHAR(36) PRIMARY KEY,
    exam_version_id VARCHAR(36) NOT NULL,
    policy_key VARCHAR(64) NOT NULL,
    policy_config JSON NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_assessment_scoring_version UNIQUE (exam_version_id),
    FOREIGN KEY (exam_version_id) REFERENCES exam_versions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_module_attempts (
    id VARCHAR(36) PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    module_id VARCHAR(36) NOT NULL,
    state VARCHAR(32) NOT NULL,
    allocated_seconds INT NOT NULL,
    started_at TIMESTAMP(6),
    review_started_at TIMESTAMP(6),
    submitted_at TIMESTAMP(6),
    locked_at TIMESTAMP(6),
    raw_correct INT,
    operational_question_count INT,
    tool_state JSON NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_assessment_attempt_module UNIQUE (attempt_id, module_id),
    FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (module_id) REFERENCES assessment_modules(id),
    CONSTRAINT chk_module_attempt_state CHECK (
        state IN ('not_started', 'active', 'review', 'submitted', 'locked')
    )
);

CREATE TABLE IF NOT EXISTS assessment_question_responses (
    id VARCHAR(36) PRIMARY KEY,
    module_attempt_id VARCHAR(36) NOT NULL,
    exam_question_id VARCHAR(36) NOT NULL,
    response JSON,
    marked_for_review BOOLEAN NOT NULL DEFAULT FALSE,
    eliminated_options JSON NOT NULL,
    annotations JSON NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT uq_module_attempt_question UNIQUE (module_attempt_id, exam_question_id),
    FOREIGN KEY (module_attempt_id) REFERENCES assessment_module_attempts(id) ON DELETE CASCADE,
    FOREIGN KEY (exam_question_id) REFERENCES assessment_exam_questions(id)
);

SET @index_idx_assessment_response_module_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
    AND table_name = 'assessment_question_responses'
    AND index_name = 'idx_assessment_response_module'
);
SET @index_idx_assessment_response_module_sql := IF(
    @index_idx_assessment_response_module_exists = 0,
    'CREATE INDEX idx_assessment_response_module ON assessment_question_responses(module_attempt_id, updated_at DESC)',
    'SELECT 1'
);
PREPARE index_idx_assessment_response_module_stmt FROM @index_idx_assessment_response_module_sql;
EXECUTE index_idx_assessment_response_module_stmt;
DEALLOCATE PREPARE index_idx_assessment_response_module_stmt;

-- Same prod-shape guard: student_submissions.provider_key may pre-exist.
SET @student_submissions_provider_key_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_submissions'
      AND column_name = 'provider_key'
);
SET @student_submissions_provider_key_sql := IF(
    @student_submissions_provider_key_exists = 0,
    'ALTER TABLE student_submissions ADD COLUMN provider_key VARCHAR(32) NOT NULL DEFAULT \'ielts\' AFTER published_version_id',
    'SELECT 1'
);
PREPARE student_submissions_provider_key_stmt FROM @student_submissions_provider_key_sql;
EXECUTE student_submissions_provider_key_stmt;
DEALLOCATE PREPARE student_submissions_provider_key_stmt;

CREATE TABLE IF NOT EXISTS assessment_results (
    id VARCHAR(36) PRIMARY KEY,
    submission_id VARCHAR(36) NOT NULL,
    provider_key VARCHAR(32) NOT NULL,
    total_score INT,
    score_payload JSON NOT NULL,
    release_status VARCHAR(32) NOT NULL DEFAULT 'ready_to_release',
    released_at TIMESTAMP(6),
    released_by VARCHAR(255),
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    revision INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_assessment_result_submission UNIQUE (submission_id),
    FOREIGN KEY (submission_id) REFERENCES student_submissions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS assessment_section_results (
    id VARCHAR(36) PRIMARY KEY,
    assessment_result_id VARCHAR(36) NOT NULL,
    section_key VARCHAR(64) NOT NULL,
    route VARCHAR(32),
    raw_correct INT NOT NULL,
    operational_question_count INT NOT NULL,
    scaled_score INT,
    details JSON NOT NULL,
    CONSTRAINT uq_assessment_result_section UNIQUE (assessment_result_id, section_key),
    FOREIGN KEY (assessment_result_id) REFERENCES assessment_results(id) ON DELETE CASCADE
);

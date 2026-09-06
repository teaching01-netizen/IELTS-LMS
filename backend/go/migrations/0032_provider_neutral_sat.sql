ALTER TABLE exam_entities
    ADD COLUMN provider_key VARCHAR(32) NOT NULL DEFAULT 'ielts' AFTER title,
    ADD COLUMN provider_exam_type VARCHAR(64) NULL AFTER provider_key;

UPDATE exam_entities
SET provider_exam_type = exam_type
WHERE provider_key = 'ielts'
  AND provider_exam_type IS NULL;

CREATE INDEX idx_exam_entities_provider_status_updated
    ON exam_entities(provider_key, status, updated_at DESC);

CREATE TABLE assessment_sections (
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

CREATE INDEX idx_assessment_sections_version_order
    ON assessment_sections(exam_version_id, display_order);

CREATE TABLE assessment_modules (
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

CREATE INDEX idx_assessment_modules_section_order
    ON assessment_modules(section_id, display_order);

CREATE TABLE assessment_questions (
    id VARCHAR(36) PRIMARY KEY,
    provider_key VARCHAR(32) NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    archived_at TIMESTAMP(6) NULL
);

CREATE INDEX idx_assessment_questions_provider_updated
    ON assessment_questions(provider_key, updated_at DESC);

CREATE TABLE assessment_question_revisions (
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

CREATE INDEX idx_question_revision_question_state
    ON assessment_question_revisions(question_id, state);

CREATE TABLE assessment_exam_questions (
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

CREATE INDEX idx_exam_questions_module_order
    ON assessment_exam_questions(module_id, display_order);

CREATE TABLE assessment_routing_policies (
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

CREATE TABLE assessment_scoring_policies (
    id VARCHAR(36) PRIMARY KEY,
    exam_version_id VARCHAR(36) NOT NULL,
    policy_key VARCHAR(64) NOT NULL,
    policy_config JSON NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    CONSTRAINT uq_assessment_scoring_version UNIQUE (exam_version_id),
    FOREIGN KEY (exam_version_id) REFERENCES exam_versions(id) ON DELETE CASCADE
);

CREATE TABLE assessment_module_attempts (
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

CREATE TABLE assessment_question_responses (
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

CREATE INDEX idx_assessment_response_module
    ON assessment_question_responses(module_attempt_id, updated_at DESC);

ALTER TABLE student_submissions
    ADD COLUMN provider_key VARCHAR(32) NOT NULL DEFAULT 'ielts' AFTER published_version_id;

CREATE TABLE assessment_results (
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

CREATE TABLE assessment_section_results (
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

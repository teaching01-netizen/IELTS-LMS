
-- Cohort runtime section identifiers must be provider-neutral. Migration 0005
-- constrained this column to IELTS-only keys; SAT uses `reading-writing` and `math`.
ALTER TABLE exam_session_runtime_sections
    DROP CHECK exam_session_runtime_sections_chk_1;

ALTER TABLE assessment_sections
    ADD COLUMN revision INT NOT NULL DEFAULT 0 AFTER tool_policy;

ALTER TABLE assessment_modules
    ADD COLUMN revision INT NOT NULL DEFAULT 0 AFTER tool_policy;

ALTER TABLE assessment_module_attempts
    ADD COLUMN available_at TIMESTAMP(6) NULL AFTER allocated_seconds,
    ADD COLUMN paused_at TIMESTAMP(6) NULL AFTER started_at,
    ADD COLUMN accumulated_paused_seconds INT NOT NULL DEFAULT 0 AFTER paused_at,
    ADD COLUMN extension_seconds INT NOT NULL DEFAULT 0 AFTER accumulated_paused_seconds,
    ADD COLUMN completion_reason VARCHAR(64) NULL AFTER locked_at;

UPDATE assessment_module_attempts
SET available_at = COALESCE(available_at, started_at)
WHERE available_at IS NULL AND started_at IS NOT NULL;

CREATE INDEX idx_assessment_module_attempts_active
    ON assessment_module_attempts(attempt_id, state, available_at);
CREATE TABLE assessment_route_decisions (
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

CREATE INDEX idx_assessment_route_decisions_attempt
    ON assessment_route_decisions(attempt_id, created_at);

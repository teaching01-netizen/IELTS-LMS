-- 0075_sat_late_answer_evidence.sql
-- Answers a browser still held after their SAT module closed (the save reached
-- the server only after the close window). Evidence is stored for review and
-- NEVER applied to responses or scores (docs/sat-m1-m2-handoff-plan.md,
-- Phase 5, decision D3: no re-route). would_change_route records whether
-- the evidence would have selected the other adaptive branch.

CREATE TABLE IF NOT EXISTS assessment_late_answer_evidence (
    id VARCHAR(36) PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    module_attempt_id VARCHAR(36) NOT NULL,
    module_id VARCHAR(36) NOT NULL,
    question_id VARCHAR(255) NOT NULL,
    write_id VARCHAR(64) NOT NULL,
    response JSON NOT NULL,
    client_received_at TIMESTAMP(6) NULL,
    server_received_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    would_change_route BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_at TIMESTAMP(6) NULL,
    reviewed_by VARCHAR(255) NULL,
    CONSTRAINT uq_late_answer_evidence UNIQUE (module_attempt_id, question_id),
    CONSTRAINT fk_late_answer_evidence_attempt FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_late_answer_evidence_module_attempt FOREIGN KEY (module_attempt_id) REFERENCES assessment_module_attempts(id) ON DELETE CASCADE
);

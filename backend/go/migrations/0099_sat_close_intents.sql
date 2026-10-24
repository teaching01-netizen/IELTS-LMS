-- Register the complete immutable SAT answer frontier before recovery chunks
-- are admitted. This metadata contains identities and response hashes only.
CREATE TABLE IF NOT EXISTS assessment_module_close_intents (
    module_attempt_id VARCHAR(36) NOT NULL PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    registration_id VARCHAR(64) NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    manifest_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    manifest JSON NOT NULL,
    receipt JSON NOT NULL,
    registered_at TIMESTAMP(6) NOT NULL,
    CONSTRAINT fk_sat_close_intents_module_attempt
        FOREIGN KEY (module_attempt_id)
        REFERENCES assessment_module_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_close_intents_attempt
        FOREIGN KEY (attempt_id)
        REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT uq_sat_close_intents_attempt_registration
        UNIQUE (attempt_id, registration_id),
    INDEX idx_sat_close_intents_attempt (attempt_id, module_attempt_id)
);

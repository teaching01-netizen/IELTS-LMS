-- Preserve every late write. Unknown historical provenance stays NULL.
-- All guards are crash-retry safe. No answer/evidence row is deleted.

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'origin_lease_epoch');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN origin_lease_epoch BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'client_version');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN client_version BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'response_hash');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN response_hash CHAR(64) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'request_hash');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN request_hash CHAR(64) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'client_metadata');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN client_metadata JSON NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'provenance_conflict');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN provenance_conflict BOOLEAN NOT NULL DEFAULT FALSE', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'review_outcome');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN review_outcome VARCHAR(32) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'review_note');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN review_note TEXT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND column_name = 'evidence_seq');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE assessment_late_answer_evidence ADD COLUMN evidence_seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT, ADD UNIQUE KEY uq_late_evidence_seq (evidence_seq)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_idx := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND index_name = 'uq_late_evidence_attempt_write');
SET @ddl := IF(@exists_idx = 0, 'CREATE UNIQUE INDEX uq_late_evidence_attempt_write ON assessment_late_answer_evidence (attempt_id, write_id)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_idx := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND index_name = 'idx_late_evidence_module');
SET @ddl := IF(@exists_idx = 0, 'CREATE INDEX idx_late_evidence_module ON assessment_late_answer_evidence (module_attempt_id)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_idx := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND index_name = 'idx_late_evidence_cursor');
SET @ddl := IF(@exists_idx = 0, 'CREATE INDEX idx_late_evidence_cursor ON assessment_late_answer_evidence (attempt_id, evidence_seq)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;


-- A bounded derived frontier keeps review-risk computation proportional to the
-- pinned module question count, never to an unbounded evidence history.
CREATE TABLE IF NOT EXISTS assessment_late_evidence_frontiers (
 module_attempt_id VARCHAR(36) NOT NULL,
 question_id VARCHAR(255) NOT NULL,
 latest_evidence_id VARCHAR(36) NOT NULL,
 origin_lease_epoch BIGINT UNSIGNED NULL,
 client_version BIGINT UNSIGNED NULL,
 response_hash CHAR(64) NULL,
 unknown_response_hash CHAR(64) NULL,
 provenance_conflict BOOLEAN NOT NULL DEFAULT FALSE,
 would_change_route BOOLEAN NOT NULL DEFAULT FALSE,
 PRIMARY KEY (module_attempt_id, question_id),
 CONSTRAINT fk_late_frontier_module FOREIGN KEY (module_attempt_id) REFERENCES assessment_module_attempts(id) ON DELETE CASCADE,
 CONSTRAINT fk_late_frontier_evidence FOREIGN KEY (latest_evidence_id) REFERENCES assessment_late_answer_evidence(id) ON DELETE CASCADE
);

-- Before the old unique key is removed, each historical question has at most
-- one row. Seeding is non-destructive and never rewrites a live frontier.
INSERT INTO assessment_late_evidence_frontiers (module_attempt_id, question_id, latest_evidence_id, origin_lease_epoch, client_version, response_hash, provenance_conflict, would_change_route)
SELECT module_attempt_id, question_id, id, origin_lease_epoch, client_version, response_hash, provenance_conflict, would_change_route FROM assessment_late_answer_evidence
ON DUPLICATE KEY UPDATE latest_evidence_id = assessment_late_evidence_frontiers.latest_evidence_id;

-- Replace the lossy per-question uniqueness only after the immutable write
-- identity and FK-supporting module index exist. Colliding historical write
-- IDs stop migration for an explicit audit; none are silently discarded.
SET @exists_old := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'assessment_late_answer_evidence' AND constraint_name = 'uq_late_answer_evidence');
SET @ddl := IF(@exists_old > 0, 'ALTER TABLE assessment_late_answer_evidence DROP INDEX uq_late_answer_evidence', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS assessment_late_evidence_reviews (
 id VARCHAR(36) PRIMARY KEY,
 attempt_id VARCHAR(36) NOT NULL,
 evidence_id VARCHAR(36) NOT NULL,
 operation_id VARCHAR(64) NOT NULL,
 actor_id VARCHAR(255) NOT NULL,
 outcome VARCHAR(32) NOT NULL,
 note TEXT NOT NULL,
 reviewed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 CONSTRAINT uq_late_evidence_review_operation UNIQUE (evidence_id, operation_id),
 CONSTRAINT fk_late_review_attempt FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
 CONSTRAINT fk_late_review_evidence FOREIGN KEY (evidence_id) REFERENCES assessment_late_answer_evidence(id) ON DELETE CASCADE,
 CONSTRAINT chk_late_review_outcome CHECK (outcome IN ('acknowledged', 'investigated')),
 INDEX idx_late_review_attempt (attempt_id, reviewed_at, id)
);

-- Additive, retry-safe policy snapshots. Legacy rows retain their original TTL.
-- No FK to user_sessions: ordinary account expiry/retention must not delete an
-- active exam grant. Security revocation remains explicit and transactional.
SET @exam_policy_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attempt_sessions' AND column_name = 'credential_policy');
SET @exam_policy_sql := IF(@exam_policy_exists = 0, 'ALTER TABLE attempt_sessions ADD COLUMN credential_policy VARCHAR(32) NOT NULL DEFAULT ''legacy_v1''', 'SELECT 1');
PREPARE exam_policy_stmt FROM @exam_policy_sql;
EXECUTE exam_policy_stmt;
DEALLOCATE PREPARE exam_policy_stmt;

SET @exam_origin_exists := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attempt_sessions' AND column_name = 'account_session_id');
SET @exam_origin_sql := IF(@exam_origin_exists = 0, 'ALTER TABLE attempt_sessions ADD COLUMN account_session_id VARCHAR(36) NULL', 'SELECT 1');
PREPARE exam_origin_stmt FROM @exam_origin_sql;
EXECUTE exam_origin_stmt;
DEALLOCATE PREPARE exam_origin_stmt;

SET @exam_origin_index_exists := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'attempt_sessions' AND index_name = 'idx_attempt_sessions_account_session');
SET @exam_origin_index_sql := IF(@exam_origin_index_exists = 0, 'CREATE INDEX idx_attempt_sessions_account_session ON attempt_sessions (account_session_id)', 'SELECT 1');
PREPARE exam_origin_index_stmt FROM @exam_origin_index_sql;
EXECUTE exam_origin_index_stmt;
DEALLOCATE PREPARE exam_origin_index_stmt;

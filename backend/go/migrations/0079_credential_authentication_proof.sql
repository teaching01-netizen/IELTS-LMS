-- Authentication origin was not recorded by legacy public-email check-in.
-- Preserve all rows and leave unknown origin NULL: deployment requires fresh
-- account authentication or a previously established opaque practice capability.
-- Never infer authentication from an email, current role, or token timestamp.
SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'user_sessions' AND column_name = 'authentication_source');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE user_sessions ADD COLUMN authentication_source VARCHAR(16) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'user_sessions' AND column_name = 'practice_schedule_id');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE user_sessions ADD COLUMN practice_schedule_id VARCHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_fk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'user_sessions' AND constraint_name = 'fk_user_session_practice_schedule');
SET @ddl := IF(@exists_fk = 0, 'ALTER TABLE user_sessions ADD CONSTRAINT fk_user_session_practice_schedule FOREIGN KEY (practice_schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_check := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'user_sessions' AND constraint_name = 'chk_user_session_authentication_source');
SET @ddl := IF(@exists_check = 0, 'ALTER TABLE user_sessions ADD CONSTRAINT chk_user_session_authentication_source CHECK ((authentication_source IS NULL AND practice_schedule_id IS NULL) OR (authentication_source = ''account'' AND practice_schedule_id IS NULL) OR (authentication_source = ''practice'' AND practice_schedule_id IS NOT NULL AND role_snapshot = ''student''))', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attempt_sessions' AND column_name = 'organization_id');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE attempt_sessions ADD COLUMN organization_id VARCHAR(36) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attempt_sessions' AND column_name = 'lease_epoch');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE attempt_sessions ADD COLUMN lease_epoch BIGINT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @exists_col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'attempt_sessions' AND column_name = 'authority_version');
SET @ddl := IF(@exists_col = 0, 'ALTER TABLE attempt_sessions ADD COLUMN authority_version SMALLINT UNSIGNED NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

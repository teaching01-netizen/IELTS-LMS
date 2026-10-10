-- 0080_sat_access_code_start.sql
-- SAT access-code start: an admitted candidate enters a six-digit session
-- code and begins their own personal clock without a proctor Start.
--
-- - exam_schedules.sat_start_mode: 'proctor' (every existing row) or
--   'access_code'. Code mode requires provider SAT and sat_personal_v1.
-- - sat_session_start_codes: one AES-GCM encrypted code per schedule. No
--   plaintext, no hash; the associated data binds schedule id + generation.
-- - student_attempts.sat_start_code_required freezes the start mode at
--   admission; accepted_at/generation are written once, by the first-start
--   transaction that also activates the first module (both NULL or both set).
-- - sat_start_code_guards / sat_start_code_reservations bound six-digit
--   guessing per schedule generation independently of bearer/instance.
-- - attempt_terminalizations reason gains 'start_window_closed' for
--   candidates who never started before the window closed.

SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_schedules' AND column_name = 'sat_start_mode');
SET @ddl := IF(@col = 0, 'ALTER TABLE exam_schedules ADD COLUMN sat_start_mode VARCHAR(16) NOT NULL DEFAULT ''proctor'' AFTER sat_timing_model', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @chk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'exam_schedules' AND constraint_name = 'chk_exam_schedules_sat_start_mode');
SET @ddl := IF(@chk = 0, 'ALTER TABLE exam_schedules ADD CONSTRAINT chk_exam_schedules_sat_start_mode CHECK (sat_start_mode IN (''proctor'', ''access_code''))', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS sat_session_start_codes (
    schedule_id VARCHAR(36) NOT NULL,
    ciphertext VARBINARY(64) NOT NULL,
    nonce VARBINARY(32) NOT NULL,
    key_id VARCHAR(32) NOT NULL,
    generation INT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    rotated_at TIMESTAMP(6) NULL,
    updated_by VARCHAR(255) NULL,
    PRIMARY KEY (schedule_id),
    CONSTRAINT chk_sat_session_start_codes_generation CHECK (generation > 0),
    CONSTRAINT fk_sat_session_start_codes_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'student_attempts' AND column_name = 'sat_start_code_required');
SET @ddl := IF(@col = 0, 'ALTER TABLE student_attempts ADD COLUMN sat_start_code_required TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'student_attempts' AND column_name = 'sat_start_code_accepted_at');
SET @ddl := IF(@col = 0, 'ALTER TABLE student_attempts ADD COLUMN sat_start_code_accepted_at TIMESTAMP(6) NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'student_attempts' AND column_name = 'sat_start_code_generation');
SET @ddl := IF(@col = 0, 'ALTER TABLE student_attempts ADD COLUMN sat_start_code_generation INT NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @chk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'student_attempts' AND constraint_name = 'chk_student_attempts_sat_start_code_pair');
SET @ddl := IF(@chk = 0, 'ALTER TABLE student_attempts ADD CONSTRAINT chk_student_attempts_sat_start_code_pair CHECK ((sat_start_code_accepted_at IS NULL AND sat_start_code_generation IS NULL) OR (sat_start_code_accepted_at IS NOT NULL AND sat_start_code_generation IS NOT NULL AND sat_start_code_required = 1))', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- Unstarted-expiry scan: required, never accepted, still open.
SET @idx := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'student_attempts' AND index_name = 'idx_student_attempts_sat_start_code_pending');
SET @ddl := IF(@idx = 0, 'CREATE INDEX idx_student_attempts_sat_start_code_pending ON student_attempts(sat_start_code_required, sat_start_code_accepted_at, schedule_id)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @idx := (SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'exam_schedules' AND index_name = 'idx_exam_schedules_sat_start_mode_status_end');
SET @ddl := IF(@idx = 0, 'CREATE INDEX idx_exam_schedules_sat_start_mode_status_end ON exam_schedules(sat_start_mode, status, end_time)', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- One serialization row per (schedule, code generation). Reservations are
-- counted under this row's lock so the failure budget is exact.
CREATE TABLE IF NOT EXISTS sat_start_code_guards (
    schedule_id VARCHAR(36) NOT NULL,
    generation INT NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (schedule_id, generation),
    CONSTRAINT fk_sat_start_code_guards_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sat_start_code_reservations (
    id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    generation INT NOT NULL,
    attempt_id VARCHAR(36) NOT NULL,
    window_start TIMESTAMP(6) NOT NULL,
    lease_expires_at TIMESTAMP(6) NOT NULL,
    state VARCHAR(16) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    settled_at TIMESTAMP(6) NULL,
    PRIMARY KEY (id),
    CONSTRAINT chk_sat_start_code_reservations_state CHECK (state IN ('pending', 'failed', 'released')),
    KEY idx_sat_start_code_reservations_budget (schedule_id, generation, window_start, state),
    KEY idx_sat_start_code_reservations_attempt (attempt_id, state, lease_expires_at),
    KEY idx_sat_start_code_reservations_lease (state, lease_expires_at),
    CONSTRAINT fk_sat_start_code_reservations_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

-- Terminal reason vocabulary gains the never-started window closure.
SET @chk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'attempt_terminalizations' AND constraint_name = 'chk_attempt_terminalizations_reason');
SET @ddl := IF(@chk = 1, 'ALTER TABLE attempt_terminalizations DROP CHECK chk_attempt_terminalizations_reason', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

ALTER TABLE attempt_terminalizations ADD CONSTRAINT chk_attempt_terminalizations_reason CHECK (reason IN (
    'student_submit',
    'sat_complete',
    'time_expired',
    'auto_stop',
    'proctor_complete',
    'proctor_end',
    'proctor_force_submit',
    'proctor_terminate',
    'legacy_unknown',
    'start_window_closed'
));

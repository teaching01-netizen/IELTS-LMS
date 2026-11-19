-- SAT Classroom room retakes and optional answer keys for released PDFs.

CREATE TABLE IF NOT EXISTS sat_activity_policies (
    schedule_id VARCHAR(36) NOT NULL,
    policy_revision BIGINT NOT NULL DEFAULT 0,
    report_visible BOOLEAN NOT NULL DEFAULT FALSE,
    include_answer_key_in_pdf BOOLEAN NOT NULL DEFAULT FALSE,
    study_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    study_required_completions INT NOT NULL DEFAULT 1,
    study_reveal_answers BOOLEAN NOT NULL DEFAULT TRUE,
    study_untimed BOOLEAN NOT NULL DEFAULT TRUE,
    updated_by VARCHAR(36),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (schedule_id),
    CONSTRAINT fk_sat_activity_policy_schedule
        FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    CONSTRAINT chk_sat_activity_policy_revision CHECK (policy_revision >= 0),
    CONSTRAINT chk_sat_activity_policy_completions
        CHECK (study_required_completions >= 1 AND study_required_completions <= 2147483647),
    CONSTRAINT chk_sat_activity_policy_permissions
        CHECK (study_enabled = 0 OR study_reveal_answers = 1 OR study_untimed = 1),
    CONSTRAINT chk_sat_activity_policy_keys
        CHECK (include_answer_key_in_pdf = 0 OR report_visible = 1)
);


CREATE TABLE IF NOT EXISTS sat_attempt_learning (
    attempt_id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    published_version_id VARCHAR(36) NOT NULL,
    student_id VARCHAR(255) NOT NULL,
    ordinal INT NOT NULL,
    mode VARCHAR(8) NOT NULL,
    policy_revision BIGINT NOT NULL,
    reveal_answers BOOLEAN NOT NULL DEFAULT FALSE,
    untimed BOOLEAN NOT NULL DEFAULT FALSE,
    admitted_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (attempt_id),
    INDEX idx_sat_attempt_learning_scope (schedule_id, student_id, published_version_id, mode),
    CONSTRAINT fk_sat_attempt_learning_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_attempt_learning_schedule
        FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    CONSTRAINT chk_sat_attempt_learning_mode CHECK (mode IN ('test', 'study')),
    CONSTRAINT chk_sat_attempt_learning_ordinal CHECK (ordinal >= 1),
    CONSTRAINT chk_sat_attempt_learning_revision CHECK (policy_revision >= 0),
    CONSTRAINT chk_sat_attempt_learning_test_caps
        CHECK (mode = 'study' OR (reveal_answers = 0 AND untimed = 0))
);

-- Standard Practice retakes serialize on this row instead of creating a second
-- student identity. Classroom starts continue to lock
-- classroom_exam_students. The candidate key is server-owned, never a display
-- email or arbitrary request studentId.
CREATE TABLE IF NOT EXISTS sat_practice_students (
    schedule_id VARCHAR(36) NOT NULL,
    student_id VARCHAR(255) NOT NULL,
    latest_ordinal INT NOT NULL DEFAULT 0,
    active_attempt_id VARCHAR(36) NULL,
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    PRIMARY KEY (schedule_id, student_id),
    CONSTRAINT fk_sat_practice_student_schedule
        FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    CONSTRAINT chk_sat_practice_student_ordinal CHECK (latest_ordinal >= 0)
);

-- One accepted attempt per (schedule, student, operation key). The digest
-- includes intent, mode, and the observed ordinal, so the same key with a
-- changed mode is a conflict rather than a capability upgrade.
CREATE TABLE IF NOT EXISTS sat_practice_start_receipts (
    schedule_id VARCHAR(36) NOT NULL,
    student_id VARCHAR(255) NOT NULL,
    operation_key VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    request_digest CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    attempt_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (schedule_id, student_id, operation_key),
    CONSTRAINT fk_sat_practice_receipt_schedule
        FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_practice_receipt_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);


SET @sat_release_ddl = IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
        AND table_name = 'sat_activity_policies' AND column_name = 'unlimited_retakes'),
    'SELECT 1',
    'ALTER TABLE sat_activity_policies ADD COLUMN unlimited_retakes BOOLEAN NOT NULL DEFAULT FALSE'
);
PREPARE sat_release_stmt FROM @sat_release_ddl;
EXECUTE sat_release_stmt;
DEALLOCATE PREPARE sat_release_stmt;

SET @sat_release_ddl = IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
        AND table_name = 'sat_activity_policies' AND column_name = 'pause_on_leave'),
    'SELECT 1',
    'ALTER TABLE sat_activity_policies ADD COLUMN pause_on_leave BOOLEAN NOT NULL DEFAULT FALSE'
);
PREPARE sat_release_stmt FROM @sat_release_ddl;
EXECUTE sat_release_stmt;
DEALLOCATE PREPARE sat_release_stmt;

SET @sat_release_ddl = IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
        AND table_name = 'exam_entities' AND column_name = 'sat_learning_defaults'),
    'SELECT 1',
    'ALTER TABLE exam_entities ADD COLUMN sat_learning_defaults JSON NULL'
);
PREPARE sat_release_stmt FROM @sat_release_ddl;
EXECUTE sat_release_stmt;
DEALLOCATE PREPARE sat_release_stmt;

SET @sat_release_ddl = IF(
    EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema = DATABASE()
        AND table_name = 'student_attempts' AND column_name = 'sat_student_paused_at'),
    'SELECT 1',
    'ALTER TABLE student_attempts ADD COLUMN sat_student_paused_at TIMESTAMP(6) NULL'
);
PREPARE sat_release_stmt FROM @sat_release_ddl;
EXECUTE sat_release_stmt;
DEALLOCATE PREPARE sat_release_stmt;

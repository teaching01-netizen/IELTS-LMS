-- Pin the SAT delivery contract per schedule and persist each opted-in
-- module's entry, work, and recovery boundary. Existing schedules stay NULL
-- and keep their current delivery behavior.
SET @sat_delivery_policy_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_schedules'
      AND column_name = 'sat_delivery_policy'
);
SET @sat_delivery_policy_sql := IF(
    @sat_delivery_policy_exists = 0,
    'ALTER TABLE exam_schedules ADD COLUMN sat_delivery_policy JSON NULL AFTER sat_route_policy',
    'SELECT 1'
);
PREPARE sat_delivery_policy_stmt FROM @sat_delivery_policy_sql;
EXECUTE sat_delivery_policy_stmt;
DEALLOCATE PREPARE sat_delivery_policy_stmt;

CREATE TABLE IF NOT EXISTS assessment_module_boundaries (
    module_attempt_id VARCHAR(36) NOT NULL PRIMARY KEY,
    attempt_id VARCHAR(36) NOT NULL,
    phase VARCHAR(24) NOT NULL,
    policy_version VARCHAR(32) NOT NULL,
    work_deadline_at TIMESTAMP(6) NULL,
    entry_deadline_at TIMESTAMP(6) NULL,
    recovery_deadline_at TIMESTAMP(6) NULL,
    next_action_at TIMESTAMP(6) NULL,
    final_manifest JSON NULL,
    manifest_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
    resolution VARCHAR(32) NULL,
    resolved_by VARCHAR(255) NULL,
    resolved_at TIMESTAMP(6) NULL,
    revision BIGINT UNSIGNED NOT NULL DEFAULT 1,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
        ON UPDATE CURRENT_TIMESTAMP(6),
    CONSTRAINT fk_assessment_module_boundaries_module_attempt
        FOREIGN KEY (module_attempt_id)
        REFERENCES assessment_module_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_assessment_module_boundaries_attempt
        FOREIGN KEY (attempt_id)
        REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT chk_assessment_module_boundaries_phase
        CHECK (phase IN ('preparing', 'working', 'collecting', 'blocked', 'settled', 'ended')),
    CONSTRAINT chk_assessment_module_boundaries_resolution
        CHECK (resolution IS NULL OR resolution IN ('continue_confirmed', 'ended')),
    INDEX idx_assessment_module_boundaries_due (next_action_at, module_attempt_id),
    INDEX idx_assessment_module_boundaries_attempt (attempt_id, module_attempt_id)
);

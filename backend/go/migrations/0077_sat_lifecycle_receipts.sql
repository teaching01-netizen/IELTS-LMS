-- Stable response-loss recovery for SAT close and staff lifecycle operations.
CREATE TABLE IF NOT EXISTS assessment_lifecycle_receipts (
    scope_kind VARCHAR(16) NOT NULL,
    scope_id VARCHAR(36) NOT NULL,
    operation_id VARCHAR(64) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    attempt_id VARCHAR(36) NULL,
    operation_kind VARCHAR(40) NOT NULL,
    request_hash CHAR(64) NOT NULL,
    result JSON NOT NULL,
    committed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (scope_kind, scope_id, operation_id),
    INDEX idx_lifecycle_receipts_schedule (schedule_id, committed_at),
    CONSTRAINT fk_lifecycle_receipt_schedule FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE,
    CONSTRAINT fk_lifecycle_receipt_attempt FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
);

-- Keep each explicit recovery action independently replayable. A single
-- module may first recover an expired entry and later need a work-boundary
-- resolution, so receipts are append-only per operation rather than one slot
-- on the boundary row.
CREATE TABLE IF NOT EXISTS assessment_module_boundary_resolutions (
    module_attempt_id VARCHAR(36) NOT NULL,
    attempt_id VARCHAR(36) NOT NULL,
    resolution_id VARCHAR(64) NOT NULL,
    request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
    action VARCHAR(32) NOT NULL,
    actor_type VARCHAR(16) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    reason VARCHAR(500) NULL,
    receipt JSON NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (module_attempt_id, resolution_id),
    INDEX idx_sat_boundary_resolutions_attempt (attempt_id, module_attempt_id, created_at),
    CONSTRAINT fk_sat_boundary_resolutions_module_attempt
        FOREIGN KEY (module_attempt_id)
        REFERENCES assessment_module_attempts(id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_boundary_resolutions_attempt
        FOREIGN KEY (attempt_id)
        REFERENCES student_attempts(id) ON DELETE CASCADE,
    CONSTRAINT chk_sat_boundary_resolutions_action
        CHECK (action IN ('continue_confirmed', 'activate_entry')),
    CONSTRAINT chk_sat_boundary_resolutions_actor
        CHECK (actor_type IN ('student', 'staff'))
);

-- Preserve idempotency for resolutions recorded by the first recovery slice.
INSERT IGNORE INTO assessment_module_boundary_resolutions
    (module_attempt_id, attempt_id, resolution_id, request_hash, action,
     actor_type, actor_id, reason, receipt, created_at)
SELECT b.module_attempt_id, b.attempt_id, b.resolution_id, b.resolution_hash,
       JSON_UNQUOTE(JSON_EXTRACT(b.resolution_receipt, '$.action')),
       JSON_UNQUOTE(JSON_EXTRACT(b.resolution_receipt, '$.actorType')),
       b.resolved_by, b.resolution_reason, b.resolution_receipt,
       COALESCE(b.resolved_at, b.updated_at)
FROM assessment_module_boundaries b
WHERE b.resolution_id IS NOT NULL
  AND b.resolution_hash IS NOT NULL
  AND b.resolution_receipt IS NOT NULL
  AND JSON_UNQUOTE(JSON_EXTRACT(b.resolution_receipt, '$.action')) = 'continue_confirmed'
  AND JSON_UNQUOTE(JSON_EXTRACT(b.resolution_receipt, '$.actorType')) IN ('student', 'staff');

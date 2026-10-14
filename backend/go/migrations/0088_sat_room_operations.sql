-- 0088_sat_room_operations.sql
-- One-action SAT room creation (internal/satrooms). The receipt is written in
-- the SAME transaction as the release seal (when one is needed), the backing
-- schedule, the access link, and the roster, so a committed receipt is proof
-- that all of them exist and a lost response is recoverable by key alone.
-- Additive and re-runnable: CREATE TABLE IF NOT EXISTS. No FKs to the access
-- link/schedule/version rows: the receipt is audit evidence and must survive
-- a later room deletion (ON DELETE CASCADE would erase the replay target).

CREATE TABLE IF NOT EXISTS sat_room_operations (
    actor_id VARCHAR(255) NOT NULL,
    operation_key VARCHAR(128) NOT NULL,
    exam_id VARCHAR(36) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    access_link_id VARCHAR(36) NULL,
    schedule_id VARCHAR(36) NULL,
    version_id VARCHAR(36) NULL,
    version_number INT NULL,
    release_created TINYINT(1) NOT NULL DEFAULT 0,
    exam_revision INT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (actor_id, operation_key)
);

SET @index_idx_sat_room_operations_exam_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'sat_room_operations'
      AND index_name = 'idx_sat_room_operations_exam'
);
SET @index_idx_sat_room_operations_exam_sql := IF(
    @index_idx_sat_room_operations_exam_exists = 0,
    'CREATE INDEX idx_sat_room_operations_exam ON sat_room_operations(exam_id, created_at)',
    'SELECT 1'
);
PREPARE index_idx_sat_room_operations_exam_stmt FROM @index_idx_sat_room_operations_exam_sql;
EXECUTE index_idx_sat_room_operations_exam_stmt;
DEALLOCATE PREPARE index_idx_sat_room_operations_exam_stmt;

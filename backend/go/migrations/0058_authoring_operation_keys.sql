-- 0058_authoring_operation_keys.sql
-- Retry-safe authoring mutations: narrowly scoped (actor, scope, key)
-- idempotency ledger for create/duplicate/publish-class operations. Additive
-- and re-runnable: CREATE TABLE IF NOT EXISTS plus existence-guarded index.
-- Rows expire after 7 days; maintenance sweeps them with the existing
-- idempotency cleanup batch (extend jobs.go to cover this table).

CREATE TABLE IF NOT EXISTS authoring_operation_keys (
    actor_id VARCHAR(255) NOT NULL,
    scope VARCHAR(255) NOT NULL,
    operation_key VARCHAR(128) NOT NULL,
    request_hash VARCHAR(64) NOT NULL,
    result_json JSON NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    expires_at TIMESTAMP(6) NOT NULL,
    PRIMARY KEY (actor_id, scope, operation_key)
);

SET @index_idx_authoring_operation_keys_expires_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_operation_keys'
      AND index_name = 'idx_authoring_operation_keys_expires'
);
SET @index_idx_authoring_operation_keys_expires_sql := IF(
    @index_idx_authoring_operation_keys_expires_exists = 0,
    'CREATE INDEX idx_authoring_operation_keys_expires ON authoring_operation_keys(expires_at)',
    'SELECT 1'
);
PREPARE index_idx_authoring_operation_keys_expires_stmt FROM @index_idx_authoring_operation_keys_expires_sql;
EXECUTE index_idx_authoring_operation_keys_expires_stmt;
DEALLOCATE PREPARE index_idx_authoring_operation_keys_expires_stmt;

-- Persist an idempotent, auditable decision when a SAT recovery boundary has
-- expired. The receipt contains metadata only; answer payloads stay in the
-- existing response/evidence stores.
SET @sat_recovery_resolution_id_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'assessment_module_boundaries'
      AND column_name = 'resolution_id'
);
SET @sat_recovery_resolution_id_sql := IF(
    @sat_recovery_resolution_id_exists = 0,
    'ALTER TABLE assessment_module_boundaries ADD COLUMN resolution_id VARCHAR(64) NULL AFTER resolution',
    'SELECT 1'
);
PREPARE sat_recovery_resolution_id_stmt FROM @sat_recovery_resolution_id_sql;
EXECUTE sat_recovery_resolution_id_stmt;
DEALLOCATE PREPARE sat_recovery_resolution_id_stmt;

SET @sat_recovery_resolution_hash_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'assessment_module_boundaries'
      AND column_name = 'resolution_hash'
);
SET @sat_recovery_resolution_hash_sql := IF(
    @sat_recovery_resolution_hash_exists = 0,
    'ALTER TABLE assessment_module_boundaries ADD COLUMN resolution_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER resolution_id',
    'SELECT 1'
);
PREPARE sat_recovery_resolution_hash_stmt FROM @sat_recovery_resolution_hash_sql;
EXECUTE sat_recovery_resolution_hash_stmt;
DEALLOCATE PREPARE sat_recovery_resolution_hash_stmt;

SET @sat_recovery_resolution_reason_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'assessment_module_boundaries'
      AND column_name = 'resolution_reason'
);
SET @sat_recovery_resolution_reason_sql := IF(
    @sat_recovery_resolution_reason_exists = 0,
    'ALTER TABLE assessment_module_boundaries ADD COLUMN resolution_reason VARCHAR(500) NULL AFTER resolution_hash',
    'SELECT 1'
);
PREPARE sat_recovery_resolution_reason_stmt FROM @sat_recovery_resolution_reason_sql;
EXECUTE sat_recovery_resolution_reason_stmt;
DEALLOCATE PREPARE sat_recovery_resolution_reason_stmt;

SET @sat_recovery_resolution_receipt_exists := (
    SELECT COUNT(*) FROM information_schema.columns
    WHERE table_schema = DATABASE() AND table_name = 'assessment_module_boundaries'
      AND column_name = 'resolution_receipt'
);
SET @sat_recovery_resolution_receipt_sql := IF(
    @sat_recovery_resolution_receipt_exists = 0,
    'ALTER TABLE assessment_module_boundaries ADD COLUMN resolution_receipt JSON NULL AFTER resolution_reason',
    'SELECT 1'
);
PREPARE sat_recovery_resolution_receipt_stmt FROM @sat_recovery_resolution_receipt_sql;
EXECUTE sat_recovery_resolution_receipt_stmt;
DEALLOCATE PREPARE sat_recovery_resolution_receipt_stmt;

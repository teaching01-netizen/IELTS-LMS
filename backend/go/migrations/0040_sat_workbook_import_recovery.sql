CREATE TABLE IF NOT EXISTS sat_workbook_imports (
    id VARCHAR(36) PRIMARY KEY,
    exam_id VARCHAR(36) NOT NULL,
    expected_version_id VARCHAR(36) NOT NULL,
    expected_version_revision INT NOT NULL,
    checkpoint_version_id VARCHAR(36),
    imported_version_id VARCHAR(36),
    imported_version_revision INT,
    asset_manifest JSON NOT NULL,
    asset_ids JSON,
    state VARCHAR(32) NOT NULL CHECK (state IN ('previewed', 'committed', 'undone', 'expired')),
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    undone_at TIMESTAMP(6),
    expires_at TIMESTAMP(6) NOT NULL,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (checkpoint_version_id) REFERENCES exam_versions(id),
    FOREIGN KEY (imported_version_id) REFERENCES exam_versions(id)
);
SET @index_idx_sat_workbook_imports_exam_created_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'sat_workbook_imports'
      AND index_name = 'idx_sat_workbook_imports_exam_created'
);
SET @index_idx_sat_workbook_imports_exam_created_sql := IF(
    @index_idx_sat_workbook_imports_exam_created_exists = 0,
    'CREATE INDEX idx_sat_workbook_imports_exam_created ON sat_workbook_imports(exam_id, created_at DESC)',
    'SELECT 1'
);
PREPARE index_idx_sat_workbook_imports_exam_created_stmt FROM @index_idx_sat_workbook_imports_exam_created_sql;
EXECUTE index_idx_sat_workbook_imports_exam_created_stmt;
DEALLOCATE PREPARE index_idx_sat_workbook_imports_exam_created_stmt;
SET @index_idx_sat_workbook_imports_state_expires_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'sat_workbook_imports'
      AND index_name = 'idx_sat_workbook_imports_state_expires'
);
SET @index_idx_sat_workbook_imports_state_expires_sql := IF(
    @index_idx_sat_workbook_imports_state_expires_exists = 0,
    'CREATE INDEX idx_sat_workbook_imports_state_expires ON sat_workbook_imports(state, expires_at)',
    'SELECT 1'
);
PREPARE index_idx_sat_workbook_imports_state_expires_stmt FROM @index_idx_sat_workbook_imports_state_expires_sql;
EXECUTE index_idx_sat_workbook_imports_state_expires_stmt;
DEALLOCATE PREPARE index_idx_sat_workbook_imports_state_expires_stmt;

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
CREATE INDEX idx_sat_workbook_imports_exam_created ON sat_workbook_imports(exam_id, created_at DESC);
CREATE INDEX idx_sat_workbook_imports_state_expires ON sat_workbook_imports(state, expires_at);

-- Checked content and exam-lifetime retry receipts for single-module imports.
-- Full-workbook records and their legacy request contract remain unchanged.
CREATE TABLE IF NOT EXISTS sat_single_module_imports (
    import_id VARCHAR(36) NOT NULL PRIMARY KEY,
    exam_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    target_module_key VARCHAR(32) NOT NULL,
    content_digest VARCHAR(80) NOT NULL,
    pretest_resolution JSON NULL,
    operation_key VARCHAR(128) NULL,
    request_hash VARCHAR(64) NULL,
    result_json JSON NULL,
    UNIQUE KEY uq_sat_single_module_operation (actor_id, exam_id, operation_key),
    CONSTRAINT fk_sat_single_module_import FOREIGN KEY (import_id) REFERENCES sat_workbook_imports(id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_single_module_exam FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    CONSTRAINT chk_sat_single_module_target CHECK (target_module_key IN ('rw-m1', 'rw-m2-lower', 'rw-m2-higher', 'math-m1', 'math-m2-lower', 'math-m2-higher')),
    CONSTRAINT chk_sat_single_module_receipt CHECK (
        (operation_key IS NULL AND request_hash IS NULL AND result_json IS NULL AND pretest_resolution IS NULL)
        OR (operation_key IS NOT NULL AND request_hash IS NOT NULL AND result_json IS NOT NULL AND pretest_resolution IS NOT NULL)
    )
) ENGINE=InnoDB;

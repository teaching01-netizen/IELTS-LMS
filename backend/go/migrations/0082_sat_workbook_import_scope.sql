-- Module scope, checked-content digest and exam-lifetime retry receipt for SAT
-- workbook imports. An import replaces only the modules detected in the sheet.
CREATE TABLE IF NOT EXISTS sat_workbook_import_scopes (
    import_id VARCHAR(36) NOT NULL PRIMARY KEY,
    exam_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    -- Comma-joined module keys in template order (one or more modules).
    target_module_key VARCHAR(255) NOT NULL,
    content_digest VARCHAR(80) NOT NULL,
    operation_key VARCHAR(128) NULL,
    request_hash VARCHAR(64) NULL,
    result_json JSON NULL,
    UNIQUE KEY uq_sat_workbook_import_scope_operation (actor_id, exam_id, operation_key),
    CONSTRAINT fk_sat_workbook_import_scope_import FOREIGN KEY (import_id) REFERENCES sat_workbook_imports(id) ON DELETE CASCADE,
    CONSTRAINT fk_sat_workbook_import_scope_exam FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    CONSTRAINT chk_sat_workbook_import_scope_receipt CHECK (
        (operation_key IS NULL AND request_hash IS NULL AND result_json IS NULL)
        OR (operation_key IS NOT NULL AND request_hash IS NOT NULL AND result_json IS NOT NULL)
    )
) ENGINE=InnoDB;

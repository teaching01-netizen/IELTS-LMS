-- Persist the SAT section set that a published version may deliver.
-- NULL is reserved for pre-migration/legacy versions and means full SAT.

SET @sat_publish_scope_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_versions'
      AND column_name = 'sat_publish_scope'
);
SET @sat_publish_scope_sql := IF(
    @sat_publish_scope_exists = 0,
    "ALTER TABLE exam_versions ADD COLUMN sat_publish_scope ENUM('full', 'reading-writing', 'math') NULL AFTER publish_notes",
    'SELECT 1'
);
PREPARE sat_publish_scope_stmt FROM @sat_publish_scope_sql;
EXECUTE sat_publish_scope_stmt;
DEALLOCATE PREPARE sat_publish_scope_stmt;

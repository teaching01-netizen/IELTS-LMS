-- SAT exam library folders (0121): organization metadata stays out of the
-- authored entity revisions. Missing entry = root revision 0; after the first
-- move a row persists even when returned to root so revision history remains.
-- Guarded re-runnable: CREATE TABLE IF NOT EXISTS + guarded indexes.
-- Apply before any API binary that serves /v1/exam-library.

CREATE TABLE IF NOT EXISTS exam_library_scopes (
    scope_key VARCHAR(320) PRIMARY KEY,
    provider_key VARCHAR(32) NOT NULL,
    organization_id VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS exam_folders (
    id VARCHAR(36) PRIMARY KEY,
    scope_key VARCHAR(320) NOT NULL,
    provider_key VARCHAR(32) NOT NULL,
    organization_id VARCHAR(255) NULL,
    parent_id VARCHAR(36) NULL,
    name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
    parent_key VARCHAR(36) GENERATED ALWAYS AS (COALESCE(parent_id,'')) STORED,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0,
    CONSTRAINT fk_exam_folders_scope FOREIGN KEY (scope_key) REFERENCES exam_library_scopes(scope_key),
    CONSTRAINT fk_exam_folders_parent FOREIGN KEY (parent_id) REFERENCES exam_folders(id) ON DELETE RESTRICT,
    CONSTRAINT chk_exam_folders_name_len CHECK (CHAR_LENGTH(name) BETWEEN 1 AND 255)
);

CREATE TABLE IF NOT EXISTS exam_folder_entries (
    exam_id VARCHAR(36) PRIMARY KEY,
    folder_id VARCHAR(36) NULL,
    scope_key VARCHAR(320) NOT NULL,
    revision INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_exam_folder_entries_exam FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    CONSTRAINT fk_exam_folder_entries_folder FOREIGN KEY (folder_id) REFERENCES exam_folders(id) ON DELETE RESTRICT
);

-- Sibling uniqueness case-insensitive, NULL-root safe via generated parent key.
-- MySQL/TiDB compatible: unique on (scope_key, parent_key, name).
-- The name column carries an explicit utf8mb4_unicode_ci collation so the
-- storage guard stays case-insensitive even on _bin deployments; the
-- application also enforces LOWER(name) comparison in queries.

SET @uq_exam_folders_sibling_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_folders'
      AND index_name = 'uq_exam_folders_sibling'
);
SET @uq_exam_folders_sibling_sql := IF(
    @uq_exam_folders_sibling_exists = 0,
    'CREATE UNIQUE INDEX uq_exam_folders_sibling ON exam_folders(scope_key, parent_key, name)',
    'SELECT 1'
);
PREPARE uq_exam_folders_sibling_stmt FROM @uq_exam_folders_sibling_sql;
EXECUTE uq_exam_folders_sibling_stmt;
DEALLOCATE PREPARE uq_exam_folders_sibling_stmt;

SET @idx_exam_folders_scope_parent_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_folders'
      AND index_name = 'idx_exam_folders_scope_parent'
);
SET @idx_exam_folders_scope_parent_sql := IF(
    @idx_exam_folders_scope_parent_exists = 0,
    'CREATE INDEX idx_exam_folders_scope_parent ON exam_folders(scope_key, parent_key)',
    'SELECT 1'
);
PREPARE idx_exam_folders_scope_parent_stmt FROM @idx_exam_folders_scope_parent_sql;
EXECUTE idx_exam_folders_scope_parent_stmt;
DEALLOCATE PREPARE idx_exam_folders_scope_parent_stmt;

SET @idx_exam_folder_entries_scope_folder_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_folder_entries'
      AND index_name = 'idx_exam_folder_entries_scope_folder'
);
SET @idx_exam_folder_entries_scope_folder_sql := IF(
    @idx_exam_folder_entries_scope_folder_exists = 0,
    'CREATE INDEX idx_exam_folder_entries_scope_folder ON exam_folder_entries(scope_key, folder_id)',
    'SELECT 1'
);
PREPARE idx_exam_folder_entries_scope_folder_stmt FROM @idx_exam_folder_entries_scope_folder_sql;
EXECUTE idx_exam_folder_entries_scope_folder_stmt;
DEALLOCATE PREPARE idx_exam_folder_entries_scope_folder_stmt;

SET @idx_exam_folder_entries_folder_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'exam_folder_entries'
      AND index_name = 'idx_exam_folder_entries_folder'
);
SET @idx_exam_folder_entries_folder_sql := IF(
    @idx_exam_folder_entries_folder_exists = 0,
    'CREATE INDEX idx_exam_folder_entries_folder ON exam_folder_entries(folder_id)',
    'SELECT 1'
);
PREPARE idx_exam_folder_entries_folder_stmt FROM @idx_exam_folder_entries_folder_sql;
EXECUTE idx_exam_folder_entries_folder_stmt;
DEALLOCATE PREPARE idx_exam_folder_entries_folder_stmt;

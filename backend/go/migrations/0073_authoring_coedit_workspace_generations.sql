-- Preserve closed SAT workspace rows while allowing the same editable draft
-- to open a replacement collaboration room. Existing rooms start at generation
-- 1; each closed room is followed by a new monotonically increasing row.

SET @authoring_coedit_workspaces_generation_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND column_name = 'generation'
);
SET @authoring_coedit_workspaces_generation_sql := IF(
    @authoring_coedit_workspaces_generation_exists = 0,
    'ALTER TABLE authoring_coedit_workspaces ADD COLUMN generation INT UNSIGNED NOT NULL DEFAULT 1 AFTER draft_version_id',
    'SELECT 1'
);
PREPARE authoring_coedit_workspaces_generation_stmt FROM @authoring_coedit_workspaces_generation_sql;
EXECUTE authoring_coedit_workspaces_generation_stmt;
DEALLOCATE PREPARE authoring_coedit_workspaces_generation_stmt;

SET @authoring_coedit_workspace_scope_index_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND index_name = 'uq_authoring_coedit_workspace_scope'
);
SET @authoring_coedit_workspace_scope_index_sql := IF(
    @authoring_coedit_workspace_scope_index_exists > 0,
    'ALTER TABLE authoring_coedit_workspaces DROP INDEX uq_authoring_coedit_workspace_scope',
    'SELECT 1'
);
PREPARE authoring_coedit_workspace_scope_index_stmt FROM @authoring_coedit_workspace_scope_index_sql;
EXECUTE authoring_coedit_workspace_scope_index_stmt;
DEALLOCATE PREPARE authoring_coedit_workspace_scope_index_stmt;

SET @authoring_coedit_workspace_generation_index_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND index_name = 'uq_authoring_coedit_workspace_generation'
);
SET @authoring_coedit_workspace_generation_index_sql := IF(
    @authoring_coedit_workspace_generation_index_exists = 0,
    'CREATE UNIQUE INDEX uq_authoring_coedit_workspace_generation ON authoring_coedit_workspaces(draft_version_id, exam_id, schema_version, generation)',
    'SELECT 1'
);
PREPARE authoring_coedit_workspace_generation_index_stmt FROM @authoring_coedit_workspace_generation_index_sql;
EXECUTE authoring_coedit_workspace_generation_index_stmt;
DEALLOCATE PREPARE authoring_coedit_workspace_generation_index_stmt;

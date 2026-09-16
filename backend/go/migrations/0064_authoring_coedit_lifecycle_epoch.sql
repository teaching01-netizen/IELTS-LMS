-- 0064_authoring_coedit_lifecycle_epoch.sql
-- Phase 2 SAT authoring co-edit lifecycle/epoch foundation (2026-09-16).
--
-- These columns let the lifecycle owner fence freezes and let durable commits
-- expose a monotonic sequence without overloading the existing revision
-- fields. Existing rows receive the neutral epoch/sequence value zero; the
-- nullable freeze columns remain empty until an explicit freeze operation.
--
-- Additive and crash-retry safe: every ADD COLUMN and CREATE INDEX is guarded
-- through information_schema. There is intentionally no destructive down
-- migration and no data rewrite, so existing Yjs bytes and materialized
-- projections remain unchanged.

SET @authoring_coedit_documents_state_epoch_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND column_name = 'state_epoch'
);
SET @authoring_coedit_documents_state_epoch_sql := IF(
    @authoring_coedit_documents_state_epoch_exists = 0,
    'ALTER TABLE authoring_coedit_documents ADD COLUMN state_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE authoring_coedit_documents_state_epoch_stmt FROM @authoring_coedit_documents_state_epoch_sql;
EXECUTE authoring_coedit_documents_state_epoch_stmt;
DEALLOCATE PREPARE authoring_coedit_documents_state_epoch_stmt;

SET @authoring_coedit_documents_commit_sequence_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND column_name = 'commit_sequence'
);
SET @authoring_coedit_documents_commit_sequence_sql := IF(
    @authoring_coedit_documents_commit_sequence_exists = 0,
    'ALTER TABLE authoring_coedit_documents ADD COLUMN commit_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE authoring_coedit_documents_commit_sequence_stmt FROM @authoring_coedit_documents_commit_sequence_sql;
EXECUTE authoring_coedit_documents_commit_sequence_stmt;
DEALLOCATE PREPARE authoring_coedit_documents_commit_sequence_stmt;

SET @authoring_coedit_documents_freeze_operation_id_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND column_name = 'freeze_operation_id'
);
SET @authoring_coedit_documents_freeze_operation_id_sql := IF(
    @authoring_coedit_documents_freeze_operation_id_exists = 0,
    'ALTER TABLE authoring_coedit_documents ADD COLUMN freeze_operation_id CHAR(36) NULL',
    'SELECT 1'
);
PREPARE authoring_coedit_documents_freeze_operation_id_stmt FROM @authoring_coedit_documents_freeze_operation_id_sql;
EXECUTE authoring_coedit_documents_freeze_operation_id_stmt;
DEALLOCATE PREPARE authoring_coedit_documents_freeze_operation_id_stmt;

SET @authoring_coedit_documents_freeze_expires_at_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND column_name = 'freeze_expires_at'
);
SET @authoring_coedit_documents_freeze_expires_at_sql := IF(
    @authoring_coedit_documents_freeze_expires_at_exists = 0,
    'ALTER TABLE authoring_coedit_documents ADD COLUMN freeze_expires_at DATETIME(6) NULL',
    'SELECT 1'
);
PREPARE authoring_coedit_documents_freeze_expires_at_stmt FROM @authoring_coedit_documents_freeze_expires_at_sql;
EXECUTE authoring_coedit_documents_freeze_expires_at_stmt;
DEALLOCATE PREPARE authoring_coedit_documents_freeze_expires_at_stmt;

SET @authoring_coedit_workspaces_state_epoch_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND column_name = 'state_epoch'
);
SET @authoring_coedit_workspaces_state_epoch_sql := IF(
    @authoring_coedit_workspaces_state_epoch_exists = 0,
    'ALTER TABLE authoring_coedit_workspaces ADD COLUMN state_epoch BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE authoring_coedit_workspaces_state_epoch_stmt FROM @authoring_coedit_workspaces_state_epoch_sql;
EXECUTE authoring_coedit_workspaces_state_epoch_stmt;
DEALLOCATE PREPARE authoring_coedit_workspaces_state_epoch_stmt;

SET @authoring_coedit_workspaces_commit_sequence_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND column_name = 'commit_sequence'
);
SET @authoring_coedit_workspaces_commit_sequence_sql := IF(
    @authoring_coedit_workspaces_commit_sequence_exists = 0,
    'ALTER TABLE authoring_coedit_workspaces ADD COLUMN commit_sequence BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE authoring_coedit_workspaces_commit_sequence_stmt FROM @authoring_coedit_workspaces_commit_sequence_sql;
EXECUTE authoring_coedit_workspaces_commit_sequence_stmt;
DEALLOCATE PREPARE authoring_coedit_workspaces_commit_sequence_stmt;

SET @authoring_coedit_workspaces_freeze_operation_id_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND column_name = 'freeze_operation_id'
);
SET @authoring_coedit_workspaces_freeze_operation_id_sql := IF(
    @authoring_coedit_workspaces_freeze_operation_id_exists = 0,
    'ALTER TABLE authoring_coedit_workspaces ADD COLUMN freeze_operation_id CHAR(36) NULL',
    'SELECT 1'
);
PREPARE authoring_coedit_workspaces_freeze_operation_id_stmt FROM @authoring_coedit_workspaces_freeze_operation_id_sql;
EXECUTE authoring_coedit_workspaces_freeze_operation_id_stmt;
DEALLOCATE PREPARE authoring_coedit_workspaces_freeze_operation_id_stmt;

SET @authoring_coedit_workspaces_freeze_expires_at_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND column_name = 'freeze_expires_at'
);
SET @authoring_coedit_workspaces_freeze_expires_at_sql := IF(
    @authoring_coedit_workspaces_freeze_expires_at_exists = 0,
    'ALTER TABLE authoring_coedit_workspaces ADD COLUMN freeze_expires_at DATETIME(6) NULL',
    'SELECT 1'
);
PREPARE authoring_coedit_workspaces_freeze_expires_at_stmt FROM @authoring_coedit_workspaces_freeze_expires_at_sql;
EXECUTE authoring_coedit_workspaces_freeze_expires_at_stmt;
DEALLOCATE PREPARE authoring_coedit_workspaces_freeze_expires_at_stmt;

SET @authoring_coedit_documents_lifecycle_expiry_index_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND index_name = 'ix_authoring_coedit_lifecycle_expiry'
);
SET @authoring_coedit_documents_lifecycle_expiry_index_sql := IF(
    @authoring_coedit_documents_lifecycle_expiry_index_exists = 0,
    'CREATE INDEX ix_authoring_coedit_lifecycle_expiry ON authoring_coedit_documents(lifecycle_state, freeze_expires_at)',
    'SELECT 1'
);
PREPARE authoring_coedit_documents_lifecycle_expiry_index_stmt FROM @authoring_coedit_documents_lifecycle_expiry_index_sql;
EXECUTE authoring_coedit_documents_lifecycle_expiry_index_stmt;
DEALLOCATE PREPARE authoring_coedit_documents_lifecycle_expiry_index_stmt;

SET @authoring_coedit_workspaces_lifecycle_expiry_index_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND index_name = 'ix_authoring_coedit_workspace_lifecycle_expiry'
);
SET @authoring_coedit_workspaces_lifecycle_expiry_index_sql := IF(
    @authoring_coedit_workspaces_lifecycle_expiry_index_exists = 0,
    'CREATE INDEX ix_authoring_coedit_workspace_lifecycle_expiry ON authoring_coedit_workspaces(lifecycle_state, freeze_expires_at)',
    'SELECT 1'
);
PREPARE authoring_coedit_workspaces_lifecycle_expiry_index_stmt FROM @authoring_coedit_workspaces_lifecycle_expiry_index_sql;
EXECUTE authoring_coedit_workspaces_lifecycle_expiry_index_stmt;
DEALLOCATE PREPARE authoring_coedit_workspaces_lifecycle_expiry_index_stmt;

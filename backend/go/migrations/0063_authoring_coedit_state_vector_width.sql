-- 0063_authoring_coedit_state_vector_width.sql
-- Co-edit capacity (2026-09-16): widen state_vector to VARBINARY(8192).
--
-- Why: a Yjs state vector grows ~5-8 bytes per distinct writer/session that has
-- ever edited the room, so a long-lived room's vector eventually exceeded
-- VARBINARY(4096). Go rejects a vector beyond authoringcoedit.MaxStateVectorBytes
-- (413 coedit_oversized) rather than letting MySQL truncate or error, so the
-- room became permanently unsavable while its content was still small: the
-- vector is a client-id ledger, not content.
--
-- This migration only widens the column; the constant in
-- internal/authoringcoedit/identity.go carries the matching value and is the
-- single enforcement point. The service bounds the residue by compacting a
-- room's document on load once its vector passes 2 KiB (see
-- services/authoring-coedit/src/persistence.ts), which is why 8192 is headroom
-- rather than a target.
--
-- Additive and re-runnable: MODIFY COLUMN is a no-op when the column is already
-- at the target width, guarded on information_schema. No row is rewritten by
-- this file (a NULL/short-column widening is metadata-only in MySQL 8), no
-- index, key, or other column is touched.

SET @coedit_documents_vector_width := (
    SELECT COALESCE(MAX(CHARACTER_OCTET_LENGTH), 0)
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND column_name = 'state_vector'
);
SET @coedit_documents_vector_sql := IF(
    @coedit_documents_vector_width >= 8192,
    'SELECT 1',
    'ALTER TABLE authoring_coedit_documents MODIFY COLUMN state_vector VARBINARY(8192) NULL'
);
PREPARE coedit_documents_vector_stmt FROM @coedit_documents_vector_sql;
EXECUTE coedit_documents_vector_stmt;
DEALLOCATE PREPARE coedit_documents_vector_stmt;

SET @coedit_workspaces_vector_width := (
    SELECT COALESCE(MAX(CHARACTER_OCTET_LENGTH), 0)
    FROM information_schema.COLUMNS
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_workspaces'
      AND column_name = 'state_vector'
);
SET @coedit_workspaces_vector_sql := IF(
    @coedit_workspaces_vector_width >= 8192,
    'SELECT 1',
    'ALTER TABLE authoring_coedit_workspaces MODIFY COLUMN state_vector VARBINARY(8192) NULL'
);
PREPARE coedit_workspaces_vector_stmt FROM @coedit_workspaces_vector_sql;
EXECUTE coedit_workspaces_vector_stmt;
DEALLOCATE PREPARE coedit_workspaces_vector_stmt;

-- 0061_authoring_coedit_documents.sql
-- SAT authoring prompt co-editing (2026-09-13 design).
--
-- One row per (draft, exam question, schema version) collaborative prompt
-- document. The row binds an opaque document UUID to the domain coordinates
-- that authorized it, so room identity is never constructed from raw ids by a
-- browser (see public paths /api/v1/assessment-authoring/.../coedit-token).
--
-- Authority model:
--   ydoc_state      = Y.encodeStateAsUpdate(document), the durable CRDT history
--   state_vector    = Y.encodeStateVector(document)
--   state_hash      = SHA-256 over the state vector, the exact state a client
--                     may call "Saved"
--   materialized_revision + assessment_question_revisions.prompt holds the
--                     domain projection that existing reads/publish consume.
--
-- Binary state and the materialized prompt are written in the SAME MySQL
-- transaction as the question revision bump and the durable authoring event.
-- Additive and re-runnable: CREATE TABLE IF NOT EXISTS plus existence-guarded
-- indexes. No existing table or column is modified by this migration.

CREATE TABLE IF NOT EXISTS authoring_coedit_documents (
    id CHAR(36) NOT NULL PRIMARY KEY,
    organization_id CHAR(36) NULL,
    exam_id CHAR(36) NOT NULL,
    draft_version_id CHAR(36) NOT NULL,
    exam_question_id CHAR(36) NOT NULL,
    question_revision_id CHAR(36) NOT NULL,
    schema_version SMALLINT UNSIGNED NOT NULL,
    field_set VARCHAR(32) NOT NULL,
    lifecycle_state VARCHAR(16) NOT NULL,
    seed_revision INT NOT NULL,
    materialized_revision INT NOT NULL,
    ydoc_state LONGBLOB NULL,
    state_vector VARBINARY(4096) NULL,
    state_hash BINARY(32) NULL,
    previous_state_hash BINARY(32) NULL,
    last_actor_id CHAR(36) NULL,
    closed_reason VARCHAR(32) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    closed_at DATETIME(6) NULL,
    UNIQUE KEY uq_authoring_coedit_scope
        (draft_version_id, exam_question_id, schema_version),
    KEY ix_authoring_coedit_exam_draft (exam_id, draft_version_id),
    KEY ix_authoring_coedit_updated (lifecycle_state, updated_at)
);

SET @index_uq_authoring_coedit_scope_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND index_name = 'uq_authoring_coedit_scope'
);
SET @index_uq_authoring_coedit_scope_sql := IF(
    @index_uq_authoring_coedit_scope_exists = 0,
    'CREATE UNIQUE INDEX uq_authoring_coedit_scope ON authoring_coedit_documents(draft_version_id, exam_question_id, schema_version)',
    'SELECT 1'
);
PREPARE index_uq_authoring_coedit_scope_stmt FROM @index_uq_authoring_coedit_scope_sql;
EXECUTE index_uq_authoring_coedit_scope_stmt;
DEALLOCATE PREPARE index_uq_authoring_coedit_scope_stmt;

SET @index_ix_authoring_coedit_exam_draft_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND index_name = 'ix_authoring_coedit_exam_draft'
);
SET @index_ix_authoring_coedit_exam_draft_sql := IF(
    @index_ix_authoring_coedit_exam_draft_exists = 0,
    'CREATE INDEX ix_authoring_coedit_exam_draft ON authoring_coedit_documents(exam_id, draft_version_id)',
    'SELECT 1'
);
PREPARE index_ix_authoring_coedit_exam_draft_stmt FROM @index_ix_authoring_coedit_exam_draft_sql;
EXECUTE index_ix_authoring_coedit_exam_draft_stmt;
DEALLOCATE PREPARE index_ix_authoring_coedit_exam_draft_stmt;

SET @index_ix_authoring_coedit_updated_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'authoring_coedit_documents'
      AND index_name = 'ix_authoring_coedit_updated'
);
SET @index_ix_authoring_coedit_updated_sql := IF(
    @index_ix_authoring_coedit_updated_exists = 0,
    'CREATE INDEX ix_authoring_coedit_updated ON authoring_coedit_documents(lifecycle_state, updated_at)',
    'SELECT 1'
);
PREPARE index_ix_authoring_coedit_updated_stmt FROM @index_ix_authoring_coedit_updated_sql;
EXECUTE index_ix_authoring_coedit_updated_stmt;
DEALLOCATE PREPARE index_ix_authoring_coedit_updated_stmt;

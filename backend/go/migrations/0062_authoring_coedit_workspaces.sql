-- SAT authoring exam-level co-edit workspace (2026-09-14).
--
-- This is additive. v1 question prompt documents remain in
-- authoring_coedit_documents while v2 binds one room to the current draft of
-- an exam. The JSON projection is a recovery/materialization boundary for the
-- browser workspace; authoritative question/release/access writes still use
-- their existing revision-fenced commands.
CREATE TABLE IF NOT EXISTS authoring_coedit_workspaces (
    id CHAR(36) NOT NULL PRIMARY KEY,
    organization_id CHAR(36) NULL,
    exam_id CHAR(36) NOT NULL,
    draft_version_id CHAR(36) NOT NULL,
    schema_version SMALLINT UNSIGNED NOT NULL,
    field_set VARCHAR(32) NOT NULL,
    lifecycle_state VARCHAR(16) NOT NULL,
    ydoc_state LONGBLOB NULL,
    state_vector VARBINARY(4096) NULL,
    state_hash BINARY(32) NULL,
    previous_state_hash BINARY(32) NULL,
    workspace_json MEDIUMTEXT NULL,
    materialized_revision INT NOT NULL DEFAULT 0,
    last_actor_id CHAR(36) NULL,
    closed_reason VARCHAR(32) NULL,
    created_at DATETIME(6) NOT NULL,
    updated_at DATETIME(6) NOT NULL,
    closed_at DATETIME(6) NULL,
    UNIQUE KEY uq_authoring_coedit_workspace_scope
        (draft_version_id, exam_id, schema_version),
    KEY ix_authoring_coedit_workspace_exam_draft (exam_id, draft_version_id),
    KEY ix_authoring_coedit_workspace_updated (lifecycle_state, updated_at)
);

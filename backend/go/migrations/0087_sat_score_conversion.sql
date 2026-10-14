-- 0087_sat_score_conversion.sql
-- Global SAT score conversion (docs/scoreconverimplement.md).
--
-- One global, versioned conversion policy replaces the per-exam-version
-- converter as the source of displayed estimated scores. Additive only: no
-- existing table, column, or row is changed, so the migration is safe to apply
-- before any binary that reads it and a binary that predates it ignores it.
--
--   sat_score_conversion_revisions  whole-snapshot policy (Reading & Writing +
--                                   Math). A draft is editable; a published
--                                   revision is immutable and checksummed.
--   sat_score_conversion_active     singleton pointer to the active revision.
--   sat_score_conversion_audit      append-only audit of drafts/publishes.
--
-- Immutability is enforced in the application (every UPDATE is guarded by
-- status = 'draft') and, on MySQL, by the triggers below. On TiDB the migrator
-- skips trigger statements (see 0056); the application guards remain.
-- Each CREATE TRIGGER is a single statement (the migration splitter does not
-- parse BEGIN..END); a sentinel value rejected by a CHECK constraint is used
-- for the conditional case, as in 0084/0086.

CREATE TABLE IF NOT EXISTS sat_score_conversion_revisions (
    id VARCHAR(36) NOT NULL,
    revision_number INT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'draft',
    base_revision_id VARCHAR(36) NULL,
    content JSON NOT NULL,
    content_sha256 CHAR(64) NULL,
    calibration_source VARCHAR(500) NOT NULL DEFAULT '',
    note VARCHAR(1000) NOT NULL DEFAULT '',
    restored_from_id VARCHAR(36) NULL,
    version INT NOT NULL DEFAULT 1,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    published_at TIMESTAMP(6) NULL,
    published_by VARCHAR(255) NULL,
    PRIMARY KEY (id),
    UNIQUE KEY uq_sat_score_conversion_revision_number (revision_number),
    KEY idx_sat_score_conversion_revisions_status (status, created_at),
    CONSTRAINT chk_sat_score_conversion_revision_status CHECK (status IN ('draft', 'published')),
    CONSTRAINT chk_sat_score_conversion_revision_published CHECK (
        (status = 'draft' AND revision_number IS NULL AND content_sha256 IS NULL AND published_at IS NULL)
        OR (status = 'published' AND revision_number IS NOT NULL AND revision_number > 0 AND content_sha256 IS NOT NULL AND published_at IS NOT NULL)
    ),
    CONSTRAINT fk_sat_score_conversion_revision_base FOREIGN KEY (base_revision_id) REFERENCES sat_score_conversion_revisions(id),
    CONSTRAINT fk_sat_score_conversion_revision_restored FOREIGN KEY (restored_from_id) REFERENCES sat_score_conversion_revisions(id)
);

CREATE TABLE IF NOT EXISTS sat_score_conversion_active (
    id TINYINT NOT NULL,
    revision_id VARCHAR(36) NULL,
    activated_at TIMESTAMP(6) NULL,
    activated_by VARCHAR(255) NULL,
    PRIMARY KEY (id),
    CONSTRAINT chk_sat_score_conversion_active_singleton CHECK (id = 1),
    CONSTRAINT fk_sat_score_conversion_active_revision FOREIGN KEY (revision_id) REFERENCES sat_score_conversion_revisions(id)
);

INSERT IGNORE INTO sat_score_conversion_active (id, revision_id) VALUES (1, NULL);

CREATE TABLE IF NOT EXISTS sat_score_conversion_audit (
    id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    action VARCHAR(32) NOT NULL,
    revision_id VARCHAR(36) NULL,
    from_revision_id VARCHAR(36) NULL,
    request_id VARCHAR(128) NOT NULL DEFAULT '',
    detail JSON NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (id),
    KEY idx_sat_score_conversion_audit_revision (revision_id, created_at),
    KEY idx_sat_score_conversion_audit_created (created_at)
);

DROP TRIGGER IF EXISTS sat_score_conversion_revisions_immutable_update;
DROP TRIGGER IF EXISTS sat_score_conversion_revisions_immutable_delete;
DROP TRIGGER IF EXISTS sat_score_conversion_audit_immutable_update;
DROP TRIGGER IF EXISTS sat_score_conversion_audit_immutable_delete;

CREATE TRIGGER sat_score_conversion_revisions_immutable_update
BEFORE UPDATE ON sat_score_conversion_revisions
FOR EACH ROW
SET NEW.status = IF(OLD.status = 'published', 'published_is_immutable', NEW.status);

CREATE TRIGGER sat_score_conversion_revisions_immutable_delete
BEFORE DELETE ON sat_score_conversion_revisions
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sat_score_conversion_revisions is append-only';

CREATE TRIGGER sat_score_conversion_audit_immutable_update
BEFORE UPDATE ON sat_score_conversion_audit
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sat_score_conversion_audit is append-only';

CREATE TRIGGER sat_score_conversion_audit_immutable_delete
BEFORE DELETE ON sat_score_conversion_audit
FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'sat_score_conversion_audit is append-only';

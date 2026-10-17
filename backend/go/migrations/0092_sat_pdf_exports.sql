-- Private, short-lived native SAT downloads. Superseded artifacts retain a
-- cleanup record; only the current export owns its non-NULL scope key.
CREATE TABLE IF NOT EXISTS sat_pdf_exports (
 id CHAR(32) NOT NULL PRIMARY KEY,
 scope_key CHAR(64) NULL,
 owner_kind VARCHAR(16) NOT NULL,
 owner_id VARCHAR(255) NOT NULL,
 attempt_id VARCHAR(36) NOT NULL,
 browser_hash CHAR(64) NOT NULL,
 binding JSON NOT NULL,
 state VARCHAR(16) NOT NULL,
 object_key VARCHAR(255) NOT NULL,
 filename VARCHAR(500) NOT NULL DEFAULT '',
 size_bytes BIGINT NOT NULL DEFAULT 0,
 expires_at DATETIME(6) NOT NULL,
 created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
 UNIQUE KEY uq_sat_pdf_export_scope (scope_key),
 KEY idx_sat_pdf_export_expiry (expires_at),
 CONSTRAINT chk_sat_pdf_export_state CHECK (state IN ('preparing','ready'))
);

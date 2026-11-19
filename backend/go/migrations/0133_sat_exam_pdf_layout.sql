CREATE TABLE IF NOT EXISTS sat_exam_pdf_layouts (
    exam_id VARCHAR(36) PRIMARY KEY,
    revision BIGINT UNSIGNED NOT NULL,
    layout JSON NOT NULL,
    updated_by VARCHAR(36) NOT NULL,
    updated_at DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sat_exam_pdf_assets (
    id VARCHAR(36) PRIMARY KEY,
    exam_id VARCHAR(36),
    purpose VARCHAR(8) NOT NULL,
    object_key VARCHAR(128) NOT NULL UNIQUE,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(32) NOT NULL,
    byte_count INT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    state VARCHAR(8) NOT NULL,
    expires_at DATETIME(6),
    INDEX idx_sat_pdf_asset_exam (exam_id, expires_at),
    INDEX idx_sat_pdf_asset_expiry (expires_at, id),
    CHECK (purpose IN ('slide','logo')),
    CHECK (state IN ('pending','ready','deleting')),
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE SET NULL
);

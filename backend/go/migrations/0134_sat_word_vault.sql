CREATE TABLE IF NOT EXISTS sat_word_vaults (
    exam_version_id VARCHAR(36) PRIMARY KEY,
    entries JSON NOT NULL,
    FOREIGN KEY (exam_version_id) REFERENCES exam_versions(id) ON DELETE CASCADE
);

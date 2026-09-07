CREATE TABLE IF NOT EXISTS assessment_access_links (
    id VARCHAR(36) PRIMARY KEY,
    exam_id VARCHAR(36) NOT NULL,
    published_version_id VARCHAR(36) NOT NULL,
    schedule_id VARCHAR(36) NOT NULL,
    name VARCHAR(160) NOT NULL,
    audience_type VARCHAR(32) NOT NULL CHECK (audience_type IN ('anyone', 'cohort', 'selected_students')),
    audience_label VARCHAR(255),
    access_mode VARCHAR(32) NOT NULL CHECK (access_mode IN ('student_code', 'open')),
    availability_type VARCHAR(32) NOT NULL CHECK (availability_type IN ('scheduled', 'anytime')),
    opens_at TIMESTAMP NULL,
    closes_at TIMESTAMP NULL,
    lifecycle_state VARCHAR(32) NOT NULL DEFAULT 'active' CHECK (lifecycle_state IN ('active', 'paused', 'revoked')),
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
    revision INT NOT NULL DEFAULT 0,
    CONSTRAINT assessment_access_links_schedule_unique UNIQUE (schedule_id),
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (published_version_id) REFERENCES exam_versions(id),
    FOREIGN KEY (schedule_id) REFERENCES exam_schedules(id) ON DELETE CASCADE
);

SET @index_idx_assessment_access_links_exam_updated_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_access_links'
      AND index_name = 'idx_assessment_access_links_exam_updated'
);
SET @index_idx_assessment_access_links_exam_updated_sql := IF(
    @index_idx_assessment_access_links_exam_updated_exists = 0,
    'CREATE INDEX idx_assessment_access_links_exam_updated ON assessment_access_links(exam_id, updated_at DESC, id)',
    'SELECT 1'
);
PREPARE index_idx_assessment_access_links_exam_updated_stmt FROM @index_idx_assessment_access_links_exam_updated_sql;
EXECUTE index_idx_assessment_access_links_exam_updated_stmt;
DEALLOCATE PREPARE index_idx_assessment_access_links_exam_updated_stmt;
SET @index_idx_assessment_access_links_version_updated_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_access_links'
      AND index_name = 'idx_assessment_access_links_version_updated'
);
SET @index_idx_assessment_access_links_version_updated_sql := IF(
    @index_idx_assessment_access_links_version_updated_exists = 0,
    'CREATE INDEX idx_assessment_access_links_version_updated ON assessment_access_links(published_version_id, updated_at DESC)',
    'SELECT 1'
);
PREPARE index_idx_assessment_access_links_version_updated_stmt FROM @index_idx_assessment_access_links_version_updated_sql;
EXECUTE index_idx_assessment_access_links_version_updated_stmt;
DEALLOCATE PREPARE index_idx_assessment_access_links_version_updated_stmt;
SET @index_idx_assessment_access_links_lifecycle_window_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_access_links'
      AND index_name = 'idx_assessment_access_links_lifecycle_window'
);
SET @index_idx_assessment_access_links_lifecycle_window_sql := IF(
    @index_idx_assessment_access_links_lifecycle_window_exists = 0,
    'CREATE INDEX idx_assessment_access_links_lifecycle_window ON assessment_access_links(lifecycle_state, opens_at, closes_at)',
    'SELECT 1'
);
PREPARE index_idx_assessment_access_links_lifecycle_window_stmt FROM @index_idx_assessment_access_links_lifecycle_window_sql;
EXECUTE index_idx_assessment_access_links_lifecycle_window_stmt;
DEALLOCATE PREPARE index_idx_assessment_access_links_lifecycle_window_stmt;

CREATE TABLE IF NOT EXISTS assessment_access_link_members (
    link_id VARCHAR(36) NOT NULL,
    student_code VARCHAR(512) NOT NULL,
    student_name VARCHAR(255),
    student_email VARCHAR(320),
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    PRIMARY KEY (link_id, student_code),
    FOREIGN KEY (link_id) REFERENCES assessment_access_links(id) ON DELETE CASCADE
);

SET @index_idx_assessment_access_link_members_email_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_access_link_members'
      AND index_name = 'idx_assessment_access_link_members_email'
);
SET @index_idx_assessment_access_link_members_email_sql := IF(
    @index_idx_assessment_access_link_members_email_exists = 0,
    'CREATE INDEX idx_assessment_access_link_members_email ON assessment_access_link_members(link_id, student_email)',
    'SELECT 1'
);
PREPARE index_idx_assessment_access_link_members_email_stmt FROM @index_idx_assessment_access_link_members_email_sql;
EXECUTE index_idx_assessment_access_link_members_email_stmt;
DEALLOCATE PREPARE index_idx_assessment_access_link_members_email_stmt;

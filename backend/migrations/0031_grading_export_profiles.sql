-- Shared, organization-scoped grading export profiles.
-- The JSON snapshot stores export rules; resolved students and paths remain run-specific.

CREATE TABLE IF NOT EXISTS grading_export_profiles (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(255),
    profile_name VARCHAR(255) NOT NULL,
    config_snapshot JSON NOT NULL,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0
);

CREATE INDEX idx_grading_export_profiles_org_updated
    ON grading_export_profiles(organization_id, updated_at DESC);

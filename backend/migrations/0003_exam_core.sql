-- Exam core tables: exam_entities, exam_memberships, exam_versions, exam_events

-- Drop tables to recreate with VARCHAR instead of CHAR for UUID columns
DROP TABLE IF EXISTS exam_events;
DROP TABLE IF EXISTS exam_versions;
DROP TABLE IF EXISTS exam_memberships;
DROP TABLE IF EXISTS exam_entities;

-- exam_entities
CREATE TABLE IF NOT EXISTS exam_entities (
    id VARCHAR(36) PRIMARY KEY,
    slug VARCHAR(255) UNIQUE NOT NULL,
    title VARCHAR(255) NOT NULL,
    exam_type VARCHAR(50) NOT NULL CHECK (exam_type IN ('Academic', 'General Training')),
    status VARCHAR(50) NOT NULL CHECK (status IN ('draft', 'in_review', 'approved', 'rejected', 'scheduled', 'published', 'archived', 'unpublished')),
    visibility VARCHAR(50) NOT NULL CHECK (visibility IN ('private', 'organization', 'public')),
    organization_id VARCHAR(255),
    owner_id VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    published_at TIMESTAMP,
    archived_at TIMESTAMP,
    current_draft_version_id VARCHAR(36),
    current_published_version_id VARCHAR(36),
    total_questions INT,
    total_reading_questions INT,
    total_listening_questions INT,
    schema_version INT NOT NULL DEFAULT 1,
    revision INT NOT NULL DEFAULT 0
);

-- Indexes for exam_entities
CREATE UNIQUE INDEX idx_exam_entities_slug ON exam_entities(slug);
CREATE INDEX IF NOT EXISTS idx_exam_entities_org_status_updated ON exam_entities(organization_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_entities_owner_updated ON exam_entities(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_entities_draft_version ON exam_entities(current_draft_version_id);

-- exam_memberships
CREATE TABLE IF NOT EXISTS exam_memberships (
    id VARCHAR(36) PRIMARY KEY,
    exam_id VARCHAR(36) NOT NULL,
    actor_id VARCHAR(255) NOT NULL,
    role VARCHAR(50) NOT NULL CHECK (role IN ('owner', 'reviewer', 'grader')),
    granted_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE
);

-- Constraints and indexes for exam_memberships
CREATE UNIQUE INDEX idx_exam_memberships_exam_actor_role_active 
    ON exam_memberships(exam_id, actor_id, role);
CREATE INDEX IF NOT EXISTS idx_exam_memberships_actor_role_created 
    ON exam_memberships(actor_id, role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_memberships_revoked_at ON exam_memberships(revoked_at);

-- exam_versions
CREATE TABLE IF NOT EXISTS exam_versions (
    id VARCHAR(36) PRIMARY KEY,
    exam_id VARCHAR(36) NOT NULL,
    version_number INT NOT NULL,
    parent_version_id VARCHAR(36),
    content_snapshot JSON NOT NULL,
    config_snapshot JSON NOT NULL,
    validation_snapshot JSON,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    publish_notes TEXT,
    is_draft BOOLEAN NOT NULL DEFAULT FALSE,
    is_published BOOLEAN NOT NULL DEFAULT FALSE,
    revision INT NOT NULL DEFAULT 0,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_version_id) REFERENCES exam_versions(id),
    CONSTRAINT exam_versions_exam_version_number UNIQUE (exam_id, version_number)
);

-- Indexes for exam_versions
CREATE INDEX IF NOT EXISTS idx_exam_versions_exam_created ON exam_versions(exam_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_versions_exam_draft ON exam_versions(exam_id, is_draft);
CREATE INDEX IF NOT EXISTS idx_exam_versions_exam_published ON exam_versions(exam_id, is_published);
CREATE INDEX IF NOT EXISTS idx_exam_versions_parent ON exam_versions(parent_version_id);

-- exam_events (append-only)
CREATE TABLE IF NOT EXISTS exam_events (
    id VARCHAR(36) PRIMARY KEY,
    exam_id VARCHAR(36) NOT NULL,
    version_id VARCHAR(36),
    actor_id VARCHAR(255) NOT NULL,
    action VARCHAR(50) NOT NULL CHECK (action IN (
        'created', 'draft_saved', 'submitted_for_review', 'approved', 'rejected', 
        'published', 'unpublished', 'scheduled', 'archived', 'restored', 
        'cloned', 'version_created', 'version_restored', 'permissions_updated'
    )),
    from_state VARCHAR(50),
    to_state VARCHAR(50),
    payload JSON,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (exam_id) REFERENCES exam_entities(id) ON DELETE CASCADE,
    FOREIGN KEY (version_id) REFERENCES exam_versions(id)
);

-- Indexes for exam_events
CREATE INDEX IF NOT EXISTS idx_exam_events_exam_created ON exam_events(exam_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_exam_events_exam_action_created ON exam_events(exam_id, action, created_at DESC);

-- Note: RLS policies removed - authorization is now handled at the application level

-- Library and defaults tables: admin_default_profiles, passage_library_items, question_bank_items

-- admin_default_profiles
CREATE TABLE IF NOT EXISTS admin_default_profiles (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(255),
    profile_name VARCHAR(255) NOT NULL,
    config_snapshot JSON NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0
);

-- Constraints and indexes for admin_default_profiles
CREATE INDEX IF NOT EXISTS idx_admin_default_profiles_org_active 
    ON admin_default_profiles(organization_id, is_active);
CREATE INDEX IF NOT EXISTS idx_admin_default_profiles_org_updated ON admin_default_profiles(organization_id, updated_at DESC);

-- passage_library_items
CREATE TABLE IF NOT EXISTS passage_library_items (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(255),
    title VARCHAR(255) NOT NULL,
    passage_snapshot JSON NOT NULL,
    difficulty VARCHAR(50) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    topic VARCHAR(255) NOT NULL,
    tags JSON NOT NULL,
    word_count INT NOT NULL,
    estimated_time_minutes INT NOT NULL,
    usage_count INT NOT NULL DEFAULT 0,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0
);

-- Indexes for passage_library_items
CREATE INDEX IF NOT EXISTS idx_passage_library_org_difficulty_updated 
    ON passage_library_items(organization_id, difficulty, updated_at DESC);
-- Note: GIN index for tags removed - MySQL doesn't support GIN, tags stored as JSON
-- Note: Full-text search index removed - to_tsvector is PostgreSQL-specific

-- question_bank_items
CREATE TABLE IF NOT EXISTS question_bank_items (
    id VARCHAR(36) PRIMARY KEY,
    organization_id VARCHAR(255),
    question_type VARCHAR(255) NOT NULL,
    block_snapshot JSON NOT NULL,
    difficulty VARCHAR(50) NOT NULL CHECK (difficulty IN ('easy', 'medium', 'hard')),
    topic VARCHAR(255) NOT NULL,
    tags JSON NOT NULL,
    usage_count INT NOT NULL DEFAULT 0,
    created_by VARCHAR(255) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    revision INT NOT NULL DEFAULT 0
);

-- Indexes for question_bank_items
CREATE INDEX IF NOT EXISTS idx_question_bank_org_type_difficulty_updated 
    ON question_bank_items(organization_id, question_type, difficulty, updated_at DESC);
-- Note: GIN index for tags removed - MySQL doesn't support GIN, tags stored as JSON
-- Note: Full-text search index removed - to_tsvector is PostgreSQL-specific

-- Note: RLS policies removed - authorization is now handled at the application level
-- Note: Triggers for updated_at removed - using ON UPDATE CURRENT_TIMESTAMP instead

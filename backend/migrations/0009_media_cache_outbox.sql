-- Media metadata, shared cache, idempotency, and outbox coordination

CREATE TABLE IF NOT EXISTS media_assets (
    id CHAR(36) PRIMARY KEY,
    owner_kind VARCHAR(50) NOT NULL,
    owner_id VARCHAR(255) NOT NULL,
    content_type VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    upload_status VARCHAR(50) NOT NULL CHECK (upload_status IN ('pending', 'finalized', 'orphaned', 'deleted')),
    object_key VARCHAR(255) NOT NULL,
    size_bytes BIGINT,
    checksum_sha256 VARCHAR(255),
    upload_url VARCHAR(255) NOT NULL,
    download_url VARCHAR(255),
    delete_after_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_media_assets_owner_updated
    ON media_assets(owner_kind, owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_media_assets_status_updated
    ON media_assets(upload_status, updated_at DESC);

CREATE TABLE IF NOT EXISTS shared_cache_entries (
    cache_key VARCHAR(255) PRIMARY KEY,
    payload JSON NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    invalidated_at TIMESTAMP,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
    actor_id VARCHAR(255) NOT NULL,
    route_key VARCHAR(255) NOT NULL,
    idempotency_key VARCHAR(255) NOT NULL,
    request_hash VARCHAR(255) NOT NULL,
    response_status INT NOT NULL,
    response_body JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    PRIMARY KEY (actor_id, route_key, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_keys_expires_at
    ON idempotency_keys(expires_at ASC);

CREATE TABLE IF NOT EXISTS outbox_events (
    id CHAR(36) NOT NULL PRIMARY KEY,
    aggregate_kind VARCHAR(50) NOT NULL,
    aggregate_id VARCHAR(255) NOT NULL,
    revision BIGINT NOT NULL DEFAULT 0,
    event_family VARCHAR(50) NOT NULL,
    payload JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    claimed_at TIMESTAMP,
    published_at TIMESTAMP,
    publish_attempts INT NOT NULL DEFAULT 0,
    last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_outbox_events_publish_pending
    ON outbox_events(published_at, claimed_at, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_outbox_events_aggregate
    ON outbox_events(aggregate_kind, aggregate_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_outbox_events_created_at
    ON outbox_events(created_at);

-- Note: Partitioning removed for simplicity - can be added later if needed for performance
-- Note: GRANT statements removed - using MySQL user management instead
-- Note: Triggers for updated_at removed - using ON UPDATE CURRENT_TIMESTAMP instead

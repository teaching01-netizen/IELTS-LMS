-- Distributed websocket admission leases.
-- Keeps connection limits correct when multiple API instances are running.

CREATE TABLE IF NOT EXISTS websocket_connection_leases (
    lease_token VARCHAR(64) PRIMARY KEY,
    instance_id VARCHAR(128) NOT NULL,
    user_id VARCHAR(191) NOT NULL,
    schedule_id VARCHAR(191) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    heartbeat_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at TIMESTAMP NOT NULL,
    INDEX idx_ws_leases_expiry (expires_at),
    INDEX idx_ws_leases_instance (instance_id),
    INDEX idx_ws_leases_user (user_id),
    INDEX idx_ws_leases_user_expiry (user_id, expires_at),
    INDEX idx_ws_leases_schedule (schedule_id),
    INDEX idx_ws_leases_schedule_expiry (schedule_id, expires_at)
);

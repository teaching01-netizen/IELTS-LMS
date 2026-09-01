-- Serialize websocket lease admission across API instances and MySQL/TiDB nodes.
CREATE TABLE IF NOT EXISTS websocket_lease_admission_lock (
    id TINYINT PRIMARY KEY,
    CONSTRAINT chk_websocket_lease_admission_lock_singleton CHECK (id = 1)
);

INSERT IGNORE INTO websocket_lease_admission_lock (id) VALUES (1);

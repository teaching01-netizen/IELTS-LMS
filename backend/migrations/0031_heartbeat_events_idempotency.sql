-- Make network-transition heartbeat deliveries idempotent under client retry
-- (BEX-051). A retried Disconnect/Reconnect/Lost event that carries the same
-- (attempt_id, event_type, client_timestamp) must not create a second
-- student_heartbeat_events row, a second session_audit_logs row, or a second
-- live alert.
--
-- The dedupe mirrors the violation idempotency precedent (0019): a unique
-- business key, with the caller inserting via INSERT IGNORE and gating the
-- append-only audit row and the live alert on rows_affected == 1 (1 = newly
-- inserted, 0 = duplicate). INSERT IGNORE is used instead of
-- ON DUPLICATE KEY UPDATE id = id because TiDB reports rows_affected = 1 for
-- a no-change duplicate update, which would defeat the gating.
-- Plain heartbeats never insert an event row, so they are unaffected.
--
-- client_timestamp is widened to fractional-second precision so that two
-- distinct transitions within the same wall-clock second do not collide on
-- the unique key (second-precision TIMESTAMP would conflate them).

ALTER TABLE student_heartbeat_events
    MODIFY COLUMN client_timestamp TIMESTAMP(6) NOT NULL;

CREATE UNIQUE INDEX uq_student_heartbeat_attempt_event_client_ts
    ON student_heartbeat_events(attempt_id, event_type, client_timestamp);
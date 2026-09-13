-- 0060_authoring_realtime_events.sql
-- Phase 02 SAT authoring realtime: replay index on the generic live-update
-- bus. Additive and re-runnable: guarded CREATE INDEX only. No column or
-- table changes; existing runtime/proctor rows are untouched.
--
-- EXAM-scoped replay (the Phase 03 query, and the only one we can prove):
--   WHERE event_kind = 'authoring' AND event_target_id = ? AND sequence_id > ?
--   ORDER BY sequence_id ASC LIMIT ?
-- event_target_id is the exam id: a draft is replaceable state, so routing
-- follows the durable collaboration scope (the exam) and each event carries
-- scope.draftVersionId for clients to compare against their own draft.
--
-- Deliberately NOT added here: an (event_kind, sequence_id) forward index.
-- The generic bus already has its own polling path/indexes, and no Phase 02
-- query filters by kind without a target. If the Phase 03 forwarder turns
-- out to need it, add it there with EXPLAIN ANALYZE evidence rather than
-- paying a write cost on every authoring insert for a query that may not
-- exist.
--
-- Retention purge reuses the existing idx_live_update_events_created (0018).

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_live_update_events_kind_target_seq ON live_update_events(event_kind, event_target_id, sequence_id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'live_update_events'
      AND INDEX_NAME = 'idx_live_update_events_kind_target_seq'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

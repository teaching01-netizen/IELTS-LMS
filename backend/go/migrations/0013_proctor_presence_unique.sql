-- Ensure proctor presence rows are unique per (schedule_id, proctor_id)
-- The application code uses INSERT ... ON DUPLICATE KEY UPDATE and expects a unique key.
-- Prior to this migration, repeated heartbeats could create unbounded duplicate rows.

-- 1) Deduplicate existing rows so a unique constraint can be added safely.
-- Prefer keeping an active row (left_at IS NULL) if one exists; otherwise keep the most recent row.
-- Tie-break by id to ensure a single survivor.
DELETE p1
FROM proctor_presence p1
JOIN proctor_presence p2
  ON p1.schedule_id = p2.schedule_id
 AND p1.proctor_id = p2.proctor_id
 AND (
      (p2.left_at IS NULL AND p1.left_at IS NOT NULL)
   OR (
        (p2.left_at IS NULL) = (p1.left_at IS NULL)
        AND (
             p2.last_heartbeat_at > p1.last_heartbeat_at
          OR (p2.last_heartbeat_at = p1.last_heartbeat_at AND p2.id > p1.id)
        )
      )
 );

-- 2) Enforce one row per proctor per schedule.
ALTER TABLE proctor_presence
  ADD UNIQUE KEY uniq_proctor_presence_schedule_proctor (schedule_id, proctor_id);


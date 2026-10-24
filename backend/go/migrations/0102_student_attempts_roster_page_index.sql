-- Staff roster keyset page (proctor.LoadStudentSessionsPage) in index order.
--
-- The page reads WHERE schedule_id = ? ORDER BY updated_at ASC, id ASC with a
-- (updated_at, id) cursor. 0017's idx_student_attempts_schedule_updated_id is
-- (schedule_id, updated_at DESC, id ASC): its mixed directions cannot supply
-- that order in either scan direction on MySQL 8+, so every page sorted the
-- whole room. On a 2,000-candidate room the page read and joined all 2,000
-- rows; with this index the page reads one page of index entries.
-- The page query names this index in an optimizer hint, which MySQL ignores
-- with a warning when the index is absent; that fallback sorts only the
-- room's own index entries. Binaries and this migration may roll out in
-- either order.
--
-- Additive and re-runnable (MIGRATION_POLICY.md sections 0 and 4): online
-- information_schema-guarded CREATE INDEX on an exam-day table. Build it
-- outside an exam window. The 0017 index is left in place; retiring it is a
-- separate destructive change.
SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_student_attempts_schedule_roster ON student_attempts(schedule_id, updated_at, id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempts'
      AND INDEX_NAME = 'idx_student_attempts_schedule_roster'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Runtime reconciler due selection (proctor.ReconcileExpiredSections) by
-- runtime status.
--
-- Both candidate reads filter runtimes by status: the section due selection
-- on status = 'live', the personal SAT drain on status IN ('live', 'paused')
-- AND timing_model = 'sat_personal_v1'. The only status index was
-- (provider_key, status), which neither read can range-scan, so every hot
-- cycle (~5 s per worker) read every runtime section ever created. With
-- 20,000 historical runtimes and 20 live rooms the due selection examined
-- 20,030 section rows and 20,010 runtimes (85-250 ms locally); with this
-- index it reads the live runtimes only (about 2 ms), and the drain read
-- drops from a table scan to two index ranges.
--
-- Additive and re-runnable (MIGRATION_POLICY.md sections 0 and 4). Runtime
-- rows change status a few times per session, so the write cost is small.
SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_exam_session_runtimes_status_timing ON exam_session_runtimes(status, timing_model)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'exam_session_runtimes'
      AND INDEX_NAME = 'idx_exam_session_runtimes_status_timing'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 0117_sat_flexible_count.sql
-- SAT flexible question count: per-version flag for Classroom-only exams with
-- flexible (1..max) counts per included module and/or M1-only shape.
--
-- exam_versions.sat_flexible_count: 0 (every existing row; strict len==target
-- publish gates) or 1 (flexible 1<=len<=target gates). Backward compatible:
-- absent flag reads as non-flexible, and Full SAT behavior is unchanged.

SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_versions' AND column_name = 'sat_flexible_count');
SET @ddl := IF(@col = 0, 'ALTER TABLE exam_versions ADD COLUMN sat_flexible_count TINYINT(1) NOT NULL DEFAULT 0', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

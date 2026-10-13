-- 0085_sat_score_report_setting.sql
-- Per-exam SAT score report switch.
--
-- exam_entities.sat_score_report_enabled: when TRUE a completed SAT attempt
-- releases its classroom score report (raw section/module scores, domain
-- accuracy) and the answered-exam download; when FALSE the student only sees
-- "SAT complete". It replaces the classroom-session check as the release gate,
-- so exams that already ran classroom sessions are backfilled to TRUE to keep
-- their current behavior.

SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_entities' AND column_name = 'sat_score_report_enabled');
SET @ddl := IF(@col = 0, 'ALTER TABLE exam_entities ADD COLUMN sat_score_report_enabled BOOLEAN NOT NULL DEFAULT FALSE', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

UPDATE exam_entities e SET sat_score_report_enabled = TRUE
WHERE e.provider_key = 'sat' AND EXISTS (SELECT 1 FROM exam_schedules sch WHERE sch.exam_id = e.id AND sch.sat_session_mode = 'classroom');

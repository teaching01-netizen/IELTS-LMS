-- 0083_sat_classroom_route_policy.sql
-- SAT Practice Classroom: per-session Module 2 routing policy.
--
-- exam_schedules.sat_session_mode: 'practice' (every existing row; score is
-- withheld) or 'classroom' (staff-run; the student sees a raw score on
-- completion). A forced route policy requires classroom mode.
--
-- exam_schedules.sat_route_policy: 'adaptive' (every existing row; the M1
-- score picks the branch), 'force_lower', 'force_higher', or 'staff_selects'
-- (staff assign the branch after Module 1). A forced policy
-- is still committed through assessment_route_decisions in the same
-- transaction that closes Module 1, so the route-integrity chain is unchanged.

SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_schedules' AND column_name = 'sat_route_policy');
SET @ddl := IF(@col = 0, 'ALTER TABLE exam_schedules ADD COLUMN sat_route_policy VARCHAR(16) NOT NULL DEFAULT ''adaptive'' AFTER sat_start_mode', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @chk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'exam_schedules' AND constraint_name = 'chk_exam_schedules_sat_route_policy');
SET @ddl := IF(@chk = 0, 'ALTER TABLE exam_schedules ADD CONSTRAINT chk_exam_schedules_sat_route_policy CHECK (sat_route_policy IN (''adaptive'', ''force_lower'', ''force_higher'', ''staff_selects''))', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_schedules' AND column_name = 'sat_session_mode');
SET @ddl := IF(@col = 0, 'ALTER TABLE exam_schedules ADD COLUMN sat_session_mode VARCHAR(16) NOT NULL DEFAULT ''practice'' AFTER sat_route_policy', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @chk := (SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = DATABASE() AND table_name = 'exam_schedules' AND constraint_name = 'chk_exam_schedules_sat_session_mode');
SET @ddl := IF(@chk = 0, 'ALTER TABLE exam_schedules ADD CONSTRAINT chk_exam_schedules_sat_session_mode CHECK (sat_session_mode IN (''practice'', ''classroom'') AND (sat_route_policy = ''adaptive'' OR sat_session_mode = ''classroom''))', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- exam_versions.sat_classroom_plan: per-section Classroom module shape
-- ({"math":"m2_hard"}). NULL (every existing row) is the standard full
-- adaptive structure; publish validation and delivery both read this column.
SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_versions' AND column_name = 'sat_classroom_plan');
SET @ddl := IF(@col = 0, 'ALTER TABLE exam_versions ADD COLUMN sat_classroom_plan JSON NULL', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

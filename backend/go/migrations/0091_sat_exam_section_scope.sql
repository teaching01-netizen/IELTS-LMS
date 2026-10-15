-- SAT exam creation scope; existing exams retain both sections.
SET @col := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'exam_entities' AND column_name = 'sat_section_scope');
SET @ddl := IF(@col = 0, 'ALTER TABLE exam_entities ADD COLUMN sat_section_scope VARCHAR(32) NOT NULL DEFAULT ''full''', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;

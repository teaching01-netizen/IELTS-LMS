-- Expand the existing form vocabulary without rewriting v1 snapshots/answers.
-- One ALTER atomically replaces the old CHECK on MySQL 8.4; reruns converge.
SET @section_forms_check_exists := (
 SELECT COUNT(*) FROM information_schema.table_constraints
 WHERE constraint_schema=DATABASE() AND table_name='assessment_form_responses'
 AND constraint_name='chk_assessment_form_responses_form_key'
);
SET @section_forms_ddl := IF(@section_forms_check_exists > 0,
 'ALTER TABLE assessment_form_responses DROP CHECK chk_assessment_form_responses_form_key, ADD CONSTRAINT chk_assessment_form_responses_form_key CHECK (form_key IN (''registration'', ''verbal_entry'', ''math_entry'', ''eva_sim''))',
 'ALTER TABLE assessment_form_responses ADD CONSTRAINT chk_assessment_form_responses_form_key CHECK (form_key IN (''registration'', ''verbal_entry'', ''math_entry'', ''eva_sim''))'
);
PREPARE section_forms_stmt FROM @section_forms_ddl;
EXECUTE section_forms_stmt;
DEALLOCATE PREPARE section_forms_stmt;

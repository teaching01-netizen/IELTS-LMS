ALTER TABLE assessment_question_revisions
    ADD COLUMN updated_by VARCHAR(255) NULL AFTER created_by;

UPDATE assessment_question_revisions
SET updated_by = created_by
WHERE updated_by IS NULL;

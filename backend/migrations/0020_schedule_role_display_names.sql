-- Add schedule-level role-specific display names for proctor and grading surfaces.
-- NOTE: each ADD/MODIFY COLUMN is its own ALTER statement — TiDB cannot resolve an
-- AFTER clause that references a column added/modified in the same ALTER statement
-- (error 1054 "Unknown column"). MySQL tolerates the batched form; TiDB does not.

ALTER TABLE exam_schedules
    ADD COLUMN proctor_display_name VARCHAR(255) NULL AFTER exam_title;

ALTER TABLE exam_schedules
    ADD COLUMN grading_display_name VARCHAR(255) NULL AFTER proctor_display_name;

UPDATE exam_schedules
SET
    proctor_display_name = exam_title
WHERE proctor_display_name IS NULL OR TRIM(proctor_display_name) = '';

UPDATE exam_schedules
SET
    grading_display_name = exam_title
WHERE grading_display_name IS NULL OR TRIM(grading_display_name) = '';

ALTER TABLE exam_schedules
    MODIFY COLUMN proctor_display_name VARCHAR(255) NOT NULL;

ALTER TABLE exam_schedules
    MODIFY COLUMN grading_display_name VARCHAR(255) NOT NULL;

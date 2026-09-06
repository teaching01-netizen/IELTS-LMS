-- Add schedule-level role-specific display names for proctor and grading surfaces.

ALTER TABLE exam_schedules
    ADD COLUMN proctor_display_name VARCHAR(255) NULL AFTER exam_title,
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
    MODIFY COLUMN proctor_display_name VARCHAR(255) NOT NULL,
    MODIFY COLUMN grading_display_name VARCHAR(255) NOT NULL;

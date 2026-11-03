-- The audited released regrade is a new schedule event action. Widen the
-- action check without assuming the unnamed MySQL constraint's suffix.

SET @grading_event_check_name := (
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'grading_schedule_override_events'
      AND constraint_type = 'CHECK'
      AND constraint_name LIKE 'grading_schedule_override_events%'
    LIMIT 1
);
SET @drop_grading_event_check := IF(
    @grading_event_check_name IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE grading_schedule_override_events DROP CHECK `', @grading_event_check_name, '`')
);
PREPARE stmt FROM @drop_grading_event_check;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE grading_schedule_override_events
    ADD CONSTRAINT chk_grading_schedule_override_events_action CHECK (
        action IN (
            'objective_override_upserted',
            'objective_override_deleted',
            'objective_regrade_triggered',
            'objective_regrade_completed',
            'objective_regrade_released'
        )
    );

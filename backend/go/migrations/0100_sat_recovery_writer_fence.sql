-- MySQL is the only supported database for SAT recovery rollout. These
-- database fences stop a mixed-version API or worker from activating or
-- terminalizing modules under a pinned recovery policy without its durable
-- boundary transition.
--
-- The invalid sentinel is rejected by chk_module_attempt_state. Keep each
-- trigger body to one statement for the migration splitter.

DROP TRIGGER IF EXISTS assessment_module_attempts_sat_recovery_insert_fence;

CREATE TRIGGER assessment_module_attempts_sat_recovery_insert_fence
BEFORE INSERT ON assessment_module_attempts
FOR EACH ROW
SET NEW.state = IF(
    NEW.state IN ('active', 'locked', 'submitted')
    AND EXISTS (
        SELECT 1
        FROM student_attempts a
        JOIN exam_schedules s ON s.id = a.schedule_id
        WHERE a.id = NEW.attempt_id
          AND s.sat_delivery_policy IS NOT NULL
    ),
    'sat_policy_fence',
    NEW.state
);

DROP TRIGGER IF EXISTS assessment_module_attempts_sat_recovery_update_fence;

CREATE TRIGGER assessment_module_attempts_sat_recovery_update_fence
BEFORE UPDATE ON assessment_module_attempts
FOR EACH ROW
SET NEW.state = IF(
    EXISTS (
        SELECT 1
        FROM student_attempts a
        JOIN exam_schedules s ON s.id = a.schedule_id
        WHERE a.id = NEW.attempt_id
          AND s.sat_delivery_policy IS NOT NULL
    )
    AND (
        (
            OLD.state = 'not_started'
            AND NEW.state = 'active'
            AND NOT EXISTS (
                SELECT 1
                FROM assessment_module_boundaries b
                JOIN student_attempts a ON a.id = b.attempt_id
                JOIN exam_schedules s ON s.id = a.schedule_id
                WHERE b.module_attempt_id = NEW.id
                  AND b.attempt_id = NEW.attempt_id
                  AND b.phase = 'working'
                  AND b.policy_version = JSON_UNQUOTE(JSON_EXTRACT(s.sat_delivery_policy, '$.version'))
            )
        )
        OR (
            OLD.state IN ('not_started', 'active', 'review')
            AND NEW.state IN ('locked', 'submitted')
            AND NOT EXISTS (
                SELECT 1
                FROM assessment_module_boundaries b
                WHERE b.module_attempt_id = NEW.id
                  AND b.attempt_id = NEW.attempt_id
                  AND b.phase IN ('settled', 'ended')
            )
        )
    ),
    'sat_policy_fence',
    NEW.state
);

-- Carry forward admission for retakes that were created before the
-- first-attempt-only code rule and are still waiting to start.
UPDATE sat_attempt_learning AS learning
JOIN student_attempts AS retake
    ON retake.id = learning.attempt_id AND retake.schedule_id = learning.schedule_id
    AND retake.user_id = learning.student_id AND retake.published_version_id = learning.published_version_id
JOIN exam_schedules AS room ON room.id = retake.schedule_id
LEFT JOIN assessment_access_links AS link ON link.schedule_id = room.id
LEFT JOIN exam_session_runtimes AS runtime ON runtime.schedule_id = room.id
JOIN student_attempts AS prior
    ON prior.schedule_id = retake.schedule_id AND prior.user_id = retake.user_id
    AND prior.published_version_id = retake.published_version_id AND prior.id <> retake.id
    AND prior.sat_start_code_accepted_at IS NOT NULL
    AND prior.created_at <= retake.created_at AND prior.submitted_at < retake.created_at + INTERVAL 1 SECOND
    AND prior.delivery_status = 'submitted' AND COALESCE(prior.proctor_status, 'active') <> 'terminated'
SET retake.sat_start_code_required = FALSE
WHERE learning.ordinal > 1 AND learning.mode = 'test'
    AND retake.sat_start_code_required = TRUE AND retake.sat_start_code_accepted_at IS NULL
    AND retake.submitted_at IS NULL AND retake.delivery_status = 'running'
    AND retake.phase IN ('lobby', 'pre-check')
    AND COALESCE(retake.proctor_status, 'active') = 'active'
    AND room.sat_start_mode = 'access_code' AND room.status IN ('scheduled', 'live')
    AND UTC_TIMESTAMP(6) >= room.start_time AND UTC_TIMESTAMP(6) < room.end_time
    AND (link.id IS NULL OR (
        link.lifecycle_state = 'active'
        AND (link.opens_at IS NULL OR UTC_TIMESTAMP(6) >= link.opens_at)
        AND (link.closes_at IS NULL OR UTC_TIMESTAMP(6) < link.closes_at)
    ))
    AND (runtime.id IS NULL OR runtime.status <> 'paused');

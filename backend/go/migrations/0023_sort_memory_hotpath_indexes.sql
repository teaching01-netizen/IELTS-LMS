-- Scale hardening for high-cardinality list/aggregation paths.
-- Focus: avoid large filesorts/tmp sorts on grading, proctor alert counts, and answer-history fallback resolution.

-- Grading list hot path.
-- Supports: ORDER BY updated_at DESC, start_time DESC, id DESC
CREATE INDEX idx_grading_sessions_updated_start_id
    ON grading_sessions(updated_at DESC, start_time DESC, id DESC);

-- Proctor alert count/filter hot path.
-- Supports:
-- WHERE schedule_id = ?
--   AND acknowledged_at IS NULL
--   AND action_type IN (...)
-- GROUP BY schedule_id
CREATE INDEX idx_session_audit_logs_schedule_ack_action_created
    ON session_audit_logs(schedule_id, acknowledged_at, action_type, created_at DESC);

-- Answer-history fallback candidate narrowing.
CREATE INDEX idx_student_attempts_schedule_candidate_submitted_updated
    ON student_attempts(schedule_id, candidate_id, submitted_at, updated_at, id);

-- Mutation aggregation/order support for fallback and timeline reads.
CREATE INDEX idx_student_attempt_mutations_attempt_received_id
    ON student_attempt_mutations(attempt_id, server_received_at, id);

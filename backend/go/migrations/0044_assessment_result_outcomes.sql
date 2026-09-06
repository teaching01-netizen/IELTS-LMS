-- Keep provider-owned assessment outcomes independent from IELTS grading submissions.
-- A terminalized SAT attempt always has a durable assessment result, even when
-- it has no student_submissions row and therefore cannot enter IELTS grading.

ALTER TABLE assessment_results
    ADD COLUMN attempt_id VARCHAR(36) NULL AFTER id,
    ADD COLUMN outcome_status VARCHAR(32) NOT NULL DEFAULT 'scored' AFTER provider_key;

UPDATE assessment_results ar
JOIN student_submissions ss ON ss.id = ar.submission_id
SET ar.attempt_id = ss.attempt_id,
    ar.outcome_status = 'scored'
WHERE ar.attempt_id IS NULL;

ALTER TABLE assessment_results
    MODIFY COLUMN attempt_id VARCHAR(36) NOT NULL,
    MODIFY COLUMN submission_id VARCHAR(36) NULL,
    ADD CONSTRAINT uq_assessment_result_attempt_provider UNIQUE (attempt_id, provider_key),
    ADD CONSTRAINT chk_assessment_result_outcome_status CHECK (
        outcome_status IN ('scored', 'pending', 'invalidated_proctor', 'invalidated_timeout')
    ),
    ADD CONSTRAINT fk_assessment_result_attempt
        FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE;

CREATE INDEX idx_assessment_results_provider_outcome
    ON assessment_results(provider_key, outcome_status, created_at);

-- Correct historical provider labels before the IELTS projection begins using
-- them. SAT rows remain available to the SAT result API but are no longer
-- eligible for any IELTS grading query.
UPDATE student_submissions ss
JOIN exam_entities e ON e.id = ss.exam_id
SET ss.provider_key = e.provider_key
WHERE ss.provider_key <> e.provider_key;

-- Remove any historical SAT schedule shells and released IELTS result rows
-- created by the old cross-provider projection. SAT result rows are owned by
-- assessment_results instead.
DELETE grading_sessions
FROM grading_sessions
JOIN exam_entities e ON e.id = grading_sessions.exam_id
WHERE e.provider_key = 'sat';

DELETE results
FROM student_results results
JOIN student_submissions submissions ON submissions.id = results.submission_id
WHERE submissions.provider_key = 'sat';

-- Historical SAT attempts that were terminalized by a proctor may have a
-- score-shaped result from the old path. Remove that score and its sections;
-- the application will materialize the explicit invalidation outcome on the
-- next termination/recovery pass.
UPDATE assessment_results ar
JOIN student_attempts a ON a.id = ar.attempt_id
JOIN exam_entities e ON e.id = a.exam_id
SET ar.outcome_status = 'invalidated_proctor',
    ar.total_score = NULL,
    ar.release_status = 'invalidated',
    ar.submission_id = NULL
WHERE ar.provider_key = 'sat'
  AND e.provider_key = 'sat'
  AND a.proctor_status = 'terminated';

-- Repair historical proctor terminalizations that never received a result row.
INSERT INTO assessment_results (
    id, attempt_id, submission_id, provider_key, outcome_status,
    total_score, score_payload, release_status
)
SELECT
    UUID(),
    t.attempt_id,
    NULL,
    'sat',
    IF(t.actor_kind = 'proctor', 'invalidated_proctor', 'invalidated_timeout'),
    NULL,
    JSON_OBJECT(
        'providerKey', 'sat',
        'outcomeStatus', IF(t.actor_kind = 'proctor', 'invalidated_proctor', 'invalidated_timeout'),
        'completionReason', t.reason,
        'terminalizationId', t.terminalization_id,
        'submittedAt', t.effective_at,
        'snapshot', t.final_snapshot
    ),
    'invalidated'
FROM attempt_terminalizations t
JOIN student_attempts a ON a.id = t.attempt_id
JOIN exam_entities e ON e.id = a.exam_id
LEFT JOIN assessment_results ar
    ON ar.attempt_id = t.attempt_id
   AND ar.provider_key = 'sat'
WHERE t.outcome = 'terminated'
  AND e.provider_key = 'sat'
  AND ar.id IS NULL;

DELETE section_results
FROM assessment_section_results section_results
JOIN assessment_results ar ON ar.id = section_results.assessment_result_id
WHERE ar.provider_key = 'sat'
  AND ar.outcome_status <> 'scored';

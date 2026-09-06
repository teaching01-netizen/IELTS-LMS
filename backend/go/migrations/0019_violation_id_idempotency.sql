-- Make VIOLATION_DETECTED writes idempotent by introducing a business key.

ALTER TABLE student_violation_events
    ADD COLUMN violation_id VARCHAR(64) NULL AFTER attempt_id;

-- Backfill from payload when available.
UPDATE student_violation_events
SET violation_id = JSON_UNQUOTE(JSON_EXTRACT(payload, '$.violationId'))
WHERE (violation_id IS NULL OR violation_id = '')
  AND JSON_EXTRACT(payload, '$.violationId') IS NOT NULL;

-- Legacy rows without payload.violationId get a stable fallback key.
UPDATE student_violation_events
SET violation_id = CONCAT('legacy:', id)
WHERE violation_id IS NULL OR violation_id = '';

-- Remove duplicate logical violations, keeping earliest created row.
DELETE sve1
FROM student_violation_events sve1
JOIN student_violation_events sve2
  ON sve1.attempt_id = sve2.attempt_id
 AND sve1.violation_id = sve2.violation_id
 AND (
      sve1.created_at > sve2.created_at
      OR (sve1.created_at = sve2.created_at AND sve1.id > sve2.id)
 );

ALTER TABLE student_violation_events
    MODIFY COLUMN violation_id VARCHAR(64) NOT NULL;

CREATE UNIQUE INDEX uq_student_violation_attempt_business_id
    ON student_violation_events(attempt_id, violation_id);

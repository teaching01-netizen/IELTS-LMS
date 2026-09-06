-- Projection worker hardening for large datasets.
-- Adds indexes for bounded ascending projection scans ordered by updated_at/id.

-- Supports schedule projection scans:
-- SELECT ... FROM exam_schedules ORDER BY updated_at ASC, id ASC LIMIT ?
CREATE INDEX idx_exam_schedules_updated_id
    ON exam_schedules(updated_at, id);

-- Supports submission projection prefilter scans:
-- SELECT ... FROM student_attempts WHERE submitted_at IS NOT NULL AND updated_at >= ? ORDER BY updated_at ASC, id ASC LIMIT ?
CREATE INDEX idx_student_attempts_updated_id_submitted
    ON student_attempts(updated_at, id, submitted_at);

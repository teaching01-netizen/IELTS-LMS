-- Ensure attempt finalization columns stay consistent.
-- If one side is present, the other must also be present.
ALTER TABLE student_attempts
ADD CONSTRAINT student_attempts_finalization_consistent
CHECK (
    (submitted_at IS NULL AND final_submission IS NULL)
    OR (submitted_at IS NOT NULL AND final_submission IS NOT NULL)
);

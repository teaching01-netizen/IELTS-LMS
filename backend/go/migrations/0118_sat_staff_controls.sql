-- Latest staff intervention belongs to the sitting. Receipts provide retry
-- safety; this is current state, not a staff-facing change-history feature.
ALTER TABLE student_attempts ADD COLUMN sat_staff_control JSON NULL;

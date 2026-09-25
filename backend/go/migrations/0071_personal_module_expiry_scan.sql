-- The synchronized personal-module timeout worker starts with due open rows.
-- State and started_at narrow the scan before it checks each exact deadline.
CREATE INDEX idx_assessment_module_personal_expiry
    ON assessment_module_attempts(state, started_at, id);

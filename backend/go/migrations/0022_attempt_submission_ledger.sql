-- Canonical final-submission ledger.
-- Enforces one canonical finalization row per attempt across student submit and auto/proctor finalizers.
CREATE TABLE IF NOT EXISTS attempt_submission_ledger (
    attempt_id VARCHAR(36) NOT NULL,
    submission_source VARCHAR(16) NOT NULL CHECK (submission_source IN ('student', 'auto')),
    canonical_revision INT NOT NULL CHECK (canonical_revision > 0),
    canonical_hash CHAR(64) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    idempotency_key VARCHAR(255) NULL,
    PRIMARY KEY (attempt_id)
);


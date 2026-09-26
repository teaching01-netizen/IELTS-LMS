-- 0072_assessment_results_nullable_submission.sql
-- P0 repair: a SAT terminal result is attempt-owned and may exist without a
-- legacy student_submissions row.
--
-- 0032_provider_neutral_sat.sql created assessment_results.submission_id as
-- VARCHAR(36) NOT NULL with an FK to student_submissions(id). 0044 then moved
-- the SAT result onto attempt identity: it adds attempt_id/outcome_status,
-- inserts invalidated SAT rows with submission_id = NULL, and nulls the column
-- again when a proctor invalidates an already-scored attempt.
-- internal/terminalization/service.go implements the same contract — it
-- deliberately writes "VALUES (?, ?, NULL, 'sat', ...)" and
-- "SET submission_id = NULL".
--
-- Deployed databases still carry the 0032 NOT NULL shape, so every SAT
-- completion fails with MySQL 1048 ("Column 'submission_id' cannot be null").
-- The module finalization that precedes it has already committed, so the
-- attempt strands with locked modules, persisted answers and no result row,
-- and delivery/reconcile.go retries the same failing completion every sweep.
--
-- MODIFY keeps the existing FK to student_submissions(id) and the
-- uq_assessment_result_submission UNIQUE: a UNIQUE index tolerates any number
-- of NULL keys, so submitted IELTS/ACT rows keep their
-- one-result-per-submission guarantee while attempt-owned SAT outcomes can
-- carry NULL.
--
-- Crash-retry safe: the ALTER is dispatched only when
-- information_schema.columns reports submission_id present and still NOT NULL,
-- so applying this file twice (or after a crash mid-file) is a no-op.

SET @ar_submission_id_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_results'
      AND column_name = 'submission_id'
);
SET @ar_submission_id_nullable := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_results'
      AND column_name = 'submission_id'
      AND is_nullable = 'YES'
);
SET @ar_submission_id_sql := IF(
    @ar_submission_id_exists = 0 OR @ar_submission_id_nullable > 0,
    'SELECT 1',
    'ALTER TABLE assessment_results MODIFY COLUMN submission_id VARCHAR(36) NULL'
);
PREPARE ar_submission_id_stmt FROM @ar_submission_id_sql;
EXECUTE ar_submission_id_stmt;
DEALLOCATE PREPARE ar_submission_id_stmt;

-- 0059_act_phase02_answer_fencing.sql
-- Phase 02 (AT-07/AT02-05..AT02-06): answer-write fencing columns on the
-- exam-day hot path table student_attempts.
--
-- The V2 durability transport already fences writes per question
-- (attempt_responses_v2.server_revision + attempt_mutations_v2.write_id /
-- version UNIQUEs, see 0049), but student_attempts itself carries no
-- per-attempt write-generation columns: two writers racing a save against a
-- submit (or racing each other across reconnects) cannot be fenced at the
-- attempt-row level, and idempotent submission replays have no client
-- write identity to converge on. This file adds exactly two additive,
-- NULL-tolerant columns:
--
--   answer_write_revision BIGINT NOT NULL DEFAULT 0
--     Monotonic per-attempt write generation bumped by answer writers.
--     Writers present the last generation they observed; a stale generation
--     loses (409 VERSION_COLLISION) instead of overwriting newer answers.
--   answer_client_write_id VARCHAR(64) NULL
--     Last client-supplied write identity for the attempt row, so a lost
--     response retried with the same identity converges (exact replay)
--     while the same identity with different content conflicts (409
--     WRITE_ID_CONFLICT). NULL means "no client identity supplied" (old
--     clients keep working; the server defaults apply).
--
-- Crash-retry safety: every ADD COLUMN is information_schema-guarded and
-- dispatched through PREPARE/EXECUTE (0045/0049 idiom), so a retry after a
-- crash mid-file executes only the missing pieces. The keep-earliest
-- normalization UPDATE is predicate-scoped (negative revisions,
-- over-long ids) and therefore idempotent: a second run matches zero rows.
-- No UNIQUE is built here (hot-table ALTER on exam day is forbidden by
-- MIGRATION_POLICY.md section 4); fencing stays application-enforced until
-- an off-peak follow-up promotes it. No data rewrite beyond clamping
-- out-of-range values to the documented defaults.
--
-- Big-ALTER policy (MIGRATION_POLICY.md section 4): these are two NULL-safe
-- trailing ADD COLUMNs with constant defaults on student_attempts. MySQL
-- 8.0.16+ applies them as metadata-only INSTANT operations (no table copy);
-- schedule them off-peak anyway on exam-day databases.

SET @col_answer_write_revision_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND column_name = 'answer_write_revision'
);
SET @col_answer_write_revision_sql := IF(
    @col_answer_write_revision_exists = 0,
    'ALTER TABLE student_attempts ADD COLUMN answer_write_revision BIGINT NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE col_answer_write_revision_stmt FROM @col_answer_write_revision_sql;
EXECUTE col_answer_write_revision_stmt;
DEALLOCATE PREPARE col_answer_write_revision_stmt;

SET @col_answer_client_write_id_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempts'
      AND column_name = 'answer_client_write_id'
);
SET @col_answer_client_write_id_sql := IF(
    @col_answer_client_write_id_exists = 0,
    'ALTER TABLE student_attempts ADD COLUMN answer_client_write_id VARCHAR(64) NULL',
    'SELECT 1'
);
PREPARE col_answer_client_write_id_stmt FROM @col_answer_client_write_id_sql;
EXECUTE col_answer_client_write_id_stmt;
DEALLOCATE PREPARE col_answer_client_write_id_stmt;

-- Keep-earliest normalization (idempotent): clamp any out-of-range values
-- left by a dirty fixture or a partial write to the documented defaults.
UPDATE student_attempts
SET answer_write_revision = 0
WHERE answer_write_revision < 0;

UPDATE student_attempts
SET answer_client_write_id = NULL
WHERE answer_client_write_id IS NOT NULL
  AND (CHAR_LENGTH(answer_client_write_id) = 0 OR CHAR_LENGTH(answer_client_write_id) > 64);

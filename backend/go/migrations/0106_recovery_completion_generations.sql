-- 0106_recovery_completion_generations.sql
-- Generation-aware completion history for timeout reopening
-- (docs/superpowers/plans/2026-10-28-staff-assisted-exam-recovery.md §3.3).
--
-- An immutable terminal receipt and a unique grading row per attempt are what
-- make early completion safe today; they also make a second completion
-- impossible. Each artifact therefore gains terminal_generation:
--
-- - Existing rows become generation 0 (the column default); no backfill
--   rewrites history.
-- - attempt_terminalizations keeps its PK on attempt_id and becomes
--   (attempt_id, terminal_generation), so a reopened sitting can append one
--   new immutable receipt while the previous receipt remains readable.
-- - student_submissions replaces the inline UNIQUE(attempt_id) with
--   UNIQUE(attempt_id, terminal_generation). A new seal creates fresh
--   submission/section/grading rows and never overwrites previous work.
-- - assessment_results stays one current projection per attempt/provider.
--   Its terminal_generation records which receipt the projection belongs to;
--   history remains in receipts and versioned submissions.
-- - attempt_submissions_v2 receipts become (attempt_id, terminal_generation).
--
-- The legacy UNIQUE index on student_submissions.attempt_id is created
-- inline by 0008 and therefore has the implicit name "attempt_id"; its name
-- is discovered rather than assumed. The composite unique index is added
-- before the legacy one is dropped, so no crash-retry window can admit two
-- current submissions for one attempt.

-- ---------------------------------------------------------------------------
-- attempt_terminalizations
-- ---------------------------------------------------------------------------
SET @at_generation_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_terminalizations'
      AND column_name = 'terminal_generation'
);
SET @at_generation_sql := IF(
    @at_generation_exists = 0,
    'ALTER TABLE attempt_terminalizations ADD COLUMN terminal_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE at_generation_stmt FROM @at_generation_sql;
EXECUTE at_generation_stmt;
DEALLOCATE PREPARE at_generation_stmt;

SET @at_pk_has_generation := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_terminalizations'
      AND index_name = 'PRIMARY'
      AND column_name = 'terminal_generation'
);
SET @at_pk_sql := IF(
    @at_pk_has_generation = 0,
    'ALTER TABLE attempt_terminalizations DROP PRIMARY KEY, ADD PRIMARY KEY (attempt_id, terminal_generation)',
    'SELECT 1'
);
PREPARE at_pk_stmt FROM @at_pk_sql;
EXECUTE at_pk_stmt;
DEALLOCATE PREPARE at_pk_stmt;

-- ---------------------------------------------------------------------------
-- student_submissions
-- ---------------------------------------------------------------------------
SET @ss_generation_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_submissions'
      AND column_name = 'terminal_generation'
);
SET @ss_generation_sql := IF(
    @ss_generation_exists = 0,
    'ALTER TABLE student_submissions ADD COLUMN terminal_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE ss_generation_stmt FROM @ss_generation_sql;
EXECUTE ss_generation_stmt;
DEALLOCATE PREPARE ss_generation_stmt;

SET @ss_composite_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_submissions'
      AND index_name = 'uq_student_submissions_attempt_generation'
);
SET @ss_composite_sql := IF(
    @ss_composite_exists = 0,
    'ALTER TABLE student_submissions ADD CONSTRAINT uq_student_submissions_attempt_generation UNIQUE (attempt_id, terminal_generation)',
    'SELECT 1'
);
PREPARE ss_composite_stmt FROM @ss_composite_sql;
EXECUTE ss_composite_stmt;
DEALLOCATE PREPARE ss_composite_stmt;

-- Discover the implicit single-column UNIQUE(attempt_id) index from 0008.
SET @ss_legacy_unique := (
    SELECT s.index_name
    FROM information_schema.statistics s
    WHERE s.table_schema = DATABASE()
      AND s.table_name = 'student_submissions'
      AND s.non_unique = 0
      AND s.index_name <> 'PRIMARY'
      AND s.column_name = 'attempt_id'
      AND (
          SELECT COUNT(*)
          FROM information_schema.statistics s2
          WHERE s2.table_schema = s.table_schema
            AND s2.table_name = s.table_name
            AND s2.index_name = s.index_name
      ) = 1
    LIMIT 1
);
SET @ss_drop_legacy_sql := IF(
    @ss_legacy_unique IS NULL,
    'SELECT 1',
    CONCAT('ALTER TABLE student_submissions DROP INDEX `', @ss_legacy_unique, '`')
);
PREPARE ss_drop_legacy_stmt FROM @ss_drop_legacy_sql;
EXECUTE ss_drop_legacy_stmt;
DEALLOCATE PREPARE ss_drop_legacy_stmt;

-- ---------------------------------------------------------------------------
-- assessment_results (current projection; unique attempt/provider retained)
-- ---------------------------------------------------------------------------
SET @ar_generation_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_results'
      AND column_name = 'terminal_generation'
);
SET @ar_generation_sql := IF(
    @ar_generation_exists = 0,
    'ALTER TABLE assessment_results ADD COLUMN terminal_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE ar_generation_stmt FROM @ar_generation_sql;
EXECUTE ar_generation_stmt;
DEALLOCATE PREPARE ar_generation_stmt;

-- ---------------------------------------------------------------------------
-- attempt_submissions_v2
-- ---------------------------------------------------------------------------
SET @asv2_generation_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_submissions_v2'
      AND column_name = 'terminal_generation'
);
SET @asv2_generation_sql := IF(
    @asv2_generation_exists = 0,
    'ALTER TABLE attempt_submissions_v2 ADD COLUMN terminal_generation BIGINT UNSIGNED NOT NULL DEFAULT 0',
    'SELECT 1'
);
PREPARE asv2_generation_stmt FROM @asv2_generation_sql;
EXECUTE asv2_generation_stmt;
DEALLOCATE PREPARE asv2_generation_stmt;

SET @asv2_pk_has_generation := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_submissions_v2'
      AND index_name = 'PRIMARY'
      AND column_name = 'terminal_generation'
);
SET @asv2_pk_sql := IF(
    @asv2_pk_has_generation = 0,
    'ALTER TABLE attempt_submissions_v2 DROP PRIMARY KEY, ADD PRIMARY KEY (attempt_id, terminal_generation)',
    'SELECT 1'
);
PREPARE asv2_pk_stmt FROM @asv2_pk_sql;
EXECUTE asv2_pk_stmt;
DEALLOCATE PREPARE asv2_pk_stmt;

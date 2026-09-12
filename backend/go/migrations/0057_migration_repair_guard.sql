-- 0057_migration_repair_guard.sql
-- WS-12 repair/guard migration: makes crash-interrupted or partially applied
-- earlier migrations converge to the intended end state. Additive and
-- re-runnable: every statement is existence-guarded, so applying this file
-- twice (or after a crash mid-file) is a no-op on the second pass.
--
-- Scope:
--   (a) Existence-guarded repair of UNIQUEs that 0015/0016 conditionally skip
--       on non-empty tables (idx_student_attempt_mutations_attempt_mutation_id,
--       idx_student_attempt_mutations_attempt_session_mutation_id), using the
--       0017 existence-guard idiom. Dirty duplicates are removed first with a
--       0019-style keep-earliest DELETE (keep lowest created order, tie-break
--       by id), so the UNIQUE builds instead of failing.
--   (b) Keep-earliest dedup for uq_assessment_result_attempt_provider from
--       0044, which adds that UNIQUE without a preceding dedup. Keeps the
--       earliest row per (attempt_id, provider_key) by created_at, tie-break
--       by id.
--   (c) Existence-guarded rebuild of 0013's uniq_proctor_presence_schedule_proctor
--       UNIQUE after a keep-earliest dedup that mirrors the 0013 survivor rule
--       (prefer active row with left_at IS NULL, else most recent heartbeat,
--       tie-break by id).
-- NO destructive deletes beyond keep-earliest dedup rows that would violate
-- the target UNIQUE; NO data rewrites beyond that dedup.
--
-- Crash-retry safety: every DDL is guarded by an information_schema existence
-- check (0017/0044/0045/0049 idiom) dispatched through PREPARE/EXECUTE, so a
-- retry after a crash executes only the missing pieces. Dedup DELETEs are
-- naturally idempotent: a second run finds no duplicate groups and deletes
-- zero rows. Correlated (non-equi) join predicates are avoided so the
-- statement form also parses on TiDB/MySQL 8.0.

-- ---------------------------------------------------------------------------
-- 1. student_attempt_mutations: repair the two UNIQUEs 0015/0016 skip on
--    non-empty tables (guard style mirrors 0017).
-- ---------------------------------------------------------------------------

-- 1a. Keep-earliest dedup for (attempt_id, client_mutation_id).
-- Keep the earliest row per business key: smallest server_received_at, then
-- smallest id. Extra join predicates use NULL-safe equality so the survivor
-- rule is deterministic on ties; re-running deletes zero rows.
DELETE m1
FROM student_attempt_mutations m1
JOIN student_attempt_mutations m2
  ON m2.attempt_id = m1.attempt_id
 AND m2.client_mutation_id <=> m1.client_mutation_id
 AND (
      m2.server_received_at < m1.server_received_at
   OR (m2.server_received_at = m1.server_received_at AND m2.id < m1.id)
 );

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE UNIQUE INDEX idx_student_attempt_mutations_attempt_mutation_id ON student_attempt_mutations(attempt_id, client_mutation_id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempt_mutations'
      AND INDEX_NAME = 'idx_student_attempt_mutations_attempt_mutation_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- 1b. Keep-earliest dedup for (attempt_id, client_session_id, client_mutation_id).
DELETE m1
FROM student_attempt_mutations m1
JOIN student_attempt_mutations m2
  ON m2.attempt_id = m1.attempt_id
 AND m2.client_session_id <=> m1.client_session_id
 AND m2.client_mutation_id <=> m1.client_mutation_id
 AND (
      m2.server_received_at < m1.server_received_at
   OR (m2.server_received_at = m1.server_received_at AND m2.id < m1.id)
 );

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE UNIQUE INDEX idx_student_attempt_mutations_attempt_session_mutation_id ON student_attempt_mutations(attempt_id, client_session_id, client_mutation_id)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'student_attempt_mutations'
      AND INDEX_NAME = 'idx_student_attempt_mutations_attempt_session_mutation_id'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ---------------------------------------------------------------------------
-- 2. assessment_results: keep-earliest dedup for the 0044 UNIQUE
--    uq_assessment_result_attempt_provider, which 0044 adds without dedup.
--    Keep earliest created row per (attempt_id, provider_key); tie-break by id.
--    Rows with NULL attempt_id predate 0044's backfill; they cannot collide
--    with the UNIQUE on populated keys, so they are excluded.
-- ---------------------------------------------------------------------------
DELETE ar1
FROM assessment_results ar1
JOIN assessment_results ar2
  ON ar2.attempt_id = ar1.attempt_id
 AND ar2.provider_key = ar1.provider_key
 AND ar1.attempt_id IS NOT NULL
 AND ar2.attempt_id IS NOT NULL
 AND (
      ar2.created_at < ar1.created_at
   OR (ar2.created_at = ar1.created_at AND ar2.id < ar1.id)
 );

SET @ar_attempt_provider_uq_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_results'
      AND constraint_name = 'uq_assessment_result_attempt_provider'
);
SET @ar_attempt_provider_uq_sql := IF(
    @ar_attempt_provider_uq_exists = 0,
    'ALTER TABLE assessment_results ADD CONSTRAINT uq_assessment_result_attempt_provider UNIQUE (attempt_id, provider_key)',
    'SELECT 1'
);
PREPARE ar_attempt_provider_uq_stmt FROM @ar_attempt_provider_uq_sql;
EXECUTE ar_attempt_provider_uq_stmt;
DEALLOCATE PREPARE ar_attempt_provider_uq_stmt;

-- 0044 CHECK + FK companions, guarded (0044/0046 idiom): a crash between the
-- UNIQUE and these leaves them missing on retry.
SET @ar_outcome_chk_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_results'
      AND constraint_name = 'chk_assessment_result_outcome_status'
);
SET @ar_outcome_chk_sql := IF(
    @ar_outcome_chk_exists = 0,
    'ALTER TABLE assessment_results ADD CONSTRAINT chk_assessment_result_outcome_status CHECK (outcome_status IN (\'scored\', \'pending\', \'invalidated_proctor\', \'invalidated_timeout\'))',
    'SELECT 1'
);
PREPARE ar_outcome_chk_stmt FROM @ar_outcome_chk_sql;
EXECUTE ar_outcome_chk_stmt;
DEALLOCATE PREPARE ar_outcome_chk_stmt;

SET @ar_attempt_fk_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_results'
      AND constraint_name = 'fk_assessment_result_attempt'
);
SET @ar_attempt_fk_sql := IF(
    @ar_attempt_fk_exists = 0,
    'ALTER TABLE assessment_results ADD CONSTRAINT fk_assessment_result_attempt FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE',
    'SELECT 1'
);
PREPARE ar_attempt_fk_stmt FROM @ar_attempt_fk_sql;
EXECUTE ar_attempt_fk_stmt;
DEALLOCATE PREPARE ar_attempt_fk_stmt;

-- ---------------------------------------------------------------------------
-- 3. proctor_presence: keep-earliest dedup mirroring the 0013 survivor rule,
--    then guarded rebuild of uniq_proctor_presence_schedule_proctor.
--    Survivor per (schedule_id, proctor_id): prefer the active row
--    (left_at IS NULL); on equal active state keep the most recent
--    last_heartbeat_at; tie-break by id. Deletes only rows that have a
--    strictly preferred survivor, so the second run deletes zero rows.
-- ---------------------------------------------------------------------------
DELETE p1
FROM proctor_presence p1
JOIN proctor_presence p2
  ON p1.schedule_id = p2.schedule_id
 AND p1.proctor_id = p2.proctor_id
 AND (
      (p2.left_at IS NULL AND p1.left_at IS NOT NULL)
   OR (
        (p2.left_at IS NULL) = (p1.left_at IS NULL)
        AND (
             p2.last_heartbeat_at > p1.last_heartbeat_at
          OR (p2.last_heartbeat_at = p1.last_heartbeat_at AND p2.id > p1.id)
        )
      )
 );

SET @pp_uq_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'proctor_presence'
      AND index_name = 'uniq_proctor_presence_schedule_proctor'
);
SET @pp_uq_sql := IF(
    @pp_uq_exists = 0,
    'ALTER TABLE proctor_presence ADD UNIQUE KEY uniq_proctor_presence_schedule_proctor (schedule_id, proctor_id)',
    'SELECT 1'
);
PREPARE pp_uq_stmt FROM @pp_uq_sql;
EXECUTE pp_uq_stmt;
DEALLOCATE PREPARE pp_uq_stmt;

-- ---------------------------------------------------------------------------
-- 4. Guarded existence repair for the remaining 0017/0018/0045/0047 UNIQUE and
--    claim-lease indexes (0017 idiom). These already exist on fully migrated
--    databases; the guards make a partial run converge without rework.
-- ---------------------------------------------------------------------------
SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_outbox_events_claim_lease ON outbox_events(published_at, claim_expires_at, created_at ASC)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND INDEX_NAME = 'idx_outbox_events_claim_lease'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @sql = (
    SELECT IF(
        COUNT(*) = 0,
        'CREATE INDEX idx_outbox_events_claim_token ON outbox_events(claim_token)',
        'SELECT 1'
    )
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'outbox_events'
      AND INDEX_NAME = 'idx_outbox_events_claim_token'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @hb_mut_uq_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'student_heartbeat_events'
      AND constraint_name IN ('uq_student_heartbeat_mutation', 'heartbeat_mutation')
);
SET @hb_mut_uq_sql := IF(
    @hb_mut_uq_exists = 0,
    'ALTER TABLE student_heartbeat_events ADD CONSTRAINT uq_student_heartbeat_mutation UNIQUE (attempt_id, mutation_id)',
    'SELECT 1'
);
PREPARE hb_mut_uq_stmt FROM @hb_mut_uq_sql;
EXECUTE hb_mut_uq_stmt;
DEALLOCATE PREPARE hb_mut_uq_stmt;

-- ---------------------------------------------------------------------------
-- 5. Guarded repair for unguarded DDL in 0014/0019. Those files re-run from
--    the top after a crash (the ledger records only fully applied files), so
--    a crash after their plain ADD COLUMN / CREATE INDEX / CREATE UNIQUE
--    INDEX aborts every retry on duplicate-name errors. The guarded forms
--    below converge those partial states; the dedup itself stays owned by
--    0013/0019 (sections 1-3 only dedup ahead of a UNIQUE this file builds).
-- ---------------------------------------------------------------------------
SET @sched_hb_idx_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_attempt_presence'
      AND index_name = 'idx_student_attempt_presence_schedule_heartbeat'
);
SET @sched_hb_idx_sql := IF(
    @sched_hb_idx_exists = 0,
    'CREATE INDEX idx_student_attempt_presence_schedule_heartbeat ON student_attempt_presence(schedule_id, last_heartbeat_at DESC)',
    'SELECT 1'
);
PREPARE sched_hb_idx_stmt FROM @sched_hb_idx_sql;
EXECUTE sched_hb_idx_stmt;
DEALLOCATE PREPARE sched_hb_idx_stmt;

SET @viol_id_col_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'student_violation_events'
      AND column_name = 'violation_id'
);
SET @viol_id_col_sql := IF(
    @viol_id_col_exists = 0,
    'ALTER TABLE student_violation_events ADD COLUMN violation_id VARCHAR(64) NULL AFTER attempt_id',
    'SELECT 1'
);
PREPARE viol_id_col_stmt FROM @viol_id_col_sql;
EXECUTE viol_id_col_stmt;
DEALLOCATE PREPARE viol_id_col_stmt;

SET @viol_uq_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'student_violation_events'
      AND index_name = 'uq_student_violation_attempt_business_id'
);
SET @viol_uq_sql := IF(
    @viol_uq_exists = 0,
    'CREATE UNIQUE INDEX uq_student_violation_attempt_business_id ON student_violation_events(attempt_id, violation_id)',
    'SELECT 1'
);
PREPARE viol_uq_stmt FROM @viol_uq_sql;
EXECUTE viol_uq_stmt;
DEALLOCATE PREPARE viol_uq_stmt;

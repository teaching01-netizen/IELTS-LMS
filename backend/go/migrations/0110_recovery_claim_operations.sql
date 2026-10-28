-- 0110_recovery_claim_operations.sql
-- Claim operation identity for staff-assisted exam recovery
-- (docs/superpowers/plans/2026-10-28-staff-assisted-exam-recovery.md §5.2).
--
-- Claim is the first student action. It consumes the single-use code and
-- binds the browser proof; a lost response must be replayable by that same
-- browser without consuming anything a second time. claim_proof_hash (0105)
-- already stores the proof identity. claim_operation_id makes the operation
-- identity explicit:
--
--   - the same operation id + same proof replays the ready projection;
--   - a different operation id after a committed claim is a conflict, not a
--     second consumption and not a silent reuse of another browser's claim;
--   - a different proof never sees the ready projection.
--
-- The column is NULL for untouched grants. Expand-only and crash-retry safe:
-- the ALTER is information_schema-guarded so a partial apply converges.

SET @recovery_claim_operation_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'attempt_device_recovery_grants'
      AND column_name = 'claim_operation_id'
);
SET @recovery_claim_operation_sql := IF(
    @recovery_claim_operation_exists = 0,
    'ALTER TABLE attempt_device_recovery_grants ADD COLUMN claim_operation_id VARCHAR(64) NULL AFTER claim_proof_hash',
    'SELECT 1'
);
PREPARE recovery_claim_operation_stmt FROM @recovery_claim_operation_sql;
EXECUTE recovery_claim_operation_stmt;
DEALLOCATE PREPARE recovery_claim_operation_stmt;

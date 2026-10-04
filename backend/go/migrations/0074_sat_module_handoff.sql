-- 0074_sat_module_handoff.sql
-- SAT Module 1 -> Module 2 handoff under load (docs/sat-m1-m2-handoff-plan.md).
--
-- Expand-only; every column is nullable, so code that predates this migration
-- keeps working against it.
--
-- - assessment_module_attempts.auto_start_at: a routed Module 2 inserted under
--   SAT_HANDOFF_MODE=client_start waits not_started for the browser to start
--   it (StartModule). auto_start_at is the server backstop: the reconciler
--   starts the clock then if the browser never did. NULL for every other row,
--   whose activation keeps using available_at.
-- - assessment_route_decisions.route_basis: what closed the base module that
--   produced the decision (client_confirmed | window_closed | proctor_end |
--   proctor_terminate | room_completed).
-- - assessment_route_decisions.late_answer_count: base-module answers whose
--   last accepted write arrived after the module deadline (audit only).

SET @auto_start_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND column_name = 'auto_start_at'
);
SET @auto_start_sql := IF(
    @auto_start_exists = 0,
    'ALTER TABLE assessment_module_attempts ADD COLUMN auto_start_at TIMESTAMP(6) NULL AFTER available_at',
    'SELECT 1'
);
PREPARE auto_start_stmt FROM @auto_start_sql;
EXECUTE auto_start_stmt;
DEALLOCATE PREPARE auto_start_stmt;

-- The personal timeout sweep scans due backstop rows by (state, auto_start_at).
SET @idx_auto_start_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_module_attempts'
      AND index_name = 'idx_assessment_module_auto_start'
);
SET @idx_auto_start_sql := IF(
    @idx_auto_start_exists = 0,
    'CREATE INDEX idx_assessment_module_auto_start ON assessment_module_attempts(state, auto_start_at, id)',
    'SELECT 1'
);
PREPARE idx_auto_start_stmt FROM @idx_auto_start_sql;
EXECUTE idx_auto_start_stmt;
DEALLOCATE PREPARE idx_auto_start_stmt;

SET @route_basis_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'assessment_route_decisions'
      AND column_name = 'route_basis'
);
SET @route_basis_sql := IF(
    @route_basis_exists = 0,
    'ALTER TABLE assessment_route_decisions ADD COLUMN route_basis VARCHAR(32) NULL AFTER policy_config, ADD COLUMN late_answer_count INT NULL AFTER route_basis',
    'SELECT 1'
);
PREPARE route_basis_stmt FROM @route_basis_sql;
EXECUTE route_basis_stmt;
DEALLOCATE PREPARE route_basis_stmt;

SET @handoff_mode_exists := (SELECT COUNT(*) FROM information_schema.columns
 WHERE table_schema = DATABASE() AND table_name = 'exam_session_runtimes' AND column_name = 'sat_handoff_mode');
SET @handoff_mode_sql := IF(@handoff_mode_exists = 0,
 'ALTER TABLE exam_session_runtimes ADD COLUMN sat_handoff_mode VARCHAR(32) NULL AFTER timing_model', 'SELECT 1');
PREPARE handoff_mode_stmt FROM @handoff_mode_sql;
EXECUTE handoff_mode_stmt;
DEALLOCATE PREPARE handoff_mode_stmt;

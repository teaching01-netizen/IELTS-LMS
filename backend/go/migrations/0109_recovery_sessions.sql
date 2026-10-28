-- 0109_recovery_sessions.sql
-- Scoped student sessions for staff-assisted exam recovery
-- (docs/superpowers/plans/2026-10-28-staff-assisted-exam-recovery.md §4.5).
--
-- A recovered browser gets a real user_sessions row so ordinary cookie
-- authentication, CSRF, idle/absolute expiry and logout keep working. The
-- row is bound to exactly one attempt through recovery_attempt_id; the
-- schedule is derived from that attempt at lookup time and is never stored
-- in practice_schedule_id.
--
-- Expand-only and crash-retry safe:
--   - the column, index, foreign key and widened CHECK are each added only
--     when absent, so re-running after a partial apply converges;
--   - existing rows keep authentication_source NULL (legacy) or account /
--     practice exactly as before;
--   - the foreign key is ON DELETE CASCADE so an attempt deletion revokes
--     the scoped session instead of leaving a dangling authority.
--
-- ON DELETE CASCADE is safe here: a recovery session has no meaning without
-- its attempt, and deleting an attempt already cascades its credentials.

SET @recovery_attempt_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND column_name = 'recovery_attempt_id'
);
SET @recovery_attempt_sql := IF(
    @recovery_attempt_exists = 0,
    'ALTER TABLE user_sessions ADD COLUMN recovery_attempt_id VARCHAR(36) NULL AFTER practice_schedule_id',
    'SELECT 1'
);
PREPARE recovery_attempt_stmt FROM @recovery_attempt_sql;
EXECUTE recovery_attempt_stmt;
DEALLOCATE PREPARE recovery_attempt_stmt;

SET @recovery_session_index_exists := (
    SELECT COUNT(*)
    FROM information_schema.statistics
    WHERE table_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND index_name = 'idx_user_sessions_recovery_attempt'
);
SET @recovery_session_index_sql := IF(
    @recovery_session_index_exists = 0,
    'ALTER TABLE user_sessions ADD INDEX idx_user_sessions_recovery_attempt (recovery_attempt_id)',
    'SELECT 1'
);
PREPARE recovery_session_index_stmt FROM @recovery_session_index_sql;
EXECUTE recovery_session_index_stmt;
DEALLOCATE PREPARE recovery_session_index_stmt;

SET @recovery_session_fk_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND constraint_name = 'fk_user_session_recovery_attempt'
);
SET @recovery_session_fk_sql := IF(
    @recovery_session_fk_exists = 0,
    'ALTER TABLE user_sessions ADD CONSTRAINT fk_user_session_recovery_attempt FOREIGN KEY (recovery_attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE',
    'SELECT 1'
);
PREPARE recovery_session_fk_stmt FROM @recovery_session_fk_sql;
EXECUTE recovery_session_fk_stmt;
DEALLOCATE PREPARE recovery_session_fk_stmt;

-- Widen the authentication-origin CHECK. Detect convergence by the clause
-- text instead of only the constraint name, so a re-run after a partial
-- deployment does not repeatedly drop/re-add a validated constraint.
SET @recovery_session_check_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND constraint_name = 'chk_user_session_authentication_source'
);
SET @recovery_session_check_widened := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints tc
    JOIN information_schema.check_constraints cc
      ON cc.constraint_schema = tc.constraint_schema
     AND cc.constraint_name = tc.constraint_name
    WHERE tc.constraint_schema = DATABASE()
      AND tc.table_name = 'user_sessions'
      AND tc.constraint_name = 'chk_user_session_authentication_source'
      AND cc.check_clause LIKE '%recovery%'
);
SET @recovery_session_check_sql := IF(
    @recovery_session_check_widened = 0,
    IF(
        @recovery_session_check_exists = 0,
        'ALTER TABLE user_sessions ADD CONSTRAINT chk_user_session_authentication_source CHECK ((authentication_source IS NULL AND practice_schedule_id IS NULL AND recovery_attempt_id IS NULL) OR (authentication_source = ''account'' AND practice_schedule_id IS NULL AND recovery_attempt_id IS NULL) OR (authentication_source = ''practice'' AND practice_schedule_id IS NOT NULL AND recovery_attempt_id IS NULL AND role_snapshot = ''student'') OR (authentication_source = ''recovery'' AND practice_schedule_id IS NULL AND recovery_attempt_id IS NOT NULL AND role_snapshot = ''student''))',
        'ALTER TABLE user_sessions DROP CHECK chk_user_session_authentication_source, ADD CONSTRAINT chk_user_session_authentication_source CHECK ((authentication_source IS NULL AND practice_schedule_id IS NULL AND recovery_attempt_id IS NULL) OR (authentication_source = ''account'' AND practice_schedule_id IS NULL AND recovery_attempt_id IS NULL) OR (authentication_source = ''practice'' AND practice_schedule_id IS NOT NULL AND recovery_attempt_id IS NULL AND role_snapshot = ''student'') OR (authentication_source = ''recovery'' AND practice_schedule_id IS NULL AND recovery_attempt_id IS NOT NULL AND role_snapshot = ''student''))'
    ),
    'SELECT 1'
);
PREPARE recovery_session_check_stmt FROM @recovery_session_check_sql;
EXECUTE recovery_session_check_stmt;
DEALLOCATE PREPARE recovery_session_check_stmt;

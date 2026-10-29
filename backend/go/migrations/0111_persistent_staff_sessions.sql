-- 0111_persistent_staff_sessions.sql
-- Remembered staff sessions and password-authentication freshness
-- (docs/plans/2026-10-29-persistent-login-low-level.md §3).
--
-- Expand-only and crash-retry safe: every column and CHECK is added only
-- when absent, so re-running after a partial apply converges.
--
--   remembered                   staff opted in to "keep me signed in";
--                                written by password issuance only. Existing
--                                rows default to FALSE and are never promoted.
--   idle_window_seconds          policy snapshot chosen at issuance; NULL means
--                                the legacy role/config idle window applies.
--   credential_authenticated_at  time of an accepted real password
--                                verification. NULL requires confirmation for
--                                sensitive actions. Never backfilled.
--
-- Legacy rows are not constrained to idle_timeout_at <= expires_at: lookup
-- already enforces the absolute deadline and new issuance/touch apply the cap.

SET @remembered_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND column_name = 'remembered'
);
SET @remembered_sql := IF(
    @remembered_exists = 0,
    'ALTER TABLE user_sessions ADD COLUMN remembered BOOLEAN NOT NULL DEFAULT FALSE',
    'SELECT 1'
);
PREPARE remembered_stmt FROM @remembered_sql;
EXECUTE remembered_stmt;
DEALLOCATE PREPARE remembered_stmt;

SET @idle_window_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND column_name = 'idle_window_seconds'
);
SET @idle_window_sql := IF(
    @idle_window_exists = 0,
    'ALTER TABLE user_sessions ADD COLUMN idle_window_seconds INT UNSIGNED NULL',
    'SELECT 1'
);
PREPARE idle_window_stmt FROM @idle_window_sql;
EXECUTE idle_window_stmt;
DEALLOCATE PREPARE idle_window_stmt;

SET @credential_at_exists := (
    SELECT COUNT(*)
    FROM information_schema.columns
    WHERE table_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND column_name = 'credential_authenticated_at'
);
SET @credential_at_sql := IF(
    @credential_at_exists = 0,
    'ALTER TABLE user_sessions ADD COLUMN credential_authenticated_at TIMESTAMP NULL DEFAULT NULL',
    'SELECT 1'
);
PREPARE credential_at_stmt FROM @credential_at_sql;
EXECUTE credential_at_stmt;
DEALLOCATE PREPARE credential_at_stmt;

SET @idle_window_check_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND constraint_name = 'chk_user_session_idle_window'
);
SET @idle_window_check_sql := IF(
    @idle_window_check_exists = 0,
    'ALTER TABLE user_sessions ADD CONSTRAINT chk_user_session_idle_window CHECK (idle_window_seconds IS NULL OR idle_window_seconds > 0)',
    'SELECT 1'
);
PREPARE idle_window_check_stmt FROM @idle_window_check_sql;
EXECUTE idle_window_check_stmt;
DEALLOCATE PREPARE idle_window_check_stmt;

-- A remembered row must be a password-authenticated, unscoped staff account
-- session that carries its own idle policy. admin_observer is deliberately
-- excluded until the frontend supports that role. The null-safe <=> keeps a
-- NULL (legacy) origin from making the CHECK UNKNOWN, which MySQL accepts.
SET @remembered_check_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE constraint_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND constraint_name = 'chk_user_session_remembered'
);
SET @remembered_check_sql := IF(
    @remembered_check_exists = 0,
    'ALTER TABLE user_sessions ADD CONSTRAINT chk_user_session_remembered CHECK (remembered IN (0, 1) AND (remembered = 0 OR (authentication_source <=> ''account'' AND practice_schedule_id IS NULL AND recovery_attempt_id IS NULL AND role_snapshot IN (''admin'', ''builder'', ''proctor'', ''grader'') AND idle_window_seconds IS NOT NULL AND credential_authenticated_at IS NOT NULL)))',
    'SELECT 1'
);
PREPARE remembered_check_stmt FROM @remembered_check_sql;
EXECUTE remembered_check_stmt;
DEALLOCATE PREPARE remembered_check_stmt;

-- Extend first-party identity constraints for the read-only platform observer role.
-- Prod safety: look the anonymous CHECK names up dynamically (0050/0052 idiom).
-- MySQL names them <table>_chk_1, but TiDB/partial shapes may differ; a
-- hardcoded DROP CHECK would abort the whole deploy on a name mismatch.
SET @users_role_check_name := (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.check_constraints AS cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE()
      AND tc.table_name = 'users'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%role%'
    LIMIT 1
);
SET @users_role_drop_sql := IF(
    @users_role_check_name IS NULL
    OR @users_role_check_name = 'chk_users_role',
    'SELECT 1',
    CONCAT('ALTER TABLE users DROP CHECK `', @users_role_check_name, '`')
);
PREPARE users_role_drop_stmt FROM @users_role_drop_sql;
EXECUTE users_role_drop_stmt;
DEALLOCATE PREPARE users_role_drop_stmt;

SET @users_role_named_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'users'
      AND constraint_name = 'chk_users_role'
);
SET @users_role_add_sql := IF(
    @users_role_named_exists = 0,
    'ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN (\'admin\', \'admin_observer\', \'builder\', \'proctor\', \'grader\', \'student\'))',
    'SELECT 1'
);
PREPARE users_role_add_stmt FROM @users_role_add_sql;
EXECUTE users_role_add_stmt;
DEALLOCATE PREPARE users_role_add_stmt;

SET @sessions_role_check_name := (
    SELECT tc.constraint_name
    FROM information_schema.table_constraints AS tc
    INNER JOIN information_schema.check_constraints AS cc
        ON cc.constraint_schema = tc.constraint_schema
        AND cc.constraint_name = tc.constraint_name
    WHERE tc.table_schema = DATABASE()
      AND tc.table_name = 'user_sessions'
      AND tc.constraint_type = 'CHECK'
      AND cc.check_clause LIKE '%role_snapshot%'
    LIMIT 1
);
SET @sessions_role_drop_sql := IF(
    @sessions_role_check_name IS NULL
    OR @sessions_role_check_name = 'chk_user_sessions_role_snapshot',
    'SELECT 1',
    CONCAT('ALTER TABLE user_sessions DROP CHECK `', @sessions_role_check_name, '`')
);
PREPARE sessions_role_drop_stmt FROM @sessions_role_drop_sql;
EXECUTE sessions_role_drop_stmt;
DEALLOCATE PREPARE sessions_role_drop_stmt;

SET @sessions_role_named_exists := (
    SELECT COUNT(*)
    FROM information_schema.table_constraints
    WHERE table_schema = DATABASE()
      AND table_name = 'user_sessions'
      AND constraint_name = 'chk_user_sessions_role_snapshot'
);
SET @sessions_role_add_sql := IF(
    @sessions_role_named_exists = 0,
    'ALTER TABLE user_sessions ADD CONSTRAINT chk_user_sessions_role_snapshot CHECK (role_snapshot IN (\'admin\', \'admin_observer\', \'builder\', \'proctor\', \'grader\', \'student\'))',
    'SELECT 1'
);
PREPARE sessions_role_add_stmt FROM @sessions_role_add_sql;
EXECUTE sessions_role_add_stmt;
DEALLOCATE PREPARE sessions_role_add_stmt;

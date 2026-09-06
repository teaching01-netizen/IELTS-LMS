-- Extend first-party identity constraints for the read-only platform observer role.
-- MySQL names anonymous CHECK constraints as <table>_chk_1.
ALTER TABLE users DROP CHECK users_chk_1;
ALTER TABLE users ADD CONSTRAINT chk_users_role
    CHECK (role IN ('admin', 'admin_observer', 'builder', 'proctor', 'grader', 'student'));

ALTER TABLE user_sessions DROP CHECK user_sessions_chk_1;
ALTER TABLE user_sessions ADD CONSTRAINT chk_user_sessions_role_snapshot
    CHECK (role_snapshot IN ('admin', 'admin_observer', 'builder', 'proctor', 'grader', 'student'));

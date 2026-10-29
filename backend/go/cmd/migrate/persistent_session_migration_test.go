package main

// Persistent staff session migration pin (0111).
//
// The static audit keeps the file expand-only and information_schema-guarded.
// The TEST_MYSQL_DSN-gated test builds the post-0109 user_sessions shape,
// seeds legacy rows, applies 0111 twice (crash-resume) and asserts that
// legacy rows stay short sessions while the remembered CHECK rejects every
// row that is not an unscoped, password-authenticated staff account session.

import (
	"strings"
	"testing"
)

const persistentSessionMigration = "0111_persistent_staff_sessions.sql"

func TestPersistentSessionMigrationIsAdditiveAndGuarded(t *testing.T) {
	raw := loadStaffRecoveryMigration(t, persistentSessionMigration)
	lower := strings.ToLower(raw)
	for _, want := range []string{
		"add column remembered boolean not null default false",
		"add column idle_window_seconds int unsigned null",
		"add column credential_authenticated_at timestamp null default null",
		"chk_user_session_idle_window",
		"chk_user_session_remembered",
		"information_schema.columns",
		"information_schema.table_constraints",
	} {
		if !strings.Contains(lower, want) {
			t.Errorf("%s is missing contract %q", persistentSessionMigration, want)
		}
	}
	if strings.Contains(lower, "update user_sessions") {
		t.Errorf("%s must not backfill or promote existing sessions", persistentSessionMigration)
	}
	for _, statement := range splitStatements(raw) {
		upper := strings.ToUpper(strings.TrimSpace(stripSQLComments(statement)))
		for _, forbidden := range []string{"DROP TABLE ", "TRUNCATE ", "DELETE FROM ", "DROP COLUMN ", "ALTER TABLE ", "UPDATE "} {
			if strings.HasPrefix(upper, forbidden) {
				t.Errorf("%s contains unguarded or destructive statement %.140q", persistentSessionMigration, statement)
			}
		}
	}
}

func TestPersistentSessionMigrationMySQL(t *testing.T) {
	conn := staffRecoveryConn(t)
	for _, ddl := range []string{
		`CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)`,
		`CREATE TABLE user_sessions (
			id VARCHAR(36) PRIMARY KEY,
			user_id VARCHAR(36) NOT NULL,
			role_snapshot VARCHAR(50) NOT NULL,
			expires_at TIMESTAMP NOT NULL,
			idle_timeout_at TIMESTAMP NOT NULL,
			authentication_source VARCHAR(16) NULL,
			practice_schedule_id VARCHAR(36) NULL,
			recovery_attempt_id VARCHAR(36) NULL
		)`,
		`INSERT INTO users (id) VALUES ('u-1')`,
		`INSERT INTO user_sessions (id, user_id, role_snapshot, expires_at, idle_timeout_at, authentication_source)
		 VALUES ('legacy-staff', 'u-1', 'builder', '2030-01-01 00:00:00', '2030-01-01 00:00:00', 'account'),
		        ('legacy-null', 'u-1', 'admin', '2030-01-01 00:00:00', '2030-01-01 00:00:00', NULL)`,
	} {
		mustExec(t, conn, ddl)
	}

	applyStaffRecoveryMigration(t, conn, persistentSessionMigration)
	applyStaffRecoveryMigration(t, conn, persistentSessionMigration)

	var promoted int
	if err := conn.QueryRowContext(t.Context(),
		`SELECT COUNT(*) FROM user_sessions WHERE remembered <> 0 OR idle_window_seconds IS NOT NULL OR credential_authenticated_at IS NOT NULL`).Scan(&promoted); err != nil {
		t.Fatal(err)
	}
	if promoted != 0 {
		t.Fatalf("legacy sessions must stay short sessions, %d promoted", promoted)
	}

	insert := `INSERT INTO user_sessions (id, user_id, role_snapshot, expires_at, idle_timeout_at, authentication_source, practice_schedule_id, recovery_attempt_id, remembered, idle_window_seconds, credential_authenticated_at) VALUES `
	mustExec(t, conn, insert+`('ok-remembered', 'u-1', 'builder', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 1, 604800, '2029-11-01')`)
	mustExec(t, conn, insert+`('ok-short', 'u-1', 'proctor', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 0, 1800, '2029-11-01')`)
	mustExec(t, conn, insert+`('ok-student', 'u-1', 'student', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 0, NULL, NULL)`)

	for why, values := range map[string]string{
		"remembered student":            `('bad-1', 'u-1', 'student', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 1, 3600, '2029-11-01')`,
		"remembered admin observer":     `('bad-2', 'u-1', 'admin_observer', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 1, 3600, '2029-11-01')`,
		"remembered legacy origin":      `('bad-3', 'u-1', 'builder', '2030-01-01', '2029-12-01', NULL, NULL, NULL, 1, 3600, '2029-11-01')`,
		"remembered practice scope":     `('bad-4', 'u-1', 'builder', '2030-01-01', '2029-12-01', 'account', 'sched-1', NULL, 1, 3600, '2029-11-01')`,
		"remembered recovery scope":     `('bad-5', 'u-1', 'builder', '2030-01-01', '2029-12-01', 'account', NULL, 'att-1', 1, 3600, '2029-11-01')`,
		"remembered without idle":       `('bad-6', 'u-1', 'builder', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 1, NULL, '2029-11-01')`,
		"remembered without password":   `('bad-7', 'u-1', 'builder', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 1, 3600, NULL)`,
		"non-boolean remembered":        `('bad-8', 'u-1', 'builder', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 2, 3600, '2029-11-01')`,
		"zero idle window":              `('bad-9', 'u-1', 'builder', '2030-01-01', '2029-12-01', 'account', NULL, NULL, 0, 0, NULL)`,
	} {
		mustFail(t, conn, insert+values, why)
	}
}

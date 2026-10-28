package main

// Staff-assisted exam recovery migration pins (0105-0110).
//
// The static audit proves the files stay expand-only and every ALTER is
// information_schema-guarded, so a crash mid-file can be retried. The
// TEST_MYSQL_DSN-gated test builds the pre-feature table shapes, seeds a
// generation-0 row in each artifact, applies all four migrations twice, and
// asserts the end contract:
//
//   - existing rows stay readable at generation 0;
//   - a reopened sitting can append generation 1 receipts/submissions;
//   - duplicate current identities remain rejected;
//   - one live grant per attempt, bounded wrong-code budget and bounded award;
//   - one audio checkpoint stream per pinned part/media revision.
//
// Without TEST_MYSQL_DSN the DB test skips cleanly.

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

var staffRecoveryMigrationFiles = []string{
	"0105_staff_device_recovery.sql",
	"0106_recovery_completion_generations.sql",
	"0107_recovery_module_runs.sql",
	"0108_audio_checkpoints.sql",
	"0109_recovery_sessions.sql",
	"0110_recovery_claim_operations.sql",
}

func loadStaffRecoveryMigration(t *testing.T, name string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join(migDir(t), name))
	if err != nil {
		t.Fatalf("read %s: %v", name, err)
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		t.Fatalf("%s is empty", name)
	}
	return string(b)
}

func TestStaffRecoveryMigrationsAreAdditiveAndGuarded(t *testing.T) {
	contracts := map[string][]string{
		"0105_staff_device_recovery.sql": {
			"add column recovery_control json null",
			"add column terminal_generation bigint unsigned not null default 0",
			"create table if not exists attempt_device_recovery_grants",
			"unique (active_attempt_id)",
			"unique (operation_id)",
			"check (failed_code_count <= 5)",
			"requested_remaining_seconds between 1 and 86400",
			"sealed_issuance blob",
		},
		"0106_recovery_completion_generations.sql": {
			"alter table attempt_terminalizations drop primary key, add primary key (attempt_id, terminal_generation)",
			"alter table attempt_submissions_v2 drop primary key, add primary key (attempt_id, terminal_generation)",
			"uq_student_submissions_attempt_generation",
			"drop index",
		},
		"0107_recovery_module_runs.sql": {
			"add primary key (module_attempt_id, run_generation)",
			"add primary key (module_attempt_id, run_generation, resolution_id)",
			"add primary key (module_attempt_id, run_generation, question_id)",
			"add column completion_reason varchar(32) null",
			"chk_ielts_timeline_completion_reason",
		},
		"0108_audio_checkpoints.sql": {
			"create table if not exists attempt_audio_checkpoints",
			"primary key (attempt_id, section_key, part_id, media_revision)",
			"client_sequence bigint unsigned",
			"lease_epoch bigint unsigned",
			"run_generation bigint unsigned",
		},
		"0109_recovery_sessions.sql": {
			"add column recovery_attempt_id varchar(36) null",
			"idx_user_sessions_recovery_attempt",
			"fk_user_session_recovery_attempt",
			"authentication_source = ''recovery''",
			"recovery_attempt_id is not null",
			"role_snapshot = ''student''",
		},
		"0110_recovery_claim_operations.sql": {
			"add column claim_operation_id varchar(64) null after claim_proof_hash",
			"information_schema.columns",
		},
	}

	for name, wants := range contracts {
		t.Run(name, func(t *testing.T) {
			raw := loadStaffRecoveryMigration(t, name)
			lower := strings.ToLower(raw)
			for _, want := range wants {
				if !strings.Contains(lower, want) {
					t.Errorf("%s is missing contract %q", name, want)
				}
			}
			for _, statement := range splitStatements(raw) {
				upper := strings.ToUpper(strings.TrimSpace(stripSQLComments(statement)))
				for _, forbidden := range []string{"DROP TABLE ", "TRUNCATE ", "DELETE FROM ", "DROP COLUMN "} {
					if strings.HasPrefix(upper, forbidden) {
						t.Errorf("%s contains destructive statement %.140q", name, statement)
					}
				}
				// Every ALTER must be crash-retry safe: a bare ALTER that can
				// run twice is drift. The only bare DDL allowed is an
				// idempotent CREATE TABLE IF NOT EXISTS.
				if strings.HasPrefix(upper, "ALTER TABLE ") {
					t.Errorf("%s contains unprepared ALTER %.140q", name, statement)
				}
			}
		})
	}
}

func TestStaffRecoveryMigrationsMySQL(t *testing.T) {
	conn := staffRecoveryConn(t)
	createStaffRecoveryLegacySchema(t, conn)
	seedStaffRecoveryLegacyRows(t, conn)

	for _, name := range staffRecoveryMigrationFiles {
		applyStaffRecoveryMigration(t, conn, name)
		applyStaffRecoveryMigration(t, conn, name) // crash-resume must converge
	}

	assertStaffRecoveryGenerationContract(t, conn)
	assertStaffRecoveryGrantContract(t, conn)
	assertStaffRecoveryModuleRunContract(t, conn)
	assertStaffRecoveryAudioContract(t, conn)
	assertStaffRecoverySessionContract(t, conn)
}

func staffRecoveryConn(t *testing.T) *sql.Conn {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; staff recovery migration test requires real MySQL")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := pool.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	name := fmt.Sprintf("staff_recovery_%d", time.Now().UnixNano())
	if _, err := pool.Exec("CREATE DATABASE `" + name + "`"); err != nil {
		t.Fatalf("create scratch schema: %v", err)
	}
	t.Cleanup(func() { _, _ = pool.Exec("DROP DATABASE IF EXISTS `" + name + "`") })
	conn, err := pool.Conn(t.Context())
	if err != nil {
		t.Fatalf("acquire conn: %v", err)
	}
	t.Cleanup(func() { _ = conn.Close() })
	if _, err := conn.ExecContext(t.Context(), "USE `"+name+"`"); err != nil {
		t.Fatalf("use scratch schema: %v", err)
	}
	return conn
}

func createStaffRecoveryLegacySchema(t *testing.T, conn *sql.Conn) {
	t.Helper()
	ddls := []string{
		`CREATE TABLE student_attempts (
			id VARCHAR(36) PRIMARY KEY,
			recovery JSON NULL
		)`,
		`CREATE TABLE exam_schedules (id VARCHAR(36) PRIMARY KEY)`,
		`CREATE TABLE users (id VARCHAR(36) PRIMARY KEY)`,
		`CREATE TABLE user_sessions (
			id VARCHAR(36) PRIMARY KEY,
			user_id VARCHAR(36) NOT NULL,
			role_snapshot VARCHAR(16) NOT NULL,
			authentication_source VARCHAR(16) NULL,
			practice_schedule_id VARCHAR(36) NULL,
			CONSTRAINT chk_user_session_authentication_source CHECK (
				(authentication_source IS NULL AND practice_schedule_id IS NULL)
				OR (authentication_source = 'account' AND practice_schedule_id IS NULL)
				OR (authentication_source = 'practice' AND practice_schedule_id IS NOT NULL AND role_snapshot = 'student')
			)
		)`,
		`CREATE TABLE attempt_terminalizations (
			attempt_id VARCHAR(36) NOT NULL,
			terminalization_id VARCHAR(36) NOT NULL,
			PRIMARY KEY (attempt_id),
			UNIQUE KEY uq_attempt_terminalizations_id (terminalization_id),
			CONSTRAINT fk_term_attempt FOREIGN KEY (attempt_id)
				REFERENCES student_attempts(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE student_submissions (
			id VARCHAR(36) PRIMARY KEY,
			attempt_id VARCHAR(36) NOT NULL UNIQUE,
			FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE assessment_results (
			id VARCHAR(36) PRIMARY KEY,
			attempt_id VARCHAR(36) NULL,
			provider_key VARCHAR(32) NOT NULL,
			UNIQUE KEY uq_assessment_result_attempt_provider (attempt_id, provider_key)
		)`,
		`CREATE TABLE attempt_submissions_v2 (
			attempt_id VARCHAR(36) NOT NULL PRIMARY KEY,
			submission_id VARCHAR(64) NOT NULL,
			UNIQUE KEY uq_attempt_submissions_v2_submission (submission_id),
			FOREIGN KEY (attempt_id) REFERENCES student_attempts(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE assessment_module_attempts (
			id VARCHAR(36) PRIMARY KEY,
			attempt_id VARCHAR(36) NOT NULL,
			module_id VARCHAR(36) NOT NULL,
			state VARCHAR(32) NOT NULL DEFAULT 'not_started',
			UNIQUE KEY module_attempt_identity (attempt_id, module_id)
		)`,
		`CREATE TABLE assessment_module_boundaries (
			module_attempt_id VARCHAR(36) NOT NULL PRIMARY KEY,
			attempt_id VARCHAR(36) NOT NULL,
			phase VARCHAR(24) NOT NULL,
			FOREIGN KEY (module_attempt_id)
				REFERENCES assessment_module_attempts(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE assessment_module_close_intents (
			module_attempt_id VARCHAR(36) NOT NULL PRIMARY KEY,
			attempt_id VARCHAR(36) NOT NULL,
			registration_id VARCHAR(64) NOT NULL,
			UNIQUE KEY uq_sat_close_intents_attempt_registration (attempt_id, registration_id)
		)`,
		`CREATE TABLE assessment_module_boundary_resolutions (
			module_attempt_id VARCHAR(36) NOT NULL,
			resolution_id VARCHAR(64) NOT NULL,
			PRIMARY KEY (module_attempt_id, resolution_id)
		)`,
		`CREATE TABLE assessment_late_answer_evidence (
			id VARCHAR(36) PRIMARY KEY,
			module_attempt_id VARCHAR(36) NOT NULL
		)`,
		`CREATE TABLE assessment_late_evidence_frontiers (
			module_attempt_id VARCHAR(36) NOT NULL,
			question_id VARCHAR(255) NOT NULL,
			latest_evidence_id VARCHAR(36) NOT NULL,
			PRIMARY KEY (module_attempt_id, question_id)
		)`,
		`CREATE TABLE ielts_attempt_section_timelines (
			id VARCHAR(36) PRIMARY KEY,
			attempt_id VARCHAR(36) NOT NULL,
			section_key VARCHAR(64) NOT NULL,
			UNIQUE KEY uq_ielts_attempt_section (attempt_id, section_key)
		)`,
	}
	for _, ddl := range ddls {
		if _, err := conn.ExecContext(t.Context(), ddl); err != nil {
			t.Fatalf("create legacy schema: %v (%s)", err, ddl)
		}
	}
}

func seedStaffRecoveryLegacyRows(t *testing.T, conn *sql.Conn) {
	t.Helper()
	stmts := []string{
		`INSERT INTO student_attempts (id, recovery) VALUES ('att-1', NULL), ('att-2', NULL)`,
		`INSERT INTO exam_schedules (id) VALUES ('sched-1')`,
		`INSERT INTO users (id) VALUES ('student-1')`,
		`INSERT INTO user_sessions (id, user_id, role_snapshot, authentication_source) VALUES ('sess-account', 'student-1', 'student', 'account')`,
		`INSERT INTO attempt_terminalizations (attempt_id, terminalization_id) VALUES ('att-1', 'term-0')`,
		`INSERT INTO student_submissions (id, attempt_id) VALUES ('sub-0', 'att-1')`,
		`INSERT INTO assessment_results (id, attempt_id, provider_key) VALUES ('res-0', 'att-1', 'sat')`,
		`INSERT INTO attempt_submissions_v2 (attempt_id, submission_id) VALUES ('att-1', 'v2-0')`,
		`INSERT INTO assessment_module_attempts (id, attempt_id, module_id) VALUES ('ma-1', 'att-1', 'mod-1')`,
		`INSERT INTO assessment_module_boundaries (module_attempt_id, attempt_id, phase) VALUES ('ma-1', 'att-1', 'working')`,
		`INSERT INTO assessment_module_close_intents (module_attempt_id, attempt_id, registration_id) VALUES ('ma-1', 'att-1', 'reg-0')`,
		`INSERT INTO assessment_module_boundary_resolutions (module_attempt_id, resolution_id) VALUES ('ma-1', 'res-0')`,
		`INSERT INTO assessment_late_answer_evidence (id, module_attempt_id) VALUES ('ev-0', 'ma-1')`,
		`INSERT INTO assessment_late_evidence_frontiers (module_attempt_id, question_id, latest_evidence_id) VALUES ('ma-1', 'q-1', 'ev-0')`,
		`INSERT INTO ielts_attempt_section_timelines (id, attempt_id, section_key) VALUES ('tl-0', 'att-1', 'listening')`,
	}
	for _, stmt := range stmts {
		if _, err := conn.ExecContext(t.Context(), stmt); err != nil {
			t.Fatalf("seed legacy rows: %v (%s)", err, stmt)
		}
	}
}

func applyStaffRecoveryMigration(t *testing.T, conn *sql.Conn, name string) {
	t.Helper()
	for _, st := range splitStatements(loadStaffRecoveryMigration(t, name)) {
		if strings.TrimSpace(st) == "" {
			continue
		}
		if _, err := conn.ExecContext(t.Context(), st); err != nil {
			t.Fatalf("apply %s: %v (%.160q)", name, err, st)
		}
	}
}

func mustExec(t *testing.T, conn *sql.Conn, stmt string) {
	t.Helper()
	if _, err := conn.ExecContext(t.Context(), stmt); err != nil {
		t.Fatalf("exec: %v (%s)", err, stmt)
	}
}

func mustFail(t *testing.T, conn *sql.Conn, stmt, why string) {
	t.Helper()
	if _, err := conn.ExecContext(t.Context(), stmt); err == nil {
		t.Fatalf("%s: statement unexpectedly succeeded (%s)", why, stmt)
	}
}

func assertStaffRecoveryGenerationContract(t *testing.T, conn *sql.Conn) {
	t.Helper()
	// Existing immutable history remains readable at generation 0.
	var count int
	if err := conn.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM attempt_terminalizations WHERE terminal_generation = 0`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("generation-0 receipt vanished: count=%d err=%v", count, err)
	}
	if err := conn.QueryRowContext(t.Context(), `SELECT terminal_generation FROM student_submissions WHERE id = 'sub-0'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("generation-0 submission changed: gen=%d err=%v", count, err)
	}

	// A reopened sitting appends a new receipt/submission; duplicates of a
	// completed generation stay rejected.
	mustExec(t, conn, `INSERT INTO attempt_terminalizations (attempt_id, terminalization_id, terminal_generation) VALUES ('att-1', 'term-1', 1)`)
	mustFail(t, conn, `INSERT INTO attempt_terminalizations (attempt_id, terminalization_id, terminal_generation) VALUES ('att-1', 'term-0-dup', 0)`, "duplicate attempt generation")
	mustFail(t, conn, `INSERT INTO attempt_terminalizations (attempt_id, terminalization_id, terminal_generation) VALUES ('att-2', 'term-1', 1)`, "duplicate terminalization id")

	mustExec(t, conn, `INSERT INTO student_submissions (id, attempt_id, terminal_generation) VALUES ('sub-1', 'att-1', 1)`)
	mustFail(t, conn, `INSERT INTO student_submissions (id, attempt_id, terminal_generation) VALUES ('sub-dup', 'att-1', 0)`, "duplicate current submission")

	mustExec(t, conn, `INSERT INTO attempt_submissions_v2 (attempt_id, submission_id, terminal_generation) VALUES ('att-1', 'v2-1', 1)`)
	mustFail(t, conn, `INSERT INTO attempt_submissions_v2 (attempt_id, submission_id, terminal_generation) VALUES ('att-1', 'v2-dup', 0)`, "duplicate attempt generation receipt")
	mustFail(t, conn, `INSERT INTO attempt_submissions_v2 (attempt_id, submission_id, terminal_generation) VALUES ('att-2', 'v2-1', 0)`, "duplicate submission id")

	// The current result projection keeps one row per attempt/provider and
	// records which generation it belongs to.
	if err := conn.QueryRowContext(t.Context(), `SELECT terminal_generation FROM assessment_results WHERE id = 'res-0'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("generation-0 result changed: gen=%d err=%v", count, err)
	}
	mustExec(t, conn, `UPDATE assessment_results SET terminal_generation = 1 WHERE id = 'res-0'`)
}

func assertStaffRecoveryGrantContract(t *testing.T, conn *sql.Conn) {
	t.Helper()
	insert := `INSERT INTO attempt_device_recovery_grants
		(id, attempt_id, schedule_id, issued_by_user_id, operation_id, request_hash,
		 active_attempt_id, state, target_section_key, requested_remaining_seconds,
		 expected_control_epoch, expected_lease_epoch, link_secret_hash, code_mac,
		 issued_at, expires_at)
		VALUES (?, ?, 'sched-1', 'staff-1', ?, REPEAT('a', 64), ?, 'issued', 'reading-writing', ?,
		 3, 4, REPEAT('b', 64), REPEAT('c', 64), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 10 MINUTE)`
	if _, err := conn.ExecContext(t.Context(), insert,
		"grant-1", "att-1", "op-1", "att-1", 600); err != nil {
		t.Fatalf("insert live grant: %v", err)
	}
	// 0110 adds the claim operation identity; untouched grants keep NULL.
	var claimOperation sql.NullString
	if err := conn.QueryRowContext(t.Context(),
		`SELECT claim_operation_id FROM attempt_device_recovery_grants WHERE id = 'grant-1'`).Scan(&claimOperation); err != nil {
		t.Fatalf("claim_operation_id column missing: %v", err)
	}
	if claimOperation.Valid {
		t.Fatalf("claim_operation_id must stay NULL for an unclaimed grant")
	}
	// One live grant per attempt, one operation id per grant.
	mustFail(t, conn, `INSERT INTO attempt_device_recovery_grants
		(id, attempt_id, schedule_id, issued_by_user_id, operation_id, request_hash,
		 active_attempt_id, state, target_section_key, expected_control_epoch, expected_lease_epoch,
		 link_secret_hash, code_mac, issued_at, expires_at)
		VALUES ('grant-2', 'att-2', 'sched-1', 'staff-1', 'op-2', REPEAT('d', 64),
		 'att-1', 'issued', 'math', 1, 1, REPEAT('e', 64), REPEAT('f', 64),
		 UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 10 MINUTE)`, "duplicate live grant")
	mustFail(t, conn, `INSERT INTO attempt_device_recovery_grants
		(id, attempt_id, schedule_id, issued_by_user_id, operation_id, request_hash,
		 active_attempt_id, state, target_section_key, expected_control_epoch, expected_lease_epoch,
		 link_secret_hash, code_mac, issued_at, expires_at)
		VALUES ('grant-3', 'att-2', 'sched-1', 'staff-1', 'op-1', REPEAT('d', 64),
		 'att-2', 'issued', 'math', 1, 1, REPEAT('e', 64), REPEAT('f', 64),
		 UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 10 MINUTE)`, "duplicate operation id")

	// Award and wrong-code bounds are persisted invariants.
	mustExec(t, conn, `INSERT INTO attempt_device_recovery_grants
		(id, attempt_id, schedule_id, issued_by_user_id, operation_id, request_hash,
		 active_attempt_id, state, target_section_key, requested_remaining_seconds,
		 expected_control_epoch, expected_lease_epoch, link_secret_hash, code_mac,
		 issued_at, expires_at)
		VALUES ('grant-4', 'att-2', 'sched-1', 'staff-1', 'op-4', REPEAT('d', 64),
		 'att-2', 'issued', 'math', 86400, 1, 1, REPEAT('e', 64), REPEAT('f', 64),
		 UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 10 MINUTE)`)
	mustFail(t, conn, `UPDATE attempt_device_recovery_grants SET requested_remaining_seconds = 0 WHERE id = 'grant-4'`, "zero award")
	mustFail(t, conn, `UPDATE attempt_device_recovery_grants SET requested_remaining_seconds = 86401 WHERE id = 'grant-4'`, "oversized award")
	mustFail(t, conn, `UPDATE attempt_device_recovery_grants SET failed_code_count = 6 WHERE id = 'grant-4'`, "sixth wrong code")
	mustFail(t, conn, `UPDATE attempt_device_recovery_grants SET state = 'paused' WHERE id = 'grant-4'`, "unknown grant state")

	// Terminal states clear the live marker, releasing the attempt for a
	// later reissue without deleting history.
	mustExec(t, conn, `UPDATE attempt_device_recovery_grants
		SET state = 'expired', active_attempt_id = NULL, sealed_issuance = NULL
		WHERE id = 'grant-1'`)
	mustExec(t, conn, `INSERT INTO attempt_device_recovery_grants
		(id, attempt_id, schedule_id, issued_by_user_id, operation_id, request_hash,
		 active_attempt_id, state, target_section_key, expected_control_epoch, expected_lease_epoch,
		 link_secret_hash, code_mac, issued_at, expires_at)
		VALUES ('grant-5', 'att-1', 'sched-1', 'staff-1', 'op-5', REPEAT('a', 64),
		 'att-1', 'issued', 'reading-writing', 5, 6, REPEAT('b', 64), REPEAT('c', 64),
		 UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 10 MINUTE)`)
}

func assertStaffRecoveryModuleRunContract(t *testing.T, conn *sql.Conn) {
	t.Helper()
	// Untouched runs keep generation 0 and accept a reopened generation
	// without losing the original boundary/receipt/frontier identities.
	mustExec(t, conn, `UPDATE assessment_module_attempts SET run_generation = 1 WHERE id = 'ma-1'`)
	mustExec(t, conn, `INSERT INTO assessment_module_boundaries (module_attempt_id, attempt_id, phase, run_generation) VALUES ('ma-1', 'att-1', 'working', 1)`)
	mustFail(t, conn, `INSERT INTO assessment_module_boundaries (module_attempt_id, attempt_id, phase, run_generation) VALUES ('ma-1', 'att-1', 'working', 0)`, "duplicate boundary generation")
	mustExec(t, conn, `INSERT INTO assessment_module_close_intents (module_attempt_id, attempt_id, registration_id, run_generation) VALUES ('ma-1', 'att-1', 'reg-1', 1)`)
	mustFail(t, conn, `INSERT INTO assessment_module_close_intents (module_attempt_id, attempt_id, registration_id, run_generation) VALUES ('ma-1', 'att-1', 'reg-1-dup', 0)`, "duplicate close intent generation")
	mustExec(t, conn, `INSERT INTO assessment_module_boundary_resolutions (module_attempt_id, resolution_id, run_generation) VALUES ('ma-1', 'res-0', 1)`)
	mustFail(t, conn, `INSERT INTO assessment_module_boundary_resolutions (module_attempt_id, resolution_id, run_generation) VALUES ('ma-1', 'res-0', 0)`, "duplicate resolution generation")
	mustExec(t, conn, `INSERT INTO assessment_late_evidence_frontiers (module_attempt_id, question_id, latest_evidence_id, run_generation) VALUES ('ma-1', 'q-1', 'ev-0', 1)`)
	mustFail(t, conn, `INSERT INTO assessment_late_evidence_frontiers (module_attempt_id, question_id, latest_evidence_id, run_generation) VALUES ('ma-1', 'q-1', 'ev-0', 0)`, "duplicate frontier generation")

	var run uint64
	if err := conn.QueryRowContext(t.Context(), `SELECT run_generation FROM assessment_late_answer_evidence WHERE id = 'ev-0'`).Scan(&run); err != nil || run != 0 {
		t.Fatalf("historical evidence generation changed: gen=%d err=%v", run, err)
	}

	// IELTS timelines distinguish timeout from manual/admin closure.
	mustExec(t, conn, `UPDATE ielts_attempt_section_timelines SET completion_reason = 'time_expired', run_generation = 1 WHERE id = 'tl-0'`)
	mustExec(t, conn, `UPDATE ielts_attempt_section_timelines SET completion_reason = 'student_submit' WHERE id = 'tl-0'`)
	mustFail(t, conn, `UPDATE ielts_attempt_section_timelines SET completion_reason = 'mystery' WHERE id = 'tl-0'`, "unknown IELTS completion reason")
}

func assertStaffRecoveryAudioContract(t *testing.T, conn *sql.Conn) {
	t.Helper()
	insert := `INSERT INTO attempt_audio_checkpoints
		(attempt_id, section_key, part_id, media_revision, position_ms, client_sequence, lease_epoch, run_generation)
		VALUES ('att-1', 'listening', 'part-1', ?, ?, ?, 7, 0)`
	if _, err := conn.ExecContext(t.Context(), insert, "media-v1", 12500, 3); err != nil {
		t.Fatalf("insert audio checkpoint: %v", err)
	}
	// A legitimate backwards seek lowers position; sequence is the freshness
	// authority.
	mustExec(t, conn, `UPDATE attempt_audio_checkpoints
		SET position_ms = 4000, client_sequence = 4
		WHERE attempt_id = 'att-1' AND section_key = 'listening' AND part_id = 'part-1' AND media_revision = 'media-v1'`)
	mustFail(t, conn, `INSERT INTO attempt_audio_checkpoints
		(attempt_id, section_key, part_id, media_revision, position_ms, client_sequence, lease_epoch, run_generation)
		VALUES ('att-1', 'listening', 'part-1', 'media-v1', 9999, 9, 8, 0)`, "duplicate part stream")
	mustExec(t, conn, `INSERT INTO attempt_audio_checkpoints
		(attempt_id, section_key, part_id, media_revision, position_ms, client_sequence, lease_epoch, run_generation)
		VALUES ('att-1', 'listening', 'part-1', 'media-v2', 0, 1, 8, 1)`)
	mustFail(t, conn, `INSERT INTO attempt_audio_checkpoints
		(attempt_id, section_key, part_id, media_revision, position_ms, client_sequence, lease_epoch, run_generation)
		VALUES ('att-missing', 'listening', 'part-1', 'media-v1', 0, 1, 1, 0)`, "unknown attempt")
}

func assertStaffRecoverySessionContract(t *testing.T, conn *sql.Conn) {
	t.Helper()
	// Existing account sessions survive the widened CHECK untouched.
	var count int
	if err := conn.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM user_sessions WHERE id = 'sess-account' AND authentication_source = 'account'`).Scan(&count); err != nil || count != 1 {
		t.Fatalf("account session vanished: count=%d err=%v", count, err)
	}

	// A recovery session must name exactly one attempt.
	mustExec(t, conn, `INSERT INTO user_sessions (id, user_id, role_snapshot, authentication_source, recovery_attempt_id)
		VALUES ('sess-recovery', 'student-1', 'student', 'recovery', 'att-1')`)
	mustFail(t, conn, `INSERT INTO user_sessions (id, user_id, role_snapshot, authentication_source)
		VALUES ('sess-recovery-null', 'student-1', 'student', 'recovery')`, "recovery session without attempt")
	mustFail(t, conn, `INSERT INTO user_sessions (id, user_id, role_snapshot, authentication_source, practice_schedule_id, recovery_attempt_id)
		VALUES ('sess-recovery-practice', 'student-1', 'student', 'recovery', 'sched-1', 'att-1')`, "recovery session with practice scope")
	mustFail(t, conn, `INSERT INTO user_sessions (id, user_id, role_snapshot, authentication_source, recovery_attempt_id)
		VALUES ('sess-recovery-staff', 'student-1', 'proctor', 'recovery', 'att-1')`, "recovery session with staff role")
	mustFail(t, conn, `INSERT INTO user_sessions (id, user_id, role_snapshot, authentication_source, recovery_attempt_id)
		VALUES ('sess-unknown-attempt', 'student-1', 'student', 'recovery', 'att-missing')`, "recovery session with unknown attempt")

	// The bound attempt owns the session lifetime: deleting it revokes the
	// scoped session instead of leaving general student authority behind.
	mustExec(t, conn, `INSERT INTO user_sessions (id, user_id, role_snapshot, authentication_source, recovery_attempt_id)
		VALUES ('sess-recovery-cascade', 'student-1', 'student', 'recovery', 'att-2')`)
	mustExec(t, conn, `DELETE FROM student_attempts WHERE id = 'att-2'`)
	if err := conn.QueryRowContext(t.Context(), `SELECT COUNT(*) FROM user_sessions WHERE id = 'sess-recovery-cascade'`).Scan(&count); err != nil || count != 0 {
		t.Fatalf("deleted attempt left scoped session: count=%d err=%v", count, err)
	}
}

package main

// WS-12 repair-migration tests for 0057_migration_repair_guard.sql.
//
//   - TestRepair0057StatementsGuarded is a static dry-run audit (no database):
//     every DDL statement must be information_schema-guarded and every DELETE
//     must be a keep-earliest self-join dedup. It fails closed on any
//     unguarded ALTER/CREATE/DROP or any non-dedup DELETE.
//   - TestRepair0057CrashRetry applies the file twice against real MySQL
//     (TEST_MYSQL_DSN-gated, isolated scratch schema): the second pass must
//     succeed and change nothing.
//   - TestRepair0057DirtyDataDedup seeds duplicate rows, applies the file,
//     and asserts keep-earliest survivors plus built UNIQUEs, then re-applies
//     for idempotence.
//
// Without TEST_MYSQL_DSN the DB tests skip cleanly.

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

const repair0057File = "0057_migration_repair_guard.sql"

func loadRepair0057(t *testing.T) string {
	t.Helper()
	dir := migDir(t)
	b, err := os.ReadFile(filepath.Join(dir, repair0057File))
	if err != nil {
		t.Fatalf("read %s: %v", repair0057File, err)
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		t.Fatalf("%s is empty", repair0057File)
	}
	return string(b)
} // stripRepairComments removes --, # and /* */ leading comments so the
// statement keyword can be classified (mirrors isTriggerStatement).
func stripRepairComments(s string) string {
	s = strings.TrimSpace(s)
	for len(s) > 0 {
		if strings.HasPrefix(s, "--") {
			i := strings.IndexByte(s, 10)
			if i >= 0 {
				s = strings.TrimSpace(s[i+1:])
				continue
			}
			return ""
		}
		if strings.HasPrefix(s, "#") {
			i := strings.IndexByte(s, 10)
			if i >= 0 {
				s = strings.TrimSpace(s[i+1:])
				continue
			}
			return ""
		}
		if strings.HasPrefix(s, "/*") {
			i := strings.Index(s[2:], "*/")
			if i >= 0 {
				s = strings.TrimSpace(s[i+4:])
				continue
			}
			return ""
		}
		break
	}
	return s
}

func TestRepair0057StatementsGuarded(t *testing.T) {
	sqlText := loadRepair0057(t)
	stmts := splitStatements(sqlText)
	if len(stmts) == 0 {
		t.Fatalf("%s has no parseable statements", repair0057File)
	}
	upper := strings.ToUpper(sqlText)
	for _, bad := range []string{"DROP TABLE", "TRUNCATE", "CREATE TRIGGER", "DROP TRIGGER", "SIGNAL SQLSTATE"} {
		if strings.Contains(upper, bad) {
			t.Fatalf("%s must not contain %q (additive repair only)", repair0057File, bad)
		}
	}
	if strings.Contains(upper, "UPDATE ") {
		t.Fatalf("%s must not contain UPDATE (no data rewrites beyond dedup)", repair0057File)
	}

	var deletes, guards int
	for _, st := range stmts {
		code := stripRepairComments(st)
		u := strings.ToUpper(strings.TrimSpace(code))
		if u == "" {
			continue
		}
		first := u
		if i := strings.IndexAny(first, " \t\n\r("); i >= 0 {
			first = first[:i]
		}
		switch first {
		case "DELETE":
			ju := strings.ToUpper(st)
			if !strings.Contains(ju, "JOIN") {
				t.Fatalf("DELETE without self-join dedup: %.120q", st)
			}
			if !strings.Contains(ju, "CREATED_AT") && !strings.Contains(ju, "SERVER_RECEIVED_AT") && !strings.Contains(ju, "LAST_HEARTBEAT_AT") {
				t.Fatalf("DELETE without keep-earliest ordering: %.120q", st)
			}
			if !strings.Contains(st, ".id <") && !strings.Contains(st, ".id >") {
				t.Fatalf("DELETE without id tie-break: %.120q", st)
			}
			deletes++
		case "SET":
			// Three SET spellings exist in the tree: the 0017 single-SET
			// probe (SELECT ... FROM information_schema in one SET), the
			// 0044 probe SET (SELECT COUNT(*) ... information_schema),
			// and the 0044 dispatch SET (IF(@probe_exists=0, '<DDL>',
			// 'SELECT 1'), no information_schema text of its own). The
			// dispatch form must reference a probe variable; the
			// fallback count is asserted file-wide below.
			lower := strings.ToLower(st)
			if strings.Contains(lower, "information_schema") {
				guards++
				break
			}
			if strings.Contains(u, "SELECT 1") && strings.Contains(st, "@") {
				break
			}
			t.Fatalf("SET without information_schema probe or guard dispatch: %.120q", st)
		case "PREPARE", "EXECUTE", "DEALLOCATE":
		default:
			t.Fatalf("unguarded statement in %s (must be SET/PREPARE/EXECUTE/DEALLOCATE/DELETE): %.120q", repair0057File, st)
		}
	}
	if deletes != 4 {
		t.Fatalf("expected exactly 4 keep-earliest dedup DELETEs, got %d", deletes)
	}
	if guards < 8 {
		t.Fatalf("expected >=8 information_schema guards, got %d", guards)
	}
	// Every guarded build dispatches through IF(..., 'SELECT 1'): the file must
	// carry at least as many SELECT 1 fallbacks as guarded builders. Checked
	// file-wide because the 0044 two-SET idiom puts the fallback in the
	// statement AFTER the probe.
	if n := strings.Count(upper, "SELECT 1"); n < guards {
		t.Fatalf("expected >=%d SELECT 1 fallbacks (one per guard), got %d", guards, n)
	}
	for _, name := range []string{
		"idx_student_attempt_mutations_attempt_mutation_id",
		"idx_student_attempt_mutations_attempt_session_mutation_id",
		"uq_assessment_result_attempt_provider",
		"uniq_proctor_presence_schedule_proctor",
		"uq_student_heartbeat_mutation",
		"uq_student_violation_attempt_business_id",
	} {
		if !strings.Contains(sqlText, name) {
			t.Fatalf("%s missing expected UNIQUE %q", repair0057File, name)
		}
	}
}

// repair0057Conn opens TEST_MYSQL_DSN on a fresh isolated scratch schema.
// User-variable guards (PREPARE/EXECUTE) are session-scoped, so every
// statement runs on the same single-session conn.
func repair0057Conn(t *testing.T) *sql.Conn {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; 0057 repair test requires real MySQL/TiDB")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := pool.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	name := fmt.Sprintf("repair0057_%d", time.Now().UnixNano())
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

func repair0057ScratchTables(t *testing.T, conn *sql.Conn) {
	t.Helper()
	ddls := []string{
		"CREATE TABLE student_attempts (id VARCHAR(36) PRIMARY KEY)",
		"CREATE TABLE student_attempt_mutations (id VARCHAR(36) PRIMARY KEY, attempt_id VARCHAR(36) NOT NULL, client_session_id VARCHAR(36) NOT NULL, client_mutation_id VARCHAR(255) NOT NULL, server_received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
		"CREATE TABLE assessment_results (id VARCHAR(36) PRIMARY KEY, attempt_id VARCHAR(36) NULL, provider_key VARCHAR(32) NOT NULL, outcome_status VARCHAR(32) NOT NULL DEFAULT 'scored', created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6))",
		"CREATE TABLE proctor_presence (id VARCHAR(36) PRIMARY KEY, schedule_id VARCHAR(36) NOT NULL, proctor_id VARCHAR(255) NOT NULL, left_at TIMESTAMP NULL, last_heartbeat_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
		"CREATE TABLE outbox_events (id VARCHAR(36) PRIMARY KEY, published_at TIMESTAMP NULL, claim_expires_at TIMESTAMP NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, claim_token VARCHAR(64) NULL, claimed_by VARCHAR(128) NULL)",
		"CREATE TABLE student_heartbeat_events (id VARCHAR(36) PRIMARY KEY, attempt_id VARCHAR(36) NOT NULL, mutation_id VARCHAR(255) NULL)",
		"CREATE TABLE student_attempt_presence (attempt_id VARCHAR(36) PRIMARY KEY, schedule_id VARCHAR(36) NOT NULL, last_heartbeat_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)",
		"CREATE TABLE student_violation_events (id VARCHAR(36) PRIMARY KEY, attempt_id VARCHAR(36) NOT NULL, violation_id VARCHAR(64) NULL)",
	}
	for _, ddl := range ddls {
		if _, err := conn.ExecContext(t.Context(), ddl); err != nil {
			t.Fatalf("create scratch table: %v (%s)", err, ddl)
		}
	}
}

func applyRepair0057(t *testing.T, conn *sql.Conn) {
	t.Helper()
	stmts := splitStatements(loadRepair0057(t))
	if len(stmts) == 0 {
		t.Fatal("no statements to apply")
	}
	for _, st := range stmts {
		if strings.TrimSpace(st) == "" {
			continue
		}
		if _, err := conn.ExecContext(t.Context(), st); err != nil {
			t.Fatalf("apply 0057 statement: %v (%.150q)", err, st)
		}
	}
}

func repair0057IndexExists(t *testing.T, conn *sql.Conn, table, index string) bool {
	t.Helper()
	var n int
	if err := conn.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ?", table, index).Scan(&n); err != nil {
		t.Fatalf("probe index %s.%s: %v", table, index, err)
	}
	return n > 0
}

func TestRepair0057CrashRetry(t *testing.T) {
	conn := repair0057Conn(t)
	repair0057ScratchTables(t, conn)
	applyRepair0057(t, conn)
	applyRepair0057(t, conn)
	for _, idx := range [][2]string{
		{"student_attempt_mutations", "idx_student_attempt_mutations_attempt_mutation_id"},
		{"student_attempt_mutations", "idx_student_attempt_mutations_attempt_session_mutation_id"},
		{"proctor_presence", "uniq_proctor_presence_schedule_proctor"},
		{"student_violation_events", "uq_student_violation_attempt_business_id"},
	} {
		if !repair0057IndexExists(t, conn, idx[0], idx[1]) {
			t.Fatalf("expected index %s.%s after double apply", idx[0], idx[1])
		}
	}
}

func TestRepair0057DirtyDataDedup(t *testing.T) {
	conn := repair0057Conn(t)
	repair0057ScratchTables(t, conn)
	ctx := t.Context()
	seed := []string{
		"INSERT INTO student_attempt_mutations (id, attempt_id, client_session_id, client_mutation_id, server_received_at) VALUES ('m-aaa', 'att-1', 'sess-1', 'mut-1', '2026-01-01 00:00:01')",
		"INSERT INTO student_attempt_mutations (id, attempt_id, client_session_id, client_mutation_id, server_received_at) VALUES ('m-bbb', 'att-1', 'sess-1', 'mut-1', '2026-01-01 00:00:02')",
		"INSERT INTO student_attempts (id) VALUES ('att-1')",
		"INSERT INTO assessment_results (id, attempt_id, provider_key, outcome_status, created_at) VALUES ('r-1', 'att-1', 'sat', 'scored', '2026-01-01 00:00:02.000000')",
		"INSERT INTO assessment_results (id, attempt_id, provider_key, outcome_status, created_at) VALUES ('r-2', 'att-1', 'sat', 'scored', '2026-01-01 00:00:01.000000')",
		"INSERT INTO proctor_presence (id, schedule_id, proctor_id, left_at, last_heartbeat_at) VALUES ('p-left', 'sched-1', 'proc-1', '2026-01-01 00:00:03', '2026-01-01 00:00:03')",
		"INSERT INTO proctor_presence (id, schedule_id, proctor_id, left_at, last_heartbeat_at) VALUES ('p-active', 'sched-1', 'proc-1', NULL, '2026-01-01 00:00:01')",
	}
	for _, s := range seed {
		if _, err := conn.ExecContext(ctx, s); err != nil {
			t.Fatalf("seed dirty data: %v (%s)", err, s)
		}
	}
	applyRepair0057(t, conn)
	checks := []struct {
		query string
		want  string
		what  string
	}{
		{"SELECT id FROM student_attempt_mutations WHERE attempt_id = 'att-1'", "m-aaa", "mutation survivor"},
		{"SELECT id FROM assessment_results WHERE attempt_id = 'att-1'", "r-2", "assessment result survivor"},
		{"SELECT id FROM proctor_presence WHERE schedule_id = 'sched-1'", "p-active", "proctor presence survivor"},
	}
	for _, c := range checks {
		rows, err := conn.QueryContext(ctx, c.query)
		if err != nil {
			t.Fatalf("%s query: %v", c.what, err)
		}
		var got []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				_ = rows.Close()
				t.Fatalf("%s scan: %v", c.what, err)
			}
			got = append(got, id)
		}
		_ = rows.Close()
		if err := rows.Err(); err != nil {
			t.Fatalf("%s rows: %v", c.what, err)
		}
		if len(got) != 1 || got[0] != c.want {
			t.Fatalf("%s = %v, want [%s]", c.what, got, c.want)
		}
	}
	if !repair0057IndexExists(t, conn, "student_attempt_mutations", "idx_student_attempt_mutations_attempt_mutation_id") {
		t.Fatal("mutation UNIQUE not built after dedup")
	}
	applyRepair0057(t, conn)
	var n int
	if err := conn.QueryRowContext(ctx, "SELECT COUNT(*) FROM student_attempt_mutations").Scan(&n); err != nil || n != 1 {
		t.Fatalf("mutations after re-apply = %d (err %v), want 1", n, err)
	}
}

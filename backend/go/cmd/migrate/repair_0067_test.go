package main

// Migration-guard pins for 0067_sat_runtime_section_candidate_duration.sql.
//
//   - TestRepair0067StatementsBounded is a static audit (no database): the file
//     must be exactly one bounded UPDATE — no DDL, no DELETE — whose predicate
//     keeps it to sections that have not started (status = 'locked') and to rows
//     that still disagree with the candidate length, which is what makes the
//     repair re-runnable and crash-retry safe.
//   - TestRepair0067CrashRetry applies the file twice against real MySQL
//     (TEST_MYSQL_DSN-gated, isolated scratch schema) and asserts the runtime
//     row of a not-yet-started section is repaired to Module 1 + the longer
//     branch while the running section's clock and the non-adaptive section are
//     left exactly as they were.
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

const repair0067File = "0067_sat_runtime_section_candidate_duration.sql"

func loadRepair0067(t *testing.T) string {
	t.Helper()
	dir := migDir(t)
	b, err := os.ReadFile(filepath.Join(dir, repair0067File))
	if err != nil {
		t.Fatalf("read %s: %v", repair0067File, err)
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		t.Fatalf("%s is empty", repair0067File)
	}
	return string(b)
}

func TestRepair0067StatementsBounded(t *testing.T) {
	sqlText := loadRepair0067(t)
	stmts := splitStatements(sqlText)
	if len(stmts) != 1 {
		t.Fatalf("%s must be a single statement, got %d", repair0067File, len(stmts))
	}
	stmt := strings.TrimSpace(stripSQLComments(stmts[0]))
	upper := strings.ToUpper(stmt)
	for _, bad := range []string{"DROP ", "ALTER ", "CREATE ", "INSERT ", "DELETE", "TRUNCATE", "PREPARE"} {
		if strings.Contains(upper, bad) {
			t.Fatalf("%s must not contain %q (bounded repair UPDATE only)", repair0067File, bad)
		}
	}
	if !strings.HasPrefix(strings.ToUpper(stmt), "UPDATE ") {
		t.Fatalf("%s must be one UPDATE, got %.80q", repair0067File, stmt)
	}
	if !strings.Contains(stmt, "WHERE") {
		t.Fatal("the repair UPDATE needs a bounding WHERE")
	}
	// Not-started sections only: a live or paused section's deadline is already
	// running, and shortening it could close a candidate's section early.
	if !strings.Contains(stmt, "status = 'locked'") {
		t.Fatalf("%s must bound itself to status = 'locked' sections", repair0067File)
	}
	// Re-runnable: the predicate matches only rows that still disagree with the
	// candidate length, so a retry after a mid-file crash writes zero rows.
	if !strings.Contains(stmt, "<>") {
		t.Fatalf("%s must be re-runnable (predicate on the not-yet-repaired value)", repair0067File)
	}
	for _, want := range []string{"base_seconds", "branch_seconds", "DIV 60"} {
		if !strings.Contains(stmt, want) {
			t.Fatalf("%s missing %q (candidate seconds conversion)", repair0067File, want)
		}
	}
}

// stripSQLComments drops whole-line -- comments so prefix and keyword scans see
// code only (splitStatements keeps comments attached to their statement).
func stripSQLComments(stmt string) string {
	lines := strings.Split(stmt, "\n")
	kept := make([]string, 0, len(lines))
	for _, line := range lines {
		if strings.HasPrefix(strings.TrimSpace(line), "--") {
			continue
		}
		kept = append(kept, line)
	}
	return strings.Join(kept, "\n")
}

// repair0067Conn opens TEST_MYSQL_DSN on a fresh isolated scratch schema.
func repair0067Conn(t *testing.T) *sql.Conn {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; 0067 repair test requires real MySQL/TiDB")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := pool.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	name := fmt.Sprintf("repair0067_%d", time.Now().UnixNano())
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

func applyRepair0067(t *testing.T, conn *sql.Conn) {
	t.Helper()
	stmts := splitStatements(loadRepair0067(t))
	if len(stmts) == 0 {
		t.Fatal("no statements to apply")
	}
	for _, st := range stmts {
		if strings.TrimSpace(st) == "" {
			continue
		}
		if _, err := conn.ExecContext(t.Context(), st); err != nil {
			t.Fatalf("apply 0067 statement: %v (%.150q)", err, st)
		}
	}
}

func TestRepair0067CrashRetry(t *testing.T) {
	conn := repair0067Conn(t)
	ctx := t.Context()
	statements := []string{
		"CREATE TABLE exam_schedules (id VARCHAR(36) PRIMARY KEY, published_version_id VARCHAR(36))",
		"CREATE TABLE exam_session_runtimes (id VARCHAR(36) PRIMARY KEY, schedule_id VARCHAR(36))",
		"CREATE TABLE exam_session_runtime_sections (id VARCHAR(36) PRIMARY KEY, runtime_id VARCHAR(36), section_key VARCHAR(32), planned_duration_minutes INT, status VARCHAR(16))",
		"CREATE TABLE assessment_sections (id VARCHAR(36) PRIMARY KEY, exam_version_id VARCHAR(36), section_key VARCHAR(32), duration_seconds INT)",
		"CREATE TABLE assessment_modules (id VARCHAR(36) PRIMARY KEY, section_id VARCHAR(36), adaptive_role VARCHAR(16), duration_seconds INT)",
		"INSERT INTO exam_schedules (id, published_version_id) VALUES ('sched-1', 'pv-1')",
		"INSERT INTO exam_session_runtimes (id, schedule_id) VALUES ('rt-1', 'sched-1')",
		"INSERT INTO assessment_sections (id, exam_version_id, section_key, duration_seconds) VALUES ('sec-math', 'pv-1', 'math', 6300), ('sec-rw', 'pv-1', 'reading-writing', 3600)",
		"INSERT INTO assessment_modules (id, section_id, adaptive_role, duration_seconds) VALUES ('m1', 'sec-math', 'base', 2100), ('m2l', 'sec-math', 'lower_branch', 2100), ('m2h', 'sec-math', 'higher_branch', 2100), ('rw1', 'sec-rw', 'none', 3600)",
		// The pre-0065 overstatement: 105 minutes for a section a candidate sits
		// for 70. One row has not started (repaired), one is already live (left).
		"INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, planned_duration_minutes, status) VALUES ('rs-math-locked', 'rt-1', 'math', 105, 'locked'), ('rs-math-live', 'rt-1', 'math', 105, 'live'), ('rs-rw-locked', 'rt-1', 'reading-writing', 60, 'locked')",
	}
	for _, stmt := range statements {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			t.Fatalf("fixture statement failed: %v (%.120q)", err, stmt)
		}
	}

	applyRepair0067(t, conn)
	applyRepair0067(t, conn)

	read := func(id string) int {
		t.Helper()
		var minutes int
		if err := conn.QueryRowContext(ctx, "SELECT planned_duration_minutes FROM exam_session_runtime_sections WHERE id = ?", id).Scan(&minutes); err != nil {
			t.Fatalf("read %s: %v", id, err)
		}
		return minutes
	}
	if got := read("rs-math-locked"); got != 70 {
		t.Fatalf("a locked Math section must be repaired to Module 1 + one 35-minute branch (70), got %d", got)
	}
	if got := read("rs-math-live"); got != 105 {
		t.Fatalf("a running section's clock must not move (105 preserved), got %d", got)
	}
	if got := read("rs-rw-locked"); got != 60 {
		t.Fatalf("a section without adaptive roles keeps its authored length (60), got %d", got)
	}
}

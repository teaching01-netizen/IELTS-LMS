package main

// Phase 02 migration-guard pins for 0059_act_phase02_answer_fencing.sql.
//
//   - TestRepair0059StatementsGuarded is a static dry-run audit (no database):
//     every ADD COLUMN must be information_schema-guarded and dispatched
//     through PREPARE/EXECUTE, and the file must stay additive (no DROP,
//     TRUNCATE, TRIGGER, or UNIQUE build on the exam-day hot table).
//   - TestRepair0059CrashRetry applies the file twice against real MySQL
//     (TEST_MYSQL_DSN-gated, isolated scratch schema): the second pass
//     must succeed and change nothing.
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

const repair0059File = "0059_act_phase02_answer_fencing.sql"

func loadRepair0059(t *testing.T) string {
	t.Helper()
	dir := migDir(t)
	b, err := os.ReadFile(filepath.Join(dir, repair0059File))
	if err != nil {
		t.Fatalf("read %s: %v", repair0059File, err)
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		t.Fatalf("%s is empty", repair0059File)
	}
	return string(b)
}

func TestRepair0059StatementsGuarded(t *testing.T) {
	sqlText := loadRepair0059(t)
	stmts := splitStatements(sqlText)
	if len(stmts) == 0 {
		t.Fatalf("%s has no parseable statements", repair0059File)
	}
	upper := strings.ToUpper(sqlText)
	for _, bad := range []string{"DROP TABLE", "DROP TRIGGER", "CREATE TRIGGER", "TRUNCATE", "ADD CONSTRAINT", "CREATE UNIQUE INDEX", "CREATE INDEX"} {
		if strings.Contains(upper, bad) {
			t.Fatalf("%s must not contain %q (additive columns only; no hot-table index build)", repair0059File, bad)
		}
	}
	if strings.Contains(upper, "DELETE") {
		t.Fatalf("%s must not contain DELETE (normalization uses bounded UPDATE only)", repair0059File)
	}
	var guards int
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
		case "SET":
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
		case "UPDATE":
			// Bounded idempotent normalization only: predicate-scoped to
			// out-of-range values, never a broad data rewrite.
			ju := strings.ToUpper(st)
			if !strings.Contains(ju, "WHERE") {
				t.Fatalf("UPDATE without bounding WHERE (must be predicate-scoped): %.120q", st)
			}
		default:
			t.Fatalf("unguarded statement in %s (must be SET/PREPARE/EXECUTE/DEALLOCATE/bounded UPDATE): %.120q", repair0059File, st)
		}
	}
	if guards < 2 {
		t.Fatalf("expected >=2 information_schema guards (one per column), got %d", guards)
	}
	if n := strings.Count(upper, "SELECT 1"); n < guards {
		t.Fatalf("expected >=%d SELECT 1 fallbacks (one per guard), got %d", guards, n)
	}
	for _, col := range []string{"answer_write_revision", "answer_client_write_id"} {
		if !strings.Contains(sqlText, col) {
			t.Fatalf("%s missing expected column %q", repair0059File, col)
		}
	}
}

// repair0059Conn opens TEST_MYSQL_DSN on a fresh isolated scratch schema.
func repair0059Conn(t *testing.T) *sql.Conn {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; 0059 repair test requires real MySQL/TiDB")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := pool.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	name := fmt.Sprintf("repair0059_%d", time.Now().UnixNano())
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

func applyRepair0059(t *testing.T, conn *sql.Conn) {
	t.Helper()
	stmts := splitStatements(loadRepair0059(t))
	if len(stmts) == 0 {
		t.Fatal("no statements to apply")
	}
	for _, st := range stmts {
		if strings.TrimSpace(st) == "" {
			continue
		}
		if _, err := conn.ExecContext(t.Context(), st); err != nil {
			t.Fatalf("apply 0059 statement: %v (%.150q)", err, st)
		}
	}
}

func TestRepair0059CrashRetry(t *testing.T) {
	conn := repair0059Conn(t)
	if _, err := conn.ExecContext(t.Context(), "CREATE TABLE student_attempts (id VARCHAR(36) PRIMARY KEY)"); err != nil {
		t.Fatalf("create scratch table: %v", err)
	}
	applyRepair0059(t, conn)
	applyRepair0059(t, conn)
	for _, col := range []string{"answer_write_revision", "answer_client_write_id"} {
		var n int
		if err := conn.QueryRowContext(t.Context(), "SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'student_attempts' AND column_name = ?", col).Scan(&n); err != nil {
			t.Fatalf("probe column %s: %v", col, err)
		}
		if n != 1 {
			t.Fatalf("expected column student_attempts.%s after double apply, got count %d", col, n)
		}
	}
}

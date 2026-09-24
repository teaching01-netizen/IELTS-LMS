package main

// Migration-guard pins for 0069_sat_personal_timing.sql (plan 2026-09-24).
//
//   - TestMigration0069StatementsGuarded is a static audit (no database): every
//     ALTER/CREATE in the file is information_schema-guarded (or an idempotent
//     IF NOT EXISTS), so a crash mid-file can be retried.
//   - TestMigration0069DefaultsAreSafe pins the column contract the delivery
//     code depends on: a nullable schedule choice (NULL keeps the deployed
//     cohort model), offer columns that default to "no offer", and a break table
//     whose state machine and uniqueness the Go code assumes.
//   - TestMigration0069CrashRetry applies the file twice against real MySQL
//     (TEST_MYSQL_DSN-gated, isolated scratch schema): the second run must change
//     nothing, the schedule choice must default to NULL, and the timing-model
//     CHECK must accept sat_personal_v1 after the re-add.
//
// Without TEST_MYSQL_DSN the DB test skips cleanly.

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
)

const satPersonalTimingFile = "0069_sat_personal_timing.sql"

func loadSatPersonalTiming(t *testing.T) string {
	t.Helper()
	dir := migDir(t)
	b, err := os.ReadFile(filepath.Join(dir, satPersonalTimingFile))
	if err != nil {
		t.Fatalf("read %s: %v", satPersonalTimingFile, err)
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		t.Fatalf("%s is empty", satPersonalTimingFile)
	}
	return string(b)
}

var (
	sqlSetVarRe     = regexp.MustCompile(`^SET (@\w+) :=`)
	sqlPrepareRe    = regexp.MustCompile(`^PREPARE \w+ FROM (@\w+)$`)
	sqlExecuteRe    = regexp.MustCompile(`^EXECUTE (\w+)$`)
	sqlDeallocRe    = regexp.MustCompile(`^DEALLOCATE PREPARE (\w+)$`)
	sqlGuardRefRe   = regexp.MustCompile(`@\w+_exists\b`)
	sqlBareDDLVerbs = []string{
		"ALTER TABLE",
		"CREATE INDEX",
		"CREATE UNIQUE INDEX",
		"DROP INDEX",
		"DROP TABLE",
	}
)

// Every statement that changes schema must be safe to run twice: either guarded
// by an information_schema predicate on the prepared statement, or idempotent by
// construction (IF NOT EXISTS).
func TestMigration0069StatementsGuarded(t *testing.T) {
	stmts := make([]string, 0, 32)
	for _, st := range splitStatements(loadSatPersonalTiming(t)) {
		stmt := strings.TrimSpace(stripSQLComments(st))
		if stmt != "" {
			stmts = append(stmts, stmt)
		}
	}
	if len(stmts) == 0 {
		t.Fatal("no statements found")
	}

	assigns := map[string]string{}
	for _, stmt := range stmts {
		if m := sqlSetVarRe.FindStringSubmatch(stmt); m != nil {
			assigns[m[1]] = stmt
		}
	}

	// No DDL may appear as a bare statement: it is either idempotent by
	// construction or the body of a conditional, prepared statement.
	for _, stmt := range stmts {
		upper := strings.ToUpper(stmt)
		if strings.HasPrefix(upper, "CREATE TABLE IF NOT EXISTS") {
			continue
		}
		for _, verb := range sqlBareDDLVerbs {
			if strings.HasPrefix(upper, verb) {
				t.Fatalf("%s: unprepared DDL is not crash-retry safe: %.140q", satPersonalTimingFile, stmt)
			}
		}
	}

	prepared := 0
	for _, stmt := range stmts {
		m := sqlPrepareRe.FindStringSubmatch(stmt)
		if m == nil {
			continue
		}
		sqlVar := m[1]
		assign, ok := assigns[sqlVar]
		if !ok {
			t.Fatalf("%s: PREPARE from an unassigned %s", satPersonalTimingFile, sqlVar)
		}
		if !strings.Contains(assign, "IF(") {
			t.Fatalf("%s: %s must be conditional: %.140q", satPersonalTimingFile, sqlVar, assign)
		}
		// The branch must be on a predicate this file reads from
		// information_schema — a shared predicate is fine (the DROP CHECK / ADD
		// CONSTRAINT pair is one decision), a hard-coded TRUE is not.
		guards := sqlGuardRefRe.FindAllStringSubmatch(assign, -1)
		if len(guards) == 0 {
			t.Fatalf("%s: %s branches on no guard: %.140q", satPersonalTimingFile, sqlVar, assign)
		}
		for _, guardMatch := range guards {
			guardVar := guardMatch[0]
			guard, ok := assigns[guardVar]
			if !ok {
				t.Fatalf("%s: %s branches on unassigned %s", satPersonalTimingFile, sqlVar, guardVar)
			}
			if !strings.Contains(strings.ToUpper(guard), "INFORMATION_SCHEMA.") {
				t.Fatalf("%s: %s must read information_schema: %.140q", satPersonalTimingFile, guardVar, guard)
			}
		}
		prepared++
	}
	if prepared < 3 {
		t.Fatalf("expected the guarded column/index/CHECK work, found %d prepared statements", prepared)
	}
	// Each prepared statement is executed and deallocated exactly once.
	executes, deallocs := 0, 0
	for _, stmt := range stmts {
		if sqlExecuteRe.MatchString(stmt) {
			executes++
		}
		if sqlDeallocRe.MatchString(stmt) {
			deallocs++
		}
	}
	if executes != prepared || deallocs != prepared {
		t.Fatalf("prepare/execute/deallocate counts must match: %d/%d/%d", prepared, executes, deallocs)
	}
}

// The exact shapes the delivery code relies on. These are cheap string pins, but
// they are the ones whose silent loss would break a live session rather than a
// build: a NOT NULL schedule choice would make the cohort fallback impossible, a
// plain TIMESTAMP would truncate the offer arithmetic to whole seconds, and a
// missing state in the CHECK would reject a real transition at runtime.
func TestMigration0069DefaultsAreSafe(t *testing.T) {
	sqlText := loadSatPersonalTiming(t)

	for _, want := range []string{
		// Nullable by contract: NULL means "the deployed cohort model".
		"ADD COLUMN sat_timing_model VARCHAR(32) NULL",
		// Offer columns are nullable and default to "no offer".
		"ADD COLUMN entry_starts_at TIMESTAMP(6) NULL",
		"ADD COLUMN entry_confirmed_at TIMESTAMP(6) NULL",
		"ADD COLUMN entry_entered_at TIMESTAMP(6) NULL",
		"ADD COLUMN entry_generation INT NOT NULL DEFAULT 0",
		// Microsecond precision matters: the offer window is seconds long.
		"starts_at TIMESTAMP(6) NULL",
		"deadline_at TIMESTAMP(6) NULL",
		"created_at TIMESTAMP(6) NOT NULL",
		// One break per (attempt, section) and a four-state machine.
		"UNIQUE (attempt_id, after_section_id)",
		"CHECK (state IN ('pending', 'armed', 'active', 'completed'))",
		// The runtime CHECK is re-added with the personal model included.
		"'sat_personal_v1'",
		"chk_exam_session_runtime_timing_model",
	} {
		if !strings.Contains(sqlText, want) {
			t.Fatalf("%s missing %q", satPersonalTimingFile, want)
		}
	}

	// A dropped CHECK that was not there is a no-op; the re-add must be gated by
	// the same predicate as the drop, or a retry would fail on the missing
	// constraint.
	if strings.Count(sqlText, "chk_timing_exists") < 3 {
		t.Fatalf("%s must gate both the DROP CHECK and the ADD CONSTRAINT on the same predicate", satPersonalTimingFile)
	}
}

// satPersonalTimingConn opens TEST_MYSQL_DSN on a fresh isolated scratch schema.
func satPersonalTimingConn(t *testing.T) *sql.Conn {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; 0069 migration test requires real MySQL/TiDB")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	if err := pool.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	name := fmt.Sprintf("satpersonal0069_%d", time.Now().UnixNano())
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

func applySatPersonalTiming(t *testing.T, conn *sql.Conn) {
	t.Helper()
	for _, st := range splitStatements(loadSatPersonalTiming(t)) {
		if strings.TrimSpace(st) == "" {
			continue
		}
		if _, err := conn.ExecContext(t.Context(), st); err != nil {
			t.Fatalf("apply 0069 statement: %v (%.150q)", err, st)
		}
	}
}

func TestMigration0069CrashRetry(t *testing.T) {
	conn := satPersonalTimingConn(t)
	ctx := t.Context()

	// The pre-0069 shape: the tables the migration touches and the runtime CHECK
	// it replaces, on a schedule row that already exists.
	fixture := []string{
		"CREATE TABLE exam_schedules (id VARCHAR(36) PRIMARY KEY, provider_key VARCHAR(32), revision INT NOT NULL DEFAULT 0)",
		"CREATE TABLE exam_session_runtimes (id VARCHAR(36) PRIMARY KEY, schedule_id VARCHAR(36), timing_model VARCHAR(32), CONSTRAINT chk_exam_session_runtime_timing_model CHECK (timing_model IN ('legacy_section_v1', 'cohort_stage_v2', 'cohort_section_v3')))",
		"CREATE TABLE assessment_module_attempts (id VARCHAR(36) PRIMARY KEY, attempt_id VARCHAR(36), started_at TIMESTAMP(6) NULL)",
		"CREATE TABLE assessment_sections (id VARCHAR(36) PRIMARY KEY, exam_version_id VARCHAR(36))",
		"CREATE TABLE student_attempts (id VARCHAR(36) PRIMARY KEY)",
		"INSERT INTO exam_schedules (id, provider_key) VALUES ('sched-1', 'sat')",
		"INSERT INTO exam_session_runtimes (id, schedule_id, timing_model) VALUES ('rt-1', 'sched-1', 'cohort_section_v3')",
		"INSERT INTO assessment_sections (id, exam_version_id) VALUES ('sec-1', 'pv-1')",
		"INSERT INTO student_attempts (id) VALUES ('att-1')",
		"INSERT INTO assessment_module_attempts (id, attempt_id) VALUES ('ma-1', 'att-1')",
	}
	for _, stmt := range fixture {
		if _, err := conn.ExecContext(ctx, stmt); err != nil {
			t.Fatalf("fixture statement failed: %v (%.140q)", err, stmt)
		}
	}

	applySatPersonalTiming(t, conn)
	// The crash-retry contract: a second pass over a partially applied file must
	// be a clean no-op rather than a duplicate-column/index/constraint error.
	applySatPersonalTiming(t, conn)

	var model sql.NullString
	if err := conn.QueryRowContext(ctx, "SELECT sat_timing_model FROM exam_schedules WHERE id = 'sched-1'").Scan(&model); err != nil {
		t.Fatalf("read schedule choice: %v", err)
	}
	if model.Valid {
		t.Fatalf("an existing schedule must keep NULL (the deployed cohort model), got %q", model.String)
	}

	// The offer columns exist, are nullable, and default to "no offer".
	var starts, entered sql.NullTime
	var generation int
	if err := conn.QueryRowContext(ctx,
		"SELECT entry_starts_at, entry_entered_at, entry_generation FROM assessment_module_attempts WHERE id = 'ma-1'",
	).Scan(&starts, &entered, &generation); err != nil {
		t.Fatalf("read offer columns: %v", err)
	}
	if starts.Valid || entered.Valid || generation != 0 {
		t.Fatalf("a pre-existing module attempt must carry no offer, got start=%v entered=%v gen=%d", starts, entered, generation)
	}

	// The re-added CHECK accepts the personal model on a runtime row.
	if _, err := conn.ExecContext(ctx,
		"UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE id = 'rt-1'",
	); err != nil {
		t.Fatalf("the timing-model CHECK must accept sat_personal_v1 after 0069: %v", err)
	}
	// …and still rejects a model nobody implements.
	if _, err := conn.ExecContext(ctx,
		"UPDATE exam_session_runtimes SET timing_model = 'not_a_model' WHERE id = 'rt-1'",
	); err == nil {
		t.Fatal("the timing-model CHECK must reject an unknown model")
	}

	// One break per (attempt, section): the second insert must conflict.
	insert := "INSERT INTO assessment_attempt_breaks (id, attempt_id, after_section_id, duration_seconds) VALUES (?, 'att-1', 'sec-1', 600)"
	if _, err := conn.ExecContext(ctx, insert, "br-1"); err != nil {
		t.Fatalf("insert break: %v", err)
	}
	if _, err := conn.ExecContext(ctx, insert, "br-2"); err == nil {
		t.Fatal("the break uniqueness constraint must reject a second break for the same section")
	}
}

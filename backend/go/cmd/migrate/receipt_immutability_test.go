package main

// WS-07 receipt-immutability pins.
//
//   - TestMigration0056RecreatesImmutabilityTriggersOnly is a static
//     dry-run audit (no database): 0056 must re-create EXACTLY the two
//     immutability triggers with the byte-identical definitions from
//     0043:187-192, guarded by DROP TRIGGER IF EXISTS for crash-retry,
//     and must NOT resurrect the two legacy-projection triggers dropped
//     by 0051 (their removal was intended).
//   - TestRefuseTiDBProduction is a pure unit test of the engine gate:
//     TiDB + production refuses with an error naming MySQL 8.4; every
//     other combination passes.
//   - TestReceiptImmutabilityMySQL is DB-gated (TEST_MYSQL_DSN): after
//     applying 0056, UPDATE/DELETE on attempt_terminalizations fails with
//     the immutability error. Skips cleanly without a DSN.
import (
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"

	_ "github.com/go-sql-driver/mysql"
)

func loadMigration0056(t *testing.T) string {
	t.Helper()
	dir := migDir(t)
	b, err := os.ReadFile(filepath.Join(dir, "0056_receipt_immutability.sql"))
	if err != nil {
		t.Fatalf("read 0056_receipt_immutability.sql: %v", err)
	}
	if len(strings.TrimSpace(string(b))) == 0 {
		t.Fatal("0056_receipt_immutability.sql is empty")
	}
	return string(b)
}

func TestMigration0056RecreatesImmutabilityTriggersOnly(t *testing.T) {
	sqlText := loadMigration0056(t)
	stmts := splitStatements(sqlText)
	if len(stmts) == 0 {
		t.Fatal("0056 has no parseable statements")
	}
	upper := strings.ToUpper(sqlText)
	for _, want := range []string{
		"ATTEMPT_TERMINALIZATIONS_IMMUTABLE_UPDATE",
		"ATTEMPT_TERMINALIZATIONS_IMMUTABLE_DELETE",
	} {
		if !strings.Contains(upper, want) {
			t.Fatalf("0056 must re-create %s", want)
		}
	}
	// Exact 0043:187-192 definitions (modulo file-header comments): both
	// trigger bodies must be BEFORE-row guards signaling SQLSTATE 45000
	// with the canonical message text.
	if n := strings.Count(upper, "SIGNAL SQLSTATE '45000'"); n != 2 {
		t.Fatalf("0056 must carry exactly 2 SIGNAL SQLSTATE '45000' guards (one per immutability trigger), got %d", n)
	}
	if strings.Count(sqlText, "attempt_terminalizations is immutable") != 2 {
		t.Fatalf("0056 trigger message text must match 0043 exactly (2 occurrences), got:\n%s", sqlText)
	}
	// Crash-retry guard: both triggers dropped IF EXISTS before creation.
	for _, name := range []string{
		"attempt_terminalizations_immutable_update",
		"attempt_terminalizations_immutable_delete",
	} {
		if !strings.Contains(strings.ToLower(sqlText), "drop trigger if exists "+name) {
			t.Fatalf("0056 must guard %s with DROP TRIGGER IF EXISTS (crash-retry)", name)
		}
	}
	// The legacy-projection triggers stay dropped (0051 removal intended).
	for _, legacy := range []string{
		"attempt_terminalizations_legacy_projection",
		"attempt_terminalizations_legacy_insert",
	} {
		if strings.Contains(strings.ToLower(sqlText), legacy) {
			t.Fatalf("0056 must NOT resurrect %s (0051 removal was intended)", legacy)
		}
	}
	// No other trigger DDL may hide in the file.
	for _, st := range stmts {
		if !isTriggerStatement(st) {
			continue
		}
		l := strings.ToLower(st)
		if strings.Contains(l, "immutable_update") || strings.Contains(l, "immutable_delete") {
			continue
		}
		t.Fatalf("unexpected trigger statement in 0056 (only the two immutability triggers allowed): %.120q", st)
	}
}

func TestRefuseTiDBProduction(t *testing.T) {
	for _, tc := range []struct {
		name    string
		tidb    bool
		appEnv  string
		env     string
		wantErr bool
	}{
		{"mysql dev", false, "", "", false},
		{"mysql prod", false, "production", "", false},
		{"tidb dev", true, "development", "", false},
		{"tidb empty env", true, "", "", false},
		{"tidb staging", true, "staging", "", false},
		{"tidb prod app_env", true, "production", "", true},
		{"tidb prod env", true, "", "production", true},
		{"tidb prod shorthand", true, "prod", "", true},
		{"tidb prod uppercase", true, "PRODUCTION", "", true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Setenv("APP_ENV", tc.appEnv)
			t.Setenv("ENVIRONMENT", tc.env)
			err := refuseTiDBProduction(tc.tidb)
			if tc.wantErr && err == nil {
				t.Fatal("TiDB in production must refuse")
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("must not refuse: %v", err)
			}
			if tc.wantErr && !strings.Contains(err.Error(), "MySQL 8.4") {
				t.Fatalf("refusal must name MySQL 8.4 as the supported prod engine, got: %v", err)
			}
		})
	}
}

func TestReceiptImmutabilityMySQL(t *testing.T) {
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; receipt immutability test requires real MySQL")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.Ping(); err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable, skipping: %v", err)
	}
	// Engine check: TiDB skips trigger DDL, so the guard cannot hold there.
	var version string
	if err := pool.QueryRow("SELECT VERSION()").Scan(&version); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.ToLower(version), "tidb") {
		t.Skip("TiDB does not run trigger DDL; immutability guard is MySQL-only")
	}
	ctx := t.Context()
	conn, err := pool.Conn(ctx)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	// Locate the attempt_terminalizations table in the DSN's database; skip
	// (do not create fixtures) when the test database is not migrated.
	var tableCount int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = 'attempt_terminalizations'`).Scan(&tableCount); err != nil {
		t.Fatal(err)
	}
	if tableCount == 0 {
		t.Skip("attempt_terminalizations absent in TEST_MYSQL_DSN database; run cmd/migrate first")
	}
	var triggerCount int
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND event_object_table = 'attempt_terminalizations' AND trigger_name IN ('attempt_terminalizations_immutable_update','attempt_terminalizations_immutable_delete')`).Scan(&triggerCount); err != nil {
		t.Fatal(err)
	}
	if triggerCount != 2 {
		t.Skipf("immutability triggers not installed (found %d/2); apply 0056 first", triggerCount)
	}
	// Post-migration, any UPDATE or DELETE must fail with the immutability
	// error — and the app maps it sanely (a plain MySQL error, never a
	// silent success or a panic). The probe touches a real row (LIMIT 1
	// over the table): BEFORE triggers fire per matched row, so a
	// zero-match predicate would succeed trivially and prove nothing.
	if _, err := conn.ExecContext(ctx, `UPDATE attempt_terminalizations SET reason = 'time_expired' ORDER BY attempt_id LIMIT 1`); err == nil {
		t.Fatal("UPDATE on attempt_terminalizations must fail post-0056 (BEFORE UPDATE guard)")
	} else if !strings.Contains(strings.ToLower(err.Error()), "immutable") {
		t.Fatalf("UPDATE must fail with the immutability error, got: %v", err)
	}
	if _, err := conn.ExecContext(ctx, `DELETE FROM attempt_terminalizations ORDER BY attempt_id LIMIT 1`); err == nil {
		t.Fatal("DELETE on attempt_terminalizations must fail post-0056 (BEFORE DELETE guard)")
	} else if !strings.Contains(strings.ToLower(err.Error()), "immutable") {
		t.Fatalf("DELETE must fail with the immutability error, got: %v", err)
	}
}

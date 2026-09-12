// Package integration runs behavior contracts against real MySQL/TiDB.
// SQLite is not a substitute (plan 110). Set TEST_MYSQL_DSN to enable;
// without it the suite skips with a clear message.
package integration

import (
	"database/sql"
	"os"
	"testing"

	_ "github.com/go-sql-driver/mysql"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	dsn := os.Getenv("TEST_MYSQL_DSN")
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; integration suite requires real MySQL/TiDB")
	}
	pool, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { _ = pool.Close() })
	return pool
}

func TestMigrationLedgerApplies(t *testing.T) {
	pool := testDB(t)
	var count int
	if err := pool.QueryRow(`SELECT COUNT(*) FROM schema_migrations`).Scan(&count); err != nil {
		t.Fatalf("schema_migrations missing (run cmd/migrate first): %v", err)
	}
	if count < 58 {
		t.Fatalf("expected >=58 applied migrations (0001..0058), got %d", count)
	}
}

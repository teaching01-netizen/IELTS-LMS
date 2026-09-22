// Package integration runs behavior contracts against real MySQL/TiDB.
// SQLite is not a substitute (plan 110). Set TEST_MYSQL_DSN to enable;
// without it the suite skips with a clear message.
package integration

import (
	"database/sql"
	"os"
	"testing"

	platformdb "example.com/ielts-proctoring/internal/platform/db"
	_ "github.com/go-sql-driver/mysql"
)

func testDB(t *testing.T) *sql.DB {
	t.Helper()
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; integration suite requires real MySQL/TiDB")
	}
	// Same session discipline as the application pool: without it a fixture
	// connection on the host's SYSTEM zone and the app's UTC read path render
	// the same TIMESTAMP column hours apart, so backdated clock fixtures flake.
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatalf("normalize TEST_MYSQL_DSN: %v", err)
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
	if count < 61 {
		t.Fatalf("expected >=61 applied migrations (0001..0061), got %d", count)
	}
}

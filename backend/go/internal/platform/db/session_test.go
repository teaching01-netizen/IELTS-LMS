package db

import (
	"database/sql"
	"strings"
	"testing"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// The platform pool owns UTC session setup: its DSN carries time_zone (run
// on every physical connection) and its driver advertises that to tx.
func TestPlatformPoolIsSessionReady(t *testing.T) {
	pool, err := newPool("mysql://u:p@127.0.0.1:1/db", 2, 1)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if !tx.SessionReady(pool) {
		t.Fatal("platform pool must be tx.SessionReady")
	}
	dsn, err := NormalizeDSN("mysql://u:p@127.0.0.1:1/db")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(dsn, "time_zone=%27%2B00%3A00%27") {
		t.Fatalf("DSN must initialize UTC per connection: %s", dsn)
	}
	plain, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer plain.Close()
	if tx.SessionReady(plain) {
		t.Fatal("an externally opened pool cannot prove session setup")
	}
}

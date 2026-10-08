package httpx_test

import (
	"context"
	"database/sql"
	"os"
	"testing"
	"time"

	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/httpx"
	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"
)

func TestDBRateLimiterFreshKeyMySQL(t *testing.T) {
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	// Force reuse of the exact connection carrying an unrelated insert ID.
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	ctx := context.Background()
	var polluted int
	if err := db.QueryRowContext(ctx, "SELECT LAST_INSERT_ID(999)").Scan(&polluted); err != nil {
		t.Fatal(err)
	}
	route := "test-fresh-bucket-" + uuid.NewString()
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, "DELETE FROM distributed_rate_limit_counters WHERE route_key = ?", route)
	})
	limiter := httpx.NewDBRateLimiter(db, route, 2, time.Minute)
	for i, want := range []bool{true, true, false} {
		allowed, _, err := limiter.Check(ctx, "candidate-a")
		if err != nil || allowed != want {
			t.Fatalf("request %d: allowed=%v want=%v err=%v", i+1, allowed, want, err)
		}
	}
	// The over-limit UPDATE also leaves connection state. A different student
	// must still begin at one instead of inheriting the preceding count.
	allowed, _, err := limiter.Check(ctx, "candidate-b")
	if err != nil || !allowed {
		t.Fatalf("fresh second student inherited a quota: allowed=%v err=%v", allowed, err)
	}
	for key, want := range map[string]int{"candidate-a": 3, "candidate-b": 1} {
		var count int
		if err := db.QueryRowContext(ctx, "SELECT SUM(request_count) FROM distributed_rate_limit_counters WHERE route_key = ? AND bucket_key = ?", route, key).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("persisted count for %s=%d want=%d", key, count, want)
		}
	}
}

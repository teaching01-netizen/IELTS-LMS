package httpx_test

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"sync"
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
	otherInstance := httpx.NewDBRateLimiter(db, route, 2, time.Minute)
	if allowed, _, err := limiter.Check(ctx, "candidate-a"); err != nil || !allowed {
		t.Fatalf("first request: allowed=%v want=true err=%v", allowed, err)
	}
	if allowed, _, err := otherInstance.Check(ctx, "candidate-a"); err != nil || allowed {
		t.Fatalf("second instance must see the shared quota: allowed=%v want=false err=%v", allowed, err)
	}
	if allowed, _, err := limiter.Check(ctx, "candidate-a"); err != nil || !allowed {
		t.Fatalf("second request from first lease: allowed=%v want=true err=%v", allowed, err)
	}
	if allowed, _, err := limiter.Check(ctx, "candidate-a"); err != nil || allowed {
		t.Fatalf("request beyond the shared quota: allowed=%v want=false err=%v", allowed, err)
	}
	// The over-limit UPDATE also leaves connection state. A different student
	// must still begin at one instead of inheriting the preceding count.
	allowed, _, err := limiter.Check(ctx, "candidate-b")
	if err != nil || !allowed {
		t.Fatalf("fresh second student inherited a quota: allowed=%v err=%v", allowed, err)
	}
	for key, want := range map[string]int{"candidate-a": 2, "candidate-b": 2} {
		var count int
		if err := db.QueryRowContext(ctx, "SELECT SUM(request_count) FROM distributed_rate_limit_counters WHERE route_key = ? AND bucket_key = ?", route, key).Scan(&count); err != nil {
			t.Fatal(err)
		}
		if count != want {
			t.Fatalf("persisted count for %s=%d want=%d", key, count, want)
		}
	}

	// A larger configured lease must still share one exact ceiling across API
	// instances when both processes reserve permits before either exhausts its
	// local cache.
	leaseRoute := route + "-large-lease"
	first := httpx.NewDBRateLimiter(db, leaseRoute, 10, time.Minute)
	second := httpx.NewDBRateLimiter(db, leaseRoute, 10, time.Minute)
	allowedCount := 0
	for i := 0; i < 30 && allowedCount < 10; i++ {
		limiter := first
		if i%2 == 1 {
			limiter = second
		}
		allowed, _, err := limiter.Check(ctx, "shared-large-lease")
		if err != nil {
			t.Fatalf("request %d within shared larger lease: %v", i+1, err)
		}
		if allowed {
			allowedCount++
		}
	}
	if allowedCount != 10 {
		t.Fatalf("shared larger-lease request count=%d want=10", allowedCount)
	}
	for _, limiter := range []*httpx.DBRateLimiter{first, second} {
		if allowed, _, err := limiter.Check(ctx, "shared-large-lease"); err != nil || allowed {
			t.Fatalf("larger shared lease exceeded its quota: allowed=%v want=false err=%v", allowed, err)
		}
	}
	var largerLeaseCount int
	if err := db.QueryRowContext(ctx, "SELECT SUM(request_count) FROM distributed_rate_limit_counters WHERE route_key = ? AND bucket_key = ?", leaseRoute, "shared-large-lease").Scan(&largerLeaseCount); err != nil {
		t.Fatal(err)
	}
	if largerLeaseCount != 10 {
		t.Fatalf("persisted larger-lease shared count=%d want=10", largerLeaseCount)
	}

	// Concurrent API instances can batch different keys together, but a key's
	// quota must remain exact when both instances reserve it at the same time.
	db.SetMaxOpenConns(4)
	db.SetMaxIdleConns(4)
	concurrentRoute := route + "-concurrent-batch"
	t.Cleanup(func() {
		_, _ = db.ExecContext(ctx, "DELETE FROM distributed_rate_limit_counters WHERE route_key = ?", concurrentRoute)
	})
	firstBatch := httpx.NewDBRateLimiter(db, concurrentRoute, 5, time.Minute)
	secondBatch := httpx.NewDBRateLimiter(db, concurrentRoute, 5, time.Minute)
	const keys = 40
	start := make(chan struct{})
	initialResults := make(chan error, keys*2)
	var initial sync.WaitGroup
	for i := 0; i < keys; i++ {
		key := fmt.Sprintf("candidate-%02d", i)
		for _, limiter := range []*httpx.DBRateLimiter{firstBatch, secondBatch} {
			initial.Add(1)
			go func(limiter *httpx.DBRateLimiter, key string) {
				defer initial.Done()
				<-start
				allowed, _, err := limiter.Check(ctx, key)
				if err != nil {
					initialResults <- err
				} else if !allowed {
					initialResults <- fmt.Errorf("first request for %s was denied", key)
				}
			}(limiter, key)
		}
	}
	close(start)
	initial.Wait()
	close(initialResults)
	for err := range initialResults {
		if err != nil {
			t.Fatal(err)
		}
	}

	for i := 0; i < keys; i++ {
		key := fmt.Sprintf("candidate-%02d", i)
		allowedCount := 2
		for request := 0; request < 20; request++ {
			limiter := firstBatch
			if request%2 == 1 {
				limiter = secondBatch
			}
			allowed, _, err := limiter.Check(ctx, key)
			if err != nil {
				t.Fatalf("quota request %d for %s: %v", request+3, key, err)
			}
			if allowed {
				allowedCount++
			}
		}
		if allowedCount != 5 {
			t.Fatalf("concurrent shared quota for %s allowed %d requests, want 5", key, allowedCount)
		}
	}

	rows, err := db.QueryContext(ctx, "SELECT bucket_key, SUM(request_count) FROM distributed_rate_limit_counters WHERE route_key = ? GROUP BY bucket_key", concurrentRoute)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	verified := 0
	for rows.Next() {
		var key string
		var count int
		if err := rows.Scan(&key, &count); err != nil {
			t.Fatal(err)
		}
		if count != 5 {
			t.Fatalf("persisted concurrent quota for %s=%d want=5", key, count)
		}
		verified++
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if verified != keys {
		t.Fatalf("verified %d concurrent quota keys, want %d", verified, keys)
	}
}

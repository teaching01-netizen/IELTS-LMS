package httpx

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// First request is allowed: pinned-conn upsert + LAST_INSERT_ID() reads 1 of 600.
// (Fresh inserts leave LAST_INSERT_ID()==0 on that connection; Check maps 0->1.)
func TestDBRateLimiterFirstRequestAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	limiter := NewDBRateLimiter(db, "global", 600, time.Minute)

	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO distributed_rate_limit_counters")).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT LAST_INSERT_ID()")).WillReturnRows(
		sqlmock.NewRows([]string{"LAST_INSERT_ID()"}).AddRow(0),
	)

	allowed, _, err := limiter.Check(context.Background(), "key-1")
	if err != nil {
		t.Fatalf("Check must not error on first request: %v", err)
	}
	if !allowed {
		t.Fatalf("first request (count 1 of 600) must be allowed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Over-limit request is denied: counter reads 601 of 600 with a retry delay.
func TestDBRateLimiterOverLimitDenied(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	limiter := NewDBRateLimiter(db, "global", 600, time.Minute)

	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO distributed_rate_limit_counters")).WillReturnResult(sqlmock.NewResult(601, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT LAST_INSERT_ID()")).WillReturnRows(
		sqlmock.NewRows([]string{"LAST_INSERT_ID()"}).AddRow(601),
	)

	allowed, retryAfter, err := limiter.Check(context.Background(), "key-1")
	if err != nil {
		t.Fatalf("Check must not error on over-limit read: %v", err)
	}
	if allowed {
		t.Fatalf("request (count 601 of 600) must be denied")
	}
	if retryAfter < time.Second {
		t.Fatalf("retryAfter must be >= 1s, got %v", retryAfter)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A DB error keeps the local verdict: allowed with a non-nil error.
func TestDBRateLimiterDBErrorKeepsLocalVerdict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	limiter := NewDBRateLimiter(db, "global", 600, time.Minute)

	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO distributed_rate_limit_counters")).WillReturnError(errors.New("db down"))

	allowed, _, err := limiter.Check(context.Background(), "key-1")
	if err == nil {
		t.Fatalf("Check must surface the DB error")
	}
	if !allowed {
		t.Fatalf("DB error must keep the local verdict (allowed=true)")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Trusted-proxy-aware ClientIPKey: XFF left-most is honored only when the
// TCP peer is a trusted proxy; otherwise RemoteAddr is authoritative.
func TestClientIPKeyTrustedProxy(t *testing.T) {
	SetTrustedProxies([]string{"10.0.0.0/8"})
	defer SetTrustedProxies([]string{"127.0.0.0/8", "::1/128"})
	mk := func(remote, xff string) string {
		req, _ := http.NewRequest("GET", "/", nil)
		req.RemoteAddr = remote
		if xff != "" {
			req.Header.Set("X-Forwarded-For", xff)
		}
		return ClientIPKey(req)
	}
	if got := mk("10.1.2.3:1234", "203.0.113.7, 10.1.2.3"); got != "ip:203.0.113.7" {
		t.Fatalf("trusted peer must use left-most XFF, got %q", got)
	}
	if got := mk("198.51.100.9:1234", "203.0.113.7"); got != "ip:198.51.100.9" {
		t.Fatalf("untrusted peer must ignore spoofed XFF, got %q", got)
	}
	if got := mk("198.51.100.9:1234", ""); got != "ip:198.51.100.9" {
		t.Fatalf("no XFF must use RemoteAddr, got %q", got)
	}
}

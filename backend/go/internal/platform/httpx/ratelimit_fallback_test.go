package httpx

import (
	"context"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// First request is allowed and reserves a bounded four-permit lease from the
// shared counter on the pinned connection.
func TestDBRateLimiterFirstRequestAllowed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	limiter := NewDBRateLimiter(db, "global", 600, time.Minute)

	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO distributed_rate_limit_counters")).
		WithArgs("global", "key-1", sqlmock.AnyArg(), 4, sqlmock.AnyArg(), 4, 600).
		WillReturnResult(sqlmock.NewResult(4, 1))

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

// An exhausted shared quota returns no permit and is denied with a retry delay.
func TestDBRateLimiterOverLimitDenied(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	limiter := NewDBRateLimiter(db, "global", 600, time.Minute)

	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO distributed_rate_limit_counters")).WillReturnResult(sqlmock.NewResult(0, 1))

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

func TestDBRateLimiterReusesLocalPermits(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	limiter := NewDBRateLimiter(db, "writes", 10, time.Minute)
	for _, grant := range []int{4, 4, 2, 0} {
		mock.ExpectExec(regexp.QuoteMeta("INSERT INTO distributed_rate_limit_counters")).
			WithArgs("writes", "attempt-1", sqlmock.AnyArg(), 4, sqlmock.AnyArg(), 4, 10).
			WillReturnResult(sqlmock.NewResult(int64(grant), 1))
	}
	for i := range 10 {
		allowed, _, err := limiter.Check(context.Background(), "attempt-1")
		if err != nil || !allowed {
			t.Fatalf("request %d: allowed=%v err=%v", i+1, allowed, err)
		}
	}
	if allowed, _, err := limiter.Check(context.Background(), "attempt-1"); err != nil || allowed {
		t.Fatalf("request beyond the exact shared quota: allowed=%v err=%v", allowed, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestDBRateLimiterLeasesCannotExceedSharedQuota(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	first := NewDBRateLimiter(db, "writes", 2, time.Minute)
	second := NewDBRateLimiter(db, "writes", 2, time.Minute)
	for _, grant := range []int{2, 0, 0} {
		mock.ExpectExec(regexp.QuoteMeta("INSERT INTO distributed_rate_limit_counters")).WillReturnResult(sqlmock.NewResult(int64(grant), 1))
	}
	if allowed, _, err := first.Check(context.Background(), "attempt-1"); err != nil || !allowed {
		t.Fatalf("first leased request: allowed=%v err=%v", allowed, err)
	}
	if allowed, _, err := second.Check(context.Background(), "attempt-1"); err != nil || allowed {
		t.Fatalf("second instance must not reserve beyond the shared limit: allowed=%v err=%v", allowed, err)
	}
	if allowed, _, err := first.Check(context.Background(), "attempt-1"); err != nil || !allowed {
		t.Fatalf("second request using the first lease: allowed=%v err=%v", allowed, err)
	}
	if allowed, _, err := first.Check(context.Background(), "attempt-1"); err != nil || allowed {
		t.Fatalf("request after the shared limit must be denied: allowed=%v err=%v", allowed, err)
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

func TestDBRateLimiterBatchedReservationsPreservePerKeyGrants(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	limiter := NewDBRateLimiter(db, "writes", 5, time.Minute)
	windowStart := "2026-10-22 05:00:00"
	expiresA := "2026-10-22 05:01:00"
	expiresB := "2026-10-22 05:01:01"
	requests := []*rateLimitReservationRequest{
		{ctx: context.Background(), key: "candidate-a", windowStart: windowStart, expires: expiresA, requested: 4, result: make(chan rateLimitReservationResult, 1)},
		{ctx: context.Background(), key: "candidate-b", windowStart: windowStart, expires: expiresB, requested: 4, result: make(chan rateLimitReservationResult, 1)},
	}

	mock.ExpectBegin()
	mock.ExpectExec("INSERT INTO distributed_rate_limit_counters").
		WithArgs("writes", "candidate-a", windowStart, expiresA, "writes", "candidate-b", windowStart, expiresB).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectQuery("SELECT bucket_key, request_count FROM distributed_rate_limit_counters").
		WithArgs("writes", windowStart, "candidate-a", "candidate-b").
		WillReturnRows(sqlmock.NewRows([]string{"bucket_key", "request_count"}).
			AddRow("candidate-a", 0).
			AddRow("candidate-b", 3))
	mock.ExpectExec("UPDATE distributed_rate_limit_counters AS counters").
		WithArgs("candidate-a", 4, expiresA, "candidate-b", 2, expiresB, "writes", windowStart).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectCommit()

	limiter.executeReservationBatch(requests)
	for i, want := range []int{4, 2} {
		got := <-requests[i].result
		if got.err != nil || got.grant != want {
			t.Fatalf("request %s grant=%d err=%v, want %d", requests[i].key, got.grant, got.err, want)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRateLimitBatchContextDoesNotInheritOneCallersCancellation(t *testing.T) {
	shortLived, cancelShortLived := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancelShortLived()
	requests := []*rateLimitReservationRequest{
		{ctx: shortLived},
		{ctx: context.Background()},
	}
	batchCtx, cancelBatch := rateLimitBatchContext(requests)
	defer cancelBatch()

	deadline, ok := batchCtx.Deadline()
	if !ok || time.Until(deadline) < time.Second {
		t.Fatalf("shared batch deadline should be independent of the short request deadline: deadline=%v ok=%v", deadline, ok)
	}
	cancelShortLived()
	if err := batchCtx.Err(); err != nil {
		t.Fatalf("one caller's cancellation canceled the shared reservation: %v", err)
	}
}

func TestDBRateLimiterRejectsUnstorableKeyBeforeBatching(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	limiter := NewDBRateLimiter(db, "writes", 10, time.Minute)
	allowed, _, err := limiter.Check(context.Background(), strings.Repeat("x", 256))
	if err == nil || !allowed {
		t.Fatalf("unstorable key should preserve the local fallback verdict with an error: allowed=%v err=%v", allowed, err)
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

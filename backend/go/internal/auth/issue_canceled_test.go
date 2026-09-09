package auth

// Plan E1 (round 151, TDD RED): the 5k entry wave proved a client-gone
// race masks as 500 — k6's queue-aged admissions time out client-side
// while the server is inside IssueAttemptToken's canonical re-read, and
// `auth: read attempt_sessions: context canceled` escapes as
// unknown-500 (r150: 6,580 of them). A canceled client must surface a
// retryable 503 SERVICE_UNAVAILABLE (or client-gone), never INTERNAL.
import (
	"context"
	"errors"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func testIssueConfig() config.Config {
	return config.Config{AuthSecret: "test-secret-that-is-long-enough-for-hmac-signing", AttemptTokenTTLMins: 15}
}

func testIssueLease() *uint64 {
	v := uint64(1)
	return &v
}

// TestIssueAttemptTokenOpaqueCancelStringIsRetryable pins the r153 live
// shape: the driver surfaces cancellation with the message intact but the
// identity opaque (`auth: upsert attempt_sessions: context canceled` as a
// plain error). The classifier must string-match the terminal cause.
func TestIssueAttemptTokenOpaqueCancelStringIsRetryable(t *testing.T) {
	if isClientGone(errors.New("auth: upsert attempt_sessions: context canceled")) != true {
		t.Fatal("opaque cancel string must classify as client-gone")
	}
	if isClientGone(errors.New("boom")) {
		t.Fatal("ordinary errors must not classify as client-gone")
	}
	if isClientGone(nil) {
		t.Fatal("nil must not classify as client-gone")
	}
}

// TestIssueAttemptTokenCanceledFallbackIsRetryable pins the r156 live
// shape: schemas predating organization_id/lease_epoch take the fallback
// leg on EVERY issuance, so a client gone mid-fallback must be retryable
// 503 (wide leg fails 1054 first, fallback then sees the dead client).
func TestIssueAttemptTokenCanceledFallbackIsRetryable(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec("INSERT INTO attempt_sessions").
		WillReturnError(errors.New("Error 1054 (42S22): Unknown column 'organization_id' in 'field list'"))
	mock.ExpectExec("INSERT INTO attempt_sessions").
		WillReturnError(context.Canceled)
	_, _, err = IssueAttemptToken(context.Background(), db, testIssueConfig(), "u-1", "sched-1", "att-1", "cs-1", nil, testIssueLease(), time.Now().UTC())
	if err == nil {
		t.Fatal("expected canceled-client error, got nil")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeServiceUnavailable {
		t.Fatalf("canceled fallback must be retryable 503, got: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestIssueAttemptTokenDeadlockRetriesToRetryable pins the r166 game-day
// shape: a 1213 deadlock on the wide upsert re-drives once; two consecutive
// deadlocks exhaust the bound and surface retryable 503 (never INTERNAL).
func TestIssueAttemptTokenDeadlockRetriesToRetryable(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	deadlock := errors.New("Error 1213 (40001): Deadlock found when trying to get lock; try restarting transaction")
	mock.ExpectExec("INSERT INTO attempt_sessions").WillReturnError(deadlock)
	mock.ExpectExec("INSERT INTO attempt_sessions").WillReturnError(deadlock)
	_, _, err = IssueAttemptToken(context.Background(), db, testIssueConfig(), "u-1", "sched-1", "att-1", "cs-1", nil, testIssueLease(), time.Now().UTC())
	if err == nil {
		t.Fatal("expected contended-issuance error, got nil")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeServiceUnavailable {
		t.Fatalf("exhausted deadlock retry must be retryable 503, got: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestIssueAttemptTokenCanceledUpsertIsRetryable pins the wide-upsert
// leg: a client gone mid-upsert (r152: 52 masked 500s) is retryable 503.
func TestIssueAttemptTokenCanceledUpsertIsRetryable(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec("INSERT INTO attempt_sessions").
		WillReturnError(context.Canceled)
	_, _, err = IssueAttemptToken(context.Background(), db, testIssueConfig(), "u-1", "sched-1", "att-1", "cs-1", nil, testIssueLease(), time.Now().UTC())
	if err == nil {
		t.Fatal("expected canceled-client error, got nil")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeServiceUnavailable {
		t.Fatalf("canceled upsert must be retryable 503, got: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueAttemptTokenCanceledClientIsRetryable(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectExec("INSERT INTO attempt_sessions").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery("SELECT token_id FROM attempt_sessions").
		WillReturnError(context.Canceled)
	_, _, err = IssueAttemptToken(context.Background(), db, testIssueConfig(), "u-1", "sched-1", "att-1", "cs-1", nil, testIssueLease(), time.Now().UTC())
	if err == nil {
		t.Fatal("expected canceled-client error, got nil")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != apperrors.CodeServiceUnavailable {
		t.Fatalf("canceled client must be retryable 503, got: %v", err)
	}
}

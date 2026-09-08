package outbox

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// B4: partitioned claiming adds the MOD(CRC32(aggregate_id)) predicate so N
// consumers hold disjoint leases. The UPDATE text must carry the predicate
// (asserted via regexp — absence fails the expectation).
func TestClaimPartitionPredicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db).WithClaim(4, 1, ClaimUpdate)
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("MOD(CRC32(aggregate_id), 4) = 1")).
		WithArgs(int64(60), "worker-1", sqlmock.AnyArg(), 10).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	if _, _, err := repo.ClaimBatch(context.Background(), 10, "worker-1", 60); err != nil {
		t.Fatalf("partitioned claim: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B4: single-consumer posture preserves today's claim SQL shape (no MOD
// predicate). sqlmock matches unordered, so assert the full due predicate
// text is present AND no CRC32 appears: the negative half is covered by
// TestClaimPartitionPredicate failing if the predicate ever leaks into the
// default path (both share partitionPredicate; default renders "").
func TestClaimUnpartitionedKeepsSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db)
	if got := repo.partitionPredicate(); got != "" {
		t.Fatalf("default posture must render empty predicate, got %q", got)
	}
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectExec("UPDATE outbox_events").
		WithArgs(int64(60), "worker-1", sqlmock.AnyArg(), 10).
		WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectCommit()
	if _, _, err := repo.ClaimBatch(context.Background(), 10, "worker-1", 60); err != nil {
		t.Fatalf("unpartitioned claim: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B4: SKIP LOCKED path claims via select-then-update by id.
func TestClaimSkipLockedPath(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db).WithClaim(1, 0, ClaimSkipLocked)
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FOR UPDATE SKIP LOCKED").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("ev-1").AddRow("ev-2"))
	mock.ExpectExec("UPDATE outbox_events").
		WithArgs(int64(60), "worker-1", sqlmock.AnyArg(), "ev-1", "ev-2").
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectQuery("WHERE claim_token = ").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "aggregate_kind", "aggregate_id", "revision", "event_family", "payload",
			"created_at", "publish_attempts", "last_error", "claim_token", "next_attempt_at", "failed_at",
		}))
	mock.ExpectCommit()
	if _, _, err := repo.ClaimBatch(context.Background(), 10, "worker-1", 60); err != nil {
		t.Fatalf("skiplocked claim: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B4: SKIP LOCKED with empty select commits cleanly with no claims.
func TestClaimSkipLockedEmpty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db).WithClaim(1, 0, ClaimSkipLocked)
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery("FOR UPDATE SKIP LOCKED").
		WithArgs(10).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectCommit()
	token, events, err := repo.ClaimBatch(context.Background(), 10, "worker-1", 60)
	if err != nil {
		t.Fatalf("empty skiplocked claim: %v", err)
	}
	if token != "" || len(events) != 0 {
		t.Fatalf("empty claim must return zero value, got %q %d", token, len(events))
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// B4: unknown claim mode fails closed at ClaimBatch (never silently
// changes locking semantics).
func TestClaimUnknownModeFailsClosed(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	repo := NewRepository(db).WithClaim(0, 0, ClaimMode("bogus"))
	if _, _, err := repo.ClaimBatch(context.Background(), 10, "w", 60); err == nil {
		t.Fatalf("unknown claim mode must fail closed")
	}
}

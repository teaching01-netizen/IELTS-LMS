package auth

// Round 168 (TDD RED): live schemas predate organization_id/lease_epoch
// (verified absent locally AND live). The wide verify SELECT hard-1054s on
// those schemas — every bearer verify fails, which the r167/168 rehearsals
// proved as blanket ATTEMPT_TOKEN_INVALID on delivery saves AND submits
// (the handlers map the verify error to INVALID without logging).
// The fallback to the base select must trigger on missing-column (1054)
// and succeed; non-1054 wide errors must still surface immediately.
import (
	"context"
	"errors"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
)

func testVerifyConfig() config.Config {
	return config.Config{AuthSecret: "0123456789abcdef0123456789abcdef"}
}

func mintVerifyToken(t *testing.T, cfg config.Config, exp time.Time) string {
	t.Helper()
	lease := uint64(1)
	tok, err := crypto.SignAttemptToken([]byte(cfg.AuthSecret), crypto.AttemptClaims{
		TokenID: "tok-verify-1", UserID: "u-1", ScheduleID: "sched-1",
		AttemptID: "att-1", ClientSessionID: "cs-1", LeaseEpoch: &lease,
		Exp: exp.Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func TestVerifyFallsBackOnMissingColumn(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := testVerifyConfig()
	now := time.Now().UTC()
	tok := mintVerifyToken(t, cfg, now.Add(time.Hour))
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WithArgs("tok-verify-1").
		WillReturnError(errors.New("Error 1054 (42S22): Unknown column 'organization_id' in 'field list'"))
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WithArgs("tok-verify-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"user_id", "schedule_id", "attempt_id", "client_session_id", "expires_at", "revoked_at",
		}).AddRow("u-1", "sched-1", "att-1", "cs-1", now.Add(time.Hour), nil))
	claims, err := VerifyAttemptToken(context.Background(), db, cfg, now, tok)
	if err != nil {
		t.Fatalf("1054 must fall back to base select, got: %v", err)
	}
	if claims.AttemptID != "att-1" {
		t.Fatalf("wrong claims after fallback: %+v", claims)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestVerifySurfacesNonMissingColumnError(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := testVerifyConfig()
	now := time.Now().UTC()
	tok := mintVerifyToken(t, cfg, now.Add(time.Hour))
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WithArgs("tok-verify-1").
		WillReturnError(errors.New("Error 1213 (40001): Deadlock found when trying to get lock"))
	if _, err := VerifyAttemptToken(context.Background(), db, cfg, now, tok); err == nil {
		t.Fatal("non-1054 wide error must surface, got nil")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

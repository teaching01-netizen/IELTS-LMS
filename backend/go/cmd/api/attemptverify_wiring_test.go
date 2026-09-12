package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
)

// WS-16: attempt-verify posture — behavioral divergence (DB round-trip vs
// zero-SQL), not a getter echo. A real HMAC bearer verifies under stateless
// with a nil DB (zero SQL); the same bearer under strict issues the
// attempt_sessions SELECT (an unknown token fails closed). If BuildApp
// dropped the AttemptVerify wiring, one posture would serve the other's
// traffic. Load-bearing line: main.go AttemptVerifyMode
// (Config.AttemptVerifyStateless).
func TestAppAttemptVerifyModeWiring(t *testing.T) {
	secret := "test-secret-with-at-least-32-characters!!"
	now := time.Now().UTC()
	tok, err := crypto.SignAttemptToken([]byte(secret), crypto.AttemptClaims{
		TokenID: "tok-1", UserID: "u-1", ScheduleID: "s-1",
		AttemptID: "a-1", ClientSessionID: "c-1", Exp: now.Add(15 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	req := httptest.NewRequest(http.MethodGet, "/", nil)

	cfg := config.Load()
	cfg.AuthSecret = secret
	cfg.AttemptVerify = config.AttemptVerifyStateless
	statelessApp := BuildApp(cfg, nil)
	if statelessApp.AttemptVerifyMode() != auth.AttemptVerifyStateless {
		t.Fatalf("stateless config must surface stateless mode, got %q", statelessApp.AttemptVerifyMode())
	}
	if _, err := verifyAttemptBearer(statelessApp, req, tok); err != nil {
		t.Fatalf("stateless must verify a fresh HMAC bearer with nil DB (zero SQL), got %v", err)
	}

	pool, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = pool.Close() }()
	cfg2 := config.Load()
	cfg2.AuthSecret = secret
	cfg2.AttemptVerify = config.AttemptVerifyStrict
	strictApp := BuildApp(cfg2, pool)
	if strictApp.AttemptVerifyMode() != auth.AttemptVerifyStrict {
		t.Fatalf("strict config must surface strict mode, got %q", strictApp.AttemptVerifyMode())
	}
	// Unknown token: the strict path must take the DB branch (SELECT issued)
	// and fail closed.
	mock.ExpectQuery("FROM attempt_sessions").
		WillReturnRows(sqlmock.NewRows([]string{"user_id", "schedule_id", "attempt_id", "client_session_id", "expires_at", "revoked_at", "organization_id", "lease_epoch"}))
	if _, err := verifyAttemptBearer(strictApp, req, tok); err == nil {
		t.Fatalf("strict must fail closed for an unknown attempt session")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("strict must issue the attempt_sessions SELECT (DB branch), got %v", err)
	}
}

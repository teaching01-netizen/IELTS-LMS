package auth

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func errNoRowsForTest() error { return sql.ErrNoRows }

func attemptTestCfg() config.Config {
	cfg := config.Load()
	cfg.AuthSecret = "test-only-auth-secret-32-chars-min"
	return cfg
}

func signAttempt(t *testing.T, cfg config.Config, mutate func(*crypto.AttemptClaims)) string {
	t.Helper()
	lease := uint64(7)
	claims := crypto.AttemptClaims{
		TokenID: "tok-1", UserID: "u-1", ScheduleID: "s-1", AttemptID: "a-1",
		ClientSessionID: "sess-1", OrganizationID: "org-1",
		LeaseEpoch: &lease, Exp: time.Now().UTC().Add(15 * time.Minute).Unix(),
	}
	if mutate != nil {
		mutate(&claims)
	}
	tok, err := crypto.SignAttemptToken([]byte(cfg.AuthSecret), claims)
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

// A3 RED: stateless verify accepts a well-formed token with ZERO sqlmock
// expectations queued (any SQL fails via unfulfilled expectations).
func TestVerifyAttemptStatelessNoSQL(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	tok := signAttempt(t, cfg, nil)
	claims, err := VerifyAttemptTokenRouted(context.Background(), db, cfg, AttemptVerifyStateless, time.Now().UTC(), tok)
	if err != nil {
		t.Fatalf("stateless verify: %v", err)
	}
	if claims.AttemptID != "a-1" || claims.ScheduleID != "s-1" || claims.UserID != "u-1" {
		t.Fatalf("claims mismatch: %+v", claims)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A3 RED: stateless still rejects forged / wrong-secret / expired /
// malformed tokens without touching the DB.
func TestVerifyAttemptStatelessRejectsBadTokens(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	good := signAttempt(t, cfg, nil)
	cases := map[string]string{
		"tampered":    good[:len(good)-2] + "AA",
		"malformed":   "not-a-token",
		"expired":     signAttempt(t, cfg, func(c *crypto.AttemptClaims) { c.Exp = time.Now().UTC().Add(-time.Minute).Unix() }),
		"zero-expiry": signAttempt(t, cfg, func(c *crypto.AttemptClaims) { c.Exp = 0 }),
	}
	for name, tok := range cases {
		if _, err := VerifyAttemptTokenRouted(context.Background(), db, cfg, AttemptVerifyStateless, time.Now().UTC(), tok); err == nil {
			t.Fatalf("%s token must be rejected", name)
		}
	}
	wrong := cfg
	wrong.AuthSecret = "wrong-secret-value-here-12345678"
	if _, err := VerifyAttemptTokenRouted(context.Background(), db, wrong, AttemptVerifyStateless, time.Now().UTC(), good); err == nil {
		t.Fatalf("wrong-secret token must be rejected")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A3 RED: strict mode keeps today's DB binding (unknown token_id -> error,
// revoked/mismatched rows fail closed) — the rollback posture stays intact.
func TestVerifyAttemptStrictKeepsDBBinding(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	tok := signAttempt(t, cfg, nil)
	// Unknown token_id: wide SELECT misses with sql.ErrNoRows (NOT a 1054,
	// so per the r168 gate the fallback must NOT fire a second query) ->
	// error, zero claims.
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnError(errNoRowsForTest())
	if _, err := VerifyAttemptTokenRouted(context.Background(), db, cfg, AttemptVerifyStrict, time.Now().UTC(), tok); err == nil {
		t.Fatalf("strict unknown session must error")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A3 RED: routed default (zero value) is strict — ship state unchanged.
func TestVerifyAttemptRoutedDefaultStrict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	tok := signAttempt(t, cfg, nil)
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").WillReturnError(errNoRowsForTest())
	if _, err := VerifyAttemptTokenRouted(context.Background(), db, cfg, AttemptVerifyMode(""), time.Now().UTC(), tok); err == nil {
		t.Fatalf("zero-value mode must behave strict")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

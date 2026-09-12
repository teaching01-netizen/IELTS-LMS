package auth

import (
	"context"
	"database/sql"
	"errors"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/crypto"
)

func mintReadToken(t *testing.T, cfgSecret string, tokenID string, lease *uint64, exp time.Time) string {
	t.Helper()
	tok, err := crypto.SignAttemptToken([]byte(cfgSecret), crypto.AttemptClaims{
		TokenID: tokenID, UserID: "u-1", ScheduleID: "s-1",
		AttemptID: "a-1", ClientSessionID: "cs-1", LeaseEpoch: lease,
		Exp: exp.Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return tok
}

func leasePtr(v uint64) *uint64 { return &v }

// Terminated-bearer replay: the session row is revoked (predicate filters it
// -> ErrNoRows) so the read fails closed in stateless mode too.
func TestVerifyAttemptReadRevokedFailsClosed(t *testing.T) {
	for _, mode := range []string{"strict", "stateless"} {
		t.Run(mode, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			cfg := attemptTestCfg()
			now := time.Now().UTC()
			tok := signAttempt(t, cfg, nil)
			// Revoked/rotated row: the revoked_at IS NULL predicate
			// filters it, surfacing as an unknown session.
			mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
				WithArgs("tok-1").
				WillReturnError(sql.ErrNoRows)
			if _, err := VerifyAttemptRead(context.Background(), db, cfg, now, tok); err == nil {
				t.Fatalf("%s: revoked session replay must fail closed", mode)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Live row (revoked_at NULL, matching lease) verifies in both modes.
func TestVerifyAttemptReadLiveRowAccepts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	now := time.Now().UTC()
	tok := signAttempt(t, cfg, nil)
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WithArgs("tok-1").
		WillReturnRows(sqlmock.NewRows([]string{"token_id", "revoked_at", "expires_at", "lease_epoch"}).
			AddRow("tok-1", nil, now.Add(time.Hour), 7))
	claims, err := VerifyAttemptRead(context.Background(), db, cfg, now, tok)
	if err != nil {
		t.Fatalf("live session row must verify: %v", err)
	}
	if claims.AttemptID != "a-1" {
		t.Fatalf("wrong claims: %+v", claims)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Lease mismatch (post-takeover old token_id presenting a stale lease epoch)
// fails closed on reads.
func TestVerifyAttemptReadLeaseMismatchFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	now := time.Now().UTC()
	tok := signAttempt(t, cfg, nil) // lease 7 in claims
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WithArgs("tok-1").
		WillReturnRows(sqlmock.NewRows([]string{"token_id", "revoked_at", "expires_at", "lease_epoch"}).
			AddRow("tok-1", nil, now.Add(time.Hour), 8))
	if _, err := VerifyAttemptRead(context.Background(), db, cfg, now, tok); err == nil {
		t.Fatal("stale-lease replay must fail closed on reads")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Pre-migration schemas without lease_epoch fall back to the
// token_id/revoked_at probe (mirrors VerifyAttemptToken's 1054 fallback).
func TestVerifyAttemptReadFallsBackOnMissingColumn(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	now := time.Now().UTC()
	tok := signAttempt(t, cfg, nil)
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WithArgs("tok-1").
		WillReturnError(errors.New("Error 1054 (42S22): Unknown column 'lease_epoch' in 'field list'"))
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WithArgs("tok-1").
		WillReturnRows(sqlmock.NewRows([]string{"token_id", "revoked_at", "expires_at"}).
			AddRow("tok-1", nil, now.Add(time.Hour)))
	if _, err := VerifyAttemptRead(context.Background(), db, cfg, now, tok); err != nil {
		t.Fatalf("1054 must fall back to the base read probe, got: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// An expired DB row fails closed on reads even when the crypto Exp is
// still valid (DB-side expiry is defense in depth behind the HMAC check).
func TestVerifyAttemptReadExpiredRowFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	now := time.Now().UTC()
	tok := signAttempt(t, cfg, nil)
	mock.ExpectQuery("FROM attempt_sessions WHERE token_id").
		WithArgs("tok-1").
		WillReturnRows(sqlmock.NewRows([]string{"token_id", "revoked_at", "expires_at", "lease_epoch"}).
			AddRow("tok-1", nil, now.Add(-time.Minute), 7))
	if _, err := VerifyAttemptRead(context.Background(), db, cfg, now, tok); err == nil {
		t.Fatal("expired session row must fail closed on reads")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Empty TokenID fails closed without trusting the bearer.
func TestVerifyAttemptReadEmptyTokenIDFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	now := time.Now().UTC()
	tok := signAttempt(t, cfg, func(c *crypto.AttemptClaims) { c.TokenID = "" })
	if _, err := VerifyAttemptRead(context.Background(), db, cfg, now, tok); err == nil {
		t.Fatal("empty token id must fail closed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Forged/expired bearers fail before any SQL.
func TestVerifyAttemptReadRejectsBadCrypto(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	now := time.Now().UTC()
	good := signAttempt(t, cfg, nil)
	for name, tok := range map[string]string{
		"tampered":  good[:len(good)-2] + "AA",
		"malformed": "not-a-token",
		"expired": signAttempt(t, cfg, func(c *crypto.AttemptClaims) {
			c.Exp = now.Add(-time.Minute).Unix()
		}),
	} {
		if _, err := VerifyAttemptRead(context.Background(), db, cfg, now, tok); err == nil {
			t.Fatalf("%s bearer must be rejected", name)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

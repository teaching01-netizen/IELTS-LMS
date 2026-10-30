package auth

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestSittingGrantSnapshotsBoundedLifetime(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	cfg.ExamAccessEnabled = true
	cfg.ExamAccessMaxHours = 12
	now := time.Now().UTC().Truncate(time.Second)
	mock.ExpectQuery("SELECT token_id, user_id, credential_policy").WithArgs("attempt", "writer").WillReturnError(sql.ErrNoRows)
	mock.ExpectExec("INSERT INTO attempt_sessions").WillReturnResult(sqlmock.NewResult(1, 1))
	token, expires, err := IssueExamGrantTx(context.Background(), db, cfg, "user", "schedule", "attempt", "writer", nil, 1, now, ExamGrantOptions{AccountSessionID: "account"})
	if err != nil {
		t.Fatal(err)
	}
	if !expires.Equal(now.Add(12 * time.Hour)) {
		t.Fatalf("expiry %v", expires)
	}
	claims, err := crypto.VerifyAttemptToken([]byte(cfg.AuthSecret), now, token)
	if err != nil || claims.CredentialPolicy != ExamCredentialSitting || claims.TokenID == "" || claims.Exp != expires.Unix() {
		t.Fatalf("grant: %+v %v", claims, err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSittingGrantResumeKeepsIdentityAndExpiryWhenIssuanceDisabled(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	cfg := attemptTestCfg()
	cfg.ExamAccessEnabled = false
	now := time.Now().UTC().Truncate(time.Second)
	expires := now.Add(time.Hour)
	mock.ExpectQuery("SELECT token_id, user_id, credential_policy").WillReturnRows(sqlmock.NewRows([]string{"token_id", "user_id", "credential_policy", "expires_at", "revoked_at", "lease_epoch", "schedule_id", "organization_id"}).AddRow("stable", "user", ExamCredentialSitting, expires, nil, 4, "schedule", "org"))
	token, actual, err := IssueExamGrantTx(context.Background(), db, cfg, "user", "schedule", "attempt", "writer", nil, 4, now, ExamGrantOptions{})
	if err != nil {
		t.Fatal(err)
	}
	claims, err := crypto.VerifyAttemptToken([]byte(cfg.AuthSecret), now, token)
	if err != nil || claims.TokenID != "stable" || !actual.Equal(expires) {
		t.Fatalf("resumed: %+v %v", claims, err)
	}
	if err = mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSittingGrantResumeCannotResurrectOrExtend(t *testing.T) {
	for _, scenario := range []string{"revoked", "expired", "wrong_lease", "wrong_user"} {
		t.Run(scenario, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			cfg := attemptTestCfg()
			cfg.ExamAccessEnabled = true
			now := time.Now().UTC().Truncate(time.Second)
			expires := now.Add(time.Hour)
			var revoked any
			user := "user"
			lease := uint64(1)
			expected := apperrors.CodeExamAccessRevoked
			switch scenario {
			case "revoked":
				revoked = now
			case "expired":
				expires = now
				expected = apperrors.CodeExamAccessExpired
			case "wrong_lease":
				lease = 2
				expected = apperrors.CodeLeaseFenced
			case "wrong_user":
				user = "other"
				expected = apperrors.CodeForbidden
			}
			mock.ExpectQuery("SELECT token_id, user_id, credential_policy").WillReturnRows(sqlmock.NewRows([]string{"token_id", "user_id", "credential_policy", "expires_at", "revoked_at", "lease_epoch", "schedule_id", "organization_id"}).AddRow("stable", user, ExamCredentialSitting, expires, revoked, lease, "schedule", nil))
			_, _, err = IssueExamGrantTx(context.Background(), db, cfg, "user", "schedule", "attempt", "writer", nil, 1, now, ExamGrantOptions{})
			if e, ok := apperrors.As(err); !ok || e.Code != expected {
				t.Fatalf("expected %s, got %v", expected, err)
			}
			if err = mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

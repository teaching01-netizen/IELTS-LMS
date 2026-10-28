package delivery

import (
	"context"
	"regexp"
	"testing"
	"time"

	platformcrypto "example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestReadyDeviceRecoveryBrowserProofAndFixedExpiry(t *testing.T) {
	for _, tc := range []struct {
		name                       string
		wrong, expired, superseded bool
	}{
		{name: "refresh"}, {name: "wrong browser", wrong: true}, {name: "expired", expired: true}, {name: "replaced", superseded: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			now := time.Now().UTC().Truncate(time.Microsecond)
			attempt := heldSATRecoveryAttempt(now, "grant-1")
			if tc.superseded {
				attempt = heldSATRecoveryAttempt(now, "grant-new")
			}
			grant := issuedRecoveryGrant(attempt, "grant-1", "op-issue-1", "link", "123456", now)
			proof := "browser-proof-0001"
			grant.state = recoveryGrantClaimed
			grant.claimProofHash = platformcrypto.RecoveryClaimProofHash(recoveryTestSecret, grant.id, proof)
			expires := now.Add(time.Minute)
			if tc.expired {
				expires = now.Add(-time.Second)
			}
			grant.claimExpiresAt = &expires
			claimed := now.Add(-time.Minute)
			grant.claimedAt = &claimed
			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			expectRecoveryGrantRead(mock, grant, false)
			expectRecoveryClaimAttemptLock(mock, attempt)
			expectRecoveryGrantRead(mock, grant, true)
			mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
			if tc.wrong {
				proof = "another-browser-proof"
				mock.ExpectRollback()
			} else if tc.superseded {
				mock.ExpectRollback()
			} else if tc.expired {
				mock.ExpectExec("UPDATE attempt_device_recovery_grants").WithArgs(grant.id).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectCommit()
			} else {
				expectRecoveryReadyQueries(mock, attempt, now.Add(-5*time.Minute))
				mock.ExpectCommit()
			}
			svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(false, recoveryTestSecret)
			out, err := svc.ReadyDeviceRecovery(context.Background(), grant.id, proof)
			if tc.wrong || tc.expired || tc.superseded {
				if err == nil || out != nil {
					t.Fatalf("out=%v err=%v", out, err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if out.ClaimExpiresAt == nil || !out.ClaimExpiresAt.Equal(expires) {
					t.Fatal("refresh extended preparation")
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

package integration

import (
	"context"
	"database/sql"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// Logout-all and security reset lock users FOR UPDATE and then revoke every
// exam grant. Transfer commit fences grants and then issues a credential that
// reads users FOR SHARE. Both must follow users -> attempt_sessions, otherwise
// the two transactions deadlock. This pins the order deterministically: while
// a logout-all-shaped transaction holds the account row, the transfer commit
// must be waiting on the account and must not hold any grant lock.
func TestTransferCommitTakesAccountLockBeforeFencingGrantsMySQL(t *testing.T) {
	f := newTransferFixture(t)
	a := f.admit(t, "sess-a")
	req, err := f.request(t, "op-lock-order-"+uuid.NewString(), "sess-b", a.LeaseEpoch)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ConfirmTransferByWriter(context.Background(), a.Token, req.RequestID, f.policy); err != nil {
		t.Fatal(err)
	}

	ctx := context.Background()
	logoutAll, err := f.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = logoutAll.Rollback() }()
	var state string
	if err := logoutAll.QueryRowContext(ctx, `SELECT state FROM users WHERE id = ? FOR UPDATE`, f.userID).Scan(&state); err != nil {
		t.Fatal(err)
	}

	// Production issuance reads the account FOR SHARE (admission gate).
	issuer := func(ctx context.Context, q tx.Tx, lease uint64) (string, time.Time, error) {
		var s string
		if err := q.QueryRowContext(ctx, `SELECT state FROM users WHERE id = ? FOR SHARE`, f.userID).Scan(&s); err != nil {
			return "", time.Time{}, err
		}
		return f.issuer("sess-b")(ctx, q, lease)
	}
	done := make(chan error, 1)
	go func() {
		commitCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
		defer cancel()
		_, err := f.svc.CommitTransfer(commitCtx, attempts.CommitTransferCommand{
			RequestID: req.RequestID, TargetSessionID: "sess-b",
			Requester: attempts.RequesterRef{UserID: f.userID, AuthSessionID: "auth-sess-b", ScheduleID: f.scheduleID, ClientSessionID: "sess-b"},
		}, func(string) attempts.CredentialIssuer { return issuer })
		done <- err
	}()

	waitForUsersLockWait(t, f.db, done)
	probe, err := f.db.BeginTx(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	var tokenID string
	probeErr := probe.QueryRowContext(ctx, `SELECT token_id FROM attempt_sessions WHERE attempt_id = ? AND client_session_id = 'sess-a' FOR UPDATE NOWAIT`, f.attemptID).Scan(&tokenID)
	_ = probe.Rollback()
	if probeErr != nil {
		t.Fatalf("transfer commit locked a grant before the account row: %v", probeErr)
	}

	// The logout-all suffix proceeds without a deadlock, then the transfer
	// commits once the account lock is released.
	if _, err := logoutAll.ExecContext(ctx, `UPDATE attempt_sessions SET revoked_at = UTC_TIMESTAMP(6), revocation_reason = 'logout_all' WHERE user_id = ? AND revoked_at IS NULL`, f.userID); err != nil {
		t.Fatalf("logout-all grant revocation: %v", err)
	}
	if err := logoutAll.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatalf("transfer commit after logout-all: %v", err)
	}
	if live := f.liveSessions(t); live["sess-a"] || !live["sess-b"] {
		t.Fatalf("old grant must stay revoked and the explicit transfer grant must be live: %v", live)
	}
}

func waitForUsersLockWait(t *testing.T, db *sql.DB, done <-chan error) {
	t.Helper()
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		var waiting int
		if err := db.QueryRow(`SELECT COUNT(*) FROM information_schema.innodb_trx WHERE trx_state = 'LOCK WAIT' AND trx_query LIKE '%FROM users WHERE id = %FOR SHARE%'`).Scan(&waiting); err != nil {
			t.Fatal(err)
		}
		if waiting > 0 {
			return
		}
		select {
		case err := <-done:
			t.Fatalf("transfer commit finished before waiting on the account lock: %v", err)
		// INNODB_TRX refreshes only after 0.1s without reads; poll slower.
		case <-time.After(150 * time.Millisecond):
		}
	}
	t.Fatal("transfer commit never waited on the account lock")
}

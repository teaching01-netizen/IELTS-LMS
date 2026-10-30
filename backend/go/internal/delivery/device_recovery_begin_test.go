package delivery

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"testing"
	"time"

	examdomain "example.com/ielts-proctoring/internal/exams"
	platformcrypto "example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"github.com/DATA-DOG/go-sqlmock"
)

func TestBeginDeviceRecoveryCommitsClockAndCredentialsAtomically(t *testing.T) {
	for _, failIssuer := range []bool{false, true} {
		t.Run(map[bool]string{false: "commit", true: "credential failure rolls back"}[failIssuer], func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			now := time.Now().UTC().Truncate(time.Microsecond)
			attempt := heldSATRecoveryAttempt(now, "grant-1")
			grant := issuedRecoveryGrant(attempt, "grant-1", "op-issue-0001", "link", "123456", now)
			grant.state = recoveryGrantClaimed
			grant.targetClientSessionID = "new-browser"
			proof := "browser-proof-0001"
			grant.claimProofHash = platformcrypto.RecoveryClaimProofHash(recoveryTestSecret, grant.id, proof)
			claimExpiry := now.Add(time.Minute)
			grant.claimExpiresAt = &claimExpiry
			award := 480
			grant.requested = &award
			deadline := now.Add(480 * time.Second)
			mock.ExpectBegin()
			mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
			expectRecoveryGrantRead(mock, grant, false)
			expectRecoveryAttempt(mock, attempt, true)
			expectRecoveryPrincipalLock(mock, attempt)
			expectRecoveryGrantRead(mock, grant, true)
			mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
			mock.ExpectQuery("(?s)FROM assessment_module_attempts ma.*").WithArgs(attempt.id, attempt.version).WillReturnRows(recoverySATTargetRows(now.Add(-time.Minute)))
			expectNoRecoveryReceipt(mock, attempt.id, 0)
			mock.ExpectExec("UPDATE assessment_module_attempts SET state = 'active'").WithArgs(now, 480, "ma-1", attempt.id, "mod-1").WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectQuery("SELECT run_generation FROM assessment_module_attempts").WithArgs("ma-1", attempt.id).WillReturnRows(sqlmock.NewRows([]string{"run_generation"}).AddRow(1))
			mock.ExpectQuery("SELECT CAST\\(s.sat_delivery_policy AS CHAR\\)").WithArgs(attempt.id).WillReturnRows(sqlmock.NewRows([]string{"sat_delivery_policy", "timing_model"}).AddRow(nil, "legacy_section_v1"))
			mock.ExpectExec("UPDATE student_attempts.*").WithArgs(sqlmock.AnyArg(), "new-browser", attempt.id).WillReturnResult(sqlmock.NewResult(0, 1))
			mock.ExpectQuery("SELECT lease_epoch, control_epoch").WithArgs(attempt.id).WillReturnRows(sqlmock.NewRows([]string{"lease_epoch", "control_epoch"}).AddRow(4, 2))
			mock.ExpectExec("UPDATE attempt_sessions").WithArgs(attempt.id).WillReturnResult(sqlmock.NewResult(0, 0))
			mock.ExpectExec("UPDATE student_attempts SET deadline_at").WithArgs(deadline, "sat", "math", attempt.id).WillReturnResult(sqlmock.NewResult(0, 1))
			if failIssuer {
				mock.ExpectRollback()
			} else {
				mock.ExpectExec("UPDATE attempt_device_recovery_grants SET state = 'started'").WithArgs(now, uint64(4), "op-begin-0001", sqlmock.AnyArg(), grant.id).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectExec("INSERT INTO session_audit_logs").WithArgs(sqlmock.AnyArg(), attempt.schedule, attempt.userID, attempt.id, sqlmock.AnyArg()).WillReturnResult(sqlmock.NewResult(0, 1))
				mock.ExpectQuery("SELECT candidate_id FROM student_attempts").WithArgs(attempt.id).WillReturnRows(sqlmock.NewRows([]string{"candidate_id"}).AddRow("candidate-1"))
				mock.ExpectCommit()
			}
			issuerFailure := errors.New("session insert failed")
			calls := 0
			svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(false, recoveryTestSecret).SetRecoveryContinuation(func(_ context.Context, _ tx.Tx, req RecoveryCredentialRequest) (RecoveryCredentialIdentity, error) {
				calls++
				if req.LeaseEpoch != 4 || req.ClientSessionID != "new-browser" {
					t.Fatalf("wrong authority: %+v", req)
				}
				if failIssuer {
					return RecoveryCredentialIdentity{}, issuerFailure
				}
				return RecoveryCredentialIdentity{SessionID: "session-1", ClientSessionID: "new-browser", SessionToken: "cookie", AttemptToken: "attempt-bearer", AttemptExpiresAt: now.Add(time.Hour)}, nil
			}, nil)
			out, id, err := svc.BeginDeviceRecovery(context.Background(), grant.id, BeginDeviceRecoveryRequest{OperationID: "op-begin-0001", BrowserProof: proof}, nil, nil)
			if calls != 1 {
				t.Fatalf("issuer calls %d", calls)
			}
			if failIssuer {
				if !errors.Is(err, issuerFailure) || out != nil || id.AttemptToken != "" {
					t.Fatalf("out=%+v id=%+v err=%v", out, id, err)
				}
			} else {
				if err != nil {
					t.Fatal(err)
				}
				if out.EffectiveDeadlineAt == nil || !out.EffectiveDeadlineAt.Equal(deadline) {
					t.Fatal("award was not anchored to Continue")
				}
				if out.RoutePath != "/student/sched-1/candidate-1" {
					t.Fatal(out.RoutePath)
				}
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestBeginDeviceRecoveryReplayDoesNotAwardTimeAgain(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	now := time.Now().UTC().Truncate(time.Microsecond)
	deadline := now.Add(100 * time.Second)
	attempt := heldSATRecoveryAttempt(now, "grant-1")
	attempt.lease = 4
	attempt.control = 2
	session := "new-browser"
	attempt.activeSession = &session
	control := examdomain.NewRecoveryControl("recovery-1", "old", examdomain.RecoveryTarget{SectionKey: "math", ModuleAttemptID: "ma-1", ModuleID: "mod-1"})
	control.ActiveGrantID = "grant-1"
	control.Phase = examdomain.RecoveryPhaseWorking
	control.FocusRunGeneration = 1
	raw, _ := json.Marshal(control)
	attempt.rawControl = string(raw)
	grant := issuedRecoveryGrant(attempt, "grant-1", "op-issue-0001", "link", "123456", now)
	grant.state = recoveryGrantStarted
	grant.targetClientSessionID = session
	grant.beginOperationID = "op-begin-0001"
	proof := "browser-proof-0001"
	grant.claimProofHash = platformcrypto.RecoveryClaimProofHash(recoveryTestSecret, grant.id, proof)
	grant.beginReceipt, _ = json.Marshal(RecoveryBeginReceipt{OperationID: grant.beginOperationID, LeaseEpoch: 4, ControlEpoch: 2, RunGeneration: 1, EffectiveDeadlineAt: &deadline})
	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryAttempt(mock, attempt, true)
	expectRecoveryPrincipalLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery("SELECT UTC_TIMESTAMP").WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery("SELECT candidate_id").WithArgs(attempt.id).WillReturnRows(sqlmock.NewRows([]string{"candidate_id"}).AddRow("candidate-1"))
	mock.ExpectCommit()
	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(false, recoveryTestSecret).SetRecoveryContinuation(func(context.Context, tx.Tx, RecoveryCredentialRequest) (RecoveryCredentialIdentity, error) {
		return RecoveryCredentialIdentity{AttemptToken: "refreshed"}, nil
	}, nil)
	out, _, err := svc.BeginDeviceRecovery(context.Background(), grant.id, BeginDeviceRecoveryRequest{OperationID: grant.beginOperationID, BrowserProof: proof}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !out.Replayed || out.EffectiveDeadlineAt == nil || !out.EffectiveDeadlineAt.Equal(deadline) {
		t.Fatalf("replay changed clock: %+v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Begin locks the account before fencing grants (users -> attempt_sessions),
// matching logout-all and security reset.
func expectRecoveryPrincipalLock(mock sqlmock.Sqlmock, attempt recoveryAttemptFixture) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT state FROM users WHERE id = ? FOR SHARE")).WithArgs(attempt.userID).
		WillReturnRows(sqlmock.NewRows([]string{"state"}).AddRow("active"))
}

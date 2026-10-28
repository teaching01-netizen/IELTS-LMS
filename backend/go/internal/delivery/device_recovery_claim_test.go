package delivery

// Staff-assisted exam recovery claim contracts.
//
// These tests pin the security boundary: nothing about the sitting is
// revealed before the code verifies, wrong codes consume a persisted budget
// that survives the refusal, and only the browser that claimed the grant can
// replay the ready projection.

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	platformcrypto "example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

type recoveryGrantFixture struct {
	id, attemptID, scheduleID, operationID, state string
	sectionKey, moduleAttemptID, moduleID         string
	requested                                     *int
	expectedControl, expectedLease, revision      uint64
	failed                                        int
	issuedAt, expiresAt                           time.Time
	sealed                                        []byte
	claimProofHash, claimOperationID              string
	targetClientSessionID                         string
	claimedAt, claimExpiresAt, startedAt          *time.Time
	resultingLease                                *uint64
	beginOperationID                              string
	beginReceipt                                  []byte
	restoredAt                                    *time.Time
	restoredBy                                    string
	linkSecretHash, codeMAC                       string
}

func anyPollTime(value *time.Time) driver.Value {
	if value == nil {
		return nil
	}
	return *value
}

func anyPollInt(value *int) driver.Value {
	if value == nil {
		return nil
	}
	return int64(*value)
}

func anyPollUint(value *uint64) driver.Value {
	if value == nil {
		return nil
	}
	return int64(*value)
}

func anyPollBytes(value []byte) driver.Value {
	if value == nil {
		return nil
	}
	return value
}

func anyPollString(value string) driver.Value {
	if value == "" {
		return nil
	}
	return value
}

func (g recoveryGrantFixture) values() []driver.Value {
	return []driver.Value{
		g.id, g.attemptID, g.scheduleID, "staff-1", g.operationID,
		strings.Repeat("a", 64), g.state, g.sectionKey,
		anyPollString(g.moduleAttemptID), anyPollString(g.moduleID),
		anyPollInt(g.requested), int64(g.expectedControl), int64(g.expectedLease),
		int64(g.revision), int64(g.failed), g.issuedAt, g.expiresAt, anyPollBytes(g.sealed),
		anyPollString(g.claimProofHash), anyPollString(g.claimOperationID),
		anyPollString(g.targetClientSessionID), anyPollTime(g.claimedAt),
		anyPollTime(g.claimExpiresAt), anyPollTime(g.startedAt),
		anyPollUint(g.resultingLease), anyPollString(g.beginOperationID),
		anyPollBytes(g.beginReceipt), anyPollTime(g.restoredAt),
		anyPollString(g.restoredBy), g.linkSecretHash, g.codeMAC,
	}
}

func heldSATRecoveryAttempt(now time.Time, grantID string) recoveryAttemptFixture {
	f := openSATRecoveryAttempt(now)
	c := examdomain.NewRecoveryControl("recovery-1", "sess-old", examdomain.RecoveryTarget{SectionKey: "math", ModuleAttemptID: "ma-1", ModuleID: "mod-1"})
	c.ActiveGrantID = grantID
	raw, _ := json.Marshal(c)
	f.rawControl = string(raw)
	f.activeSession = nil
	return f
}

func issuedRecoveryGrant(attempt recoveryAttemptFixture, grantID, operationID, link, code string, now time.Time) recoveryGrantFixture {
	return recoveryGrantFixture{
		id: grantID, attemptID: attempt.id, scheduleID: attempt.schedule,
		operationID: operationID, state: recoveryGrantIssued,
		sectionKey: "math", moduleAttemptID: "ma-1", moduleID: "mod-1",
		expectedControl: 1, expectedLease: 3, revision: 1,
		issuedAt: now.Add(-time.Minute), expiresAt: now.Add(5 * time.Minute),
		linkSecretHash: platformcrypto.RecoveryLinkHash(recoveryTestSecret, link),
		codeMAC:        platformcrypto.RecoveryCodeMAC(recoveryTestSecret, grantID, attempt.id, code),
	}
}

func expectRecoveryClaimAttemptLock(mock sqlmock.Sqlmock, attempt recoveryAttemptFixture) {
	expectRecoveryAttempt(mock, attempt, true)
}

func expectRecoveryGrantRead(mock sqlmock.Sqlmock, grant recoveryGrantFixture, forUpdate bool) {
	query := regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE id = ?")
	if forUpdate {
		query += " FOR UPDATE"
	}
	mock.ExpectQuery(query).WithArgs(grant.id).WillReturnRows(recoveryGrantRowColumns().AddRow(grant.values()...))
}

func expectRecoveryReadyQueries(mock sqlmock.Sqlmock, attempt recoveryAttemptFixture, started time.Time) {
	mock.ExpectQuery("(?s)FROM assessment_module_attempts ma.*").
		WithArgs(attempt.id, attempt.version).
		WillReturnRows(recoverySATTargetRows(started))
	expectNoRecoveryReceipt(mock, attempt.id, attempt.generation)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT COUNT(*), MAX(updated_at) FROM attempt_responses_v2 WHERE attempt_id = ?")).
		WithArgs(attempt.id).
		WillReturnRows(sqlmock.NewRows([]string{"COUNT(*)", "MAX(updated_at)"}).AddRow(3, started.Add(time.Minute)))
	mock.ExpectQuery("(?s)FROM attempt_audio_checkpoints.*").
		WithArgs(attempt.id).
		WillReturnRows(sqlmock.NewRows([]string{
			"section_key", "part_id", "media_revision", "position_ms",
			"client_sequence", "run_generation", "updated_at",
		}).AddRow("listening", "part-1", "media-v1", 12500, 4, 0, started.Add(2*time.Minute)))
	mock.ExpectQuery("(?s)FROM assessment_exam_questions eq.*").
		WithArgs(attempt.version, "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "module_id", "section_key", "stimulus", "prompt", "answer_definition",
		}).AddRow(
			"eq-1", "mod-1", "math",
			`{"type":"doc","content":[{"type":"image","attrs":{"assetId":"asset-1"}}]}`,
			`{"type":"doc","content":[]}`,
			`{"options":[{"content":{"type":"doc","content":[{"type":"image","attrs":{"assetId":"asset-2"}}]}}]}`,
		))
}

func TestClaimDeviceRecoveryConsumesCodeAndReturnsPreparationOnly(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC().Truncate(time.Microsecond)
	attempt := heldSATRecoveryAttempt(now, "grant-1")
	started := now.Add(-5 * time.Minute)
	req := ClaimDeviceRecoveryRequest{
		OperationID: "op-claim-0001", LinkSecret: "link-secret-value",
		Code: "123456", BrowserProof: "browser-proof-0001",
	}
	grant := issuedRecoveryGrant(attempt, "grant-1", "op-issue-0001", req.LinkSecret, req.Code, now)
	proofHash := platformcrypto.RecoveryClaimProofHash(recoveryTestSecret, grant.id, req.BrowserProof)
	claimExpires := now.Add(recoveryClaimTTL)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryClaimAttemptLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE attempt_device_recovery_grants")).
		WithArgs(req.OperationID, proofHash, sqlmock.AnyArg(), now, claimExpires, grant.id).
		WillReturnResult(sqlmock.NewResult(0, 1))
	expectRecoveryReadyQueries(mock, attempt, started)
	mock.ExpectCommit()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	out, err := svc.ClaimDeviceRecovery(context.Background(), grant.id, req)
	if err != nil {
		t.Fatalf("claim: %v", err)
	}
	if out.State != recoveryGrantClaimed || out.GrantRevision != 2 {
		t.Fatalf("state = %+v", out)
	}
	if out.CandidateName != "Ada Lovelace" || out.Target.Label != "Math — Module 1" {
		t.Fatalf("ready header = %+v", out)
	}
	if out.TimePolicy.Mode != "original_deadline" || out.TimePolicy.RemainingSeconds == nil || *out.TimePolicy.RemainingSeconds <= 0 {
		t.Fatalf("time policy = %+v", out.TimePolicy)
	}
	if len(out.Manifest.QuestionIDs) != 1 || out.Manifest.QuestionIDs[0] != "eq-1" {
		t.Fatalf("manifest questions = %+v", out.Manifest)
	}
	if strings.Join(out.Manifest.MediaAssetIDs, ",") != "asset-1,asset-2" {
		t.Fatalf("manifest media = %+v", out.Manifest.MediaAssetIDs)
	}
	if len(out.Checkpoint.Audio) != 1 || out.Checkpoint.Audio[0].PositionMS != 12500 {
		t.Fatalf("checkpoint = %+v", out.Checkpoint)
	}
	raw, err := json.Marshal(out)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"sessionToken", "attemptToken", "csrf", "answerDefinition", "stimulus"} {
		if strings.Contains(strings.ToLower(string(raw)), strings.ToLower(forbidden)) {
			t.Fatalf("ready view leaked %q: %s", forbidden, raw)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimDeviceRecoveryWrongCodeCommitsCounter(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := heldSATRecoveryAttempt(now, "grant-2")
	req := ClaimDeviceRecoveryRequest{
		OperationID: "op-claim-0002", LinkSecret: "link-secret-value",
		Code: "000000", BrowserProof: "browser-proof-0002",
	}
	grant := issuedRecoveryGrant(attempt, "grant-2", "op-issue-0002", req.LinkSecret, "123456", now)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryClaimAttemptLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE attempt_device_recovery_grants")).
		WithArgs(1, grant.id).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.ClaimDeviceRecovery(context.Background(), grant.id, req)
	if err == nil {
		t.Fatal("wrong code must be refused")
	}
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeValidation {
		t.Fatalf("wrong code error = %v", err)
	}
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_INVALID_CREDENTIALS" {
		t.Fatalf("wrong code reason = %q", reason)
	}
	if appErr.HTTPStatus != 422 || appErr.Message != "This recovery code is not valid." {
		t.Fatalf("public credential refusal = %+v", appErr)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimDeviceRecoveryFifthWrongCodeLocksGrant(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := heldSATRecoveryAttempt(now, "grant-3")
	req := ClaimDeviceRecoveryRequest{
		OperationID: "op-claim-0003", LinkSecret: "link-secret-value",
		Code: "999999", BrowserProof: "browser-proof-0003",
	}
	grant := issuedRecoveryGrant(attempt, "grant-3", "op-issue-0003", req.LinkSecret, "123456", now)
	grant.failed = 4

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryClaimAttemptLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE attempt_device_recovery_grants")).
		WithArgs(5, grant.id).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.ClaimDeviceRecovery(context.Background(), grant.id, req)
	if err == nil {
		t.Fatal("fifth wrong code must lock")
	}
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_CODE_LOCKED" {
		t.Fatalf("lock reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimDeviceRecoveryReplaysSameBrowserAndOperation(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := heldSATRecoveryAttempt(now, "grant-4")
	started := now.Add(-5 * time.Minute)
	req := ClaimDeviceRecoveryRequest{
		OperationID: "op-claim-0004", LinkSecret: "link-secret-value",
		Code: "123456", BrowserProof: "browser-proof-0004",
	}
	grant := issuedRecoveryGrant(attempt, "grant-4", "op-issue-0004", req.LinkSecret, req.Code, now)
	claimedAt := now.Add(-time.Minute)
	claimExpires := now.Add(9 * time.Minute)
	grant.state = recoveryGrantClaimed
	grant.claimOperationID = req.OperationID
	grant.claimProofHash = platformcrypto.RecoveryClaimProofHash(recoveryTestSecret, grant.id, req.BrowserProof)
	grant.targetClientSessionID = "client-4"
	grant.claimedAt = &claimedAt
	grant.claimExpiresAt = &claimExpires
	grant.sealed = nil
	grant.revision = 2

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryClaimAttemptLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	expectRecoveryReadyQueries(mock, attempt, started)
	mock.ExpectCommit()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	out, err := svc.ClaimDeviceRecovery(context.Background(), grant.id, req)
	if err != nil {
		t.Fatalf("claim replay: %v", err)
	}
	if out.State != recoveryGrantClaimed || out.GrantRevision != 2 {
		t.Fatalf("claim replay state = %+v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimDeviceRecoveryRefusesAnotherBrowser(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := heldSATRecoveryAttempt(now, "grant-5")
	req := ClaimDeviceRecoveryRequest{
		OperationID: "op-claim-0005", LinkSecret: "link-secret-value",
		Code: "123456", BrowserProof: "browser-proof-other",
	}
	grant := issuedRecoveryGrant(attempt, "grant-5", "op-issue-0005", req.LinkSecret, req.Code, now)
	claimedAt := now.Add(-time.Minute)
	claimExpires := now.Add(9 * time.Minute)
	grant.state = recoveryGrantClaimed
	grant.claimOperationID = "op-claim-owner"
	grant.claimProofHash = platformcrypto.RecoveryClaimProofHash(recoveryTestSecret, grant.id, "browser-proof-owner")
	grant.claimedAt = &claimedAt
	grant.claimExpiresAt = &claimExpires
	grant.sealed = nil

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryClaimAttemptLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectCommit()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.ClaimDeviceRecovery(context.Background(), grant.id, req)
	if err == nil {
		t.Fatal("another browser must not see the ready view")
	}
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_CLAIMED" {
		t.Fatalf("another browser reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimDeviceRecoveryExpiresAndCommitsState(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := heldSATRecoveryAttempt(now, "grant-6")
	req := ClaimDeviceRecoveryRequest{
		OperationID: "op-claim-0006", LinkSecret: "link-secret-value",
		Code: "123456", BrowserProof: "browser-proof-0006",
	}
	grant := issuedRecoveryGrant(attempt, "grant-6", "op-issue-0006", req.LinkSecret, req.Code, now)
	grant.expiresAt = now.Add(-time.Second)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryClaimAttemptLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE attempt_device_recovery_grants")).
		WithArgs(grant.id).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.ClaimDeviceRecovery(context.Background(), grant.id, req)
	if err == nil {
		t.Fatal("expired grant must be refused")
	}
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_EXPIRED" {
		t.Fatalf("expired reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimDeviceRecoveryWrongLinkDoesNotConsumeAnAttempt(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := heldSATRecoveryAttempt(now, "grant-7")
	req := ClaimDeviceRecoveryRequest{
		OperationID: "op-claim-0007", LinkSecret: "wrong-link-secret",
		Code: "123456", BrowserProof: "browser-proof-0007",
	}
	grant := issuedRecoveryGrant(attempt, "grant-7", "op-issue-0007", "right-link-secret", req.Code, now)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryClaimAttemptLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.ClaimDeviceRecovery(context.Background(), grant.id, req)
	if err == nil {
		t.Fatal("wrong link must be refused")
	}
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_INVALID_CREDENTIALS" {
		t.Fatalf("wrong link reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestClaimDeviceRecoveryWrongLinkDoesNotRevealSupersededGrant(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	// Staff reissued: the attempt's control now points at a newer grant.
	attempt := heldSATRecoveryAttempt(now, "grant-new")
	req := ClaimDeviceRecoveryRequest{
		OperationID: "op-claim-0008", LinkSecret: "guessed-link-secret",
		Code: "123456", BrowserProof: "browser-proof-0008",
	}
	grant := issuedRecoveryGrant(attempt, "grant-old", "op-issue-0008", "right-link-secret", req.Code, now)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryGrantRead(mock, grant, false)
	expectRecoveryClaimAttemptLock(mock, attempt)
	expectRecoveryGrantRead(mock, grant, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.ClaimDeviceRecovery(context.Background(), grant.id, req)
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_INVALID_CREDENTIALS" {
		t.Fatalf("a grant id without its link secret must not reveal grant state, got %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package delivery

// Staff-assisted device recovery issuance contracts.
//
// These tests pin the transaction shape rather than HTTP: one operation id
// replays without extending its window, stale epochs cannot fence a newer
// writer, an ineligible closure never fences at all, and a failure after the
// fence (audit/grant insert) leaves the attempt exactly as it was.

import (
	"context"
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

var recoveryTestSecret = []byte("staff-recovery-test-secret-32-chars!")

func examdomainRecoveryTarget(section, moduleAttempt, module string) examdomain.RecoveryTarget {
	return examdomain.RecoveryTarget{
		SectionKey: section, ModuleAttemptID: moduleAttempt, ModuleID: module,
	}
}

type recoveryAttemptFixture struct {
	id, schedule, exam, version, candidate, title string
	status, phase, proctor                        string
	submitted                                     *time.Time
	activeSession                                 *string
	lease, control, generation                    uint64
	rawControl                                    string
	provider, examType                            string
	updated                                       time.Time
	userID                                        string
	organizationID                                *string
}

func (f recoveryAttemptFixture) rows() *sqlmock.Rows {
	rows := sqlmock.NewRows([]string{
		"id", "schedule_id", "exam_id", "published_version_id",
		"candidate_name", "exam_title", "delivery_status", "phase",
		"submitted_at", "proctor_status", "active_client_session_id",
		"lease_epoch", "control_epoch", "terminal_generation",
		"recovery_control", "provider_key", "exam_type", "updated_at",
		"user_id", "organization_id",
	})
	var submitted any
	if f.submitted != nil {
		submitted = *f.submitted
	}
	var active any
	if f.activeSession != nil {
		active = *f.activeSession
	}
	var raw any
	if f.rawControl != "" {
		raw = f.rawControl
	}
	var org any
	if f.organizationID != nil {
		org = *f.organizationID
	}
	return rows.AddRow(f.id, f.schedule, f.exam, f.version, f.candidate, f.title,
		f.status, f.phase, submitted, f.proctor, active, f.lease, f.control,
		f.generation, raw, f.provider, f.examType, f.updated, f.userID, org)
}

func openSATRecoveryAttempt(now time.Time) recoveryAttemptFixture {
	active := "sess-old"
	return recoveryAttemptFixture{
		id: "att-1", schedule: "sched-1", exam: "exam-1", version: "ver-1",
		candidate: "Ada Lovelace", title: "SAT Practice", status: "in_progress",
		phase: "exam", proctor: "active", activeSession: &active,
		lease: 3, control: 1, provider: "sat", examType: "SAT", updated: now,
		userID: "user-1",
	}
}

func recoverySATTargetRows(started time.Time) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "module_id", "state", "allocated_seconds", "started_at",
		"available_at", "paused_at", "accumulated_paused_seconds",
		"extension_seconds", "completion_reason", "section_key",
		"section_title", "module_title",
	}).AddRow("ma-1", "mod-1", "active", 1800, started, nil, nil, 0, 0, nil,
		"math", "Math", "Module 1")
}

func recoveryCompletedSATTargetRows(started time.Time, reason string) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "module_id", "state", "allocated_seconds", "started_at",
		"available_at", "paused_at", "accumulated_paused_seconds",
		"extension_seconds", "completion_reason", "section_key",
		"section_title", "module_title",
	}).AddRow("ma-1", "mod-1", "completed", 1800, started, nil, nil, 0, 0, reason,
		"math", "Math", "Module 1")
}

func recoveryGrantRowColumns() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"id", "attempt_id", "schedule_id", "issued_by_user_id", "operation_id",
		"request_hash", "state", "target_section_key",
		"target_module_attempt_id", "target_module_id",
		"requested_remaining_seconds", "expected_control_epoch",
		"expected_lease_epoch", "grant_revision", "failed_code_count",
		"issued_at", "expires_at", "sealed_issuance",
		"claim_proof_hash", "claim_operation_id", "target_client_session_id",
		"claimed_at", "claim_expires_at", "started_at",
		"resulting_lease_epoch", "begin_operation_id", "begin_receipt",
		"restored_at", "restored_by", "link_secret_hash", "code_mac",
	})
}

func sealedRecoveryIssuance(t *testing.T, secret []byte, grantID, attemptID, link, code string, issued, expires time.Time) []byte {
	t.Helper()
	raw, err := json.Marshal(recoveryIssuanceCapsule{
		LinkSecret: link, Code: code, IssuedAt: issued, ExpiresAt: expires,
	})
	if err != nil {
		t.Fatal(err)
	}
	sealed, err := platformcrypto.SealRecoveryIssuance(secret, grantID, attemptID, raw)
	if err != nil {
		t.Fatal(err)
	}
	return sealed
}

func expectRecoveryAttempt(mock sqlmock.Sqlmock, row recoveryAttemptFixture, forUpdate bool) {
	query := "(?s)FROM student_attempts a.*"
	if forUpdate {
		query = "(?s)FROM student_attempts a.*FOR UPDATE"
	}
	mock.ExpectQuery(query).WithArgs(row.id, row.schedule).WillReturnRows(row.rows())
}

func expectNoRecoveryReceipt(mock sqlmock.Sqlmock, attemptID string, generation uint64) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id = ? AND terminal_generation = ? LIMIT 1")).
		WithArgs(attemptID, generation).
		WillReturnRows(sqlmock.NewRows([]string{"reason"}))
}

func recoveryErrorReason(t *testing.T, err error) string {
	t.Helper()
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) {
		t.Fatalf("expected typed application error, got %T: %v", err, err)
	}
	reason, _ := appErr.Details["reason"].(string)
	return reason
}

func TestIssueDeviceRecoveryReplaysCommittedSecretsWhileGateIsOff(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := openSATRecoveryAttempt(now)
	req := IssueDeviceRecoveryRequest{
		OperationID: "op-replay-0001", ExpectedLeaseEpoch: 3, ExpectedControlEpoch: 1,
		Target: examdomainRecoveryTarget("math", "ma-1", "mod-1"),
	}
	issued := now.Add(-time.Minute)
	expires := now.Add(5 * time.Minute)
	sealed := sealedRecoveryIssuance(t, recoveryTestSecret, "grant-1", attempt.id,
		"link-secret-value", "123456", issued, expires)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryAttempt(mock, attempt, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE operation_id = ?")).
		WithArgs(req.OperationID).
		WillReturnRows(recoveryGrantRowColumns().AddRow(
			"grant-1", attempt.id, attempt.schedule, "staff-1", req.OperationID,
			recoveryIssueRequestHash(attempt.id, req), recoveryGrantIssued,
			"math", "ma-1", "mod-1", nil, 1, 3, 1, 0,
			issued, expires, sealed, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil))
	mock.ExpectCommit()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(false, recoveryTestSecret)
	out, err := svc.IssueDeviceRecovery(context.Background(), attempt.schedule, attempt.id, "staff-1", req)
	if err != nil {
		t.Fatalf("replay: %v", err)
	}
	if !out.Replayed {
		t.Fatal("lost-response replay must be labelled")
	}
	if out.LinkSecret != "link-secret-value" || out.Code != "123456" {
		t.Fatalf("gate-off replay lost the committed secrets: %+v", out)
	}
	if out.Grant.State != recoveryGrantIssued || !out.Grant.SecretsAvailable {
		t.Fatalf("replayed grant status = %+v", out.Grant)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueDeviceRecoveryGateOffRefusesNewGrant(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := openSATRecoveryAttempt(now)
	req := IssueDeviceRecoveryRequest{
		OperationID: "op-blocked-001", ExpectedLeaseEpoch: 3, ExpectedControlEpoch: 1,
		Target: examdomainRecoveryTarget("math", "ma-1", "mod-1"),
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryAttempt(mock, attempt, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE operation_id = ?")).
		WithArgs(req.OperationID).
		WillReturnRows(recoveryGrantRowColumns())
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(false, recoveryTestSecret)
	_, err = svc.IssueDeviceRecovery(context.Background(), attempt.schedule, attempt.id, "staff-1", req)
	if err == nil {
		t.Fatal("gate-off issuance must be refused")
	}
	var appErr *apperrors.Error
	if !errors.As(err, &appErr) || appErr.Code != apperrors.CodeServiceUnavailable {
		t.Fatalf("gate-off error = %v", err)
	}
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_DISABLED" {
		t.Fatalf("gate-off reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueDeviceRecoveryRejectsStaleEpochsBeforeFencing(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := openSATRecoveryAttempt(now)
	attempt.lease = 5
	req := IssueDeviceRecoveryRequest{
		OperationID: "op-stale-0001", ExpectedLeaseEpoch: 4, ExpectedControlEpoch: 1,
		Target: examdomainRecoveryTarget("math", "ma-1", "mod-1"),
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryAttempt(mock, attempt, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE operation_id = ?")).
		WithArgs(req.OperationID).
		WillReturnRows(recoveryGrantRowColumns())
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.IssueDeviceRecovery(context.Background(), attempt.schedule, attempt.id, "staff-1", req)
	if err == nil {
		t.Fatal("stale epoch must be refused")
	}
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_STALE" {
		t.Fatalf("stale reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueDeviceRecoveryIssuesGrantAndFencesOldWriter(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := openSATRecoveryAttempt(now)
	started := now.Add(-5 * time.Minute)
	req := IssueDeviceRecoveryRequest{
		OperationID: "op-issue-00001", ExpectedLeaseEpoch: 3, ExpectedControlEpoch: 1,
		Target: examdomainRecoveryTarget("math", "ma-1", "mod-1"),
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryAttempt(mock, attempt, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE operation_id = ?")).
		WithArgs(req.OperationID).
		WillReturnRows(recoveryGrantRowColumns())
	expectNoRecoveryReceipt(mock, attempt.id, attempt.generation)
	mock.ExpectQuery("(?s)FROM assessment_module_attempts ma.*").
		WithArgs(attempt.id, attempt.version).
		WillReturnRows(recoverySATTargetRows(started))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants")).
		WithArgs(attempt.id, attempt.id).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec("UPDATE student_attempts").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT lease_epoch, control_epoch FROM student_attempts WHERE id = ?")).
		WithArgs(attempt.id).
		WillReturnRows(sqlmock.NewRows([]string{"lease_epoch", "control_epoch"}).AddRow(4, 2))
	mock.ExpectExec("UPDATE attempt_sessions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE attempt_device_transfers").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_device_recovery_grants").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectCommit()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	out, err := svc.IssueDeviceRecovery(context.Background(), attempt.schedule, attempt.id, "staff-1", req)
	if err != nil {
		t.Fatalf("issue: %v", err)
	}
	if out.Replayed {
		t.Fatal("fresh issuance must not be labelled replayed")
	}
	if out.Grant.State != recoveryGrantIssued || out.Grant.Target != req.Target {
		t.Fatalf("issued grant = %+v", out.Grant)
	}
	if !regexp.MustCompile(`^\d{6}$`).MatchString(out.Code) {
		t.Fatalf("code = %q", out.Code)
	}
	if !strings.HasPrefix(out.RecoveryPath, recoveryPathPrefix) || !strings.Contains(out.RecoveryPath, "#key="+out.LinkSecret) {
		t.Fatalf("recovery path = %q", out.RecoveryPath)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueDeviceRecoveryRefusesManualSubmit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	submitted := now.Add(-time.Hour)
	attempt := openSATRecoveryAttempt(now)
	attempt.status = "submitted"
	attempt.phase = "post-exam"
	attempt.submitted = &submitted
	req := IssueDeviceRecoveryRequest{
		OperationID: "op-manual-0001", ExpectedLeaseEpoch: 3, ExpectedControlEpoch: 1,
		Target: examdomainRecoveryTarget("math", "ma-1", "mod-1"),
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryAttempt(mock, attempt, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE operation_id = ?")).
		WithArgs(req.OperationID).
		WillReturnRows(recoveryGrantRowColumns())
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id = ? AND terminal_generation = ? LIMIT 1")).
		WithArgs(attempt.id, attempt.generation).
		WillReturnRows(sqlmock.NewRows([]string{"reason"}).AddRow("student_submit"))
	mock.ExpectQuery("(?s)FROM assessment_module_attempts ma.*").
		WithArgs(attempt.id, attempt.version).
		WillReturnRows(recoveryCompletedSATTargetRows(now.Add(-2*time.Hour), "time_expired"))
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.IssueDeviceRecovery(context.Background(), attempt.schedule, attempt.id, "staff-1", req)
	if err == nil {
		t.Fatal("manual submit must never be reopened")
	}
	if reason := recoveryErrorReason(t, err); reason != RecoveryReasonManualSubmit {
		t.Fatalf("manual submit reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueDeviceRecoveryClosedTimeoutRequiresExplicitAward(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	submitted := now.Add(-time.Hour)
	attempt := openSATRecoveryAttempt(now)
	attempt.status = "submitted"
	attempt.phase = "post-exam"
	attempt.submitted = &submitted
	req := IssueDeviceRecoveryRequest{
		OperationID: "op-timeout-001", ExpectedLeaseEpoch: 3, ExpectedControlEpoch: 1,
		Target: examdomainRecoveryTarget("math", "ma-1", "mod-1"),
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryAttempt(mock, attempt, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE operation_id = ?")).
		WithArgs(req.OperationID).
		WillReturnRows(recoveryGrantRowColumns())
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_terminalizations WHERE attempt_id = ? AND terminal_generation = ? LIMIT 1")).
		WithArgs(attempt.id, attempt.generation).
		WillReturnRows(sqlmock.NewRows([]string{"reason"}).AddRow("time_expired"))
	mock.ExpectQuery("(?s)FROM assessment_module_attempts ma.*").
		WithArgs(attempt.id, attempt.version).
		WillReturnRows(recoveryCompletedSATTargetRows(now.Add(-2*time.Hour), "time_expired"))
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.IssueDeviceRecovery(context.Background(), attempt.schedule, attempt.id, "staff-1", req)
	if err == nil {
		t.Fatal("elapsed original clock without an award must be refused")
	}
	if reason := recoveryErrorReason(t, err); reason != "RECOVERY_TIME_REQUIRED" {
		t.Fatalf("time reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueDeviceRecoveryAuditFailureRollsBackTheFence(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := openSATRecoveryAttempt(now)
	started := now.Add(-5 * time.Minute)
	req := IssueDeviceRecoveryRequest{
		OperationID: "op-audit-00001", ExpectedLeaseEpoch: 3, ExpectedControlEpoch: 1,
		Target: examdomainRecoveryTarget("math", "ma-1", "mod-1"),
	}

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryAttempt(mock, attempt, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE operation_id = ?")).
		WithArgs(req.OperationID).
		WillReturnRows(recoveryGrantRowColumns())
	expectNoRecoveryReceipt(mock, attempt.id, attempt.generation)
	mock.ExpectQuery("(?s)FROM assessment_module_attempts ma.*").
		WithArgs(attempt.id, attempt.version).
		WillReturnRows(recoverySATTargetRows(started))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants")).
		WithArgs(attempt.id, attempt.id).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	mock.ExpectExec("UPDATE student_attempts").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT lease_epoch, control_epoch FROM student_attempts WHERE id = ?")).
		WithArgs(attempt.id).
		WillReturnRows(sqlmock.NewRows([]string{"lease_epoch", "control_epoch"}).AddRow(4, 2))
	mock.ExpectExec("UPDATE attempt_sessions").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("UPDATE attempt_device_transfers").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec("INSERT INTO attempt_device_recovery_grants").WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec("INSERT INTO session_audit_logs").WillReturnError(errors.New("audit store down"))
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.IssueDeviceRecovery(context.Background(), attempt.schedule, attempt.id, "staff-1", req)
	if err == nil {
		t.Fatal("audit failure must abort the transfer")
	}
	if !strings.Contains(err.Error(), "audit store down") {
		t.Fatalf("error = %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestIssueDeviceRecoveryOperationReplayRequiresSameActor(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := openSATRecoveryAttempt(now)
	req := IssueDeviceRecoveryRequest{
		OperationID: "op-replay-0002", ExpectedLeaseEpoch: 3, ExpectedControlEpoch: 1,
		Target: examdomainRecoveryTarget("math", "ma-1", "mod-1"),
	}
	issued := now.Add(-time.Minute)
	expires := now.Add(5 * time.Minute)
	sealed := sealedRecoveryIssuance(t, recoveryTestSecret, "grant-1", attempt.id,
		"link-secret-value", "123456", issued, expires)

	mock.ExpectBegin()
	mock.ExpectExec("SET time_zone").WillReturnResult(sqlmock.NewResult(0, 0))
	expectRecoveryAttempt(mock, attempt, true)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_device_recovery_grants WHERE operation_id = ?")).
		WithArgs(req.OperationID).
		WillReturnRows(recoveryGrantRowColumns().AddRow(
			"grant-1", attempt.id, attempt.schedule, "someone-else", req.OperationID,
			recoveryIssueRequestHash(attempt.id, req), recoveryGrantIssued,
			"math", "ma-1", "mod-1", nil, 1, 3, 1, 0,
			issued, expires, sealed, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil))
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	_, err = svc.IssueDeviceRecovery(context.Background(), attempt.schedule, attempt.id, "staff-1", req)
	if err == nil {
		t.Fatal("another actor must not replay the live code")
	}
	if reason := recoveryErrorReason(t, err); reason != "OPERATION_ID_CONFLICT" {
		t.Fatalf("actor conflict reason = %q", reason)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRecoveryOptionsPreviewsLiveTargetWithoutGrant(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Now().UTC()
	attempt := openSATRecoveryAttempt(now)
	started := now.Add(-5 * time.Minute)

	mock.ExpectBegin()
	expectRecoveryAttempt(mock, attempt, false)
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).WillReturnRows(sqlmock.NewRows([]string{"now"}).AddRow(now))
	expectNoRecoveryReceipt(mock, attempt.id, attempt.generation)
	mock.ExpectQuery("(?s)FROM assessment_module_attempts ma.*").
		WithArgs(attempt.id, attempt.version).
		WillReturnRows(recoverySATTargetRows(started))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT MAX(updated_at) FROM attempt_responses_v2 WHERE attempt_id = ?")).
		WithArgs(attempt.id).
		WillReturnRows(sqlmock.NewRows([]string{"MAX(updated_at)"}).AddRow(started))
	mock.ExpectQuery("(?s)FROM attempt_device_recovery_grants.*ORDER BY issued_at").
		WithArgs(attempt.id).
		WillReturnRows(recoveryGrantRowColumns())
	mock.ExpectRollback()

	svc := NewService(db, tx.NewRunner(db)).SetStaffDeviceRecovery(true, recoveryTestSecret)
	out, err := svc.RecoveryOptions(context.Background(), attempt.schedule, attempt.id)
	if err != nil {
		t.Fatalf("options: %v", err)
	}
	if len(out.Targets) != 1 {
		t.Fatalf("targets = %+v", out.Targets)
	}
	target := out.Targets[0]
	if !target.Eligibility.Eligible || target.Eligibility.Class != RecoveryClosureLive {
		t.Fatalf("live target eligibility = %+v", target.Eligibility)
	}
	if target.RemainingSeconds == nil || *target.RemainingSeconds <= 0 {
		t.Fatalf("live remaining seconds = %v", target.RemainingSeconds)
	}
	if out.Grant != nil {
		t.Fatalf("unexpected grant: %+v", out.Grant)
	}
	if out.ServerNow.IsZero() || out.CandidateName != "Ada Lovelace" {
		t.Fatalf("options header = %+v", out)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

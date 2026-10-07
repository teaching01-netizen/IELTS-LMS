package integration

// SAT session ownership + device transfer against real MySQL
// (docs/superpowers/plans/2026-10-06-sat-session-ownership-and-device-transfer.md).
// Assertions read the stored rows (student_attempts owner/lease/policy,
// attempt_sessions revocation, attempt_device_transfers state), not HTTP
// status alone. Skips without TEST_MYSQL_DSN like the rest of the package.
import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
)

const transferSecret = "device-transfer-secret-with-32-plus-chars!!"

type transferFixture struct {
	*adaptiveExam
	svc       *attempts.Service
	cfg       config.Config
	attemptID string
	userID    string
	policy    attempts.TransferPolicy
}

// newTransferFixture seeds one SAT attempt bound to a student user whose
// Module 1 has NOT started (pre-start policy stage).
func newTransferFixture(t *testing.T) *transferFixture {
	t.Helper()
	exam := newAdaptiveExam(t)
	ctx := context.Background()
	attemptID := exam.seedStudent(exam.rw, 0, false)
	userID := uuid.NewString()
	mustExec(t, exam.db, `INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, 'Transfer Candidate', 'student', 'active')`,
		userID, "transfer-"+userID+"@example.test")
	mustExec(t, exam.db, `UPDATE student_attempts SET user_id = ? WHERE id = ?`, userID, attemptID)
	mustExec(t, exam.db, `UPDATE assessment_module_attempts SET started_at = NULL, state = 'not_started' WHERE attempt_id = ?`, attemptID)
	t.Cleanup(func() {
		_, _ = exam.db.ExecContext(ctx, `DELETE FROM attempt_device_transfers WHERE attempt_id = ?`, attemptID)
		_, _ = exam.db.ExecContext(ctx, `DELETE FROM attempt_sessions WHERE attempt_id = ?`, attemptID)
		_, _ = exam.db.ExecContext(ctx, `DELETE FROM session_audit_logs WHERE schedule_id = ?`, exam.scheduleID)
		_, _ = exam.db.ExecContext(ctx, `UPDATE student_attempts SET user_id = NULL WHERE id = ?`, attemptID)
		_, _ = exam.db.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, userID)
	})
	cfg := config.Config{AuthSecret: transferSecret, AttemptTokenTTLMins: 15}
	return &transferFixture{
		adaptiveExam: exam,
		svc:          attempts.NewService(tx.NewRunner(exam.db), clock.System{}, []byte(transferSecret)),
		cfg:          cfg,
		attemptID:    attemptID,
		userID:       userID,
		policy:       attempts.TransferPolicy{Enabled: true, RequestTTL: 10 * time.Minute, ApprovalTTL: 2 * time.Minute},
	}
}

func mustExec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.ExecContext(context.Background(), query, args...); err != nil {
		t.Fatalf("exec %.80q: %v", query, err)
	}
}

func (f *transferFixture) issuer(session string) attempts.CredentialIssuer {
	return func(ctx context.Context, q tx.Tx, lease uint64) (string, time.Time, error) {
		l := lease
		return auth.IssueAttemptTokenTx(ctx, q, f.cfg, f.userID, f.scheduleID, f.attemptID, session, nil, &l, time.Now().UTC())
	}
}

func (f *transferFixture) admit(t *testing.T, session string) attempts.Admission {
	t.Helper()
	a, err := f.svc.Admit(context.Background(), attempts.AdmitCommand{
		AttemptID: f.attemptID, UserID: f.userID, ClientSessionID: session, SingleWriterEnabled: true,
	}, f.issuer(session))
	if err != nil {
		t.Fatalf("admit %s: %v", session, err)
	}
	return a
}

type ownerRow struct {
	owner  sql.NullString
	lease  uint64
	policy sql.NullString
}

func (f *transferFixture) ownerRow(t *testing.T) ownerRow {
	t.Helper()
	var r ownerRow
	if err := f.db.QueryRow(`SELECT active_client_session_id, lease_epoch, writer_policy FROM student_attempts WHERE id = ?`, f.attemptID).
		Scan(&r.owner, &r.lease, &r.policy); err != nil {
		t.Fatalf("read owner row: %v", err)
	}
	return r
}

func (f *transferFixture) liveSessions(t *testing.T) map[string]bool {
	t.Helper()
	rows, err := f.db.Query(`SELECT client_session_id FROM attempt_sessions WHERE attempt_id = ? AND revoked_at IS NULL`, f.attemptID)
	if err != nil {
		t.Fatalf("read sessions: %v", err)
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var s string
		if err := rows.Scan(&s); err != nil {
			t.Fatal(err)
		}
		out[s] = true
	}
	return out
}

func (f *transferFixture) request(t *testing.T, opID, target string, lease uint64) (attempts.TransferView, error) {
	t.Helper()
	return f.svc.RequestTransfer(context.Background(), attempts.RequestTransferCommand{
		OperationID: opID, AttemptID: f.attemptID, ScheduleID: f.scheduleID, UserID: f.userID,
		AuthSessionID: "auth-" + target, TargetSessionID: target, ExpectedLeaseEpoch: lease, ReasonCode: "device_change",
	}, f.policy)
}

func (f *transferFixture) commit(target, requestID string) (attempts.TransferCommit, error) {
	return f.svc.CommitTransfer(context.Background(), attempts.CommitTransferCommand{
		RequestID: requestID, TargetSessionID: target,
		Requester: attempts.RequesterRef{UserID: f.userID, AuthSessionID: "auth-" + target, ScheduleID: f.scheduleID, ClientSessionID: target},
	}, func(string) attempts.CredentialIssuer { return f.issuer(target) })
}

func (f *transferFixture) startModule(t *testing.T) {
	t.Helper()
	mustExec(t, f.db, `UPDATE assessment_module_attempts SET started_at = UTC_TIMESTAMP(6), state = 'active' WHERE attempt_id = ?`, f.attemptID)
}

func wantCode(t *testing.T, err error, code apperrors.Code) {
	t.Helper()
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
}

func (f *transferFixture) transferState(t *testing.T, requestID string) (string, sql.NullString) {
	t.Helper()
	var state string
	var marker sql.NullString
	if err := f.db.QueryRow(`SELECT state, active_attempt_id FROM attempt_device_transfers WHERE id = ?`, requestID).Scan(&state, &marker); err != nil {
		t.Fatalf("read transfer: %v", err)
	}
	return state, marker
}

// I1-I3/I5/I7: admission claims an unowned attempt, resumes the same session
// at the authoritative lease, and gives a competing session no credential.
func TestSATTransferAdmissionClaimsResumesAndBlocks(t *testing.T) {
	f := newTransferFixture(t)
	mustExec(t, f.db, `UPDATE student_attempts SET lease_epoch = 4 WHERE id = ?`, f.attemptID)

	a := f.admit(t, "sess-a")
	if a.Outcome != attempts.AdmissionAuthorized || a.LeaseEpoch != 4 || a.Token == "" || a.PolicyStage != attempts.StagePreStart {
		t.Fatalf("first admission: %+v", a)
	}
	claims, err := crypto.VerifyAttemptToken([]byte(transferSecret), time.Now().UTC(), a.Token)
	if err != nil || claims.LeaseEpoch == nil || *claims.LeaseEpoch != 4 || claims.ClientSessionID != "sess-a" {
		t.Fatalf("credential must carry the authoritative lease 4, got %+v (%v)", claims, err)
	}
	row := f.ownerRow(t)
	if row.owner.String != "sess-a" || row.lease != 4 || row.policy.String != attempts.WriterPolicySATSingleWriter {
		t.Fatalf("claim must persist owner+policy, got %+v", row)
	}

	b := f.admit(t, "sess-b")
	if b.Outcome != attempts.AdmissionBlocked || b.Token != "" {
		t.Fatalf("competing session must be blocked without a credential: %+v", b)
	}
	if f.liveSessions(t)["sess-b"] {
		t.Fatal("a blocked session must not get an attempt_sessions row")
	}

	again := f.admit(t, "sess-a")
	if again.Outcome != attempts.AdmissionAuthorized || again.LeaseEpoch != 4 {
		t.Fatalf("resume must keep the owner at its lease: %+v", again)
	}
	if got := f.ownerRow(t); got.owner.String != "sess-a" || got.lease != 4 {
		t.Fatalf("resume must not change ownership: %+v", got)
	}

	// Policy snapshot survives the deployment flag turning off.
	off, err := f.svc.Admit(context.Background(), attempts.AdmitCommand{AttemptID: f.attemptID, UserID: f.userID, ClientSessionID: "sess-c"}, f.issuer("sess-c"))
	if err != nil || off.Outcome != attempts.AdmissionBlocked {
		t.Fatalf("snapshotted policy must keep blocking with the flag off: %+v %v", off, err)
	}
}

// I2: concurrent first entries from different browsers yield exactly one
// authorized writer.
func TestSATTransferConcurrentAdmissionOneWriter(t *testing.T) {
	f := newTransferFixture(t)
	// Independent service instances share only the database, as API replicas do.
	replicas := []*attempts.Service{
		f.svc,
		attempts.NewService(tx.NewRunner(f.db), clock.System{}, []byte(transferSecret)),
	}
	const n = 8
	var wg sync.WaitGroup
	outcomes := make([]attempts.Admission, n)
	errs := make([]error, n)
	start := make(chan struct{})
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			<-start
			session := "race-" + uuid.NewString()[:8]
			outcomes[i], errs[i] = replicas[i%len(replicas)].Admit(context.Background(), attempts.AdmitCommand{
				AttemptID: f.attemptID, UserID: f.userID, ClientSessionID: session, SingleWriterEnabled: true,
			}, f.issuer(session))
		}(i)
	}
	close(start)
	wg.Wait()
	authorized := 0
	for i := range n {
		if errs[i] != nil {
			t.Fatalf("admission %d: %v", i, errs[i])
		}
		if outcomes[i].Outcome == attempts.AdmissionAuthorized {
			authorized++
		}
	}
	if authorized != 1 {
		t.Fatalf("exactly one concurrent admission may own the attempt, got %d", authorized)
	}
	if live := f.liveSessions(t); len(live) != 1 {
		t.Fatalf("exactly one credential row may exist, got %v", live)
	}
}

// Pre-start self-service: the current writer confirms, the target commits;
// the old credential is revoked and cannot write; retries recover without a
// second ownership change; a later transfer makes the old receipt stale.
func TestSATTransferPreStartWriterConfirmCommitAndRecover(t *testing.T) {
	f := newTransferFixture(t)
	a := f.admit(t, "sess-a")
	if b := f.admit(t, "sess-b"); b.Outcome != attempts.AdmissionBlocked {
		t.Fatalf("sess-b must be blocked: %+v", b)
	}

	req, err := f.request(t, "op-transfer-b-1", "sess-b", a.LeaseEpoch)
	if err != nil || req.State != attempts.TransferPending || req.PolicyStage != attempts.StagePreStart {
		t.Fatalf("request: %+v %v", req, err)
	}
	// Identical retry returns the same request; a reused op id with a
	// different payload conflicts.
	if retry, err := f.request(t, "op-transfer-b-1", "sess-b", a.LeaseEpoch); err != nil || retry.RequestID != req.RequestID {
		t.Fatalf("identical retry must return the request: %+v %v", retry, err)
	}
	if _, err := f.request(t, "op-transfer-b-1", "sess-z", a.LeaseEpoch); err == nil {
		t.Fatal("reused operation id with a different target must conflict")
	} else {
		wantCode(t, err, apperrors.CodeTransferConflict)
	}
	// A different target cannot silently replace the outstanding request.
	_, err = f.request(t, "op-transfer-c-1", "sess-c", a.LeaseEpoch)
	wantCode(t, err, apperrors.CodeTransferConflict)

	// Commit before approval is refused and changes nothing.
	_, err = f.commit("sess-b", req.RequestID)
	wantCode(t, err, apperrors.CodeTransferApprovalRequired)
	if row := f.ownerRow(t); row.owner.String != "sess-a" || row.lease != 1 {
		t.Fatalf("unapproved commit must not move ownership: %+v", row)
	}

	pending, err := f.svc.PendingTransferForWriter(context.Background(), a.Token, f.attemptID)
	if err != nil || pending == nil || pending.RequestID != req.RequestID {
		t.Fatalf("owner must see the pending request: %+v %v", pending, err)
	}
	approved, err := f.svc.ConfirmTransferByWriter(context.Background(), a.Token, req.RequestID, f.policy)
	if err != nil || approved.State != attempts.TransferApproved {
		t.Fatalf("writer confirm: %+v %v", approved, err)
	}

	res, err := f.commit("sess-b", req.RequestID)
	if err != nil || res.Admission.LeaseEpoch != 2 || res.Admission.Token == "" || res.Transfer.State != attempts.TransferCommitted {
		t.Fatalf("commit: %+v %v", res, err)
	}
	if row := f.ownerRow(t); row.owner.String != "sess-b" || row.lease != 2 {
		t.Fatalf("commit must move owner+lease atomically: %+v", row)
	}
	live := f.liveSessions(t)
	if live["sess-a"] || !live["sess-b"] {
		t.Fatalf("old writer must be revoked, target live: %v", live)
	}
	if state, marker := f.transferState(t, req.RequestID); state != attempts.TransferCommitted || marker.Valid {
		t.Fatalf("committed request must clear the active marker: %s %v", state, marker)
	}

	// I3/I7: the superseded writer cannot save, cannot re-admit, cannot
	// take over.
	_, err = f.svc.SaveResponses(context.Background(), a.Token, attempts.SaveResponsesCommand{
		AttemptID: f.attemptID, LeaseEpoch: 2, ControlEpoch: 1,
		Commands: []attempts.ResponseCommand{{WriteID: uuid.NewString(), QuestionID: uuid.NewString(), ClientVersion: 1, Response: attempts.ResponsePayload{Answer: "A"}}},
	}, nil, nil)
	// Superseded by a transfer: told LEASE_FENCED (stop, keep drafts), not a
	// refreshable 401.
	wantCode(t, err, apperrors.CodeLeaseFenced)
	if old := f.admit(t, "sess-a"); old.Outcome != attempts.AdmissionBlocked || old.Token != "" {
		t.Fatalf("revoked owner must not regain authority through admission: %+v", old)
	}
	_, err = f.svc.Takeover(context.Background(), a.Token, f.attemptID, "sess-a", "retake")
	if err == nil {
		t.Fatal("revoked bearer must not take over")
	}

	// Lost commit response: retry recovers the credential at the same lease.
	again, err := f.commit("sess-b", req.RequestID)
	if err != nil || !again.Recovered || again.Admission.LeaseEpoch != 2 {
		t.Fatalf("commit retry must recover without a second change: %+v %v", again, err)
	}
	if row := f.ownerRow(t); row.lease != 2 {
		t.Fatalf("recovery must not bump the lease: %+v", row)
	}

	// A later transfer (proctor-approved) supersedes the old receipt.
	req2, err := f.request(t, "op-transfer-c-2", "sess-c", 2)
	if err != nil {
		t.Fatalf("second request: %v", err)
	}
	if _, err := f.svc.DecideTransfer(context.Background(), attempts.ProctorDecision{
		RequestID: req2.RequestID, ScheduleID: f.scheduleID, ActorID: "proctor-1", Approve: true, AcknowledgeUnconfirmedRisk: true,
	}, f.policy); err != nil {
		t.Fatalf("proctor approve: %v", err)
	}
	if _, err := f.commit("sess-c", req2.RequestID); err != nil {
		t.Fatalf("second commit: %v", err)
	}
	_, err = f.commit("sess-b", req.RequestID)
	wantCode(t, err, apperrors.CodeTransferConflict)
	if row := f.ownerRow(t); row.owner.String != "sess-c" || row.lease != 3 {
		t.Fatalf("stale receipt must never reclaim ownership: %+v", row)
	}
}

// Post-start: the current writer cannot self-approve; the proctor must
// acknowledge unconfirmed-answer risk; the legacy takeover cannot bypass.
func TestSATTransferPostStartRequiresProctor(t *testing.T) {
	f := newTransferFixture(t)
	a := f.admit(t, "sess-a")
	f.startModule(t)
	if b := f.admit(t, "sess-b"); b.Outcome != attempts.AdmissionBlocked || b.PolicyStage != attempts.StagePostStart {
		t.Fatalf("post-start competitor must be blocked: %+v", b)
	}

	// Legacy takeover by a valid non-owner bearer is refused: mint one for
	// sess-b directly (as a pre-fix binary could have).
	lease := uint64(1)
	legacy, _, err := auth.IssueAttemptToken(context.Background(), f.db, f.cfg, f.userID, f.scheduleID, f.attemptID, "sess-b", nil, &lease, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.Takeover(context.Background(), legacy, f.attemptID, "sess-b", "student_explicit_takeover")
	wantCode(t, err, apperrors.CodeTransferApprovalRequired)
	if row := f.ownerRow(t); row.owner.String != "sess-a" || row.lease != 1 {
		t.Fatalf("refused takeover must not move ownership: %+v", row)
	}

	req, err := f.request(t, "op-post-start-1", "sess-b", 1)
	if err != nil || req.PolicyStage != attempts.StagePostStart {
		t.Fatalf("request: %+v %v", req, err)
	}
	_, err = f.svc.ConfirmTransferByWriter(context.Background(), a.Token, req.RequestID, f.policy)
	wantCode(t, err, apperrors.CodeTransferApprovalRequired)
	_, err = f.svc.DecideTransfer(context.Background(), attempts.ProctorDecision{
		RequestID: req.RequestID, ScheduleID: f.scheduleID, ActorID: "proctor-1", Approve: true,
	}, f.policy)
	wantCode(t, err, apperrors.CodeTransferApprovalRequired)
	// Wrong schedule scope is invisible.
	_, err = f.svc.DecideTransfer(context.Background(), attempts.ProctorDecision{
		RequestID: req.RequestID, ScheduleID: uuid.NewString(), ActorID: "proctor-1", Approve: true, AcknowledgeUnconfirmedRisk: true,
	}, f.policy)
	wantCode(t, err, apperrors.CodeNotFound)

	if _, err := f.svc.DecideTransfer(context.Background(), attempts.ProctorDecision{
		RequestID: req.RequestID, ScheduleID: f.scheduleID, ActorID: "proctor-1", Approve: true, AcknowledgeUnconfirmedRisk: true, Reason: "laptop battery",
	}, f.policy); err != nil {
		t.Fatalf("proctor approve: %v", err)
	}
	items, err := f.svc.ListOpenTransfers(context.Background(), f.db, f.scheduleID)
	if err != nil || len(items) != 1 || items[0].State != attempts.TransferApproved {
		t.Fatalf("proctor queue: %+v %v", items, err)
	}
	res, err := f.commit("sess-b", req.RequestID)
	if err != nil || res.Admission.LeaseEpoch != 2 {
		t.Fatalf("commit: %+v %v", res, err)
	}
	var started int
	if err := f.db.QueryRow(`SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND started_at IS NOT NULL AND state = 'active'`, f.attemptID).Scan(&started); err != nil || started != 1 {
		t.Fatalf("transfer must preserve module progress: %d %v", started, err)
	}
	var responses int
	if err := f.db.QueryRow(`SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ?`, f.attemptID).Scan(&responses); err != nil || responses != 3 {
		t.Fatalf("transfer must preserve accepted answers: %d %v", responses, err)
	}
}

// A pre-start approval cannot be redeemed after a module start wins the race.
func TestSATTransferWriterApprovalVoidedByModuleStart(t *testing.T) {
	f := newTransferFixture(t)
	a := f.admit(t, "sess-a")
	req, err := f.request(t, "op-start-race-1", "sess-b", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ConfirmTransferByWriter(context.Background(), a.Token, req.RequestID, f.policy); err != nil {
		t.Fatal(err)
	}
	f.startModule(t)
	_, err = f.commit("sess-b", req.RequestID)
	wantCode(t, err, apperrors.CodeTransferApprovalRequired)
	if state, marker := f.transferState(t, req.RequestID); state != attempts.TransferConflicted || marker.Valid {
		t.Fatalf("voided approval must be conflicted and release the marker: %s %v", state, marker)
	}
	if row := f.ownerRow(t); row.owner.String != "sess-a" || row.lease != 1 {
		t.Fatalf("voided approval must not move ownership: %+v", row)
	}
}

// Two concurrent commits of one approval change ownership exactly once.
func TestSATTransferConcurrentCommitOnce(t *testing.T) {
	f := newTransferFixture(t)
	f.admit(t, "sess-a")
	req, err := f.request(t, "op-commit-race-1", "sess-b", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.DecideTransfer(context.Background(), attempts.ProctorDecision{
		RequestID: req.RequestID, ScheduleID: f.scheduleID, ActorID: "proctor-1", Approve: true, AcknowledgeUnconfirmedRisk: true,
	}, f.policy); err != nil {
		t.Fatal(err)
	}
	var wg sync.WaitGroup
	results := make([]attempts.TransferCommit, 4)
	errs := make([]error, 4)
	for i := range results {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			results[i], errs[i] = f.commit("sess-b", req.RequestID)
		}(i)
	}
	wg.Wait()
	fresh := 0
	for i := range results {
		if errs[i] != nil {
			t.Fatalf("commit %d: %v", i, errs[i])
		}
		if !results[i].Recovered {
			fresh++
		}
		if results[i].Admission.LeaseEpoch != 2 {
			t.Fatalf("every commit result must report lease 2: %+v", results[i])
		}
	}
	if fresh != 1 {
		t.Fatalf("exactly one commit may change ownership, got %d", fresh)
	}
	if row := f.ownerRow(t); row.lease != 2 || row.owner.String != "sess-b" {
		t.Fatalf("lease must increment once: %+v", row)
	}
}

// Expiry is lazy, releases the marker, and never touches ownership; denial
// and cancellation likewise leave the writer unchanged.
func TestSATTransferExpiryDenyCancelKeepOwner(t *testing.T) {
	f := newTransferFixture(t)
	f.admit(t, "sess-a")
	req, err := f.request(t, "op-expire-1", "sess-b", 1)
	if err != nil {
		t.Fatal(err)
	}
	mustExec(t, f.db, `UPDATE attempt_device_transfers SET expires_at = UTC_TIMESTAMP(6) - INTERVAL 1 SECOND WHERE id = ?`, req.RequestID)
	who := attempts.RequesterRef{UserID: f.userID, AuthSessionID: "auth-sess-b", ScheduleID: f.scheduleID}
	view, err := f.svc.TransferStatus(context.Background(), req.RequestID, who)
	if err != nil || view.State != attempts.TransferExpired {
		t.Fatalf("status must lazily expire: %+v %v", view, err)
	}
	_, err = f.commit("sess-b", req.RequestID)
	wantCode(t, err, apperrors.CodeTransferConflict)

	denied, err := f.request(t, "op-deny-1", "sess-b", 1)
	if err != nil {
		t.Fatalf("expired marker must allow a new request: %v", err)
	}
	if v, err := f.svc.DecideTransfer(context.Background(), attempts.ProctorDecision{
		RequestID: denied.RequestID, ScheduleID: f.scheduleID, ActorID: "proctor-1", Approve: false, Reason: "not verified",
	}, f.policy); err != nil || v.State != attempts.TransferDenied {
		t.Fatalf("deny: %+v %v", v, err)
	}
	cancelled, err := f.request(t, "op-cancel-1", "sess-b", 1)
	if err != nil {
		t.Fatal(err)
	}
	if v, err := f.svc.CancelTransfer(context.Background(), cancelled.RequestID, who); err != nil || v.State != attempts.TransferCancelled {
		t.Fatalf("cancel: %+v %v", v, err)
	}
	// Another student's session cannot read or cancel it.
	other := attempts.RequesterRef{UserID: uuid.NewString(), AuthSessionID: "auth-sess-b", ScheduleID: f.scheduleID}
	_, err = f.svc.TransferStatus(context.Background(), cancelled.RequestID, other)
	wantCode(t, err, apperrors.CodeNotFound)
	if row := f.ownerRow(t); row.owner.String != "sess-a" || row.lease != 1 {
		t.Fatalf("expiry/deny/cancel must leave the writer unchanged: %+v", row)
	}
}

// A submitted attempt refuses transfer; a transfer committed first fences
// the old writer's submit.
func TestSATTransferTerminalAndSubmitFence(t *testing.T) {
	f := newTransferFixture(t)
	a := f.admit(t, "sess-a")
	req, err := f.request(t, "op-submit-fence-1", "sess-b", 1)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.svc.ConfirmTransferByWriter(context.Background(), a.Token, req.RequestID, f.policy); err != nil {
		t.Fatal(err)
	}
	if _, err := f.commit("sess-b", req.RequestID); err != nil {
		t.Fatal(err)
	}
	_, err = f.svc.Submit(context.Background(), a.Token, attempts.SubmitCommand{AttemptID: f.attemptID, LeaseEpoch: 2, SubmissionID: uuid.NewString()}, nil, nil, nil, nil)
	if err == nil {
		t.Fatal("old writer submit after transfer must be refused")
	}
	mustExec(t, f.db, `UPDATE student_attempts SET delivery_status = 'submitted', submitted_at = UTC_TIMESTAMP(6), final_submission = '{}' WHERE id = ?`, f.attemptID)
	_, err = f.request(t, "op-after-submit-1", "sess-c", 2)
	wantCode(t, err, apperrors.CodeAttemptNotWritable)
	if closed := f.admit(t, "sess-c"); closed.Outcome != attempts.AdmissionClosed {
		t.Fatalf("terminal attempt admission must be closed: %+v", closed)
	}
	if row := f.ownerRow(t); row.owner.String != "sess-b" || row.lease != 2 {
		t.Fatalf("terminal attempt ownership must not change: %+v", row)
	}
}

// I11: another student's open transaction (attempt row X-locked, schedule
// row S-locked) does not block this student's admission, transfer, or
// commit: ownership coordinates on this attempt's own rows only.
func TestSATTransferProgressesWhileNeighbourHoldsLocks(t *testing.T) {
	f := newTransferFixture(t)
	neighbour := f.seedStudent(f.rw, 0, false)
	hold, err := f.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = hold.Rollback() }()
	var id string
	if err := hold.QueryRow(`SELECT id FROM student_attempts WHERE id = ? FOR UPDATE`, neighbour).Scan(&id); err != nil {
		t.Fatalf("lock neighbour attempt: %v", err)
	}
	if err := hold.QueryRow(`SELECT id FROM exam_schedules WHERE id = ? FOR SHARE`, f.scheduleID).Scan(&id); err != nil {
		t.Fatalf("share-lock schedule: %v", err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	a, err := f.svc.Admit(ctx, attempts.AdmitCommand{AttemptID: f.attemptID, UserID: f.userID, ClientSessionID: "sess-a", SingleWriterEnabled: true}, f.issuer("sess-a"))
	if err != nil || a.Outcome != attempts.AdmissionAuthorized {
		t.Fatalf("admission blocked by a neighbour's transaction: %+v %v", a, err)
	}
	req, err := f.svc.RequestTransfer(ctx, attempts.RequestTransferCommand{
		OperationID: "op-neighbour-1", AttemptID: f.attemptID, ScheduleID: f.scheduleID, UserID: f.userID,
		AuthSessionID: "auth-sess-b", TargetSessionID: "sess-b", ExpectedLeaseEpoch: 1, ReasonCode: "device_change",
	}, f.policy)
	if err != nil {
		t.Fatalf("request blocked by a neighbour's transaction: %v", err)
	}
	if _, err := f.svc.ConfirmTransferByWriter(ctx, a.Token, req.RequestID, f.policy); err != nil {
		t.Fatalf("confirm blocked by a neighbour's transaction: %v", err)
	}
	if _, err := f.svc.CommitTransfer(ctx, attempts.CommitTransferCommand{
		RequestID: req.RequestID, TargetSessionID: "sess-b",
		Requester: attempts.RequesterRef{UserID: f.userID, AuthSessionID: "auth-sess-b", ScheduleID: f.scheduleID},
	}, func(string) attempts.CredentialIssuer { return f.issuer("sess-b") }); err != nil {
		t.Fatalf("commit blocked by a neighbour's transaction: %v", err)
	}
}

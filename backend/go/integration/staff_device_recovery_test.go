package integration

import (
	"context"
	"database/sql"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/act"
	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/delivery"
	examdomain "example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/grading"
	platformcrypto "example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	"example.com/ielts-proctoring/internal/terminalization"
	"github.com/google/uuid"
)

// This test uses a fresh browser proof with no account cookie or migrated
// client state. Stored authority and clocks, rather than status alone, are
// asserted after each transactional transition.
func TestStaffDeviceRecoveryColdBrowserMySQL(t *testing.T) {
	f := newTransferFixture(t)
	ctx := context.Background()
	staff, svc := newStaffRecoveryService(t, f)
	mustExec(t, f.db, `UPDATE assessment_module_attempts SET state = 'active', started_at = UTC_TIMESTAMP(6), allocated_seconds = 1800 WHERE attempt_id = ?`, f.attemptID)
	old := f.admit(t, "original-browser")
	options, err := svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
	if err != nil {
		t.Fatal(err)
	}
	if len(options.Targets) != 1 || !options.Targets[0].Eligibility.Eligible {
		t.Fatalf("options=%+v", options)
	}
	target := options.Targets[0]
	seconds := 480
	issue, err := svc.IssueDeviceRecovery(ctx, f.scheduleID, f.attemptID, staff, delivery.IssueDeviceRecoveryRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch, Target: deliveryTarget(target), RemainingSeconds: &seconds})
	if err != nil {
		t.Fatal(err)
	}
	var owner sql.NullString
	var lease uint64
	var revoked int
	if err := f.db.QueryRow(`SELECT active_client_session_id,lease_epoch FROM student_attempts WHERE id = ?`, f.attemptID).Scan(&owner, &lease); err != nil {
		t.Fatal(err)
	}
	if owner.Valid || lease != old.LeaseEpoch+1 {
		t.Fatalf("hold owner=%v lease=%d", owner, lease)
	}
	if err := f.db.QueryRow(`SELECT COUNT(*) FROM attempt_sessions WHERE attempt_id = ? AND revoked_at IS NOT NULL`, f.attemptID).Scan(&revoked); err != nil {
		t.Fatal(err)
	}
	if revoked == 0 {
		t.Fatal("old bearer not revoked")
	}
	proof := "clean-browser-proof-" + uuid.NewString()
	claim, err := svc.ClaimDeviceRecovery(ctx, issue.Grant.GrantID, delivery.ClaimDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof, LinkSecret: issue.LinkSecret, Code: issue.Code})
	if err != nil {
		t.Fatal(err)
	}
	if claim.CandidateName == "" || claim.State != "claimed" {
		t.Fatalf("claim=%+v", claim)
	}
	if _, err := svc.ReadyDeviceRecovery(ctx, issue.Grant.GrantID, "another-browser-"+uuid.NewString()); err == nil {
		t.Fatal("another browser obtained readiness")
	}
	operation := uuid.NewString()
	before := time.Now().UTC()
	begun, credentials, err := svc.BeginDeviceRecovery(ctx, issue.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: operation, BrowserProof: proof}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if credentials.AttemptToken == "" || credentials.SessionToken == "" {
		t.Fatal("missing committed credentials")
	}
	if begun.EffectiveDeadlineAt == nil || begun.EffectiveDeadlineAt.Before(before.Add(479*time.Second)) || begun.EffectiveDeadlineAt.After(time.Now().UTC().Add(481*time.Second)) {
		t.Fatalf("incorrect award=%+v", begun)
	}
	replay, _, err := svc.BeginDeviceRecovery(ctx, issue.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: operation, BrowserProof: proof}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if !replay.Replayed || !replay.EffectiveDeadlineAt.Equal(*begun.EffectiveDeadlineAt) {
		t.Fatal("retry awarded time twice")
	}
	var run uint64
	if err := f.db.QueryRow(`SELECT run_generation FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`, f.attemptID, target.ModuleID).Scan(&run); err != nil {
		t.Fatal(err)
	}
	if run != 1 {
		t.Fatalf("run=%d", run)
	}
	if err := f.db.QueryRow(`SELECT active_client_session_id,lease_epoch FROM student_attempts WHERE id = ?`, f.attemptID).Scan(&owner, &lease); err != nil {
		t.Fatal(err)
	}
	if owner.String != credentials.ClientSessionID || lease != old.LeaseEpoch+2 {
		t.Fatalf("owner=%v lease=%d", owner, lease)
	}
	options, err = svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
	if err != nil {
		t.Fatal(err)
	}
	restored, err := svc.RestoreOriginalDevice(ctx, f.scheduleID, f.attemptID, staff, delivery.RestoreOriginalDeviceRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch})
	if err != nil {
		t.Fatal(err)
	}
	if restored.Grant == nil || restored.Grant.State != "restored" {
		t.Fatalf("restore status=%+v", restored)
	}
	if _, _, err := svc.BeginDeviceRecovery(ctx, issue.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: operation, BrowserProof: proof}, nil, nil); err == nil {
		t.Fatal("superseded replacement browser regained authority")
	}
	originalClaims, err := platformcrypto.VerifyAttemptToken([]byte(transferSecret), time.Now().UTC(), old.Token)
	if err != nil {
		t.Fatal(err)
	}
	originalProof := "original-proof-" + uuid.NewString()
	originalOperation := uuid.NewString()
	prepared, err := svc.PrepareOriginalDeviceRecovery(ctx, f.scheduleID, f.attemptID, f.userID, originalClaims, delivery.ClaimDeviceRecoveryRequest{OperationID: originalOperation, BrowserProof: originalProof})
	if err != nil {
		t.Fatal(err)
	}
	restoredBegin, restoredIdentity, err := svc.BeginDeviceRecovery(ctx, prepared.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: originalProof}, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if restoredIdentity.ClientSessionID == originalClaims.ClientSessionID {
		t.Fatal("restore rebound the old offline queue identity")
	}
	if !restoredBegin.EffectiveDeadlineAt.Equal(*begun.EffectiveDeadlineAt) {
		t.Fatal("restore awarded consumed override twice")
	}
	var originalRevoked sql.NullTime
	if err := f.db.QueryRow(`SELECT revoked_at FROM attempt_sessions WHERE token_id=?`, originalClaims.TokenID).Scan(&originalRevoked); err != nil {
		t.Fatal(err)
	}
	if !originalRevoked.Valid {
		t.Fatal("restore un-revoked the original bearer")
	}

	// A whole-attempt timeout retains its immutable generation-0 receipt.
	// ACT's timeout path uses terminated/system; exercise that provenance here
	// rather than treating every terminated projection as a proctor action.
	mustExec(t, f.db, `UPDATE assessment_module_attempts SET state='locked', completion_reason='time_expired', locked_at=UTC_TIMESTAMP(6) WHERE attempt_id=?`, f.attemptID)
	terminal := terminalization.NewService(tx.NewRunner(f.db), nil, nil)
	mustExec(t, f.db, `UPDATE student_attempts SET recovery_control=JSON_SET(recovery_control,'$.focusDeadlineAt',DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND),'%Y-%m-%dT%H:%i:%s.%fZ')) WHERE id=?`, f.attemptID)
	var controlID string
	if err := f.db.QueryRow(`SELECT JSON_UNQUOTE(JSON_EXTRACT(recovery_control,'$.id')) FROM student_attempts WHERE id=?`, f.attemptID).Scan(&controlID); err != nil {
		t.Fatal(err)
	}
	firstSeal, err := terminal.Terminalize(ctx, terminalization.SealCommand{AttemptID: f.attemptID, ScheduleID: f.scheduleID, Outcome: terminalization.OutcomeTerminated, Reason: terminalization.ReasonTimeExpired, ActorKind: terminalization.ActorSystem, RecoveryControlID: controlID})
	if err != nil {
		t.Fatal(err)
	}
	options, err = svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
	if err != nil {
		t.Fatal(err)
	}
	issue, err = svc.IssueDeviceRecovery(ctx, f.scheduleID, f.attemptID, staff, delivery.IssueDeviceRecoveryRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch, Target: deliveryTarget(target), RemainingSeconds: &seconds})
	if err != nil {
		t.Fatal(err)
	}
	proof = "another-clean-browser-" + uuid.NewString()
	if _, err := svc.ClaimDeviceRecovery(ctx, issue.Grant.GrantID, delivery.ClaimDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof, LinkSecret: issue.LinkSecret, Code: issue.Code}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.BeginDeviceRecovery(ctx, issue.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof}, nil, nil); err != nil {
		t.Fatal(err)
	}
	var generation uint64
	var submitted sql.NullTime
	var oldReceipt string
	if err := f.db.QueryRow(`SELECT terminal_generation,submitted_at FROM student_attempts WHERE id=?`, f.attemptID).Scan(&generation, &submitted); err != nil {
		t.Fatal(err)
	}
	if generation != 1 || submitted.Valid {
		t.Fatalf("generation=%d submitted=%v", generation, submitted)
	}
	if err := f.db.QueryRow(`SELECT terminalization_id FROM attempt_terminalizations WHERE attempt_id=? AND terminal_generation=0`, f.attemptID).Scan(&oldReceipt); err != nil {
		t.Fatal(err)
	}
	if oldReceipt != firstSeal.TerminalizationID {
		t.Fatal("immutable receipt changed")
	}
	// A delayed generation-0 worker cannot reseal generation 1, even if it
	// reaches the terminalizer after the new browser has begun.
	previousGeneration := uint64(0)
	if _, err := terminal.Terminalize(ctx, terminalization.SealCommand{AttemptID: f.attemptID, ScheduleID: f.scheduleID, Outcome: terminalization.OutcomeTerminated, Reason: terminalization.ReasonTimeExpired, ActorKind: terminalization.ActorSystem, ExpectedTerminalGeneration: &previousGeneration}); err == nil {
		t.Fatal("old completion worker sealed the recovered generation")
	}
	secondSeal, err := terminal.Terminalize(ctx, terminalization.SealCommand{AttemptID: f.attemptID, ScheduleID: f.scheduleID, Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonStudentSubmit, ActorKind: terminalization.ActorStudent})
	if err != nil {
		t.Fatal(err)
	}
	if !secondSeal.Created || secondSeal.TerminalizationID == firstSeal.TerminalizationID {
		t.Fatal("reseal reused old receipt")
	}
	options, err = svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
	if err != nil {
		t.Fatal(err)
	}
	if options.Eligibility.Eligible {
		t.Fatal("explicit submission was eligible for reopening")
	}

}

func deliveryTarget(t delivery.DeviceRecoveryTarget) examdomain.RecoveryTarget {
	return examdomain.RecoveryTarget{SectionKey: t.SectionKey, ModuleAttemptID: t.ModuleAttemptID, ModuleID: t.ModuleID}
}

func TestStaffDeviceRecoveryConcurrentIssueClaimAndBeginMySQL(t *testing.T) {
	f := newTransferFixture(t)
	ctx := context.Background()
	f.admit(t, "concurrency-original")
	staff, svc := newStaffRecoveryService(t, f)
	mustExec(t, f.db, `UPDATE assessment_module_attempts SET state='active',started_at=UTC_TIMESTAMP(6),allocated_seconds=1800 WHERE attempt_id=?`, f.attemptID)
	options, err := svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
	if err != nil {
		t.Fatal(err)
	}
	award := 300
	type issued struct {
		value *delivery.IssuedDeviceRecovery
		err   error
	}
	issues := make(chan issued, 2)
	for range 2 {
		go func() {
			value, err := svc.IssueDeviceRecovery(ctx, f.scheduleID, f.attemptID, staff, delivery.IssueDeviceRecoveryRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch, Target: deliveryTarget(options.Targets[0]), RemainingSeconds: &award})
			issues <- issued{value, err}
		}()
	}
	var winner *delivery.IssuedDeviceRecovery
	failures := 0
	for range 2 {
		result := <-issues
		if result.err != nil {
			failures++
		} else {
			winner = result.value
		}
	}
	if winner == nil || failures != 1 {
		t.Fatalf("concurrent issuances: winner=%v failures=%d", winner != nil, failures)
	}
	type claimed struct {
		proof string
		view  *delivery.RecoveryReadyView
		err   error
	}
	claims := make(chan claimed, 2)
	for range 2 {
		go func() {
			proof := "racing-browser-" + uuid.NewString()
			view, err := svc.ClaimDeviceRecovery(ctx, winner.Grant.GrantID, delivery.ClaimDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof, LinkSecret: winner.LinkSecret, Code: winner.Code})
			claims <- claimed{proof, view, err}
		}()
	}
	var proof string
	failures = 0
	var revision uint64
	for range 2 {
		result := <-claims
		if result.err != nil {
			failures++
		} else {
			proof = result.proof
			revision = result.view.GrantRevision
		}
	}
	if proof == "" || failures != 1 {
		t.Fatalf("concurrent claims: winner=%v failures=%d", proof != "", failures)
	}
	type begun struct {
		view     *delivery.RecoveryBeginResult
		identity delivery.RecoveryCredentialIdentity
		err      error
	}
	begins := make(chan begun, 2)
	operation := uuid.NewString()
	for range 2 {
		go func() {
			view, identity, err := svc.BeginDeviceRecovery(ctx, winner.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: operation, BrowserProof: proof, ExpectedGrantRevision: revision}, nil, nil)
			begins <- begun{view, identity, err}
		}()
	}
	first, second := <-begins, <-begins
	if first.err != nil || second.err != nil {
		t.Fatalf("concurrent Begin: %v %v", first.err, second.err)
	}
	if first.identity.ClientSessionID != second.identity.ClientSessionID || !first.view.EffectiveDeadlineAt.Equal(*second.view.EffectiveDeadlineAt) || first.view.Replayed == second.view.Replayed {
		t.Fatal("identical concurrent Begin did not converge on one run and clock")
	}
	var lease, run uint64
	if err := f.db.QueryRow(`SELECT lease_epoch FROM student_attempts WHERE id=?`, f.attemptID).Scan(&lease); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow(`SELECT run_generation FROM assessment_module_attempts WHERE attempt_id=?`, f.attemptID).Scan(&run); err != nil {
		t.Fatal(err)
	}
	if lease != options.LeaseEpoch+2 || run != 1 {
		t.Fatalf("duplicate fencing or activation: lease=%d initial=%d run=%d", lease, options.LeaseEpoch, run)
	}
}

func TestStaffDeviceRecoveryACTResealsCurrentGenerationMySQL(t *testing.T) {
	f := newTransferFixture(t)
	ctx := context.Background()
	f.admit(t, "act-original")
	staff, svc := newStaffRecoveryService(t, f)
	question := "act-recovery-q1"
	mustExec(t, f.db, `UPDATE exam_entities SET provider_key='act',exam_type='ACT' WHERE id=?`, f.examID)
	mustExec(t, f.db, `UPDATE exam_schedules SET provider_key='act' WHERE id=?`, f.scheduleID)
	mustExec(t, f.db, `UPDATE exam_versions SET content_snapshot=?,config_snapshot='{"weights":[1]}' WHERE id=?`, mustJSONBytes(actScienceContent(question)), f.versionID)
	mustExec(t, f.db, `UPDATE student_attempts SET protocol_version=1,current_module='science',answers=? WHERE id=?`, mustJSONBytes(map[string]string{question: "A"}), f.attemptID)
	mustExec(t, f.db, `UPDATE exam_session_runtimes SET provider_key='act',timing_model='legacy_section_v1',active_section_key='science',current_section_key='science',actual_start_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 40 MINUTE) WHERE schedule_id=?`, f.scheduleID)
	var runtimeID string
	if err := f.db.QueryRow(`SELECT id FROM exam_session_runtimes WHERE schedule_id=?`, f.scheduleID).Scan(&runtimeID); err != nil {
		t.Fatal(err)
	}
	mustExec(t, f.db, `DELETE FROM exam_session_runtime_sections WHERE runtime_id=?`, runtimeID)
	mustExec(t, f.db, `INSERT INTO exam_session_runtime_sections (id,runtime_id,section_key,label,section_order,planned_duration_minutes,status,actual_start_at,actual_end_at,completion_reason) VALUES (?,?,'science','Science',0,35,'completed',DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 40 MINUTE),DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE),'time_expired')`, uuid.NewString(), runtimeID)
	runner := tx.NewRunner(f.db)
	terminal := terminalization.NewService(runner, nil, nil).SetAttemptScorer(act.NewService(f.db, runner))
	svc.SetRecoveryTimeoutSealer(func(ctx context.Context, q tx.Tx, attemptID, scheduleID, controlID string, deadline time.Time) error {
		_, err := terminal.TerminalizeInTx(ctx, q, terminalization.SealCommand{AttemptID: attemptID, ScheduleID: scheduleID, Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonTimeExpired, ActorKind: terminalization.ActorSystem, RecoveryControlID: controlID, EffectiveAt: &deadline})
		return err
	})
	if _, err := terminal.Terminalize(ctx, terminalization.SealCommand{AttemptID: f.attemptID, ScheduleID: f.scheduleID, Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonTimeExpired, ActorKind: terminalization.ActorSystem}); err != nil {
		t.Fatal(err)
	}
	var oldSubmission string
	if err := f.db.QueryRow(`SELECT id FROM student_submissions WHERE attempt_id=? AND terminal_generation=0`, f.attemptID).Scan(&oldSubmission); err != nil {
		t.Fatal(err)
	}
	options, err := svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
	if err != nil {
		t.Fatal(err)
	}
	seconds := 180
	issue, err := svc.IssueDeviceRecovery(ctx, f.scheduleID, f.attemptID, staff, delivery.IssueDeviceRecoveryRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch, Target: examdomain.RecoveryTarget{SectionKey: "science"}, RemainingSeconds: &seconds})
	if err != nil {
		t.Fatal(err)
	}
	proof := "act-clean-browser-" + uuid.NewString()
	if _, err := svc.ClaimDeviceRecovery(ctx, issue.Grant.GrantID, delivery.ClaimDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof, LinkSecret: issue.LinkSecret, Code: issue.Code}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.BeginDeviceRecovery(ctx, issue.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof}, nil, nil); err != nil {
		t.Fatal(err)
	}
	if result, err := act.LoadResultForAttempt(ctx, f.db, f.attemptID); err != nil || result != nil {
		t.Fatalf("old result remained current: %v err=%v", result, err)
	}
	historical, err := grading.NewService(f.db, runner).GetSubmission(ctx, oldSubmission)
	if err != nil || !historical.Historical || historical.TerminalGeneration != 0 {
		t.Fatalf("historical submission=%+v err=%v", historical, err)
	}
	if _, err := grading.NewService(f.db, runner).GradeObjective(ctx, oldSubmission, nil); err == nil {
		t.Fatal("historical grading accepted a mutation")
	}
	if changed, err := svc.ReconcileRecoveryTimeout(ctx, f.scheduleID, f.attemptID); err != nil || changed {
		t.Fatalf("new clock closed early: changed=%v err=%v", changed, err)
	}
	// Room and individual pauses overlap. Their union shifts the snapshot
	// clock once, including protocol 1; an ordinary resume cannot double it.
	readDeadline := func() time.Time {
		t.Helper()
		var deadline time.Time
		if err := f.db.QueryRow(`SELECT deadline_at FROM student_attempts WHERE id=?`, f.attemptID).Scan(&deadline); err != nil {
			t.Fatal(err)
		}
		return deadline
	}
	syncClock := func() {
		t.Helper()
		if err := runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
			return examruntime.SyncRecoveryClockInTx(ctx, q, f.scheduleID, f.attemptID)
		}); err != nil {
			t.Fatal(err)
		}
	}
	originalDeadline := readDeadline()
	mustExec(t, f.db, `UPDATE exam_session_runtimes SET status='paused' WHERE id=?`, runtimeID)
	syncClock()
	mustExec(t, f.db, `UPDATE student_attempts SET proctor_status='paused',recovery_control=JSON_SET(recovery_control,'$.focusPausedAt',DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 20 SECOND),'%Y-%m-%dT%H:%i:%s.%fZ')) WHERE id=?`, f.attemptID)
	mustExec(t, f.db, `UPDATE exam_session_runtimes SET status='live' WHERE id=?`, runtimeID)
	syncClock()
	if !readDeadline().Equal(originalDeadline) {
		t.Fatal("room resume released an individual pause")
	}
	mustExec(t, f.db, `UPDATE student_attempts SET proctor_status='active' WHERE id=?`, f.attemptID)
	syncClock()
	resumedDeadline := readDeadline()
	if shift := resumedDeadline.Sub(originalDeadline); shift < 20*time.Second || shift > 21*time.Second {
		t.Fatalf("union pause shift=%s", shift)
	}
	syncClock()
	if !readDeadline().Equal(resumedDeadline) {
		t.Fatal("repeated resume awarded the pause twice")
	}
	mustExec(t, f.db, `UPDATE student_attempts SET answers=?,deadline_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND),recovery_control=JSON_SET(recovery_control,'$.focusDeadlineAt',DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND),'%Y-%m-%dT%H:%i:%s.%fZ')) WHERE id=?`, mustJSONBytes(map[string]string{question: "B"}), f.attemptID)
	if changed, err := svc.ReconcileRecoveryTimeout(ctx, f.scheduleID, f.attemptID); err != nil || !changed {
		t.Fatalf("recovery expiry did not seal: changed=%v err=%v", changed, err)
	}
	var receipts, submissions, oldScore, newScore int
	if err := f.db.QueryRow(`SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id=?`, f.attemptID).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow(`SELECT COUNT(*) FROM student_submissions WHERE attempt_id=?`, f.attemptID).Scan(&submissions); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow(`SELECT CAST(JSON_UNQUOTE(JSON_EXTRACT(auto_grading_results,'$.totalScore')) AS SIGNED) FROM section_submissions WHERE submission_id=?`, oldSubmission).Scan(&oldScore); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow(`SELECT total_score FROM assessment_results WHERE attempt_id=? AND terminal_generation=1`, f.attemptID).Scan(&newScore); err != nil {
		t.Fatal(err)
	}
	if receipts != 2 || submissions != 2 || oldScore != 1 || newScore != 0 {
		t.Fatalf("receipts=%d submissions=%d oldScore=%d newScore=%d", receipts, submissions, oldScore, newScore)
	}
	if changed, err := svc.ReconcileRecoveryTimeout(ctx, f.scheduleID, f.attemptID); err != nil || changed {
		t.Fatalf("expiry retry changed completion: %v %v", changed, err)
	}
}

func TestStaffDeviceRecoveryIELTSRewindResumesSavedClockMySQL(t *testing.T) {
	for _, model := range []string{examruntime.TimingModelIELTSPersonalV1, examruntime.TimingModelIELTSPersonal} {
		t.Run(model, func(t *testing.T) {
			f := newTransferFixture(t)
			ctx := context.Background()
			f.admit(t, "original-ielts-browser")
			staff, svc := newStaffRecoveryService(t, f)
			mustExec(t, f.db, `UPDATE exam_entities SET provider_key='ielts',exam_type='Academic' WHERE id=?`, f.examID)
			mustExec(t, f.db, `UPDATE exam_schedules SET provider_key='ielts',ielts_timing_model=? WHERE id=?`, model, f.scheduleID)
			mustExec(t, f.db, `UPDATE exam_session_runtimes SET provider_key='ielts',timing_model=?,actual_start_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 40 MINUTE),active_section_key='reading',current_section_key='reading' WHERE schedule_id=?`, model, f.scheduleID)
			mustExec(t, f.db, `UPDATE student_attempts SET current_module='reading',answers='{"later-reading":"saved"}',writing_answers='{"task1":"saved essay"}' WHERE id=?`, f.attemptID)
			var runtimeID string
			if err := f.db.QueryRow(`SELECT id FROM exam_session_runtimes WHERE schedule_id=?`, f.scheduleID).Scan(&runtimeID); err != nil {
				t.Fatal(err)
			}
			mustExec(t, f.db, `DELETE FROM exam_session_runtime_sections WHERE runtime_id=?`, runtimeID)
			for index, section := range []string{"listening", "reading"} {
				state, reason := "active", ""
				if index == 0 {
					state, reason = "completed", "time_expired"
				}
				roomState := "live"
				if index == 0 {
					roomState = "completed"
				}
				mustExec(t, f.db, `INSERT INTO exam_session_runtime_sections (id,runtime_id,section_key,label,section_order,planned_duration_minutes,status,actual_start_at,completion_reason) VALUES (?,?,?,?,?,35,?,DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 35 MINUTE),NULLIF(?,''))`, uuid.NewString(), runtimeID, section, section, index, roomState, reason)
				mustExec(t, f.db, `INSERT INTO ielts_attempt_section_timelines (id,attempt_id,runtime_id,section_key,section_order,state,expected_start_at,preparation_deadline_at,started_at,deadline_at,completion_reason) VALUES (?,?,?,?,?,?,DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 40 MINUTE),DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 38 MINUTE),DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 35 MINUTE),TIMESTAMPADD(SECOND,?,UTC_TIMESTAMP(6)),NULLIF(?,''))`, uuid.NewString(), f.attemptID, runtimeID, section, index, state, -300+index*900, reason)
			}
			options, err := svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
			if err != nil {
				t.Fatal(err)
			}
			seconds := 180
			issued, err := svc.IssueDeviceRecovery(ctx, f.scheduleID, f.attemptID, staff, delivery.IssueDeviceRecoveryRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch, Target: examdomain.RecoveryTarget{SectionKey: "listening"}, RemainingSeconds: &seconds})
			if err != nil {
				t.Fatal(err)
			}
			proof := "clean-ielts-" + uuid.NewString()
			claim, err := svc.ClaimDeviceRecovery(ctx, issued.Grant.GrantID, delivery.ClaimDeviceRecoveryRequest{OperationID: uuid.NewString(), LinkSecret: issued.LinkSecret, Code: issued.Code, BrowserProof: proof})
			if err != nil {
				t.Fatal(err)
			}
			_, _, err = svc.BeginDeviceRecovery(ctx, issued.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof, ExpectedGrantRevision: claim.GrantRevision}, nil, nil)
			if err != nil {
				t.Fatal(err)
			}
			room := examruntime.NewService(tx.NewRunner(f.db), nil)
			ready, err := room.ReadyCohortSection(ctx, f.scheduleID, "listening", f.attemptID, f.userID, nil)
			if err != nil || ready.Status != "active" {
				t.Fatalf("focused readiness=%+v err=%v", ready, err)
			}
			if _, err := room.ReadyCohortSection(ctx, f.scheduleID, "reading", f.attemptID, f.userID, nil); err == nil {
				t.Fatal("suspended section accepted readiness")
			}
			var frozen string
			if err := f.db.QueryRow(`SELECT CAST(recovery_control AS CHAR) FROM student_attempts WHERE id=?`, f.attemptID).Scan(&frozen); err != nil {
				t.Fatal(err)
			}
			c, err := examdomain.ParseRecoveryControl([]byte(frozen))
			if err != nil || len(c.Suspended) != 1 {
				t.Fatalf("continuation=%s err=%v", frozen, err)
			}
			savedRemaining := c.Suspended[0].RemainingSeconds
			if savedRemaining < 598 || savedRemaining > 600 {
				t.Fatalf("saved seconds=%d", savedRemaining)
			}
			// Move only the focused provider clock to its expiry; the suspended clock
			// remains paused and the room's cursor/deadline remain unchanged.
			mustExec(t, f.db, `UPDATE ielts_attempt_section_timelines SET deadline_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE attempt_id=? AND section_key='listening'`, f.attemptID)
			ready, err = room.ReadyCohortSection(ctx, f.scheduleID, "listening", f.attemptID, f.userID, nil)
			if err != nil || ready.Status != "completed" {
				t.Fatalf("focus completion=%+v err=%v", ready, err)
			}
			ready, err = room.ReadyCohortSection(ctx, f.scheduleID, "reading", f.attemptID, f.userID, nil)
			if err != nil || ready.Status != "active" || ready.DeadlineAt == nil {
				t.Fatalf("successor=%+v err=%v", ready, err)
			}
			if d := ready.DeadlineAt.Sub(ready.ServerNow); d < time.Duration(savedRemaining-1)*time.Second || d > time.Duration(savedRemaining)*time.Second {
				t.Fatalf("successor remaining=%s saved=%d", d, savedRemaining)
			}
			var answers, writing, cursor string
			if err := f.db.QueryRow(`SELECT CAST(answers AS CHAR),CAST(writing_answers AS CHAR) FROM student_attempts WHERE id=?`, f.attemptID).Scan(&answers, &writing); err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(answers, "saved") || !strings.Contains(writing, "saved essay") {
				t.Fatal("successor answers were reset")
			}
			if err := f.db.QueryRow(`SELECT active_section_key FROM exam_session_runtimes WHERE id=?`, runtimeID).Scan(&cursor); err != nil || cursor != "reading" {
				t.Fatalf("room cursor=%q err=%v", cursor, err)
			}
			if changed, err := svc.ReconcileRecoveryTimeout(ctx, f.scheduleID, f.attemptID); err != nil || changed {
				t.Fatalf("successor closed early: %v %v", changed, err)
			}
			mustExec(t, f.db, `UPDATE ielts_attempt_section_timelines SET deadline_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND) WHERE attempt_id=? AND section_key='reading'`, f.attemptID)
			mustExec(t, f.db, `UPDATE student_attempts SET deadline_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND),recovery_control=JSON_SET(recovery_control,'$.focusDeadlineAt',DATE_FORMAT(DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 SECOND),'%Y-%m-%dT%H:%i:%s.%fZ')) WHERE id=?`, f.attemptID)
			if changed, err := svc.ReconcileRecoveryTimeout(ctx, f.scheduleID, f.attemptID); err != nil || !changed {
				t.Fatalf("IELTS expiry did not seal: %v %v", changed, err)
			}
			var completion string
			if err := f.db.QueryRow(`SELECT reason FROM attempt_terminalizations WHERE attempt_id=? AND terminal_generation=0`, f.attemptID).Scan(&completion); err != nil || completion != "time_expired" {
				t.Fatalf("IELTS completion=%q err=%v", completion, err)
			}
		})
	}
}

func TestStaffDeviceRecoveryAudioCheckpointMySQL(t *testing.T) {
	f := newTransferFixture(t)
	ctx := context.Background()
	admission := f.admit(t, "audio-browser")
	mustExec(t, f.db, `UPDATE exam_entities SET provider_key='ielts',exam_type='Academic' WHERE id=?`, f.examID)
	mustExec(t, f.db, `UPDATE student_attempts SET current_module='listening' WHERE id=?`, f.attemptID)
	mustExec(t, f.db, `UPDATE exam_versions SET content_snapshot='{"listening":{"parts":[{"id":"part-1","audioUrl":"media://audio-1"}]}}',config_snapshot='{"sections":{"listening":{"audioPlaybackEnabled":true}}}' WHERE id=?`, f.versionID)
	claims, err := platformcrypto.VerifyAttemptToken([]byte(transferSecret), time.Now().UTC(), admission.Token)
	if err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(f.db, tx.NewRunner(f.db))
	view, err := svc.ReadAudioCheckpoint(ctx, claims, "part-1")
	if err != nil {
		t.Fatal(err)
	}
	if view.Checkpoint != nil {
		t.Fatal("fabricated initial checkpoint")
	}
	req := delivery.AudioCheckpointRequest{SectionKey: "listening", PartID: "part-1", MediaRevision: view.MediaRevision, PositionMS: 42000, Sequence: 1, LeaseEpoch: view.LeaseEpoch, RunGeneration: view.RunGeneration}
	if _, err := svc.SaveAudioCheckpoint(ctx, claims, req); err != nil {
		t.Fatal(err)
	}
	req.Sequence = 2
	req.PositionMS = 12000
	if _, err := svc.SaveAudioCheckpoint(ctx, claims, req); err != nil {
		t.Fatal(err)
	}
	req.Sequence = 1
	req.PositionMS = 59000
	view, err = svc.SaveAudioCheckpoint(ctx, claims, req)
	if err != nil {
		t.Fatal(err)
	}
	if view.Checkpoint.PositionMS != 12000 {
		t.Fatal("old sequence overwrote backwards seek")
	}
	req.Sequence = 2
	if _, err := svc.SaveAudioCheckpoint(ctx, claims, req); err == nil {
		t.Fatal("same sequence changed payload")
	}
	if err := tx.NewRunner(f.db).WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if _, err := q.ExecContext(ctx, `SELECT id FROM student_attempts WHERE id=? FOR UPDATE`, f.attemptID); err != nil {
			return err
		}
		c := examdomain.NewRecoveryControl(uuid.NewString(), claims.ClientSessionID, examdomain.RecoveryTarget{SectionKey: "listening"})
		c.ActiveGrantID = uuid.NewString()
		_, _, err := attempts.FenceForRecoveryInTx(ctx, q, f.attemptID, c)
		return err
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.SaveAudioCheckpoint(ctx, claims, req); err == nil {
		t.Fatal("revoked browser saved audio checkpoint")
	}
}

func newStaffRecoveryService(t *testing.T, f *transferFixture) (string, *delivery.Service) {
	t.Helper()
	staff := uuid.NewString()
	mustExec(t, f.db, `INSERT INTO users (id,email,display_name,role,state) VALUES (?,?,'Recovery Proctor','proctor','active')`, staff, staff+"@example.test")
	t.Cleanup(func() {
		_, _ = f.db.Exec(`DELETE FROM user_sessions WHERE recovery_attempt_id = ?`, f.attemptID)
		_, _ = f.db.Exec(`DELETE FROM attempt_device_recovery_grants WHERE attempt_id = ?`, f.attemptID)
		_, _ = f.db.Exec(`DELETE FROM users WHERE id = ?`, staff)
	})
	svc := delivery.NewService(f.db, tx.NewRunner(f.db)).SetStaffDeviceRecovery(true, []byte(transferSecret)).SetRecoveryContinuation(func(ctx context.Context, q tx.Tx, req delivery.RecoveryCredentialRequest) (delivery.RecoveryCredentialIdentity, error) {
		id, cookie, csrf, err := auth.CreateSessionInTx(ctx, q, f.cfg, req.UserID, auth.RoleStudent, auth.SessionProof{Source: auth.SessionSourceRecovery, RecoveryAttemptID: req.AttemptID}, nil, nil, req.Now)
		if err != nil {
			return delivery.RecoveryCredentialIdentity{}, err
		}
		bearer, expires, err := auth.IssueAttemptTokenTx(ctx, q, f.cfg, req.UserID, req.ScheduleID, req.AttemptID, req.ClientSessionID, nil, &req.LeaseEpoch, req.Now)
		return delivery.RecoveryCredentialIdentity{SessionID: id, SessionToken: cookie, CSRFToken: csrf, AttemptToken: bearer, AttemptExpiresAt: expires, ClientSessionID: req.ClientSessionID}, err
	}, func(ctx context.Context, q tx.Tx, attemptID string, now time.Time) (uint64, error) {
		var raw string
		if err := q.QueryRowContext(ctx, `SELECT COALESCE(recovery_control,'') FROM student_attempts WHERE id = ?`, attemptID).Scan(&raw); err != nil {
			return 0, err
		}
		c, err := examdomain.ParseRecoveryControl([]byte(raw))
		if err != nil {
			return 0, err
		}
		return terminalization.NewService(tx.NewRunner(f.db), nil, nil).ReopenTimedOutInTx(ctx, q, attemptID, f.scheduleID, staff, c.ID, c.Target)
	})
	svc.SetRecoveryTimeoutSealer(func(ctx context.Context, q tx.Tx, attemptID, scheduleID, controlID string, deadline time.Time) error {
		_, err := terminalization.NewService(tx.NewRunner(f.db), nil, nil).SetAttemptScorer(act.NewService(f.db, tx.NewRunner(f.db))).TerminalizeInTx(ctx, q, terminalization.SealCommand{AttemptID: attemptID, ScheduleID: scheduleID, Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonTimeExpired, ActorKind: terminalization.ActorSystem, RecoveryControlID: controlID, EffectiveAt: &deadline})
		return err
	})
	return staff, svc
}

func TestStaffDeviceRecoverySATRewindPreservesSuccessorMySQL(t *testing.T) {
	f := newTransferFixture(t)
	ctx := context.Background()
	staff, svc := newStaffRecoveryService(t, f)
	f.admit(t, "original-browser")
	mustExec(t, f.db, `UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?`, f.scheduleID)
	mustExec(t, f.db, `UPDATE assessment_module_attempts SET state='active',started_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 3610 SECOND),allocated_seconds=3600 WHERE attempt_id=?`, f.attemptID)
	if _, err := svc.ReconcileAttemptTimeout(ctx, f.scheduleID, f.attemptID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	var m1, m2, selected string
	if err := f.db.QueryRow(`SELECT base_module_attempt_id,selected_module_id FROM assessment_route_decisions WHERE attempt_id=? AND section_id=?`, f.attemptID, f.rw.sectionID).Scan(&m1, &selected); err != nil {
		t.Fatal(err)
	}
	if selected != f.rw.lowID {
		t.Fatalf("initial selected module=%s", selected)
	}
	if err := f.db.QueryRow(`SELECT id FROM assessment_module_attempts WHERE attempt_id=? AND module_id=?`, f.attemptID, selected).Scan(&m2); err != nil {
		t.Fatal(err)
	}
	mustExec(t, f.db, `UPDATE assessment_module_attempts SET state='active',started_at=UTC_TIMESTAMP(6),allocated_seconds=840 WHERE id=?`, m2)
	var question string
	if err := f.db.QueryRow(`SELECT id FROM assessment_exam_questions WHERE module_id=? ORDER BY display_order LIMIT 1`, selected).Scan(&question); err != nil {
		t.Fatal(err)
	}
	mustExec(t, f.db, `INSERT INTO attempt_responses_v2 (attempt_id,question_id,module_id,response,response_hash,server_revision,client_version,client_write_id,lease_epoch,control_epoch,request_hash) VALUES (?,?,?,'{"answer":"B"}',?,19,7,?,1,1,?)`, f.attemptID, question, selected, strings.Repeat("b", 64), uuid.NewString(), strings.Repeat("b", 64))
	options, err := svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
	if err != nil {
		t.Fatal(err)
	}
	award := 360
	issue, err := svc.IssueDeviceRecovery(ctx, f.scheduleID, f.attemptID, staff, delivery.IssueDeviceRecoveryRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch, Target: examdomain.RecoveryTarget{SectionKey: "reading-writing", ModuleAttemptID: m1, ModuleID: f.rw.baseID}, RemainingSeconds: &award})
	if err != nil {
		t.Fatal(err)
	}
	proof := "rewind-proof-" + uuid.NewString()
	if _, err := svc.ClaimDeviceRecovery(ctx, issue.Grant.GrantID, delivery.ClaimDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof, LinkSecret: issue.LinkSecret, Code: issue.Code}); err != nil {
		t.Fatal(err)
	}
	if _, _, err := svc.BeginDeviceRecovery(ctx, issue.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof}, nil, nil); err != nil {
		t.Fatal(err)
	}
	var raw string
	var paused sql.NullTime
	if err := f.db.QueryRow(`SELECT CAST(recovery_control AS CHAR) FROM student_attempts WHERE id=?`, f.attemptID).Scan(&raw); err != nil {
		t.Fatal(err)
	}
	control, err := examdomain.ParseRecoveryControl([]byte(raw))
	if err != nil {
		t.Fatal(err)
	}
	if len(control.Suspended) != 1 || control.Suspended[0].Target.ModuleAttemptID != m2 || control.Suspended[0].RemainingSeconds < 835 || control.Suspended[0].RemainingSeconds > 840 {
		t.Fatalf("suspended=%+v", control.Suspended)
	}
	frozen := control.Suspended[0].RemainingSeconds
	if err := f.db.QueryRow(`SELECT paused_at FROM assessment_module_attempts WHERE id=?`, m2).Scan(&paused); err != nil || !paused.Valid {
		t.Fatalf("successor paused=%v err=%v", paused, err)
	}
	// The new M1 score crosses the threshold; the administered M2 must remain.
	mustExec(t, f.db, `UPDATE attempt_responses_v2 SET response='{"answer":"B"}' WHERE attempt_id=? AND module_id=?`, f.attemptID, f.rw.baseID)
	expired := time.Now().UTC().Add(-10 * time.Second)
	mustExec(t, f.db, `UPDATE assessment_module_attempts SET started_at=?,allocated_seconds=1 WHERE id=?`, expired.Add(-time.Second), m1)
	mustExec(t, f.db, `UPDATE student_attempts SET recovery_control=JSON_SET(recovery_control,'$.focusDeadlineAt',?),deadline_at=? WHERE id=?`, expired.Format(time.RFC3339Nano), expired, f.attemptID)
	if _, err := svc.ReconcileAttemptTimeout(ctx, f.scheduleID, f.attemptID, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	var decisions, score, selectionScore int
	if err := f.db.QueryRow(`SELECT COUNT(*),MAX(selected_module_id),MAX(raw_correct) FROM assessment_route_decisions WHERE attempt_id=? AND section_id=?`, f.attemptID, f.rw.sectionID).Scan(&decisions, &selected, &selectionScore); err != nil {
		t.Fatal(err)
	}
	if decisions != 1 || selected != f.rw.lowID || selectionScore != 0 {
		t.Fatalf("route changed: count=%d selected=%s raw=%d", decisions, selected, selectionScore)
	}
	if err := f.db.QueryRow(`SELECT raw_correct FROM assessment_module_attempts WHERE id=?`, m1).Scan(&score); err != nil || score != 3 {
		t.Fatalf("recovered score=%d err=%v", score, err)
	}
	var remaining int
	if err := f.db.QueryRow(`SELECT paused_at,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(6),TIMESTAMPADD(SECOND,allocated_seconds+extension_seconds+accumulated_paused_seconds,started_at)) FROM assessment_module_attempts WHERE id=?`, m2).Scan(&paused, &remaining); err != nil {
		t.Fatal(err)
	}
	if paused.Valid || remaining < frozen-2 || remaining > frozen {
		t.Fatalf("resumed paused=%v remaining=%d frozen=%d", paused, remaining, frozen)
	}
	var answer string
	var version, revision int
	if err := f.db.QueryRow(`SELECT CAST(response AS CHAR),client_version,server_revision FROM attempt_responses_v2 WHERE attempt_id=? AND question_id=?`, f.attemptID, question).Scan(&answer, &version, &revision); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(answer, `"B"`) || version != 7 || revision != 19 {
		t.Fatalf("successor answer changed: %s v%d r%d", answer, version, revision)
	}
}

func TestStaffDeviceRecoverySATRewindPreservesBreakAndOfferMySQL(t *testing.T) {
	for _, breakState := range []string{"active", "armed"} {
		t.Run(breakState, func(t *testing.T) {
			f := newTransferFixture(t)
			ctx := context.Background()
			f.admit(t, "break-original")
			staff, svc := newStaffRecoveryService(t, f)
			mustExec(t, f.db, `UPDATE exam_session_runtimes SET timing_model='sat_personal_v1' WHERE schedule_id=?`, f.scheduleID)
			mustExec(t, f.db, `UPDATE assessment_module_attempts SET state='locked',started_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 1 HOUR),locked_at=UTC_TIMESTAMP(6),completion_reason='time_expired' WHERE attempt_id=?`, f.attemptID)
			var target string
			if err := f.db.QueryRow(`SELECT id FROM assessment_module_attempts WHERE attempt_id=? AND module_id=?`, f.attemptID, f.rw.baseID).Scan(&target); err != nil {
				t.Fatal(err)
			}
			nextID, breakID := uuid.NewString(), uuid.NewString()
			mustExec(t, f.db, `INSERT INTO assessment_module_attempts (id,attempt_id,module_id,state,allocated_seconds,available_at,auto_start_at,entry_starts_at,entry_generation,tool_state) VALUES (?,?,?,'not_started',1800,TIMESTAMPADD(SECOND,90,UTC_TIMESTAMP(6)),TIMESTAMPADD(SECOND,90,UTC_TIMESTAMP(6)),TIMESTAMPADD(SECOND,90,UTC_TIMESTAMP(6)),3,'{}')`, nextID, f.attemptID, f.math.baseID)
			mustExec(t, f.db, `INSERT INTO assessment_attempt_breaks (id,attempt_id,after_section_id,duration_seconds,state,starts_at,deadline_at,entry_starts_at,entry_generation) VALUES (?,?,?,600,?,CASE WHEN ?='active' THEN DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 5 MINUTE) ELSE NULL END,CASE WHEN ?='active' THEN TIMESTAMPADD(SECOND,90,UTC_TIMESTAMP(6)) ELSE NULL END,TIMESTAMPADD(SECOND,90,UTC_TIMESTAMP(6)),2)`, breakID, f.attemptID, f.rw.sectionID, breakState, breakState, breakState)
			mustExec(t, f.db, `INSERT INTO assessment_form_responses (attempt_id,form_key,answers,revision,first_submitted_at,updated_at) VALUES (?,'math_entry','{"already":"accepted"}',1,UTC_TIMESTAMP(6),UTC_TIMESTAMP(6))`, f.attemptID)
			options, err := svc.RecoveryOptions(ctx, f.scheduleID, f.attemptID)
			if err != nil {
				t.Fatal(err)
			}
			seconds := 300
			issue, err := svc.IssueDeviceRecovery(ctx, f.scheduleID, f.attemptID, staff, delivery.IssueDeviceRecoveryRequest{OperationID: uuid.NewString(), ExpectedLeaseEpoch: options.LeaseEpoch, ExpectedControlEpoch: options.ControlEpoch, Target: examdomain.RecoveryTarget{SectionKey: "reading-writing", ModuleID: f.rw.baseID, ModuleAttemptID: target}, RemainingSeconds: &seconds})
			if err != nil {
				t.Fatal(err)
			}
			proof := "break-browser-" + uuid.NewString()
			if _, err := svc.ClaimDeviceRecovery(ctx, issue.Grant.GrantID, delivery.ClaimDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof, LinkSecret: issue.LinkSecret, Code: issue.Code}); err != nil {
				t.Fatal(err)
			}
			if _, _, err := svc.BeginDeviceRecovery(ctx, issue.Grant.GrantID, delivery.BeginDeviceRecoveryRequest{OperationID: uuid.NewString(), BrowserProof: proof}, nil, nil); err != nil {
				t.Fatal(err)
			}
			var paused sql.NullTime
			if err := f.db.QueryRow(`SELECT paused_at FROM assessment_attempt_breaks WHERE id=?`, breakID).Scan(&paused); err != nil || !paused.Valid {
				t.Fatalf("break did not freeze: %v %v", paused, err)
			}
			// Ordinary room synchronization must not release a recovery suspension.
			if err := tx.NewRunner(f.db).WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
				return examruntime.SyncSATPauseInTx(ctx, q, f.scheduleID, f.attemptID)
			}); err != nil {
				t.Fatal(err)
			}
			if err := f.db.QueryRow(`SELECT paused_at FROM assessment_attempt_breaks WHERE id=?`, breakID).Scan(&paused); err != nil || !paused.Valid {
				t.Fatalf("ordinary resume released break: %v %v", paused, err)
			}
			// Simulate 20 seconds spent recovering without waiting on wall time.
			mustExec(t, f.db, `UPDATE assessment_attempt_breaks SET paused_at=DATE_SUB(paused_at,INTERVAL 20 SECOND) WHERE id=?`, breakID)
			mustExec(t, f.db, `UPDATE assessment_module_attempts SET paused_at=DATE_SUB(paused_at,INTERVAL 20 SECOND) WHERE id=?`, nextID)
			mustExec(t, f.db, `UPDATE assessment_module_attempts SET started_at=DATE_SUB(UTC_TIMESTAMP(6),INTERVAL 400 SECOND) WHERE id=?`, target)
			if _, err := svc.ReconcileAttemptTimeout(ctx, f.scheduleID, f.attemptID, time.Now().UTC()); err != nil {
				t.Fatal(err)
			}
			var state string
			var generation, count, offerRemaining int
			if err := f.db.QueryRow(`SELECT state,entry_generation,paused_at,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(6),CASE WHEN state='active' THEN deadline_at ELSE entry_starts_at END) FROM assessment_attempt_breaks WHERE id=?`, breakID).Scan(&state, &generation, &paused, &offerRemaining); err != nil {
				t.Fatal(err)
			}
			if state != breakState || generation != 2 || paused.Valid || offerRemaining < 108 || offerRemaining > 111 {
				t.Fatalf("break state=%s generation=%d paused=%v remaining=%d", state, generation, paused, offerRemaining)
			}
			if err := f.db.QueryRow(`SELECT entry_generation,TIMESTAMPDIFF(SECOND,UTC_TIMESTAMP(6),auto_start_at) FROM assessment_module_attempts WHERE id=?`, nextID).Scan(&generation, &offerRemaining); err != nil {
				t.Fatal(err)
			}
			if generation != 3 || offerRemaining < 108 || offerRemaining > 111 {
				t.Fatalf("module offer generation=%d remaining=%d", generation, offerRemaining)
			}
			if err := f.db.QueryRow(`SELECT COUNT(*) FROM assessment_attempt_breaks WHERE attempt_id=?`, f.attemptID).Scan(&count); err != nil || count != 1 {
				t.Fatalf("breaks=%d err=%v", count, err)
			}
			if err := f.db.QueryRow(`SELECT COUNT(*) FROM assessment_form_responses WHERE attempt_id=? AND form_key='math_entry' AND JSON_UNQUOTE(JSON_EXTRACT(answers,'$.already'))='accepted'`, f.attemptID).Scan(&count); err != nil || count != 1 {
				t.Fatalf("form was changed: count=%d err=%v", count, err)
			}
		})
	}
}

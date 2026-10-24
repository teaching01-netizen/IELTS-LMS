package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/terminalization"
)

type satV2CompletionFixture struct {
	db             *sql.DB
	scheduleID     string
	attemptID      string
	highModuleID   string
	bearer         string
	submitter      *attempts.Service
	sealer         terminalSealer
	responseCount  int
	expectedDigest string
}

func newSATV2CompletionFixture(t *testing.T) satV2CompletionFixture {
	t.Helper()
	db := staleETagTestDB(t)
	ctx := context.Background()
	userID, sessionID, tokenID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	if _, err := db.ExecContext(ctx,
		"INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, 'SAT Candidate', 'student', 'active')",
		userID, "sat-v2-"+userID+"@example.test"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _, _ = db.ExecContext(context.Background(), "DELETE FROM users WHERE id = ?", userID) })
	scheduleID, attemptID, baseID, _, highID := seedStaleETagExam(t, db)
	linkID := uuid.NewString()
	if _, err := db.ExecContext(ctx, `INSERT INTO assessment_access_links (
		id, exam_id, published_version_id, schedule_id, name, audience_type,
		access_mode, availability_type, created_by, enabled_sections
	) SELECT ?, exam_id, published_version_id, id, 'RW only', 'anyone',
		'open', 'anytime', created_by, '["reading-writing"]'
		FROM exam_schedules WHERE id = ?`, linkID, scheduleID); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, _ = db.ExecContext(context.Background(), "DELETE FROM assessment_access_links WHERE id = ?", linkID)
	})
	now := time.Now().UTC()
	if _, err := db.ExecContext(ctx, `UPDATE assessment_module_attempts
		SET state = 'submitted', submitted_at = ?, revision = revision + 1
		WHERE attempt_id = ? AND module_id = ?`, now, attemptID, baseID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO assessment_module_attempts (
		id, attempt_id, module_id, state, allocated_seconds, started_at, submitted_at, tool_state, revision
	) VALUES (?, ?, ?, 'submitted', 3600, ?, ?, '{}', 1)`,
		uuid.NewString(), attemptID, highID, now.Add(-time.Minute), now); err != nil {
		t.Fatal(err)
	}
	// The completion gate admits a Module 2 only with the decision that chose it.
	if _, err := db.ExecContext(ctx, `INSERT INTO assessment_route_decisions (
		id, attempt_id, section_id, base_module_attempt_id, base_module_id, selected_module_id, selected_route,
		raw_correct, operational_question_count, policy_key, policy_revision, policy_config, route_basis
	) SELECT ?, ma.attempt_id, m.section_id, ma.id, ma.module_id, ?, 'higher', 3, 3, 'sat_threshold', 1, '{"threshold":2}', 'window_closed'
		FROM assessment_module_attempts ma JOIN assessment_modules m ON m.id = ma.module_id
		WHERE ma.attempt_id = ? AND ma.module_id = ?`, uuid.NewString(), highID, attemptID, baseID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx,
		"UPDATE student_attempts SET user_id = ?, active_client_session_id = ? WHERE id = ?",
		userID, sessionID, attemptID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, `INSERT INTO attempt_sessions (
		id, user_id, schedule_id, attempt_id, client_session_id, token_id, expires_at
	) VALUES (?, ?, ?, ?, ?, ?, ?)`, uuid.NewString(), userID, scheduleID, attemptID,
		sessionID, tokenID, now.Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	lease := uint64(1)
	bearer, err := crypto.SignAttemptToken([]byte(submitTestSecret), crypto.AttemptClaims{
		TokenID: tokenID, UserID: userID, ScheduleID: scheduleID, AttemptID: attemptID,
		ClientSessionID: sessionID, LeaseEpoch: &lease, Exp: now.Add(30 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}
	runner := tx.NewRunner(db)
	readTx, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		t.Fatal(err)
	}
	expectedDigest, err := attempts.ComputeDigestInTx(ctx, readTx, attemptID)
	_ = readTx.Rollback()
	if err != nil {
		t.Fatal(err)
	}
	var responseCount int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ?", attemptID).Scan(&responseCount); err != nil {
		t.Fatal(err)
	}
	return satV2CompletionFixture{
		db: db, scheduleID: scheduleID, attemptID: attemptID, highModuleID: highID, bearer: bearer,
		responseCount: responseCount, expectedDigest: expectedDigest,
		submitter: attempts.NewService(runner, clock.System{}, []byte(submitTestSecret)),
		sealer: terminalSealer{
			materializer: terminalization.NewService(runner, nil, nil), outboxExecOnly: true,
		},
	}
}

func (f satV2CompletionFixture) expireLastModule(t *testing.T) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(), `UPDATE assessment_module_attempts
		SET state = 'active', submitted_at = NULL, started_at = UTC_TIMESTAMP(6) - INTERVAL 2 HOUR
		WHERE attempt_id = ? AND module_id = ?`, f.attemptID, f.highModuleID); err != nil {
		t.Fatal(err)
	}
}

func (f satV2CompletionFixture) submit(ctx context.Context) error {
	_, err := f.submitter.Submit(ctx, f.bearer, attempts.SubmitCommand{
		AttemptID: f.attemptID, LeaseEpoch: 1, SubmissionID: uuid.NewString(),
	}, nil, v2Locker{}, v2ProviderResolver{}, f.sealer)
	return err
}

func (f satV2CompletionFixture) assertSealedWithoutScore(t *testing.T) {
	t.Helper()
	var terminalCount, resultCount, sectionCount, answerCount, policyCount int
	var submittedAt sql.NullTime
	var digest sql.NullString
	var score sql.NullInt64
	var answerRevision, responseRevision int64
	var finalSubmission []byte
	err := f.db.QueryRow(`SELECT submitted_at, final_response_digest, answer_revision, response_revision, final_submission FROM student_attempts WHERE id = ?`, f.attemptID).
		Scan(&submittedAt, &digest, &answerRevision, &responseRevision, &finalSubmission)
	if err != nil {
		t.Fatal(err)
	}
	for _, item := range []struct {
		query string
		out   *int
	}{
		{"SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?", &terminalCount},
		{"SELECT COUNT(*) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", &resultCount},
		{"SELECT COUNT(*) FROM assessment_section_results WHERE assessment_result_id IN (SELECT id FROM assessment_results WHERE attempt_id = ?)", &sectionCount},
		{"SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ?", &answerCount},
		{"SELECT COUNT(*) FROM assessment_scoring_policies WHERE exam_version_id = (SELECT published_version_id FROM student_attempts WHERE id = ?)", &policyCount},
	} {
		if err := f.db.QueryRow(item.query, f.attemptID).Scan(item.out); err != nil {
			t.Fatal(err)
		}
	}
	if err := f.db.QueryRow("SELECT total_score FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", f.attemptID).Scan(&score); err != nil {
		t.Fatal(err)
	}
	if !submittedAt.Valid || terminalCount != 1 || resultCount != 1 || sectionCount != 0 || answerCount != f.responseCount || answerCount == 0 || policyCount != 0 || score.Valid || !digest.Valid || answerRevision != 0 || responseRevision != 7 || len(finalSubmission) == 0 {
		t.Fatalf("SAT must seal once without policy or scaled scores: submitted=%v terminal=%d results=%d sections=%d answers=%d policies=%d score=%v digest=%v",
			submittedAt, terminalCount, resultCount, sectionCount, answerCount, policyCount, score, digest)
	}
	if digest.String != f.expectedDigest {
		t.Fatalf("final digest = %q, want pre-submit digest %q", digest.String, f.expectedDigest)
	}
	var digestFromRows string
	if err := f.db.QueryRow(`SELECT final_response_digest FROM attempt_submissions_v2 WHERE attempt_id = ?`, f.attemptID).Scan(&digestFromRows); err == nil && digest.String != digestFromRows {
		t.Fatalf("attempt digest %q differs from V2 receipt %q", digest.String, digestFromRows)
	} else if err != nil && err != sql.ErrNoRows {
		t.Fatal(err)
	}
}

func TestSATV2SubmitWithoutScoringPolicySealsWithProductionSealer(t *testing.T) {
	f := newSATV2CompletionFixture(t)
	if err := f.submit(context.Background()); err != nil {
		t.Fatal(err)
	}
	f.assertSealedWithoutScore(t)
}

func TestSATBlockedFinalRecoveryBoundaryBlocksCleanCompletionAndPreservesAuthorizedRoomEndMySQL(t *testing.T) {
	f := newSATV2CompletionFixture(t)
	ctx := context.Background()
	var moduleAttemptID string
	if err := f.db.QueryRowContext(ctx, `SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`, f.attemptID, f.highModuleID).Scan(&moduleAttemptID); err != nil {
		t.Fatal(err)
	}
	// Model the final module at the recovery cutoff: its timer ended, its
	// boundary is blocked, and no authorized answer settlement occurred.
	if _, err := f.db.ExecContext(ctx, `UPDATE assessment_module_attempts
		SET state = 'active', submitted_at = NULL, started_at = UTC_TIMESTAMP(6) - INTERVAL 2 HOUR
		WHERE id = ?`, moduleAttemptID); err != nil {
		t.Fatal(err)
	}
	policy := `{"version":"sat_recovery_v1","recoverySeconds":120,"entryRecoverySeconds":120,"lateAnswerPolicy":"frozen_arrival_window"}`
	if _, err := f.db.ExecContext(ctx, `UPDATE exam_schedules
		SET sat_timing_model = 'sat_personal_v1', sat_delivery_policy = CAST(? AS JSON)
		WHERE id = ?`, policy, f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.ExecContext(ctx, `UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id = ?`, f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.ExecContext(ctx, `INSERT INTO assessment_module_boundaries
		(module_attempt_id, attempt_id, phase, policy_version)
		VALUES (?, ?, 'blocked', 'sat_recovery_v1')`, moduleAttemptID, f.attemptID); err != nil {
		t.Fatal(err)
	}

	if err := f.submit(ctx); err == nil {
		t.Fatal("V2 submit completed an attempt with an unresolved final SAT boundary")
	} else if appErr, ok := apperrors.As(err); !ok || appErr.Code != apperrors.CodeConflict {
		t.Fatalf("V2 submit error = %v, want conflict from the unfinished-module gate", err)
	}
	var submissions, terminalizations int
	if err := f.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM attempt_submissions_v2 WHERE attempt_id = ?`, f.attemptID).Scan(&submissions); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?`, f.attemptID).Scan(&terminalizations); err != nil {
		t.Fatal(err)
	}
	if submissions != 0 || terminalizations != 0 {
		t.Fatalf("unresolved boundary created a clean completion receipt: submissions=%d terminalizations=%d", submissions, terminalizations)
	}

	seal := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil).ReconcileInTxAdapter()
	reconciler := delivery.NewService(f.db, tx.NewRunner(f.db)).SetSATTerminalizerInTx(seal)
	if _, err := reconciler.ReconcileAttemptTimeout(ctx, f.scheduleID, f.attemptID, time.Now().UTC()); err != nil {
		t.Fatalf("timeout reconciliation at blocked boundary: %v", err)
	}
	var moduleState, boundaryPhase string
	if err := f.db.QueryRowContext(ctx, `SELECT ma.state, b.phase
		FROM assessment_module_attempts ma JOIN assessment_module_boundaries b ON b.module_attempt_id = ma.id
		WHERE ma.id = ?`, moduleAttemptID).Scan(&moduleState, &boundaryPhase); err != nil {
		t.Fatal(err)
	}
	if moduleState != "active" || boundaryPhase != "blocked" {
		t.Fatalf("timeout reconciliation bypassed the unresolved boundary: module=%q boundary=%q", moduleState, boundaryPhase)
	}
	if err := f.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?`, f.attemptID).Scan(&terminalizations); err != nil {
		t.Fatal(err)
	}
	if terminalizations != 0 {
		t.Fatalf("timeout reconciliation terminalized a blocked attempt: %d receipts", terminalizations)
	}

	// A proctor may explicitly end the room. That must follow the existing
	// forced-auto-submit policy and leave the SAT result pending, rather than
	// turning an unresolved boundary into a clean scored completion.
	terminalizer := terminalization.NewService(tx.NewRunner(f.db), nil, nil)
	room := proctor.NewService(tx.NewRunner(f.db), f.db, terminalizer, nil, nil)
	actor := proctor.Actor{ID: "sat-room-end-admin", Role: proctor.RoleAdmin, CSRFVerified: true}
	if err := room.CompleteExam(ctx, actor, f.scheduleID, proctor.CompleteExamCommand{OperationID: uuid.NewString()}); err != nil {
		t.Fatalf("complete SAT room with an explicit staff action: %v", err)
	}
	if err := room.AutoSubmitScheduleAfterComplete(ctx, actor, f.scheduleID); err != nil {
		t.Fatalf("apply the authorized room-end policy: %v", err)
	}
	var outcome, reason, actorKind, releaseStatus string
	var finalSubmission []byte
	if err := f.db.QueryRowContext(ctx, `SELECT t.outcome, t.reason, t.actor_kind, a.final_submission
		FROM attempt_terminalizations t JOIN student_attempts a ON a.id = t.attempt_id
		WHERE t.attempt_id = ?`, f.attemptID).Scan(&outcome, &reason, &actorKind, &finalSubmission); err != nil {
		t.Fatal(err)
	}
	var projection map[string]any
	if err := json.Unmarshal(finalSubmission, &projection); err != nil {
		t.Fatalf("decode explicit room-end projection: %v", err)
	}
	if outcome != terminalization.OutcomeSubmitted || reason != terminalization.ReasonProctorComplete || actorKind != terminalization.ActorProctor ||
		projection["autoSubmission"] != true || projection["submissionPolicy"] != "forced_auto_submit" {
		t.Fatalf("room completion did not retain its explicit forced-submit policy: outcome=%q reason=%q actor=%q projection=%s", outcome, reason, actorKind, finalSubmission)
	}
	var resultStatus string
	var totalScore sql.NullInt64
	if err := f.db.QueryRowContext(ctx, `SELECT outcome_status, total_score, release_status
		FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'`, f.attemptID).Scan(&resultStatus, &totalScore, &releaseStatus); err != nil {
		t.Fatal(err)
	}
	if resultStatus != terminalization.SATPending || totalScore.Valid || releaseStatus != "pending" {
		t.Fatalf("room completion exposed a clean SAT result for a blocked boundary: status=%q score=%v release=%q", resultStatus, totalScore, releaseStatus)
	}
}

func TestSATV2SubmitAndTimeoutReconcileRaceWithProductionSealer(t *testing.T) {
	f := newSATV2CompletionFixture(t)
	f.expireLastModule(t)
	entered, release := make(chan struct{}), make(chan struct{})
	seal := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil).ReconcileInTxAdapter()
	reconciler := delivery.NewService(f.db, tx.NewRunner(f.db)).SetSATTerminalizerInTx(
		func(ctx context.Context, q tx.Tx, scheduleID, attemptID string) (bool, error) {
			close(entered) // final module is locked, before the terminal receipt is written
			select {
			case <-release:
			case <-ctx.Done():
				return false, ctx.Err()
			}
			return seal(ctx, q, scheduleID, attemptID)
		})
	clientDone, timeoutDone := make(chan error, 1), make(chan error, 1)
	go func() {
		_, err := reconciler.ReconcileAttemptTimeout(context.Background(), f.scheduleID, f.attemptID, time.Now().UTC())
		timeoutDone <- err
	}()
	select {
	case <-entered:
	case <-time.After(20 * time.Second):
		t.Fatal("timeout did not finalize the last module")
	}
	go func() { clientDone <- f.submit(context.Background()) }()
	close(release)
	select {
	case err := <-clientDone:
		if err != nil {
			appErr, ok := apperrors.As(err)
			if !ok || appErr.Code != apperrors.CodeAttemptNotWritable {
				t.Fatalf("client submit failed for a reason other than timeout winning: %v", err)
			}
		}
	case <-time.After(20 * time.Second):
		t.Fatal("client submit did not finish")
	}
	select {
	case err := <-timeoutDone:
		if err != nil {
			t.Fatalf("timeout reconciliation failed: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("timeout reconciliation did not finish")
	}
	f.assertSealedWithoutScore(t)
	var state string
	if err := f.db.QueryRow("SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", f.attemptID, f.highModuleID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if state != "locked" {
		t.Fatalf("final module state = %q, want locked", state)
	}
}

func TestSATTimeoutSealFailureRollsBackFinalModule(t *testing.T) {
	f := newSATV2CompletionFixture(t)
	f.expireLastModule(t)
	seal := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil).ReconcileInTxAdapter()
	injected := errors.New("fail after sealing, before commit")
	reconciler := delivery.NewService(f.db, tx.NewRunner(f.db)).SetSATTerminalizerInTx(
		func(ctx context.Context, q tx.Tx, scheduleID, attemptID string) (bool, error) {
			if _, err := seal(ctx, q, scheduleID, attemptID); err != nil {
				return false, err
			}
			return false, injected
		})
	if _, err := reconciler.ReconcileAttemptTimeout(context.Background(), f.scheduleID, f.attemptID, time.Now().UTC()); !errors.Is(err, injected) {
		t.Fatalf("reconciliation error = %v, want injected failure", err)
	}
	var state string
	var submittedAt sql.NullTime
	var receipts, results int
	if err := f.db.QueryRow("SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", f.attemptID, f.highModuleID).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow("SELECT submitted_at FROM student_attempts WHERE id = ?", f.attemptID).Scan(&submittedAt); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow("SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?", f.attemptID).Scan(&receipts); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRow("SELECT COUNT(*) FROM assessment_results WHERE attempt_id = ?", f.attemptID).Scan(&results); err != nil {
		t.Fatal(err)
	}
	if state != "active" || submittedAt.Valid || receipts != 0 || results != 0 {
		t.Fatalf("failed seal committed partial completion: state=%q submitted=%v receipts=%d results=%d", state, submittedAt, receipts, results)
	}
	reconciler.SetSATTerminalizerInTx(seal)
	if changed, err := reconciler.ReconcileAttemptTimeout(context.Background(), f.scheduleID, f.attemptID, time.Now().UTC()); err != nil || !changed {
		t.Fatalf("retry must finalize and seal the attempt: changed=%v err=%v", changed, err)
	}
	f.assertSealedWithoutScore(t)
}

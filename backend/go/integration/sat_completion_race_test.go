package integration

import (
	"context"
	"database/sql"
	"encoding/json"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/crypto"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/terminalization"
)

const satRaceTokenSecret = "integration-sat-submit-secret-32bytes"

// seedTerminalModules makes a real full SAT topology while retaining the
// responses seedStudent already wrote to the V2 durability tables.
func (f *adaptiveExam) seedTerminalModules(attemptID string) {
	f.t.Helper()
	ctx := context.Background()
	now := time.Now().UTC()
	if _, err := f.db.ExecContext(ctx,
		`UPDATE assessment_module_attempts SET state = 'submitted', submitted_at = ?, revision = revision + 1 WHERE attempt_id = ? AND module_id = ?`,
		now, attemptID, f.rw.baseID); err != nil {
		f.t.Fatalf("submit reading-writing module 1: %v", err)
	}
	modules := []struct{ id, moduleID string }{
		{uuid.NewString(), f.rw.lowID},
		{uuid.NewString(), f.math.baseID},
		{uuid.NewString(), f.math.lowID},
	}
	for _, mod := range modules {
		if _, err := f.db.ExecContext(ctx, `
			INSERT INTO assessment_module_attempts (
				id, attempt_id, module_id, state, allocated_seconds, started_at,
				submitted_at, tool_state, revision
			) VALUES (?, ?, ?, 'submitted', 3600, ?, ?, '{}', 1)`,
			mod.id, attemptID, mod.moduleID, now.Add(-time.Minute), now); err != nil {
			f.t.Fatalf("seed terminal SAT module %s: %v", mod.moduleID, err)
		}
	}
}

func TestSATCompletionDoesNotRequireScoringPolicy(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 2, false)
	f.seedTerminalModules(attemptID)

	var policyCount int
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM assessment_scoring_policies WHERE exam_version_id = ?`, f.versionID).Scan(&policyCount); err != nil {
		t.Fatal(err)
	}
	if policyCount != 0 {
		t.Fatalf("fixture unexpectedly has %d scoring policies", policyCount)
	}

	completion := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil)
	result, err := completion.CompleteAssessment(context.Background(), sat.CompleteRequest{
		AttemptID: attemptID, ScheduleID: f.scheduleID, SubmissionID: attemptID, ActorKind: "student",
	})
	if err != nil {
		t.Fatalf("SAT completion must not depend on a scoring policy: %v", err)
	}
	if result == nil || result.OutcomeStatus != terminalization.SATPending || result.TotalScore != nil || len(result.Sections) != 0 {
		t.Fatalf("completion must materialize a pending unscored result, got %+v", result)
	}

	var terminalCount, resultCount, sectionCount, responseCount int
	var submittedAt sql.NullTime
	var answerRevision, responseRevision int64
	var finalSubmission, answers []byte
	var totalScore sql.NullInt64
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?`, attemptID).Scan(&terminalCount); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT submitted_at, answer_revision, response_revision, final_submission, answers FROM student_attempts WHERE id = ?`, attemptID).
		Scan(&submittedAt, &answerRevision, &responseRevision, &finalSubmission, &answers); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*), MAX(total_score) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'`, attemptID).
		Scan(&resultCount, &totalScore); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM assessment_section_results sr JOIN assessment_results ar ON ar.id = sr.assessment_result_id WHERE ar.attempt_id = ?`, attemptID).
		Scan(&sectionCount); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ?`, attemptID).Scan(&responseCount); err != nil {
		t.Fatal(err)
	}
	if terminalCount != 1 || !submittedAt.Valid {
		t.Fatalf("completion must set submitted_at and create one terminal fact; count=%d submitted_at=%v", terminalCount, submittedAt)
	}
	if resultCount != 1 || totalScore.Valid || sectionCount != 0 {
		t.Fatalf("completion must create one unscored SAT result without scaled sections; results=%d total=%v sections=%d", resultCount, totalScore, sectionCount)
	}
	if answerRevision != 0 || responseRevision != 7 || responseCount != 3 || len(answers) == 0 || string(answers) == "{}" || len(finalSubmission) == 0 {
		t.Fatalf("terminalization must retain durable answers and revisions; answer_revision=%d response_revision=%d response_rows=%d answers=%s", answerRevision, responseRevision, responseCount, answers)
	}
}

type integrationSATProviderResolver struct{}

func (integrationSATProviderResolver) ResolveProvider(ctx context.Context, q tx.Tx, attemptID string) (attempts.Provider, error) {
	var providerKey, examType string
	if err := q.QueryRowContext(ctx,
		`SELECT e.provider_key, e.exam_type FROM student_attempts a JOIN exam_entities e ON e.id = a.exam_id WHERE a.id = ?`, attemptID).
		Scan(&providerKey, &examType); err != nil {
		return "", err
	}
	switch exams.EffectiveProviderKey(providerKey, examType) {
	case "sat":
		return attempts.ProviderSAT, nil
	case "act":
		return attempts.ProviderACT, nil
	default:
		return attempts.ProviderIELTS, nil
	}
}

type integrationRuntimeLocker struct {
	entered chan<- struct{}
	release <-chan struct{}
}

func (l integrationRuntimeLocker) Lock(ctx context.Context, q tx.Tx, _ string) (attempts.RuntimeGate, error) {
	if l.entered != nil {
		l.entered <- struct{}{}
	}
	if l.release != nil {
		select {
		case <-ctx.Done():
			return attempts.RuntimeGate{}, ctx.Err()
		case <-l.release:
		}
	}
	var now time.Time
	if err := q.QueryRowContext(ctx, `SELECT UTC_TIMESTAMP(6)`).Scan(&now); err != nil {
		return attempts.RuntimeGate{}, err
	}
	return attempts.RuntimeGate{Status: "live", ActiveSectionKey: "*", SectionLive: true, SectionStarted: true, Now: now.UTC()}, nil
}

type integrationSATSealer struct{ terminalizer *terminalization.Service }

func (s integrationSATSealer) SealSubmitted(ctx context.Context, q tx.Tx, attemptID, scheduleID, submissionID, digest, _ string, actorID string, effectiveAt time.Time) error {
	projection, err := json.Marshal(map[string]any{
		"submissionId": submissionID, "providerKey": "sat", "digest": digest,
	})
	if err != nil {
		return err
	}
	actor := actorID
	_, err = s.terminalizer.TerminalizeInTx(ctx, q, terminalization.SealCommand{
		AttemptID: attemptID, ScheduleID: scheduleID,
		Outcome: terminalization.OutcomeSubmitted, Reason: terminalization.ReasonStudentSubmit,
		ActorKind: terminalization.ActorStudent, ActorID: &actor,
		EffectiveAt: &effectiveAt, FinalSubmission: projection, RequestID: submissionID,
	})
	return err
}

func TestConcurrentSATClientSubmitAndTimeoutReconcileSealOnce(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 1, false)
	f.seedTerminalModules(attemptID)

	ctx := context.Background()
	userID, sessionID, tokenID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	if _, err := f.db.ExecContext(ctx, `INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, 'SAT Candidate', 'student', 'active')`,
		userID, "sat-race-"+uuid.NewString()+"@example.test"); err != nil {
		t.Fatalf("seed SAT submit user: %v", err)
	}
	if _, err := f.db.ExecContext(ctx, `UPDATE student_attempts SET user_id = ?, active_client_session_id = ? WHERE id = ?`,
		userID, sessionID, attemptID); err != nil {
		t.Fatalf("bind SAT submit session to attempt: %v", err)
	}
	if _, err := f.db.ExecContext(ctx, `INSERT INTO attempt_sessions (
		id, user_id, schedule_id, attempt_id, client_session_id, token_id, expires_at
	) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		uuid.NewString(), userID, f.scheduleID, attemptID, sessionID, tokenID, time.Now().UTC().Add(time.Hour)); err != nil {
		t.Fatalf("seed SAT attempt session: %v", err)
	}
	t.Cleanup(func() {
		if _, err := f.db.ExecContext(context.Background(), `DELETE FROM users WHERE id = ?`, userID); err != nil {
			t.Logf("cleanup SAT submit user: %v", err)
		}
	})

	var hashes map[string]string
	hashes = map[string]string{}
	rows, err := f.db.QueryContext(ctx, `SELECT question_id, response_hash FROM attempt_responses_v2 WHERE attempt_id = ?`, attemptID)
	if err != nil {
		t.Fatal(err)
	}
	for rows.Next() {
		var questionID, hash string
		if err := rows.Scan(&questionID, &hash); err != nil {
			rows.Close()
			t.Fatal(err)
		}
		hashes[questionID] = hash
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		t.Fatal(err)
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	expectedDigest, err := attempts.FinalDigest(hashes)
	if err != nil {
		t.Fatal(err)
	}
	var beforeAnswerRevision, beforeResponseRevision int64
	if err := f.db.QueryRowContext(ctx,
		`SELECT answer_revision, response_revision FROM student_attempts WHERE id = ?`, attemptID).
		Scan(&beforeAnswerRevision, &beforeResponseRevision); err != nil {
		t.Fatal(err)
	}

	terminalizer := terminalization.NewService(tx.NewRunner(f.db), nil, nil)
	submitService := attempts.NewService(tx.NewRunner(f.db), clock.System{}, []byte(satRaceTokenSecret))
	lease := uint64(1)
	token, err := crypto.SignAttemptToken([]byte(satRaceTokenSecret), crypto.AttemptClaims{
		TokenID: tokenID, UserID: userID, ScheduleID: f.scheduleID,
		AttemptID: attemptID, ClientSessionID: sessionID, LeaseEpoch: &lease,
		Exp: time.Now().Add(30 * time.Minute).Unix(),
	})
	if err != nil {
		t.Fatal(err)
	}

	entered, release := make(chan struct{}, 1), make(chan struct{})
	submitDone := make(chan error, 1)
	go func() {
		_, submitErr := submitService.Submit(ctx, token, attempts.SubmitCommand{
			AttemptID: attemptID, LeaseEpoch: lease, SubmissionID: uuid.NewString(),
		}, nil, integrationRuntimeLocker{entered: entered, release: release}, integrationSATProviderResolver{}, integrationSATSealer{terminalizer})
		submitDone <- submitErr
	}()
	select {
	case <-entered:
	case <-time.After(10 * time.Second):
		t.Fatal("client submit did not reach its runtime gate")
	}

	reconcileDone := make(chan error, 1)
	reconcileReady := make(chan struct{})
	go func() {
		reconciler := delivery.NewService(f.db, tx.NewRunner(f.db)).SetCompleter(sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, nil).ReconcileAdapter())
		close(reconcileReady)
		_, reconcileErr := reconciler.ReconcileAttemptTimeout(ctx, f.scheduleID, attemptID, time.Now().UTC())
		reconcileDone <- reconcileErr
	}()
	// The handshake starts the real reconciler while submit still holds the
	// attempt row lock, without relying on a scheduling delay.
	select {
	case <-reconcileReady:
	case <-time.After(10 * time.Second):
		t.Fatal("timeout reconciliation did not start")
	}
	close(release)

	select {
	case err := <-submitDone:
		if err != nil {
			t.Fatalf("client submit lost the terminalization race: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("client submit did not complete")
	}
	select {
	case err := <-reconcileDone:
		if err != nil {
			t.Fatalf("timeout reconcile did not converge on the submitted attempt: %v", err)
		}
	case <-time.After(20 * time.Second):
		t.Fatal("timeout reconcile did not complete")
	}

	var terminalCount, resultCount, responseCount int
	var totalScore sql.NullInt64
	var answerRevision, responseRevision int64
	var digest sql.NullString
	if err := f.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?`, attemptID).Scan(&terminalCount); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(ctx,
		`SELECT COUNT(*), MAX(total_score) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'`, attemptID).
		Scan(&resultCount, &totalScore); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(ctx,
		`SELECT answer_revision, response_revision, final_response_digest FROM student_attempts WHERE id = ?`, attemptID).
		Scan(&answerRevision, &responseRevision, &digest); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM attempt_responses_v2 WHERE attempt_id = ?`, attemptID).Scan(&responseCount); err != nil {
		t.Fatal(err)
	}
	if terminalCount != 1 || resultCount != 1 || totalScore.Valid {
		t.Fatalf("racing completion must create one terminal fact and one unscored result; terminal=%d result=%d score=%v", terminalCount, resultCount, totalScore)
	}
	if answerRevision != beforeAnswerRevision || responseRevision != beforeResponseRevision || responseCount != len(hashes) || !digest.Valid || digest.String != expectedDigest {
		t.Fatalf("race changed durable answers/revisions or stored the wrong digest; answer_revision %d→%d response_revision %d→%d responses=%d/%d digest=%q want=%q",
			beforeAnswerRevision, answerRevision, beforeResponseRevision, responseRevision, responseCount, len(hashes), digest.String, expectedDigest)
	}
	var finalSubmission, answers []byte
	if err := f.db.QueryRowContext(ctx, `SELECT final_submission, answers FROM student_attempts WHERE id = ?`, attemptID).
		Scan(&finalSubmission, &answers); err != nil {
		t.Fatal(err)
	}
	var submissionMap map[string]any
	if err := json.Unmarshal(finalSubmission, &submissionMap); err != nil {
		t.Fatalf("final submission must preserve its answer projection: %v", err)
	}
	if len(answers) == 0 || string(answers) == "{}" || submissionMap["answers"] == nil {
		t.Fatalf("answers must remain intact through the race; answers=%s final_submission=%s", answers, finalSubmission)
	}
}

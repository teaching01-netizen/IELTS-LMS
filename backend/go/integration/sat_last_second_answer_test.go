package integration

// Last-second answer, route correctness, and the save/close race (real MySQL;
// skips without TEST_MYSQL_DSN like the rest of this package).
//
// The reported hazard was that a module's score could move after its adaptive
// route had been decided, so the branch a candidate was sent to could disagree
// with the answers that earned it. The delivery reconciler closes a module past
// deadline + attempts.SATSaveGrace; the single-response save gate ends at that
// same instant (see internal/delivery/save_gate_boundary_test.go).
//
// These tests assert the property that survives any interleaving rather than a
// particular winner: for every finalized base module, the recorded route must
// equal the route the recorded score implies. The writes use the legacy
// assessment_question_responses path (the one the audited gate belongs to), so
// each raced question has its attempt_responses_v2 row removed first — the
// scorer prefers V2 and would otherwise ignore the legacy write.

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// moduleAttemptState reads the base module row the reconciler finalizes.
func (f *adaptiveExam) moduleAttemptState(t *testing.T, attemptID, moduleID string) (state string, rawCorrect sql.NullInt64) {
	t.Helper()
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT state, raw_correct FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`,
		attemptID, moduleID).Scan(&state, &rawCorrect); err != nil {
		t.Fatalf("read module attempt %s: %v", moduleID, err)
	}
	return state, rawCorrect
}

// backdateModuleStartedAt moves a module's clock so its window (and the save
// grace) have already elapsed while the row keeps its state. The worker has not
// run, which is exactly the "worker behind" case.
func (f *adaptiveExam) backdateModuleStartedAt(t *testing.T, attemptID, moduleID string, elapsed time.Duration) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(),
		`UPDATE assessment_module_attempts SET started_at = UTC_TIMESTAMP(6) - INTERVAL ? SECOND WHERE attempt_id = ? AND module_id = ?`,
		int(elapsed.Seconds()), attemptID, moduleID); err != nil {
		t.Fatalf("backdate module %s: %v", moduleID, err)
	}
}

// dropV2Response removes the V2 row for one question so the legacy write below
// is the row the scorer reads.
func (f *adaptiveExam) dropV2Response(t *testing.T, attemptID, examQuestionID string) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(),
		`DELETE FROM attempt_responses_v2 WHERE attempt_id = ? AND question_id = ?`,
		attemptID, examQuestionID); err != nil {
		t.Fatalf("drop V2 response: %v", err)
	}
}

// writerSessionFor derives the writer binding a real bearer carries. The ids are
// attempt-scoped so parallel tests never collide on the session/token indexes.
func writerSessionFor(attemptID string) (clientSessionID, tokenID string) {
	suffix := attemptID
	if len(suffix) > 8 {
		suffix = suffix[:8]
	}
	return "sess-" + suffix, "tok-" + suffix
}

// openWriterSession seeds the durable attempt_sessions row the in-tx writer
// claim re-checks (a mutation without it fails closed as an invalid credential),
// and hands the attempt to that session.
func (f *adaptiveExam) openWriterSession(t *testing.T, attemptID string) {
	t.Helper()
	ctx := context.Background()
	clientSessionID, tokenID := writerSessionFor(attemptID)
	if _, err := f.db.ExecContext(ctx,
		`INSERT INTO attempt_sessions (
			id, user_id, schedule_id, attempt_id, client_session_id, token_id,
			device_fingerprint_hash, issued_at, last_seen_at, expires_at
		) VALUES (?, '', ?, ?, ?, ?, NULL, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6), UTC_TIMESTAMP(6) + INTERVAL 1 HOUR)`,
		uuid.NewString(), f.scheduleID, attemptID, clientSessionID, tokenID); err != nil {
		t.Fatalf("seed attempt session: %v", err)
	}
	if _, err := f.db.ExecContext(ctx,
		`UPDATE student_attempts SET active_client_session_id = ? WHERE id = ?`,
		clientSessionID, attemptID); err != nil {
		t.Fatalf("bind active client session: %v", err)
	}
}

// saveAnswer drives the same delivery write the student client's single-response
// path uses.
func (f *adaptiveExam) saveAnswer(t *testing.T, attemptID, examQuestionID, answer string) error {
	t.Helper()
	clientSessionID, tokenID := writerSessionFor(attemptID)
	writeID := uuid.NewString()
	// The wire contract is `response: string | null`, and the scorer reads the
	// legacy column as a bare JSON scalar (assessscore.SATResponseCorrect
	// unmarshals it into a string). An object here would store fine and score as
	// incorrect, silently, so the shape is part of the contract under test.
	req := delivery.SaveResponseRequest{
		Revision:          0,
		Response:          json.RawMessage(`"` + answer + `"`),
		EliminatedOptions: []string{},
		Annotations:       json.RawMessage(`{}`),
		ClientWriteID:     &writeID,
	}
	_, err := f.deliverySvc().SaveResponse(
		context.Background(), f.scheduleID, attemptID, f.scheduleID, examQuestionID, req, clientSessionID, tokenID)
	return err
}

// routeForScore mirrors the authored policy (minimumCorrectForHigher = 2 of 3).
func routeForScore(correct int) string {
	if correct >= 2 {
		return "higher"
	}
	return "lower"
}

// assertRouteMatchesStoredScore is the invariant every test below ends on: the
// branch the candidate was sent to must be the branch the stored score earned.
func (f *adaptiveExam) assertRouteMatchesStoredScore(t *testing.T, attemptID string, branch adaptiveBranch) (routeDecisionRow, int) {
	t.Helper()
	state, rawCorrect := f.moduleAttemptState(t, attemptID, branch.baseID)
	if state != "locked" {
		t.Fatalf("base module state = %q, want locked after finalization", state)
	}
	if !rawCorrect.Valid {
		t.Fatalf("a finalized base module must carry raw_correct (state %q)", state)
	}
	decision, ok := f.routeDecision(t, attemptID, branch.sectionID)
	if !ok {
		t.Fatal("a finalized base module must have a route decision")
	}
	if decision.baseModuleID != branch.baseID {
		t.Fatalf("decision base module = %q, want %q", decision.baseModuleID, branch.baseID)
	}
	if got, want := decision.selectedRoute, routeForScore(int(rawCorrect.Int64)); got != want {
		t.Fatalf("stored score %d implies route %q, but the decision says %q — the score and the branch disagree",
			rawCorrect.Int64, want, got)
	}
	return decision, int(rawCorrect.Int64)
}

// A save that lands before finalization is in the score and drives the route.
// Deterministic (no race): the answer is written while the module is still
// running, and the reconciler routes on it afterwards.
func TestSATSaveBeforeFinalizationCountsTowardTheRoute(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 1, false) // 1 of 3 correct: below threshold
	f.openWriterSession(t, attemptID)
	questions := f.examQuestionIDs(t, f.rw.baseID)
	if len(questions) < 2 {
		t.Fatalf("fixture needs >= 2 base questions, got %d", len(questions))
	}

	// The last-second answer arrives through the legacy single-response path.
	f.dropV2Response(t, attemptID, questions[1])
	if err := f.saveAnswer(t, attemptID, questions[1], "B"); err != nil {
		t.Fatalf("a save inside the running window must be admitted: %v", err)
	}

	f.expireBase(t, attemptID, f.rw.baseID)
	if !f.reconcile(t, attemptID) {
		t.Fatal("the expired Module 1 must be finalized by the reconciler")
	}
	decision, score := f.assertRouteMatchesStoredScore(t, attemptID, f.rw)
	if score != 2 {
		t.Fatalf("the accepted save must be in the score: raw_correct = %d, want 2", score)
	}
	if decision.selectedRoute != "higher" || decision.selectedModuleID != f.rw.highID {
		t.Fatalf("2 of 3 correct must route higher/HIGH, got %+v", decision)
	}
	if f.countModuleAttempts(t, attemptID, f.rw.lowID) != 0 {
		t.Fatal("the Lower branch must never gain an attempt")
	}
}

// A save after the module closed is refused with a typed conflict, never a
// crash or a silent score change.
func TestSATSaveAfterFinalizationIsRefused(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 3, true)
	f.openWriterSession(t, attemptID)
	questions := f.examQuestionIDs(t, f.rw.baseID)

	if !f.reconcile(t, attemptID) {
		t.Fatal("the expired Module 1 must be finalized")
	}
	_, before := f.assertRouteMatchesStoredScore(t, attemptID, f.rw)

	err := f.saveAnswer(t, attemptID, questions[0], "C")
	if err == nil {
		t.Fatal("a save after finalization must be refused")
	}
	appErr, ok := apperrors.As(err)
	if !ok {
		t.Fatalf("a refused save must be a typed error, got %T (%v)", err, err)
	}
	if appErr.HTTPStatus < 400 || appErr.HTTPStatus >= 500 {
		t.Fatalf("a refused save must be a client error, got %d (%v)", appErr.HTTPStatus, err)
	}
	reason, _ := appErr.Details["reason"].(string)
	if reason == "" {
		t.Fatalf("a refused save must name its reason, got %v", err)
	}
	// Whatever it answered, the score and the branch must still agree.
	_, after := f.assertRouteMatchesStoredScore(t, attemptID, f.rw)
	if after != before {
		t.Fatalf("a refused save must not move the score: %d -> %d", before, after)
	}
}

// A module whose window (plus the save grace) has elapsed is refused even while
// its row still reads active, i.e. before the worker has closed it.
func TestSATSavePastDeadlineAndGraceIsRefusedWhileTheWorkerIsBehind(t *testing.T) {
	f := newAdaptiveExam(t)
	// The production personal clock takes a distinct gate path from the legacy
	// fixture. Keep this test on that path so a skipped personal deadline check
	// cannot pass behind a legacy-only assertion.
	if _, err := f.db.ExecContext(context.Background(),
		"UPDATE exam_session_runtimes SET timing_model = 'sat_personal_v1' WHERE schedule_id = ?", f.scheduleID); err != nil {
		t.Fatalf("set personal timing: %v", err)
	}
	attemptID := f.seedStudent(f.rw, 0, false)
	f.openWriterSession(t, attemptID)
	questions := f.examQuestionIDs(t, f.rw.baseID)

	// The module is still active; only its clock has run past deadline + grace.
	f.backdateModuleStartedAt(t, attemptID, f.rw.baseID, 3600*time.Second+attempts.SATSaveGrace+time.Second)
	state, _ := f.moduleAttemptState(t, attemptID, f.rw.baseID)
	if state != "active" {
		t.Fatalf("fixture precondition: module must still read active, got %q", state)
	}

	err := f.saveAnswer(t, attemptID, questions[0], "B")
	if err == nil {
		t.Fatal("a save past deadline + grace must be refused even while the module row is still active")
	}
	appErr, ok := apperrors.As(err)
	if !ok || appErr.Details == nil {
		t.Fatalf("expected a typed deadline conflict, got %T (%v)", err, err)
	}
	if reason, _ := appErr.Details["reason"].(string); reason != "DEADLINE_EXPIRED" {
		t.Fatalf("reason = %q, want DEADLINE_EXPIRED (%v)", reason, err)
	}
	if state, _ := f.moduleAttemptState(t, attemptID, f.rw.baseID); state != "active" {
		t.Fatalf("the save gate, not the timeout worker, must refuse this write; state = %q", state)
	}
}

// Concurrent saves against timeout finalization. Whichever side wins the lock,
// the recorded route must equal the recorded score and no accepted answer may
// be missing from it — this is the property the earlier finding said could
// break.
func TestSATConcurrentSavesAndFinalizationKeepTheRouteConsistent(t *testing.T) {
	for iteration := 0; iteration < 20; iteration++ {
		t.Run(strconv.Itoa(iteration), testSATConcurrentSavesAndFinalization)
	}
}

func testSATConcurrentSavesAndFinalization(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 0, true) // 0 of 3 correct: everything is up for grabs
	f.openWriterSession(t, attemptID)
	questions := f.examQuestionIDs(t, f.rw.baseID)
	if len(questions) != 3 {
		t.Fatalf("fixture expects 3 base questions, got %d", len(questions))
	}
	// Distinct values make the acknowledgement audit catch a response copied to
	// the wrong question or silently rewritten during finalization.
	answers := []string{"B", "C", "B"}
	// All three answers arrive through the legacy path concurrently.
	for _, questionID := range questions {
		f.dropV2Response(t, attemptID, questionID)
	}

	var wg sync.WaitGroup
	errs := make([]error, len(questions))
	start := make(chan struct{})
	for i, questionID := range questions {
		wg.Add(1)
		go func(i int, questionID string) {
			defer wg.Done()
			<-start
			errs[i] = f.saveAnswer(t, attemptID, questionID, answers[i])
		}(i, questionID)
	}
	reconcileDone := make(chan error, 1)
	go func() {
		<-start
		_, err := f.deliverySvc().ReconcileAttemptTimeout(context.Background(), f.scheduleID, attemptID, time.Now().UTC())
		reconcileDone <- err
	}()
	close(start)
	wg.Wait()
	reconcileErr := <-reconcileDone

	for i, err := range errs {
		if err == nil {
			continue
		}
		// A loser must see a typed conflict, never a raw driver error.
		if _, ok := apperrors.As(err); !ok {
			t.Fatalf("save %d must fail typed, got %T (%v)", i, err, err)
		}
	}
	if reconcileErr != nil {
		if _, ok := apperrors.As(reconcileErr); !ok {
			t.Fatalf("reconcile must fail typed, got %T (%v)", reconcileErr, reconcileErr)
		}
		t.Logf("reconcile lost the CAS race as designed: %v", reconcileErr)
	}

	if got := f.countDecisions(t, attemptID); got != 1 {
		t.Fatalf("route decisions = %d, want exactly 1", got)
	}
	_, score := f.assertRouteMatchesStoredScore(t, attemptID, f.rw)

	// Each acknowledged write must exist with its exact answer. A score bound
	// cannot prove this: all three questions can score at most three even if an
	// acknowledged response disappears during the close.
	acknowledged := make(map[string]string, len(questions))
	correct := 0
	for i, err := range errs {
		if err != nil {
			continue
		}
		acknowledged[questions[i]] = answers[i]
		if answers[i] == "B" {
			correct++
		}
		var stored string
		if err := f.db.QueryRowContext(context.Background(), `
			SELECT CAST(r.response AS CHAR) FROM assessment_question_responses r
			JOIN assessment_module_attempts ma ON ma.id = r.module_attempt_id
			WHERE ma.attempt_id = ? AND ma.module_id = ? AND r.exam_question_id = ?`,
			attemptID, f.rw.baseID, questions[i]).Scan(&stored); err != nil {
			t.Fatalf("accepted answer %s missing after finalization: %v", questions[i], err)
		}
		if stored != `"`+acknowledged[questions[i]]+`"` {
			t.Fatalf("accepted answer %s changed after finalization: got %q, want %q", questions[i], stored, acknowledged[questions[i]])
		}
	}
	if score != correct {
		t.Fatalf("stored score = %d, want %d correct answers among acknowledged values %v", score, correct, acknowledged)
	}
	// Whichever branch the raced score earned, routing must have opened it — and
	// only it.
	lowAttempts := f.countModuleAttempts(t, attemptID, f.rw.lowID)
	highAttempts := f.countModuleAttempts(t, attemptID, f.rw.highID)
	if lowAttempts+highAttempts != 1 {
		t.Fatalf("routing must open exactly one branch: low=%d high=%d", lowAttempts, highAttempts)
	}
	route, _ := f.routeDecision(t, attemptID, f.rw.sectionID)
	if route.selectedModuleID != f.rw.highID && route.selectedModuleID != f.rw.lowID {
		t.Fatalf("decision must name an authored branch, got %q", route.selectedModuleID)
	}
	if f.countModuleAttempts(t, attemptID, route.selectedModuleID) != 1 {
		t.Fatalf("the decision must name the branch that was opened: %q", route.selectedModuleID)
	}
}

// A route decision must only ever be written once per base module, however many
// saves race it, and the branch it names must match selected_route.
func TestSATConcurrentSavesLeaveExactlyOneBranchOpen(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 3, true)
	f.openWriterSession(t, attemptID)
	questions := f.examQuestionIDs(t, f.rw.baseID)

	var wg sync.WaitGroup
	for _, questionID := range questions {
		f.dropV2Response(t, attemptID, questionID)
		wg.Add(1)
		go func(questionID string) {
			defer wg.Done()
			_ = f.saveAnswer(t, attemptID, questionID, "B")
		}(questionID)
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = f.deliverySvc().ReconcileAttemptTimeout(context.Background(), f.scheduleID, attemptID, time.Now().UTC())
	}()
	wg.Wait()

	decision, _ := f.assertRouteMatchesStoredScore(t, attemptID, f.rw)
	branches := f.branchAttempts(t, attemptID, f.rw)
	if len(branches) != 1 {
		t.Fatalf("branch attempts = %v, want exactly one", branches)
	}
	if _, ok := branches[decision.selectedModuleID]; !ok {
		t.Fatalf("the decision must name the branch that was opened: decision=%q branches=%v",
			decision.selectedModuleID, branches)
	}
	if decisions := f.countDecisions(t, attemptID); decisions != 1 {
		t.Fatalf("route decisions = %d, want exactly 1", decisions)
	}
}

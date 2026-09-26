package integration

// SAT adaptive-routing integrity suite (real MySQL; skips without
// TEST_MYSQL_DSN like the rest of this package).
//
// The chain under test, per student and section:
//
//	Module 1 score -> assessment_route_decisions(selected_route,
//	selected_module_id) -> exactly one branch module attempt ->
//	student bootstrap shows that branch -> proctor roster shows that
//	branch (higher_branch) -> final result carries that route.
//
// Every test below drives the REAL delivery reconciler
// (ReconcileAttemptTimeout, the path Module 1 normally ends through) and
// the REAL bootstrap / proctor / completion reads — no sqlmock. Fixture
// rows use fresh UUIDs and are deleted afterwards so the shared `ielts`
// database never accumulates state.
import (
	"context"
	"database/sql"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/clock"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/proctor"
	"example.com/ielts-proctoring/internal/sat"
	"example.com/ielts-proctoring/internal/terminalization"
)

type adaptiveBranch struct {
	sectionID string
	baseID    string
	lowID     string
	highID    string
}

type adaptiveExam struct {
	t          *testing.T
	db         *sql.DB
	owner      string
	examID     string
	versionID  string
	scheduleID string
	rw         adaptiveBranch
	math       adaptiveBranch
}

func newAdaptiveExam(t *testing.T) *adaptiveExam {
	t.Helper()
	db := testDB(t)
	ctx := context.Background()
	owner := "adaptive-" + uuid.NewString()
	examID := uuid.NewString()
	versionID := uuid.NewString()
	scheduleID := uuid.NewString()
	now := time.Now().UTC().Truncate(time.Second)

	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed adaptive exam: %v", err)
		}
	}

	exec(`INSERT INTO exam_entities (
		id, slug, title, provider_key, provider_exam_type, exam_type,
		status, visibility, organization_id, owner_id, schema_version, revision
	) VALUES (?, ?, 'SAT adaptive integration', 'sat', 'SAT', 'Academic',
		'published', 'organization', ?, ?, 1, 0)`,
		examID, examID, "adaptive-org", owner)
	exec(`INSERT INTO exam_versions (
		id, exam_id, version_number, content_snapshot, config_snapshot,
		created_by, is_published, revision
	) VALUES (?, ?, 1, '{}', '{}', ?, TRUE, 1)`,
		versionID, examID, owner)
	exec(`UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?`, versionID, examID)
	exec(`INSERT INTO exam_schedules (
		id, exam_id, provider_key, organization_id, exam_title, proctor_display_name,
		grading_display_name, published_version_id,
		cohort_name, institution, start_time, end_time, planned_duration_minutes,
		delivery_mode, status, created_by
	) VALUES (?, ?, 'sat', ?, 'SAT adaptive integration', 'SAT adaptive integration',
		'SAT adaptive integration', ?, 'adaptive', 'Codex', ?, ?, 120,
		'proctor_start', 'live', ?)`,
		scheduleID, examID, "adaptive-org", versionID,
		now.Add(-2*time.Hour), now.Add(2*time.Hour), owner)
	exec(`INSERT INTO exam_session_runtimes (
		id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model
	) VALUES (?, ?, ?, 'sat', 'live', '{}', 'legacy_section_v1')`,
		uuid.NewString(), scheduleID, examID)

	f := &adaptiveExam{t: t, db: db, owner: owner, examID: examID, versionID: versionID, scheduleID: scheduleID}
	f.rw = f.seedSection("reading-writing", "Reading and Writing", 0)
	f.math = f.seedSection("math", "Math", 1)
	t.Cleanup(func() { f.cleanup() })
	return f
}

func (f *adaptiveExam) seedSection(sectionKey, title string, order int) adaptiveBranch {
	f.t.Helper()
	ctx := context.Background()
	branch := adaptiveBranch{
		sectionID: uuid.NewString(),
		baseID:    uuid.NewString(),
		lowID:     uuid.NewString(),
		highID:    uuid.NewString(),
	}
	exec := func(query string, args ...any) {
		f.t.Helper()
		if _, err := f.db.ExecContext(ctx, query, args...); err != nil {
			f.t.Fatalf("seed adaptive section %s: %v", sectionKey, err)
		}
	}
	exec(`INSERT INTO assessment_sections (
		id, exam_version_id, section_key, title, display_order, duration_seconds,
		break_after_seconds, instructions, tool_policy
	) VALUES (?, ?, ?, ?, ?, 3600, 0, '{"version":1,"nodes":[]}', '[]')`,
		branch.sectionID, f.versionID, sectionKey, title, order)
	seedModule := func(id, key, modTitle string, modOrder int, role string) {
		exec(`INSERT INTO assessment_modules (
			id, section_id, module_key, title, display_order, duration_seconds,
			target_question_count, adaptive_role, instructions, tool_policy
		) VALUES (?, ?, ?, ?, ?, 3600, 3, ?, '{"version":1,"nodes":[]}', '[]')`,
			id, branch.sectionID, key, modTitle, modOrder, role)
		for q := 0; q < 3; q++ {
			questionID := uuid.NewString()
			revisionID := uuid.NewString()
			examQuestionID := uuid.NewString()
			exec(`INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)`, questionID, f.owner)
			exec(`INSERT INTO assessment_question_revisions (
				id, question_id, semantic_revision, state, question_type, stimulus,
				prompt, answer_definition, rationale, metadata, accessibility, created_by
			) VALUES (?, ?, 1, 'sealed', 'single_choice', '{"version":1,"nodes":[]}',
				'{"version":1,"nodes":[]}', '{"kind":"single_choice","correctOptionId":"B"}',
				'{}', '{}', '{}', ?)`, revisionID, questionID, f.owner)
			exec(`INSERT INTO assessment_exam_questions (
				id, module_id, question_id, question_revision_id, display_order, is_pretest
			) VALUES (?, ?, ?, ?, ?, FALSE)`, examQuestionID, id, questionID, revisionID, q)
		}
	}
	seedModule(branch.baseID, sectionKey+"-m1", title+" Module 1", 0, "base")
	seedModule(branch.lowID, sectionKey+"-m2-lower", title+" Module 2 Lower", 1, "lower_branch")
	seedModule(branch.highID, sectionKey+"-m2-higher", title+" Module 2 Higher", 2, "higher_branch")
	exec(`INSERT INTO assessment_routing_policies (
		id, section_id, base_module_id, lower_module_id, higher_module_id,
		policy_key, policy_config, revision
	) VALUES (?, ?, ?, ?, ?, 'threshold', '{"minimumCorrectForHigher":2}', 1)`,
		uuid.NewString(), branch.sectionID, branch.baseID, branch.lowID, branch.highID)
	return branch
}

// seedStudent creates one attempt whose Module 1 is active and long expired.
// correctAnswers controls the V2 score: >=2 routes higher (threshold 2 of 3).
// expire controls whether Module 1's window has elapsed (reconcile picks it
// up) or is still running (reconcile leaves it alone).
func (f *adaptiveExam) seedStudent(branch adaptiveBranch, correctAnswers int, expire bool) string {
	f.t.Helper()
	ctx := context.Background()
	attemptID := uuid.NewString()
	now := time.Now().UTC().Truncate(time.Second)
	startedAt := now.Add(-time.Minute)
	if expire {
		startedAt = now.Add(-2 * time.Hour)
	}
	exec := func(query string, args ...any) {
		f.t.Helper()
		if _, err := f.db.ExecContext(ctx, query, args...); err != nil {
			f.t.Fatalf("seed adaptive student: %v", err)
		}
	}
	exec(`INSERT INTO student_attempts (
		id, schedule_id, student_key, organization_id, exam_id,
		published_version_id, exam_title, candidate_id, candidate_name,
		candidate_email, phase, current_module, answers, writing_answers,
		flags, violations_snapshot, integrity, recovery, revision,
		protocol_version, delivery_status, lease_epoch, control_epoch, response_revision,
		wcode
	) VALUES (?, ?, ?, ?, ?, ?, 'SAT adaptive integration', ?, 'Adaptive Candidate',
		'candidate@example.test', 'exam', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', 0,
		2, 'running', 1, 1, 7, ?)`,
		attemptID, f.scheduleID, attemptID, "adaptive-org", f.examID, f.versionID, "cand-"+attemptID[:8], "W-"+attemptID)
	baseAttemptID := uuid.NewString()
	exec(`INSERT INTO assessment_module_attempts (
		id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision
	) VALUES (?, ?, ?, 'active', 3600, ?, '{}', 1)`,
		baseAttemptID, attemptID, branch.baseID, startedAt)

	// Score Module 1 through the V2 transport the scorer actually reads.
	rows, err := f.db.QueryContext(ctx,
		`SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order`, branch.baseID)
	if err != nil {
		f.t.Fatalf("read base questions: %v", err)
	}
	var examQuestionIDs []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			f.t.Fatalf("scan base questions: %v", err)
		}
		examQuestionIDs = append(examQuestionIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		f.t.Fatalf("read base questions: %v", err)
	}
	for i, examQuestionID := range examQuestionIDs {
		answer := "C"
		if i < correctAnswers {
			answer = "B"
		}
		exec(`INSERT INTO attempt_responses_v2 (
			attempt_id, question_id, module_id, lease_epoch, control_epoch,
			client_version, client_write_id, request_hash, response, response_hash,
			server_revision
		) VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?, ?, 7)`,
			attemptID, examQuestionID, branch.baseID,
			"write-"+uuid.NewString(), "req-"+uuid.NewString(),
			`{"answer":"`+answer+`","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`,
			"hash-"+uuid.NewString())
	}
	return attemptID
}

func (f *adaptiveExam) cleanup() {
	ctx := context.Background()
	quiet := func(query string, args ...any) {
		if _, err := f.db.ExecContext(ctx, query, args...); err != nil {
			f.t.Logf("cleanup adaptive exam (%.60q): %v", query, err)
		}
	}
	// Best-effort cleanup: UUID-scoped rows never collide across tests.
	// attempt_terminalizations rows are immutable by schema trigger, so a
	// test that completes an assessment leaves its terminal chain behind;
	// every id in that chain is a fresh UUID, so the residue is isolated.
	quiet(`DELETE FROM attempt_responses_v2 WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?)`, f.scheduleID)
	quiet(`DELETE FROM assessment_question_responses WHERE module_attempt_id IN (SELECT id FROM assessment_module_attempts WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?))`, f.scheduleID)
	quiet(`DELETE FROM assessment_section_results WHERE assessment_result_id IN (SELECT id FROM assessment_results WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?))`, f.scheduleID)
	quiet(`DELETE FROM assessment_results WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?)`, f.scheduleID)
	quiet(`DELETE FROM student_submissions WHERE schedule_id = ?`, f.scheduleID)
	quiet(`DELETE FROM assessment_route_decisions WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?)`, f.scheduleID)
	quiet(`DELETE FROM assessment_module_attempts WHERE attempt_id IN (SELECT id FROM student_attempts WHERE schedule_id = ?)`, f.scheduleID)
	quiet(`DELETE FROM student_attempts WHERE schedule_id = ?`, f.scheduleID)
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		for _, moduleID := range []string{branch.baseID, branch.lowID, branch.highID} {
			quiet(`DELETE FROM assessment_exam_questions WHERE module_id = ?`, moduleID)
		}
	}
	quiet(`DELETE FROM assessment_question_revisions WHERE question_id IN (SELECT id FROM assessment_questions WHERE created_by = ?)`, f.owner)
	quiet(`DELETE FROM assessment_questions WHERE created_by = ?`, f.owner)
	quiet(`DELETE FROM assessment_routing_policies WHERE section_id IN (?, ?)`, f.rw.sectionID, f.math.sectionID)
	quiet(`DELETE FROM assessment_scoring_policies WHERE exam_version_id = ?`, f.versionID)
	for _, moduleID := range []string{f.rw.baseID, f.rw.lowID, f.rw.highID, f.math.baseID, f.math.lowID, f.math.highID} {
		quiet(`DELETE FROM assessment_modules WHERE id = ?`, moduleID)
	}
	quiet(`DELETE FROM assessment_sections WHERE id IN (?, ?)`, f.rw.sectionID, f.math.sectionID)
	quiet(`DELETE FROM exam_session_runtimes WHERE schedule_id = ?`, f.scheduleID)
	quiet(`DELETE FROM exam_schedules WHERE id = ?`, f.scheduleID)
	quiet(`DELETE FROM exam_versions WHERE id = ?`, f.versionID)
	quiet(`DELETE FROM exam_entities WHERE id = ?`, f.examID)
}

func (f *adaptiveExam) deliverySvc() *delivery.Service {
	return delivery.NewService(f.db, tx.NewRunner(f.db))
}

func (f *adaptiveExam) reconcile(t *testing.T, attemptID string) bool {
	t.Helper()
	changed, err := f.deliverySvc().ReconcileAttemptTimeout(context.Background(), f.scheduleID, attemptID, time.Now().UTC())
	if err != nil {
		t.Fatalf("reconcile attempt %s: %v", attemptID, err)
	}
	return changed
}

type routeDecisionRow struct {
	selectedRoute    string
	selectedModuleID string
	baseModuleID     string
}

func (f *adaptiveExam) routeDecision(t *testing.T, attemptID, sectionID string) (routeDecisionRow, bool) {
	t.Helper()
	var row routeDecisionRow
	err := f.db.QueryRowContext(context.Background(),
		`SELECT selected_route, selected_module_id, base_module_id FROM assessment_route_decisions WHERE attempt_id = ? AND section_id = ?`,
		attemptID, sectionID).Scan(&row.selectedRoute, &row.selectedModuleID, &row.baseModuleID)
	if err == sql.ErrNoRows {
		return routeDecisionRow{}, false
	}
	if err != nil {
		t.Fatalf("read route decision: %v", err)
	}
	return row, true
}

func (f *adaptiveExam) countModuleAttempts(t *testing.T, attemptID, moduleID string) int {
	t.Helper()
	var n int
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`,
		attemptID, moduleID).Scan(&n); err != nil {
		t.Fatalf("count module attempts: %v", err)
	}
	return n
}

func (f *adaptiveExam) countDecisions(t *testing.T, attemptID string) int {
	t.Helper()
	var n int
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?`, attemptID).Scan(&n); err != nil {
		t.Fatalf("count route decisions: %v", err)
	}
	return n
}

// branchAttempts returns (module_id, state) for every non-base attempt.
func (f *adaptiveExam) branchAttempts(t *testing.T, attemptID string, branch adaptiveBranch) map[string]string {
	t.Helper()
	rows, err := f.db.QueryContext(context.Background(),
		`SELECT module_id, state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id IN (?, ?)`,
		attemptID, branch.lowID, branch.highID)
	if err != nil {
		t.Fatalf("read branch attempts: %v", err)
	}
	defer rows.Close()
	out := map[string]string{}
	for rows.Next() {
		var moduleID, state string
		if err := rows.Scan(&moduleID, &state); err != nil {
			t.Fatalf("scan branch attempts: %v", err)
		}
		out[moduleID] = state
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("read branch attempts: %v", err)
	}
	return out
}

func (f *adaptiveExam) bootstrap(t *testing.T, attemptID string) *delivery.Bootstrap {
	t.Helper()
	out, err := f.deliverySvc().Bootstrap(context.Background(), f.scheduleID, attemptID, f.scheduleID)
	if err != nil {
		t.Fatalf("bootstrap attempt: %v", err)
	}
	return out
}

func bootstrapModuleIDs(out *delivery.Bootstrap) map[string]string {
	ids := map[string]string{}
	for _, ma := range out.Attempt.ModuleAttempts {
		ids[ma.ModuleID] = ma.State
	}
	return ids
}

// T2: persisted route-decision invariant (real MySQL, not sqlmock).
// 3/3 correct (threshold 2) must record exactly one decision
// (selected_route=higher, selected_module_id=HIGH, base_module_id=BASE),
// exactly one successor attempt (HIGH, not_started), and no LOW attempt.
func TestSATAdaptiveRouteDecisionPersistedHigher(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 3, true)

	if !f.reconcile(t, attemptID) {
		t.Fatal("expired Module 1 must be finalized by the reconciler")
	}
	decision, ok := f.routeDecision(t, attemptID, f.rw.sectionID)
	if !ok {
		t.Fatal("reconcile must record exactly one route decision")
	}
	if decision.selectedRoute != "higher" {
		t.Fatalf("selected_route = %q, want higher", decision.selectedRoute)
	}
	if decision.selectedModuleID != f.rw.highID {
		t.Fatalf("selected_module_id = %q, want HIGH %q", decision.selectedModuleID, f.rw.highID)
	}
	if decision.baseModuleID != f.rw.baseID {
		t.Fatalf("base_module_id = %q, want BASE %q", decision.baseModuleID, f.rw.baseID)
	}
	if got := f.countDecisions(t, attemptID); got != 1 {
		t.Fatalf("route decisions = %d, want exactly 1", got)
	}
	branches := f.branchAttempts(t, attemptID, f.rw)
	if len(branches) != 1 {
		t.Fatalf("branch attempts = %v, want exactly the HIGH module", branches)
	}
	if state, ok := branches[f.rw.highID]; !ok || state != "not_started" {
		t.Fatalf("HIGH attempt = %v, want exactly one not_started HIGH", branches)
	}
	if f.countModuleAttempts(t, attemptID, f.rw.lowID) != 0 {
		t.Fatal("LOW must never gain a module attempt")
	}
}

// T3: timeout routing parity. The timeout reconciler must produce exactly
// what direct finalization produces (same decision, same HIGH module) —
// no special Lower default may exist in the timeout path — and a second
// pass must be a no-op (idempotent, still one decision, still one HIGH).
func TestSATAdaptiveTimeoutRoutingParity(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 3, true)

	if !f.reconcile(t, attemptID) {
		t.Fatal("first reconcile must finalize the expired Module 1")
	}
	if changed := f.reconcile(t, attemptID); changed {
		t.Fatal("second reconcile must be a no-op: the branch is already open")
	}
	decision, ok := f.routeDecision(t, attemptID, f.rw.sectionID)
	if !ok || decision.selectedRoute != "higher" || decision.selectedModuleID != f.rw.highID {
		t.Fatalf("timeout path must record higher/HIGH, got %+v", decision)
	}
	if got := f.countDecisions(t, attemptID); got != 1 {
		t.Fatalf("route decisions after two passes = %d, want 1", got)
	}
	if branches := f.branchAttempts(t, attemptID, f.rw); len(branches) != 1 || branches[f.rw.highID] != "not_started" {
		t.Fatalf("branch attempts after two passes = %v, want one not_started HIGH", branches)
	}
}

// T4: concurrent Module 1 finalization (real database concurrency).
// Two racers must settle on one decision, one HIGH attempt, zero LOW
// attempts, one finalized BASE — never HIGH+LOW, never duplicate HIGHs.
func TestSATAdaptiveConcurrentFinalization(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 3, true)

	var wg sync.WaitGroup
	errs := make([]error, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			_, err := f.deliverySvc().ReconcileAttemptTimeout(context.Background(), f.scheduleID, attemptID, time.Now().UTC())
			errs[i] = err
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err == nil {
			continue
		}
		// The loser must observe the winner's commit as the CAS conflict
		// ("already finalized by another request", CodeAssessmentConflict).
		// Anything else — deadlock, timeout, unknown 500 — is a real
		// failure: fail here instead of letting the end-state assertions
		// below mask which racer broke and how.
		appErr, ok := apperrors.As(err)
		if !ok || appErr.Code != apperrors.CodeAssessmentConflict {
			t.Fatalf("racer %d must be nil or a CAS conflict, got %v", i, err)
		}
		t.Logf("racer %d lost the CAS race as designed: %v", i, err)
	}
	if got := f.countDecisions(t, attemptID); got != 1 {
		t.Fatalf("route decisions after concurrent finalize = %d, want 1 (errors: %v)", got, errs)
	}
	if branches := f.branchAttempts(t, attemptID, f.rw); len(branches) != 1 || branches[f.rw.highID] == "" {
		t.Fatalf("branch attempts after concurrent finalize = %v, want exactly HIGH (errors: %v)", branches, errs)
	}
	if f.countModuleAttempts(t, attemptID, f.rw.lowID) != 0 {
		t.Fatalf("LOW must never gain a module attempt (errors: %v)", errs)
	}
	var baseState string
	if err := f.db.QueryRowContext(context.Background(),
		`SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?`,
		attemptID, f.rw.baseID).Scan(&baseState); err != nil {
		t.Fatalf("read base attempt: %v", err)
	}
	if baseState != "locked" {
		t.Fatalf("BASE state = %q, want locked", baseState)
	}
}

// expireBase backdates a base module attempt so its authoritative window has
// elapsed without touching anything else.
func (f *adaptiveExam) expireBase(t *testing.T, attemptID, baseModuleID string) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(),
		`UPDATE assessment_module_attempts SET started_at = UTC_TIMESTAMP(6) - INTERVAL 2 HOUR WHERE attempt_id = ? AND module_id = ?`,
		attemptID, baseModuleID); err != nil {
		t.Fatalf("expire base module: %v", err)
	}
}

// T5 + P0-b: dynamic bootstrap regression (the ETag bug, behaviorally).
// Routing HIGH does not move the published version, so the version ETag is
// identical before and after — and the bootstrap after routing must still
// carry the HIGH attempt. Exam-version equality must never suppress live
// attempt updates.
//
// Note the stale snapshot is taken while Module 1 is still RUNNING: any
// bootstrap of an already-expired Module 1 reconciles first (Bootstrap
// finalizes expired modules before assembling), so that path cannot
// produce a stale read by construction.
func TestSATAdaptiveBootstrapAlwaysFreshAfterRouting(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 3, false)
	svc := f.deliverySvc()
	ctx := context.Background()

	_, _, etagBefore, err := svc.VersionTag(ctx, f.scheduleID)
	if err != nil {
		t.Fatalf("version tag before routing: %v", err)
	}
	before := f.bootstrap(t, attemptID)
	if _, ok := bootstrapModuleIDs(before)[f.rw.highID]; ok {
		t.Fatal("HIGH must not exist while Module 1 is still running")
	}

	// Module 1 expires AFTER the stale snapshot was taken.
	f.expireBase(t, attemptID, f.rw.baseID)

	_, _, etagAfter, err := svc.VersionTag(ctx, f.scheduleID)
	if err != nil {
		t.Fatalf("version tag after routing: %v", err)
	}
	if etagBefore != etagAfter {
		t.Fatalf("routing must not move the published version (etag %q -> %q)", etagBefore, etagAfter)
	}
	after := f.bootstrap(t, attemptID)
	modules := bootstrapModuleIDs(after)
	if _, ok := modules[f.rw.highID]; !ok {
		t.Fatalf("post-route bootstrap must contain HIGH, got %v", modules)
	}
	if _, ok := modules[f.rw.lowID]; ok {
		t.Fatalf("post-route bootstrap must not contain LOW, got %v", modules)
	}
	again := f.bootstrap(t, attemptID)
	if _, ok := bootstrapModuleIDs(again)[f.rw.highID]; !ok {
		t.Fatal("repeat bootstrap must still contain HIGH")
	}
}

// activateBranch simulates the student opening the routed module
// (not_started -> active), the way StartModule would after the handoff.
func (f *adaptiveExam) activateBranch(t *testing.T, attemptID, moduleID string) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(),
		`UPDATE assessment_module_attempts SET state = 'active', started_at = UTC_TIMESTAMP(6) WHERE attempt_id = ? AND module_id = ?`,
		attemptID, moduleID); err != nil {
		t.Fatalf("activate branch: %v", err)
	}
}

func (f *adaptiveExam) lockBranch(t *testing.T, attemptID, moduleID string) {
	t.Helper()
	if _, err := f.db.ExecContext(context.Background(),
		`UPDATE assessment_module_attempts SET state = 'locked', submitted_at = UTC_TIMESTAMP(6) WHERE attempt_id = ? AND module_id = ?`,
		attemptID, moduleID); err != nil {
		t.Fatalf("lock branch: %v", err)
	}
}

func (f *adaptiveExam) proctorSession(t *testing.T, attemptID string) proctor.StudentSessionSummary {
	t.Helper()
	svc := proctor.NewService(tx.NewRunner(f.db), f.db, nil, nil, nil)
	detail, err := svc.GetSessionDetail(context.Background(), proctor.Actor{
		ID: f.owner, Role: proctor.RoleAdmin, CSRFVerified: true,
	}, f.scheduleID, 50, 50)
	if err != nil {
		t.Fatalf("GetSessionDetail: %v", err)
	}
	for _, session := range detail.Sessions {
		if session.AttemptID == attemptID {
			return session
		}
	}
	t.Fatalf("attempt %s missing from proctor roster (%d sessions)", attemptID, len(detail.Sessions))
	return proctor.StudentSessionSummary{}
}

func (f *adaptiveExam) complete(t *testing.T, attemptID string) *sat.AssessmentResult {
	t.Helper()
	svc := sat.NewService(f.db, tx.NewRunner(f.db), clock.System{}, sat.DeterministicScorer{})
	result, err := svc.CompleteAssessment(context.Background(), sat.CompleteRequest{
		ScheduleID: f.scheduleID, AttemptID: attemptID,
		SubmissionID: "sub-" + attemptID[:8], ActorKind: "student", ActorID: attemptID,
	})
	if err != nil {
		t.Fatalf("CompleteAssessment: %v", err)
	}
	return result
}

func (f *adaptiveExam) assertPendingResult(t *testing.T, attemptID string, result *sat.AssessmentResult) {
	t.Helper()
	if result == nil || result.OutcomeStatus != terminalization.SATPending {
		t.Fatalf("completion result = %+v, want pending SAT outcome", result)
	}
	if result.TotalScore != nil || len(result.Sections) != 0 {
		t.Fatalf("pending SAT result must not have a score or sections: total=%v sections=%d",
			result.TotalScore, len(result.Sections))
	}
	submissionID, outcomeStatus, releaseStatus := f.satResultRow(t, attemptID)
	if submissionID.Valid || outcomeStatus != terminalization.SATPending || releaseStatus != "pending" {
		t.Fatalf("stored SAT result = submissionID:%v outcome:%q release:%q, want NULL/pending/pending",
			submissionID, outcomeStatus, releaseStatus)
	}
}

// P0-a + T15: full Higher end-to-end invariant. One student, both sections
// score HIGH: route decision, module attempt, student bootstrap and proctor
// roster must agree on HIGH, LOW must never exist, and completion must remain
// an unscored pending result until the scoring workflow runs.
func TestSATAdaptiveHigherEndToEndInvariant(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 3, true)
	mathAttemptID := attemptID
	// Math Module 1 belongs to the same attempt: seed it directly.
	f.seedMathBase(mathAttemptID, 3, true)

	if !f.reconcile(t, attemptID) {
		t.Fatal("reconcile must finalize the expired Module 1s")
	}
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		decision, ok := f.routeDecision(t, attemptID, branch.sectionID)
		if !ok || decision.selectedRoute != "higher" || decision.selectedModuleID != branch.highID {
			t.Fatalf("section decision = %+v, want higher/%s", decision, branch.highID)
		}
		f.activateBranch(t, attemptID, branch.highID)
	}

	// Student bootstrap: both HIGHs present, no LOW anywhere.
	modules := bootstrapModuleIDs(f.bootstrap(t, attemptID))
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		if _, ok := modules[branch.highID]; !ok {
			t.Fatalf("bootstrap must contain HIGH %s, got %v", branch.highID, modules)
		}
		if _, ok := modules[branch.lowID]; ok {
			t.Fatalf("bootstrap must not contain LOW %s, got %v", branch.lowID, modules)
		}
	}

	// Staff roster: the projected active module must be one of the routed
	// HIGHs in the higher_branch slot — never LOW, never Module 1. (The
	// roster projects the single latest active module attempt per student;
	// both HIGHs are active, asserted via SQL below.)
	//
	// T11 non-dependence pin: poison the legacy current_module column
	// first (the schema constrains it to section names, none of which
	// names a SAT module). The projection must still report HIGH from
	// assessment_module_attempts — it must never read
	// student_attempts.current_module for SAT module identity.
	if _, err := f.db.ExecContext(context.Background(),
		`UPDATE student_attempts SET current_module = 'science' WHERE id = ?`, attemptID); err != nil {
		t.Fatalf("poison current_module: %v", err)
	}
	session := f.proctorSession(t, attemptID)
	if session.RuntimeCurrentModuleID == nil ||
		(*session.RuntimeCurrentModuleID != f.rw.highID && *session.RuntimeCurrentModuleID != f.math.highID) {
		t.Fatalf("proctor roster module = %v, want a routed HIGH", session.RuntimeCurrentModuleID)
	}
	if session.RuntimeCurrentModuleRole == nil || *session.RuntimeCurrentModuleRole != "higher_branch" {
		t.Fatalf("proctor roster role = %v, want higher_branch", session.RuntimeCurrentModuleRole)
	}
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		var activeModule string
		if err := f.db.QueryRowContext(context.Background(),
			`SELECT module_id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? AND state = 'active'`,
			attemptID, branch.highID).Scan(&activeModule); err != nil {
			t.Fatalf("HIGH %s must be active for the roster: %v", branch.highID, err)
		}
	}

	// Finish the exam and check the result agrees.
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		f.lockBranch(t, attemptID, branch.highID)
	}
	result := f.complete(t, attemptID)
	f.assertPendingResult(t, attemptID, result)
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		if f.countModuleAttempts(t, attemptID, branch.lowID) != 0 {
			t.Fatalf("LOW %s was never allowed an attempt", branch.lowID)
		}
		if got := f.countLowAnswers(t, attemptID, branch.lowID); got != 0 {
			t.Fatalf("LOW %s must have zero answers recorded, got %d", branch.lowID, got)
		}
	}
}

// countLowAnswers counts every persisted answer row attributable to a
// never-administered branch module: V2 responses keyed to its exam
// questions (by either question identity) plus legacy responses on its
// (nonexistent) module attempts.
func (f *adaptiveExam) countLowAnswers(t *testing.T, attemptID, lowModuleID string) int {
	t.Helper()
	ctx := context.Background()
	var v2 int
	if err := f.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM attempt_responses_v2 v
		  JOIN assessment_exam_questions eq
		    ON (eq.id = v.question_id OR eq.question_id = v.question_id)
		 WHERE v.attempt_id = ? AND eq.module_id = ?`,
		attemptID, lowModuleID).Scan(&v2); err != nil {
		t.Fatalf("count LOW V2 answers: %v", err)
	}
	var legacy int
	if err := f.db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM assessment_question_responses ar
		  JOIN assessment_module_attempts ma ON ma.id = ar.module_attempt_id
		 WHERE ma.attempt_id = ? AND ma.module_id = ?`,
		attemptID, lowModuleID).Scan(&legacy); err != nil {
		t.Fatalf("count LOW legacy answers: %v", err)
	}
	return v2 + legacy
}

// seedMathBase adds an expired Module 1 for the math section to an existing
// attempt (seedStudent only seeds one section; the two sections share one
// student attempt).
func (f *adaptiveExam) seedMathBase(attemptID string, correctAnswers int, expire bool) {
	f.t.Helper()
	ctx := context.Background()
	now := time.Now().UTC().Truncate(time.Second)
	startedAt := now.Add(-time.Minute)
	if expire {
		startedAt = now.Add(-2 * time.Hour)
	}
	if _, err := f.db.ExecContext(ctx, `INSERT INTO assessment_module_attempts (
		id, attempt_id, module_id, state, allocated_seconds, started_at, tool_state, revision
	) VALUES (?, ?, ?, 'active', 3600, ?, '{}', 1)`,
		uuid.NewString(), attemptID, f.math.baseID, startedAt); err != nil {
		f.t.Fatalf("seed math base: %v", err)
	}
	rows, err := f.db.QueryContext(ctx,
		`SELECT id FROM assessment_exam_questions WHERE module_id = ? ORDER BY display_order`, f.math.baseID)
	if err != nil {
		f.t.Fatalf("read math questions: %v", err)
	}
	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			f.t.Fatalf("scan math questions: %v", err)
		}
		ids = append(ids, id)
	}
	rows.Close()
	for i, examQuestionID := range ids {
		answer := "C"
		if i < correctAnswers {
			answer = "B"
		}
		if _, err := f.db.ExecContext(ctx, `INSERT INTO attempt_responses_v2 (
			attempt_id, question_id, module_id, lease_epoch, control_epoch,
			client_version, client_write_id, request_hash, response, response_hash,
			server_revision
		) VALUES (?, ?, ?, 1, 1, 1, ?, ?, ?, ?, 7)`,
			attemptID, examQuestionID, f.math.baseID,
			"write-"+uuid.NewString(), "req-"+uuid.NewString(),
			`{"answer":"`+answer+`","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`,
			"hash-"+uuid.NewString()); err != nil {
			f.t.Fatalf("seed math responses: %v", err)
		}
	}
}

// T16: full Lower control. Same scenario below threshold: everything must
// read LOW / lower_branch / lower, proving the Higher fix did not break
// the Lower path.
func TestSATAdaptiveLowerControl(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 1, true)
	f.seedMathBase(attemptID, 1, true)

	if !f.reconcile(t, attemptID) {
		t.Fatal("reconcile must finalize the expired Module 1s")
	}
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		decision, ok := f.routeDecision(t, attemptID, branch.sectionID)
		if !ok || decision.selectedRoute != "lower" || decision.selectedModuleID != branch.lowID {
			t.Fatalf("section decision = %+v, want lower/%s", decision, branch.lowID)
		}
		f.activateBranch(t, attemptID, branch.lowID)
	}
	modules := bootstrapModuleIDs(f.bootstrap(t, attemptID))
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		if _, ok := modules[branch.lowID]; !ok {
			t.Fatalf("bootstrap must contain LOW %s, got %v", branch.lowID, modules)
		}
		if _, ok := modules[branch.highID]; ok {
			t.Fatalf("bootstrap must not contain HIGH %s, got %v", branch.highID, modules)
		}
	}
	session := f.proctorSession(t, attemptID)
	if session.RuntimeCurrentModuleID == nil ||
		(*session.RuntimeCurrentModuleID != f.rw.lowID && *session.RuntimeCurrentModuleID != f.math.lowID) {
		t.Fatalf("proctor roster module = %v, want a routed LOW", session.RuntimeCurrentModuleID)
	}
	if session.RuntimeCurrentModuleRole == nil || *session.RuntimeCurrentModuleRole != "lower_branch" {
		t.Fatalf("proctor roster role = %v, want lower_branch", session.RuntimeCurrentModuleRole)
	}
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		f.lockBranch(t, attemptID, branch.lowID)
	}
	result := f.complete(t, attemptID)
	f.assertPendingResult(t, attemptID, result)
	for _, branch := range []adaptiveBranch{f.rw, f.math} {
		if f.countModuleAttempts(t, attemptID, branch.highID) != 0 {
			t.Fatalf("HIGH %s was never allowed an attempt", branch.highID)
		}
	}
}

// T17: high-concurrency cohort. 25 students finish Module 1 with mixed
// scores under concurrent reconciliation; every student must hold exactly
// one decision, one matching branch attempt, a matching bootstrap, a
// matching proctor projection, and a pending unscored completion — and no
// student may ever hold two branch attempts for one section.
func TestSATAdaptiveCohortRouting(t *testing.T) {
	f := newAdaptiveExam(t)
	const students = 25
	type student struct {
		attemptID string
		wantRoute string
		wantID    string
		wantRole  string
	}
	cohort := make([]student, 0, students)
	for i := 0; i < students; i++ {
		correct := 3
		wantRoute, wantID, wantRole := "higher", f.rw.highID, "higher_branch"
		if i%3 == 2 {
			correct = 1
			wantRoute, wantID, wantRole = "lower", f.rw.lowID, "lower_branch"
		}
		// Both sections share one attempt and one score band, so every
		// student can run the full decision -> attempt -> bootstrap ->
		// roster -> result chain below like T15/T16.
		attemptID := f.seedStudent(f.rw, correct, true)
		f.seedMathBase(attemptID, correct, true)
		cohort = append(cohort, student{attemptID, wantRoute, wantID, wantRole})
	}
	mathWantID := func(s student) string {
		if s.wantRoute == "higher" {
			return f.math.highID
		}
		return f.math.lowID
	}

	sem := make(chan struct{}, 8)
	var wg sync.WaitGroup
	errs := make([]error, students)
	for i, s := range cohort {
		wg.Add(1)
		go func(i int, s student) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			_, err := f.deliverySvc().ReconcileAttemptTimeout(context.Background(), f.scheduleID, s.attemptID, time.Now().UTC())
			errs[i] = err
		}(i, s)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("student %d reconcile: %v", i, err)
		}
	}
	for i, s := range cohort {
		for _, branch := range []adaptiveBranch{f.rw, f.math} {
			wantID := s.wantID
			if branch.sectionID == f.math.sectionID {
				wantID = mathWantID(s)
			}
			decision, ok := f.routeDecision(t, s.attemptID, branch.sectionID)
			if !ok || decision.selectedRoute != s.wantRoute || decision.selectedModuleID != wantID {
				t.Fatalf("student %d decision = %+v, want %s/%s", i, decision, s.wantRoute, wantID)
			}
			f.activateBranch(t, s.attemptID, wantID)
		}
		if got := f.countDecisions(t, s.attemptID); got != 2 {
			t.Fatalf("student %d decisions = %d, want 2 (one per section)", i, got)
		}
		branches := f.branchAttempts(t, s.attemptID, f.rw)
		if len(branches) != 1 || branches[s.wantID] == "" {
			t.Fatalf("student %d branches = %v, want exactly %s", i, branches, s.wantID)
		}
		modules := bootstrapModuleIDs(f.bootstrap(t, s.attemptID))
		if _, ok := modules[s.wantID]; !ok {
			t.Fatalf("student %d bootstrap missing %s: %v", i, s.wantID, modules)
		}
		if _, ok := modules[mathWantID(s)]; !ok {
			t.Fatalf("student %d bootstrap missing math %s: %v", i, mathWantID(s), modules)
		}
		// Staff roster: the projected active module must be one of this
		// student's routed branches in the matching adaptive slot.
		session := f.proctorSession(t, s.attemptID)
		if session.RuntimeCurrentModuleID == nil ||
			(*session.RuntimeCurrentModuleID != s.wantID && *session.RuntimeCurrentModuleID != mathWantID(s)) {
			t.Fatalf("student %d proctor roster module = %v, want a routed branch", i, session.RuntimeCurrentModuleID)
		}
		if session.RuntimeCurrentModuleRole == nil || *session.RuntimeCurrentModuleRole != s.wantRole {
			t.Fatalf("student %d proctor roster role = %v, want %s", i, session.RuntimeCurrentModuleRole, s.wantRole)
		}
		// Completion is intentionally pending until the scoring workflow runs;
		// routing correctness is asserted above from decisions and administered
		// branch attempts.
		f.lockBranch(t, s.attemptID, s.wantID)
		f.lockBranch(t, s.attemptID, mathWantID(s))
		result := f.complete(t, s.attemptID)
		f.assertPendingResult(t, s.attemptID, result)
	}
}

// T18: reconnect/concurrency torture around the Module 1 boundary.
// A stale pre-expiry bootstrap exists; then expiry lands while bootstraps,
// proctor reads and an explicit reconcile interleave. Once HIGH is
// authoritative no read may return the UI to LOW or Module 1.
func TestSATAdaptiveReconnectTorture(t *testing.T) {
	f := newAdaptiveExam(t)
	attemptID := f.seedStudent(f.rw, 3, false)

	stale := f.bootstrap(t, attemptID)
	if _, ok := bootstrapModuleIDs(stale)[f.rw.highID]; ok {
		t.Fatal("pre-expiry bootstrap must not contain HIGH")
	}
	f.expireBase(t, attemptID, f.rw.baseID)

	var wg sync.WaitGroup
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			// Ignoring errors: concurrent passes may CAS-conflict; the
			// final assertions below are the verdict, not any one racer.
			_, _ = f.deliverySvc().Bootstrap(context.Background(), f.scheduleID, attemptID, f.scheduleID)
		}()
	}
	wg.Add(1)
	go func() {
		defer wg.Done()
		_, _ = f.deliverySvc().ReconcileAttemptTimeout(context.Background(), f.scheduleID, attemptID, time.Now().UTC())
	}()
	wg.Wait()
	// Ensure routing landed even if every background pass raced.
	f.reconcile(t, attemptID)

	for i := 0; i < 5; i++ {
		modules := bootstrapModuleIDs(f.bootstrap(t, attemptID))
		if _, ok := modules[f.rw.highID]; !ok {
			t.Fatalf("post-torture bootstrap %d must contain HIGH, got %v", i, modules)
		}
		if _, ok := modules[f.rw.lowID]; ok {
			t.Fatalf("post-torture bootstrap %d must not contain LOW, got %v", i, modules)
		}
	}
	decision, ok := f.routeDecision(t, attemptID, f.rw.sectionID)
	if !ok || decision.selectedModuleID != f.rw.highID {
		t.Fatalf("post-torture decision = %+v, want HIGH", decision)
	}
	if got := f.countDecisions(t, attemptID); got != 1 {
		t.Fatalf("post-torture decisions = %d, want 1", got)
	}
}

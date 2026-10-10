package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"errors"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/config"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satstartcode"
	"example.com/ielts-proctoring/internal/schedules"
	"example.com/ielts-proctoring/internal/terminalization"
)

// codeStartFixture is one SAT exam (RW base + two branches) with a
// code-start schedule created through the real schedule service.
type codeStartFixture struct {
	app        *App
	db         *sql.DB
	scheduleID string
	baseID     string
}

type codeStartCandidate struct {
	attemptID string
	session   string
	token     string
}

func newCodeStartFixture(t *testing.T, db *sql.DB, start, end time.Time) codeStartFixture {
	t.Helper()
	ctx := context.Background()
	cfg := config.Load()
	cfg.AuthSecret = "test-secret-with-at-least-32-characters!!"
	cfg.SATAccessCodeStart = true
	cfg.SATStartCodeKeys = "k1:" + base64.StdEncoding.EncodeToString([]byte("0123456789abcdef0123456789abcdef"))
	app := BuildApp(cfg, db)
	// The keyring/rollout switch is process-wide: restore the default so
	// later tests in this package keep proctor-start schedules.
	t.Cleanup(func() { satstartcode.Configure(false, nil) })
	if app.Delivery == nil || app.Schedules == nil {
		t.Fatal("BuildApp must wire delivery and schedules")
	}
	owner := "code-start-" + uuid.NewString()
	org := "code-start-org-" + uuid.NewString()[:8]
	examID, versionID, sectionID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := db.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	exec(`INSERT INTO exam_entities (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility, organization_id, owner_id, schema_version, revision)
		VALUES (?, ?, 'SAT code start', 'sat', 'SAT', 'Academic', 'published', 'organization', ?, ?, 1, 0)`, examID, examID, org, owner)
	exec(`INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision)
		VALUES (?, ?, 1, '{"providerKey":"sat","title":"SAT code start","sections":[{"secret":"question body"}]}', '{}', ?, TRUE, 1)`, versionID, examID, owner)
	exec(`UPDATE exam_entities SET current_published_version_id = ? WHERE id = ?`, versionID, examID)
	exec(`INSERT INTO assessment_sections (id, exam_version_id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions, tool_policy)
		VALUES (?, ?, 'reading-writing', 'Reading and Writing', 0, 3600, 0, '{"version":1,"nodes":[]}', '[]')`, sectionID, versionID)
	baseID, lowID, highID := uuid.NewString(), uuid.NewString(), uuid.NewString()
	for i, m := range []struct{ id, key, role string }{{baseID, "rw-m1", "base"}, {lowID, "rw-m2-lower", "lower_branch"}, {highID, "rw-m2-higher", "higher_branch"}} {
		exec(`INSERT INTO assessment_modules (id, section_id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy)
			VALUES (?, ?, ?, ?, ?, 1920, 1, ?, '{"version":1,"nodes":[]}', '[]')`, m.id, sectionID, m.key, m.key, i, m.role)
		questionID, revisionID := uuid.NewString(), uuid.NewString()
		exec(`INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)`, questionID, owner)
		exec(`INSERT INTO assessment_question_revisions (id, question_id, semantic_revision, state, question_type, stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by)
			VALUES (?, ?, 1, 'sealed', 'single_choice', '{"version":1,"nodes":[]}', '{"version":1,"nodes":[{"type":"text","text":"PROTECTED-CANARY"}]}', '{"kind":"single_choice","correctOptionId":"B"}', '{}', '{}', '{}', ?)`, revisionID, questionID, owner)
		exec(`INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest) VALUES (?, ?, ?, ?, 0, FALSE)`, uuid.NewString(), m.id, questionID, revisionID)
	}
	exec(`INSERT INTO assessment_routing_policies (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision)
		VALUES (?, ?, ?, ?, ?, 'threshold', '{"minimumCorrectForHigher":1}', 1)`, uuid.NewString(), sectionID, baseID, lowID, highID)
	sch, err := app.Schedules.Create(ctx, schedules.CreateRequest{
		ExamID: examID, PublishedVersionID: versionID, CohortName: "code start cohort",
		StartTime: start, EndTime: end, AutoStart: true, CreatedBy: owner,
	})
	if err != nil {
		t.Fatalf("create code-start schedule: %v", err)
	}
	if sch.SatStartMode != satstartcode.ModeAccessCode || sch.AutoStart {
		t.Fatalf("new SAT schedule must default to code start without auto-start, got mode=%q autoStart=%v", sch.SatStartMode, sch.AutoStart)
	}
	return codeStartFixture{app: app, db: db, scheduleID: sch.ID, baseID: baseID}
}

func (f codeStartFixture) code(t *testing.T) satstartcode.Code {
	t.Helper()
	var out satstartcode.Code
	if err := tx.NewRunner(f.db).WithTxRC(context.Background(), func(ctx context.Context, q tx.Tx) error {
		var err error
		out, err = satstartcode.ReadTx(ctx, q, f.scheduleID, "")
		return err
	}); err != nil {
		t.Fatalf("read code: %v", err)
	}
	return out
}

// admit registers a candidate and mints their attempt through the real
// admission path, plus the attempt session that binds the writer.
func (f codeStartFixture) admit(t *testing.T, name string) codeStartCandidate {
	t.Helper()
	ctx := context.Background()
	user, regID, key := uuid.NewString(), uuid.NewString(), "key-"+uuid.NewString()[:8]
	if _, err := f.db.Exec("INSERT INTO users (id, email, display_name, role, state) VALUES (?, ?, ?, 'student', 'active')", user, user+"@example.test", name); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.Exec("INSERT INTO schedule_registrations (id, schedule_id, student_key, student_id, student_name, access_state, wcode, user_id) VALUES (?, ?, ?, ?, ?, 'checked_in', ?, ?)",
		regID, f.scheduleID, key, key, name, "W"+key, user); err != nil {
		t.Fatal(err)
	}
	ref, err := f.app.Schedules.CreateScheduleAttempt(ctx, f.scheduleID, regID, key, key, name, user+"@example.test", "sess-"+key)
	if err != nil {
		t.Fatalf("admit %s: %v", name, err)
	}
	session, token := uuid.NewString(), uuid.NewString()
	if _, err := f.db.Exec("INSERT INTO attempt_sessions (id, user_id, schedule_id, attempt_id, client_session_id, token_id, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
		uuid.NewString(), user, f.scheduleID, ref.AttemptID, session, token, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	return codeStartCandidate{attemptID: ref.AttemptID, session: session, token: token}
}

func (f codeStartFixture) start(c codeStartCandidate, code string) (*delivery.SatCodeStartResponse, error) {
	return f.startWithContext(context.Background(), c, code)
}

func (f codeStartFixture) startWithContext(ctx context.Context, c codeStartCandidate, code string) (*delivery.SatCodeStartResponse, error) {
	var epoch int
	if err := f.db.QueryRowContext(ctx, "SELECT control_epoch FROM student_attempts WHERE id = ?", c.attemptID).Scan(&epoch); err != nil {
		return nil, err
	}
	return f.app.Delivery.StartWithCode(ctx, f.scheduleID, c.attemptID, f.scheduleID,
		delivery.SatCodeStartRequest{Code: code, ControlEpoch: epoch}, c.session, c.token)
}

func wrongCode(code string) string {
	if code == "000000" {
		return "000001"
	}
	return "000000"
}

func reasonOf(err error) string {
	if e, ok := apperrors.As(err); ok {
		if r, ok := e.Details["reason"].(string); ok {
			return r
		}
		return string(e.Code)
	}
	if err == nil {
		return ""
	}
	return err.Error()
}

func TestSATAccessCodeStartMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(2*time.Hour))
	current := f.code(t)
	if len(current.Value) != satstartcode.CodeLength || current.Generation != 1 {
		t.Fatalf("generation-1 six-digit code expected, got %q gen %d", current.Value, current.Generation)
	}
	a := f.admit(t, "Candidate A")
	b := f.admit(t, "Candidate B")

	// Before any start: B's bootstrap carries the code policy and no content.
	boot, err := f.app.Delivery.Bootstrap(ctx, f.scheduleID, b.attemptID, f.scheduleID)
	if err != nil {
		t.Fatalf("bootstrap B: %v", err)
	}
	if boot.SatStartPolicy == nil || boot.SatStartPolicy.Mode != "access_code" || boot.SatStartPolicy.State != "code_required" {
		t.Fatalf("code_required policy expected, got %+v", boot.SatStartPolicy)
	}
	for _, s := range boot.Sections {
		for _, m := range s.Modules {
			if len(m.Questions) != 0 || !m.ContentWithheld {
				t.Fatalf("module %s content must be withheld before the code", m.ID)
			}
		}
	}
	// No direct start without the code, and no media.
	if _, err := f.app.Delivery.StartModule(ctx, f.scheduleID, a.attemptID, f.scheduleID, f.baseID, a.session, a.token); reasonOf(err) != "START_CODE_REQUIRED" && reasonOf(err) != "RUNTIME_NOT_LIVE" {
		t.Fatalf("direct start must be refused, got %v", err)
	}

	// Malformed and wrong codes never start anything.
	if _, err := f.start(a, "12a456"); reasonOf(err) != "START_CODE_FORMAT_INVALID" {
		t.Fatalf("malformed: %v", err)
	}
	if _, err := f.start(a, wrongCode(current.Value)); reasonOf(err) != "START_CODE_INVALID" {
		t.Fatalf("wrong code: %v", err)
	}
	var failed int
	if err := db.QueryRow("SELECT COUNT(*) FROM sat_start_code_reservations WHERE schedule_id = ? AND state = 'failed'", f.scheduleID).Scan(&failed); err != nil || failed != 1 {
		t.Fatalf("one failed comparison must be counted, got %d %v", failed, err)
	}
	var runtimes int
	_ = db.QueryRow("SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?", f.scheduleID).Scan(&runtimes)
	if runtimes != 0 {
		t.Fatal("a mismatch must not create a runtime")
	}

	// A starts: first-runtime path opens the room for A only.
	out, err := f.start(a, "  "+current.Value+" ")
	if err != nil {
		t.Fatalf("A start: %v", err)
	}
	if out.Kind != "started" || out.Entry == nil || out.Entry.StartedAt == nil || out.Entry.SelectedSection == nil {
		t.Fatalf("started ACK with content expected, got %+v", out)
	}
	var acceptedAt, moduleStartedAt sql.NullTime
	if err := db.QueryRowContext(ctx,
		`SELECT a.sat_start_code_accepted_at, m.started_at
		FROM student_attempts a
		JOIN assessment_module_attempts m ON m.attempt_id = a.id
		WHERE a.id = ? AND m.module_id = ?`,
		a.attemptID, f.baseID).Scan(&acceptedAt, &moduleStartedAt); err != nil {
		t.Fatal(err)
	}
	if !acceptedAt.Valid || !moduleStartedAt.Valid ||
		!out.Entry.StartedAt.Equal(moduleStartedAt.Time) ||
		!acceptedAt.Time.Equal(moduleStartedAt.Time) ||
		out.Entry.ServerNow.Before(*out.Entry.StartedAt) {
		t.Fatalf("ACK/start clock diverged: ack=%+v accepted=%+v moduleStarted=%+v",
			out.Entry, acceptedAt, moduleStartedAt)
	}
	_ = db.QueryRow("SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ? AND status = 'live' AND timing_model = 'sat_personal_v1'", f.scheduleID).Scan(&runtimes)
	if runtimes != 1 {
		t.Fatalf("exactly one live personal runtime expected, got %d", runtimes)
	}
	// B unaffected: still lobby, no acceptance, no started module, refused.
	var phase string
	var accepted sql.NullTime
	if err := db.QueryRow("SELECT phase, sat_start_code_accepted_at FROM student_attempts WHERE id = ?", b.attemptID).Scan(&phase, &accepted); err != nil {
		t.Fatal(err)
	}
	if phase != "lobby" || accepted.Valid {
		t.Fatalf("B must stay pre-exam, phase=%s accepted=%v", phase, accepted.Valid)
	}
	if _, err := f.app.Delivery.StartModule(ctx, f.scheduleID, b.attemptID, f.scheduleID, f.baseID, b.session, b.token); reasonOf(err) != "START_CODE_REQUIRED" {
		t.Fatalf("B direct start after room opened must still need the code, got %v", err)
	}
	if ok, err := f.app.Delivery.CanAttemptReadMedia(ctx, f.scheduleID, b.attemptID, "any-asset"); err != nil || ok {
		t.Fatalf("B media must be denied before start: %v %v", ok, err)
	}

	// A replay (even with a rotated code later) resumes the same start.
	var aStarted time.Time
	_ = db.QueryRow("SELECT started_at FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", a.attemptID, f.baseID).Scan(&aStarted)
	rotated, err := func() (satstartcode.Code, error) {
		var c satstartcode.Code
		err := tx.NewRunner(db).WithTxRC(ctx, func(ctx context.Context, q tx.Tx) error {
			var err error
			c, err = satstartcode.RotateTx(ctx, q, f.scheduleID, 1, "proctor-1")
			return err
		})
		return c, err
	}()
	if err != nil || rotated.Generation != 2 || rotated.Value == current.Value {
		t.Fatalf("rotation: %+v %v", rotated, err)
	}
	replay, err := f.start(a, current.Value)
	if err != nil || replay.Kind != "resume" || replay.Bootstrap == nil {
		t.Fatalf("A replay must resume, got %+v %v", replay, err)
	}
	var aStartedAfter time.Time
	_ = db.QueryRow("SELECT started_at FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", a.attemptID, f.baseID).Scan(&aStartedAfter)
	if !aStartedAfter.Equal(aStarted) {
		t.Fatalf("replay must not reset the clock: %v -> %v", aStarted, aStartedAfter)
	}

	// B: the old code no longer starts; the new one does, later and separately.
	if _, err := f.start(b, current.Value); reasonOf(err) != "START_CODE_INVALID" {
		t.Fatalf("old code after rotation: %v", err)
	}
	if out, err := f.start(b, rotated.Value); err != nil || out.Kind != "started" {
		t.Fatalf("B start with rotated code: %+v %v", out, err)
	}
	var bStarted time.Time
	var bGeneration int
	_ = db.QueryRow("SELECT started_at FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", b.attemptID, f.baseID).Scan(&bStarted)
	_ = db.QueryRow("SELECT sat_start_code_generation FROM student_attempts WHERE id = ?", b.attemptID).Scan(&bGeneration)
	if !bStarted.After(aStarted) || bGeneration != 2 {
		t.Fatalf("B must start independently on generation 2: a=%v b=%v gen=%d", aStarted, bStarted, bGeneration)
	}
	_ = db.QueryRow("SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?", f.scheduleID).Scan(&runtimes)
	if runtimes != 1 {
		t.Fatalf("later starts must reuse the runtime, got %d", runtimes)
	}

	// Room Start is refused for a code session.
	if _, err := f.app.Schedules.ApplyRuntimeCommand(ctx, f.scheduleID, schedules.RuntimeCommand{Action: "start_runtime", ActorID: "proctor-1"}); reasonOf(err) != "START_MODE_CONFLICT" {
		t.Fatalf("room start must conflict, got %v", err)
	}
}

func TestSATAccessCodeConcurrentFirstStartsMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(2*time.Hour))
	code := f.code(t).Value
	const n = 6
	candidates := make([]codeStartCandidate, n)
	for i := range n {
		candidates[i] = f.admit(t, "Racer")
	}
	var wg sync.WaitGroup
	errs := make([]error, n)
	for i := range n {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			out, err := f.start(candidates[i], code)
			if err == nil && out.Kind != "started" {
				err = errors.New("kind " + out.Kind)
			}
			errs[i] = err
		}(i)
	}
	wg.Wait()
	for i, err := range errs {
		if err != nil {
			t.Fatalf("racer %d: %v", i, err)
		}
	}
	var runtimes, started, accepted int
	_ = db.QueryRow("SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?", f.scheduleID).Scan(&runtimes)
	_ = db.QueryRow("SELECT COUNT(*) FROM assessment_module_attempts m JOIN student_attempts a ON a.id = m.attempt_id WHERE a.schedule_id = ? AND m.started_at IS NOT NULL", f.scheduleID).Scan(&started)
	_ = db.QueryRow("SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ? AND sat_start_code_accepted_at IS NOT NULL", f.scheduleID).Scan(&accepted)
	if runtimes != 1 || started != n || accepted != n {
		t.Fatalf("runtimes=%d started=%d accepted=%d", runtimes, started, accepted)
	}
}

func TestSATAccessCodeCrossServiceColdRuntimeRaceMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(-time.Minute), now.Add(2*time.Hour))
	code := f.code(t).Value
	candidates := []codeStartCandidate{f.admit(t, "Service racer 1"), f.admit(t, "Service racer 2")}
	services := []*delivery.Service{
		f.app.Delivery,
		delivery.NewService(db, f.app.Tx).SetCodeStart(f.app.Runtime, f.app.Schedules.RuntimeStartPlanner()),
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	var examID, versionID string
	if err := db.QueryRowContext(ctx, "SELECT exam_id, published_version_id FROM exam_schedules WHERE id = ?", f.scheduleID).Scan(&examID, &versionID); err != nil {
		t.Fatal(err)
	}
	linkID := uuid.NewString()
	if _, err := db.ExecContext(ctx, `INSERT INTO assessment_access_links
		(id, exam_id, published_version_id, schedule_id, name, audience_type, access_mode, availability_type, created_by)
		VALUES (?, ?, ?, ?, 'cold-race barrier', 'anyone', 'open', 'anytime', 'test')`,
		linkID, examID, versionID, f.scheduleID); err != nil {
		t.Fatal(err)
	}
	// Hold both first-module rows exclusively. Reservation claims do not touch
	// these rows, so both services can claim slots before the first transaction
	// blocks while activating its candidate's module.
	locker, err := db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelReadCommitted})
	if err != nil {
		t.Fatal(err)
	}
	defer locker.Rollback()
	for _, candidate := range candidates {
		if err := f.app.Delivery.EnsureBaseModuleAttemptForSchedule(ctx, candidate.attemptID, f.scheduleID); err != nil {
			t.Fatal(err)
		}
		var lockedModule string
		if err := locker.QueryRowContext(ctx,
			"SELECT id FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE",
			candidate.attemptID, f.baseID).Scan(&lockedModule); err != nil {
			t.Fatal(err)
		}
	}
	retryMetric := telemetry.MSATStartCodeTxRetry
	retryBefore := telemetry.CounterValueForTest(telemetry.DefaultRegistry, retryMetric, "direction", "exclusive_to_shared")
	start := make(chan struct{})
	results := make(chan error, len(candidates))
	for i := range candidates {
		go func(service *delivery.Service, candidate codeStartCandidate) {
			<-start
			var epoch int
			if err := db.QueryRowContext(ctx, "SELECT control_epoch FROM student_attempts WHERE id = ?", candidate.attemptID).Scan(&epoch); err != nil {
				results <- err
				return
			}
			out, err := service.StartWithCode(ctx, f.scheduleID, candidate.attemptID, f.scheduleID,
				delivery.SatCodeStartRequest{Code: code, ControlEpoch: epoch}, candidate.session, candidate.token)
			if err == nil && (out == nil || out.Kind != "started") {
				kind := "<nil>"
				if out != nil {
					kind = out.Kind
				}
				err = errors.New("kind " + kind)
			}
			results <- err
		}(services[i], candidates[i])
	}
	close(start)

	waitDeadline := time.NewTimer(5 * time.Second)
	waitPoll := time.NewTicker(time.Millisecond)
	for {
		var pending int
		if err := db.QueryRowContext(ctx,
			"SELECT COUNT(*) FROM sat_start_code_reservations WHERE schedule_id = ? AND state = 'pending'",
			f.scheduleID).Scan(&pending); err != nil {
			waitPoll.Stop()
			waitDeadline.Stop()
			t.Fatal(err)
		}
		if pending >= len(candidates) {
			break
		}
		select {
		case <-waitPoll.C:
		case <-waitDeadline.C:
			waitPoll.Stop()
			t.Fatalf("both services did not reserve before module activation lock release")
		}
	}
	waitPoll.Stop()
	waitDeadline.Stop()
	if err := locker.Commit(); err != nil {
		t.Fatal(err)
	}
	for range len(candidates) {
		select {
		case err := <-results:
			if err != nil {
				t.Fatalf("concurrent start: %v", err)
			}
		case <-ctx.Done():
			t.Fatal("concurrent starts did not finish after schedule unlock")
		}
	}
	retryAfter := telemetry.CounterValueForTest(telemetry.DefaultRegistry, retryMetric, "direction", "exclusive_to_shared")
	if retryAfter-retryBefore < 1 {
		t.Fatalf("stale exclusive initializer was not retried shared: before=%v after=%v", retryBefore, retryAfter)
	}
	var runtimes, accepted, started int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?", f.scheduleID).Scan(&runtimes); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM student_attempts WHERE schedule_id = ? AND sat_start_code_accepted_at IS NOT NULL", f.scheduleID).Scan(&accepted); err != nil {
		t.Fatal(err)
	}
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_module_attempts m JOIN student_attempts a ON a.id = m.attempt_id WHERE a.schedule_id = ? AND m.started_at IS NOT NULL", f.scheduleID).Scan(&started); err != nil {
		t.Fatal(err)
	}
	if runtimes != 1 || accepted != len(candidates) || started != len(candidates) {
		t.Fatalf("runtimes=%d accepted=%d first modules started=%d", runtimes, accepted, started)
	}
}

func TestSATAccessCodeWindowAndExpiryMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	now := time.Now().UTC()
	f := newCodeStartFixture(t, db, now.Add(time.Hour), now.Add(3*time.Hour))
	code := f.code(t).Value
	c := f.admit(t, "Early")
	if _, err := f.start(c, code); reasonOf(err) != "START_WINDOW_NOT_OPEN" {
		t.Fatalf("before open: %v", err)
	}
	// Close the window without anyone starting: the sweep seals the
	// candidate as never started, without a result or a runtime.
	if _, err := db.Exec("UPDATE exam_schedules SET start_time = ?, end_time = ? WHERE id = ?", now.Add(-2*time.Hour), now.Add(-time.Second), f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.start(c, code); reasonOf(err) != "START_WINDOW_CLOSED" {
		t.Fatalf("after close: %v", err)
	}
	if _, err := f.app.Proctor.ReconcileExpiredSections(ctx, time.Now().UTC(), 50, "test"); err != nil {
		t.Fatalf("sweep: %v", err)
	}
	var reason, status string
	if err := db.QueryRow("SELECT reason FROM attempt_terminalizations WHERE attempt_id = ?", c.attemptID).Scan(&reason); err != nil || reason != "start_window_closed" {
		t.Fatalf("never-started receipt expected, got %q %v", reason, err)
	}
	var results int
	_ = db.QueryRow("SELECT COUNT(*) FROM assessment_results WHERE attempt_id = ?", c.attemptID).Scan(&results)
	if results != 0 {
		t.Fatal("a never-started candidate must not get a result")
	}
	if err := db.QueryRow("SELECT status FROM exam_schedules WHERE id = ?", f.scheduleID).Scan(&status); err != nil || status != "completed" {
		t.Fatalf("a never-opened code session closes without a runtime, got %q %v", status, err)
	}
	var runtimes int
	_ = db.QueryRow("SELECT COUNT(*) FROM exam_session_runtimes WHERE schedule_id = ?", f.scheduleID).Scan(&runtimes)
	if runtimes != 0 {
		t.Fatal("expiry must not fabricate a runtime")
	}
	// The SAT result repair sweep never resurrects a result for it.
	if _, err := terminalization.RepairSATResults(ctx, db, 50); err != nil {
		t.Fatalf("repair: %v", err)
	}
	_ = db.QueryRow("SELECT COUNT(*) FROM assessment_results WHERE attempt_id = ?", c.attemptID).Scan(&results)
	if results != 0 {
		t.Fatal("repair must not materialize a never-started result")
	}
	var snapshot string
	_ = db.QueryRow("SELECT CAST(final_snapshot AS CHAR) FROM attempt_terminalizations WHERE attempt_id = ?", c.attemptID).Scan(&snapshot)
	if !strings.Contains(snapshot, `"satStart"`) || !strings.Contains(snapshot, `"access_code"`) {
		t.Fatalf("receipt must record the start disposition: %s", snapshot)
	}
}

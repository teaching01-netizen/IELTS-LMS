package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/exams"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/results"
	"example.com/ielts-proctoring/internal/terminalization"
)

// Real-MySQL coverage for docs/sat_newmode.md TC-09..TC-12: the staff Module 2
// assignment races on one attempt row lock and one (attempt, section) decision key.
func TestSATClassroomStaffRouteRaceMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, base, _, _ := seedStaleETagExam(t, db)
	if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = 'staff_selects' WHERE id = ?", schedule); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	// Module 1 is long expired: the clock closes it, and staff_selects must not route.
	if _, err := svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	count := func(query string, args ...any) int {
		t.Helper()
		var n int
		if err := db.QueryRowContext(ctx, query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	if n := count("SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?", attempt); n != 0 {
		t.Fatalf("staff_selects routed on its own: %d decisions", n)
	}
	if n := count("SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?", attempt, base); n != 0 {
		t.Fatalf("Module 2 opened before staff chose: %d", n)
	}
	var state string
	if err := db.QueryRowContext(ctx, "SELECT state FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attempt, base).Scan(&state); err != nil {
		t.Fatal(err)
	}
	if !attempts.SATModuleTerminal(state) {
		t.Fatalf("Module 1 did not close: %s", state)
	}

	// TC-12: completion is refused while the attempt awaits staff.
	runner := tx.NewRunner(db)
	err := runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		return attempts.EnsureSATModuleTopologyTx(ctx, q, attempt)
	})
	if e, ok := apperrors.As(err); !ok || e.HTTPStatus != 409 {
		t.Fatalf("awaiting attempt must not complete: %v", err)
	}

	// TC-09: opposite assignments released together by a barrier. Exactly one
	// route can win; every caller gets that route or a 409 — never a second branch.
	// Each caller owns its pool and service, standing in for separate API instances.
	const callers = 16
	instances := make([]*delivery.Service, callers)
	for i := range instances {
		pool := staleETagTestDB(t)
		instances[i] = delivery.NewService(pool, tx.NewRunner(pool))
	}
	start := make(chan struct{})
	type outcome struct {
		route string
		res   *delivery.StaffRouteResult
		err   error
	}
	out := make(chan outcome, callers)
	var wg sync.WaitGroup
	for i := 0; i < callers; i++ {
		route := "lower"
		if i%2 == 1 {
			route = "higher"
		}
		instance := instances[i]
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			res, err := instance.AssignStaffRoute(ctx, "staff-race", schedule, attempt, "reading-writing", route)
			out <- outcome{route, res, err}
		}()
	}
	close(start)
	wg.Wait()
	close(out)
	winner, committed, conflicts := "", 0, 0
	for o := range out {
		if o.err == nil {
			if !o.res.Replayed {
				committed++
			}
			if winner == "" {
				winner = o.res.Route
			}
			if o.res.Route != winner {
				t.Fatalf("two routes both succeeded: %s and %s", winner, o.res.Route)
			}
			continue
		}
		if e, ok := apperrors.As(o.err); !ok || e.HTTPStatus != 409 {
			t.Fatalf("losing assignment must be a 409, got %v", o.err)
		}
		conflicts++
	}
	if committed != 1 || winner == "" {
		t.Fatalf("exactly one assignment must commit: committed=%d winner=%q conflicts=%d", committed, winner, conflicts)
	}
	if n := count("SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?", attempt); n != 1 {
		t.Fatalf("decisions=%d", n)
	}
	if n := count("SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?", attempt, base); n != 1 {
		t.Fatalf("Module 2 branches=%d", n)
	}
	var selected, policy string
	if err := db.QueryRowContext(ctx, "SELECT selected_route, policy_key FROM assessment_route_decisions WHERE attempt_id = ?", attempt).Scan(&selected, &policy); err != nil {
		t.Fatal(err)
	}
	if selected != winner || policy != "classroom_staff_selects" {
		t.Fatalf("decision %s/%s does not match winner %s", selected, policy, winner)
	}

	// TC-10: an identical retry replays; TC-11: the opposite choice is a 409.
	again, err := svc.AssignStaffRoute(ctx, "staff-race", schedule, attempt, "reading-writing", winner)
	if err != nil || !again.Replayed {
		t.Fatalf("identical retry must replay: %+v %v", again, err)
	}
	opposite := "lower"
	if winner == "lower" {
		opposite = "higher"
	}
	if _, err := svc.AssignStaffRoute(ctx, "staff-race", schedule, attempt, "reading-writing", opposite); err == nil {
		t.Fatal("changing a committed route must fail")
	} else if e, ok := apperrors.As(err); !ok || e.HTTPStatus != 409 {
		t.Fatalf("change must be 409: %v", err)
	}
	if n := count("SELECT COUNT(*) FROM session_audit_logs WHERE schedule_id = ? AND action_type = 'SAT_ROUTE_ASSIGNED'", schedule); n != 1 {
		t.Fatalf("audit rows=%d, want one per committed assignment", n)
	}
}

// TC-19: concurrent Module 1 closes (clock backstop + browser + retries) under a
// forced policy produce one decision and one branch, always the forced one.
func TestSATClassroomForcedRouteConcurrentCloseMySQL(t *testing.T) {
	for _, tc := range []struct{ policy, role, key string }{
		{"force_lower", "lower_branch", "classroom_force_lower"},
		{"force_higher", "higher_branch", "classroom_force_higher"},
	} {
		t.Run(tc.policy, func(t *testing.T) {
			db := staleETagTestDB(t)
			ctx := context.Background()
			schedule, attempt, base, _, _ := seedStaleETagExam(t, db) // 3/3 correct: adaptive would go higher
			if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = ? WHERE id = ?", tc.policy, schedule); err != nil {
				t.Fatal(err)
			}
			svc := delivery.NewService(db, tx.NewRunner(db))
			start := make(chan struct{})
			errs := make(chan error, 12)
			var wg sync.WaitGroup
			for i := 0; i < 12; i++ {
				wg.Add(1)
				go func() {
					defer wg.Done()
					<-start
					_, err := svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC())
					errs <- err
				}()
			}
			close(start)
			wg.Wait()
			close(errs)
			for err := range errs {
				if err != nil {
					t.Fatalf("racing close: %v", err)
				}
			}
			var decisions, branches int
			if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?", attempt).Scan(&decisions); err != nil {
				t.Fatal(err)
			}
			var role, key string
			if err := db.QueryRowContext(ctx, "SELECT COUNT(*), COALESCE(MAX(m.adaptive_role), '') FROM assessment_module_attempts ma JOIN assessment_modules m ON m.id = ma.module_id WHERE ma.attempt_id = ? AND ma.module_id <> ?", attempt, base).Scan(&branches, &role); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(ctx, "SELECT policy_key FROM assessment_route_decisions WHERE attempt_id = ?", attempt).Scan(&key); err != nil {
				t.Fatal(err)
			}
			if decisions != 1 || branches != 1 || role != tc.role || key != tc.key {
				t.Fatalf("decisions=%d branches=%d role=%s policy=%s", decisions, branches, role, key)
			}
		})
	}
}

// TC-14: a classroom attempt sealed while a module is still unscored withholds
// its raw score; concurrent repair sweeps release it exactly once.
func TestSATClassroomRawScoreReleasedOnceMySQL(t *testing.T) {
	f := newSATV2CompletionFixture(t)
	ctx := context.Background()
	if _, err := f.db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.ExecContext(ctx, "UPDATE exam_entities e JOIN exam_schedules sch ON sch.exam_id = e.id SET e.sat_score_report_enabled = TRUE WHERE sch.id = ?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if err := f.submit(ctx); err != nil {
		t.Fatal(err)
	}
	read := func() (release string, revision int, payload string) {
		t.Helper()
		if err := f.db.QueryRowContext(ctx, "SELECT release_status, revision, CAST(score_payload AS CHAR) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", f.attemptID).Scan(&release, &revision, &payload); err != nil {
			t.Fatal(err)
		}
		return
	}
	release, revision, _ := read()
	if release != "pending" {
		t.Fatalf("unscored modules must withhold the raw score, got %s", release)
	}
	if _, err := f.db.ExecContext(ctx, "UPDATE assessment_module_attempts SET raw_correct = 2, operational_question_count = 3 WHERE attempt_id = ?", f.attemptID); err != nil {
		t.Fatal(err)
	}
	const sweeps = 4
	start := make(chan struct{})
	errs := make(chan error, sweeps)
	var wg sync.WaitGroup
	for i := 0; i < sweeps; i++ {
		pool := staleETagTestDB(t) // one pool per sweeper: separate worker instances
		wg.Add(1)
		go func() {
			defer wg.Done()
			<-start
			_, _, err := terminalization.RepairClassroomResults(ctx, pool, 50)
			errs <- err
		}()
	}
	close(start)
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Fatalf("repair sweep: %v", err)
		}
	}
	release, after, payload := read()
	if release != "released" || after != revision+1 {
		t.Fatalf("released once expected: status=%s revision %d -> %d", release, revision, after)
	}
	var doc struct {
		Raw struct{ RawCorrect, Total int } `json:"classroomRaw"`
	}
	if err := json.Unmarshal([]byte(payload), &doc); err != nil || doc.Raw.RawCorrect != 4 || doc.Raw.Total != 6 {
		t.Fatalf("raw score payload = %s (%v)", payload, err)
	}
	if _, _, err := terminalization.RepairClassroomResults(ctx, f.db, 50); err != nil {
		t.Fatal(err)
	}
	if _, again, _ := read(); again != after {
		t.Fatalf("a later sweep rewrote a released result: %d -> %d", after, again)
	}
}

// REG-01: the score report switch opens classroom sittings only. A Standard
// Practice sitting of an exam with the switch on (e.g. backfilled by 0085)
// stays withheld at seal, through repair sweeps, and at bootstrap.
func TestSATPracticeSittingNeverReleasesWithReportOnMySQL(t *testing.T) {
	f := newSATV2CompletionFixture(t)
	ctx := context.Background()
	if _, err := f.db.ExecContext(ctx, "UPDATE exam_entities e JOIN exam_schedules sch ON sch.exam_id = e.id SET e.sat_score_report_enabled = TRUE WHERE sch.id = ?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if err := f.submit(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := f.db.ExecContext(ctx, "UPDATE assessment_module_attempts SET raw_correct = 2, operational_question_count = 3 WHERE attempt_id = ?", f.attemptID); err != nil {
		t.Fatal(err)
	}
	if _, _, err := terminalization.RepairClassroomResults(ctx, f.db, 50); err != nil {
		t.Fatal(err)
	}
	var release, payload string
	if err := f.db.QueryRowContext(ctx, "SELECT release_status, CAST(score_payload AS CHAR) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", f.attemptID).Scan(&release, &payload); err != nil {
		t.Fatal(err)
	}
	if release == "released" || strings.Contains(payload, "classroomRaw") {
		t.Fatalf("practice sitting released a report: status=%s payload=%s", release, payload)
	}
	var open bool
	if err := f.db.QueryRowContext(ctx, results.SATScoreReportOpenSQL, f.attemptID).Scan(&open); err != nil || open {
		t.Fatalf("bootstrap gate for a practice sitting = %v (%v), want closed", open, err)
	}
	// Positive control: the same attempt in a classroom session opens the gate.
	if _, err := f.db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?", f.scheduleID); err != nil {
		t.Fatal(err)
	}
	if err := f.db.QueryRowContext(ctx, results.SATScoreReportOpenSQL, f.attemptID).Scan(&open); err != nil || !open {
		t.Fatalf("bootstrap gate for a classroom sitting = %v (%v), want open", open, err)
	}
}

// Close-vs-staff-route-vs-terminalization: a sealed attempt must never gain a
// Module 2, and a racing seal and assignment may not deadlock or fail with a 5xx.
func TestSATClassroomStaffRouteVsTerminalizationMySQL(t *testing.T) {
	seal := func(runner *tx.Runner, schedule, attempt string) error {
		actor := "proctor-race"
		_, err := terminalization.NewService(runner, nil, nil).Terminalize(context.Background(), terminalization.SealCommand{
			AttemptID: attempt, ScheduleID: schedule, Outcome: terminalization.OutcomeTerminated,
			Reason: terminalization.ReasonProctorTerminate, ActorKind: terminalization.ActorProctor, ActorID: &actor, RequestID: "req-" + attempt,
		})
		return err
	}
	setup := func(t *testing.T) (db *sql.DB, svc *delivery.Service, runner *tx.Runner, schedule, attempt, base string) {
		db = staleETagTestDB(t)
		schedule, attempt, base, _, _ = seedStaleETagExam(t, db)
		if _, err := db.Exec("UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = 'staff_selects' WHERE id = ?", schedule); err != nil {
			t.Fatal(err)
		}
		runner = tx.NewRunner(db)
		svc = delivery.NewService(db, runner)
		if _, err := svc.ReconcileAttemptTimeout(context.Background(), schedule, attempt, time.Now().UTC()); err != nil {
			t.Fatal(err)
		}
		return
	}
	branches := func(t *testing.T, db *sql.DB, attempt, base string) (n int) {
		t.Helper()
		if err := db.QueryRow("SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ?", attempt, base).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return
	}

	t.Run("seal then assign", func(t *testing.T) {
		db, svc, runner, schedule, attempt, base := setup(t)
		if err := seal(runner, schedule, attempt); err != nil {
			t.Fatal(err)
		}
		_, err := svc.AssignStaffRoute(context.Background(), "staff", schedule, attempt, "reading-writing", "lower")
		if e, ok := apperrors.As(err); !ok || e.HTTPStatus != 409 {
			t.Fatalf("assigning a sealed attempt must be a 409, got %v", err)
		}
		if n := branches(t, db, attempt, base); n != 0 {
			t.Fatalf("sealed attempt gained %d Module 2 attempt(s)", n)
		}
	})

	t.Run("seal races assign", func(t *testing.T) {
		db, svc, runner, schedule, attempt, base := setup(t)
		start := make(chan struct{})
		sealErr, assignErr := make(chan error, 1), make(chan error, 1)
		go func() { <-start; sealErr <- seal(runner, schedule, attempt) }()
		go func() {
			<-start
			_, err := svc.AssignStaffRoute(context.Background(), "staff", schedule, attempt, "reading-writing", "lower")
			assignErr <- err
		}()
		close(start)
		if err := <-sealErr; err != nil {
			t.Fatalf("seal must always win or follow the assignment: %v", err)
		}
		if err := <-assignErr; err != nil {
			if e, ok := apperrors.As(err); !ok || e.HTTPStatus != 409 {
				t.Fatalf("losing assignment must be a 409, got %v", err)
			}
		}
		var receipts int
		if err := db.QueryRow("SELECT COUNT(*) FROM attempt_terminalizations WHERE attempt_id = ?", attempt).Scan(&receipts); err != nil || receipts != 1 {
			t.Fatalf("receipts=%d err=%v", receipts, err)
		}
		// Whichever order won, no Module 2 may be left open on the sealed attempt.
		var open int
		if err := db.QueryRow("SELECT COUNT(*) FROM assessment_module_attempts WHERE attempt_id = ? AND module_id <> ? AND state NOT IN ('submitted','locked')", attempt, base).Scan(&open); err != nil || open != 0 {
			t.Fatalf("open Module 2 attempts on a sealed attempt: %d (%v) branches=%d", open, err, branches(t, db, attempt, base))
		}
	})
}

// TC-20 / rollout stop: closing the creation gate (SAT_CLASSROOM_ENABLED=false,
// or a fleet still mixing old binaries) refuses NEW classroom sessions but must
// let an already-started classroom attempt finish its route.
func TestSATClassroomGateOffStillFinishesStartedAttemptsMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	schedule, attempt, _, _, _ := seedStaleETagExam(t, db)
	if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = 'staff_selects' WHERE id = ?", schedule); err != nil {
		t.Fatal(err)
	}
	exams.SetClassroomCreationEnabled(false)
	t.Cleanup(func() { exams.SetClassroomCreationEnabled(true) })
	if err := exams.PersistSATSession(ctx, db, schedule, "sat", "v", exams.SATSession{Classroom: true, Route: exams.SATRouteStaffSelects}, nil); err == nil {
		t.Fatal("a closed gate must refuse new classroom sessions")
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	if _, err := svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AssignStaffRoute(ctx, "staff-gate", schedule, attempt, "reading-writing", "higher"); err != nil {
		t.Fatalf("started classroom attempt must finish with the gate closed: %v", err)
	}
}

// SC-01..05 end to end: the converter stored on the published version converts
// the released raw score by the administered topology (base + higher = full
// higher), pins the converter version in classroomRaw, and fails closed —
// "unavailable", never a number — on a count mismatch or a missing topology.
func TestSATClassroomConvertedScoreMySQL(t *testing.T) {
	table := func(ops int, rangeAt int) map[string]any {
		scores := map[string]any{}
		for r := 0; r <= ops; r++ {
			scores[strconv.Itoa(r)] = 400 + 20*r
		}
		if rangeAt >= 0 {
			scores[strconv.Itoa(rangeAt)] = map[string]int{"low": 480, "high": 500}
		}
		return map[string]any{"operationalQuestions": ops, "scores": scores}
	}
	converter := func(version, topology string, ops int) string {
		raw, err := json.Marshal(map[string]any{
			"converterVersion": version, "scoreType": "estimated_sat", "calibrationSource": "staff_approved",
			"sections": map[string]any{"reading-writing": map[string]string{topology: "t"}},
			"tables":   map[string]any{"t": table(ops, 4)},
		})
		if err != nil {
			t.Fatal(err)
		}
		return string(raw)
	}
	type section struct {
		SectionKey       string `json:"sectionKey"`
		RawCorrect       int    `json:"rawCorrect"`
		Total            int    `json:"total"`
		ConversionStatus string `json:"conversionStatus"`
		Topology         string `json:"topology"`
		Scaled           *struct{ Low, High int }
		Roles            any `json:"roles"`
	}
	type report struct {
		Conversion  *struct{ ConverterVersion, ScoreType string } `json:"conversion"`
		TotalScaled any                                           `json:"totalScaled"`
		Sections    []section                                     `json:"sections"`
	}
	release := func(t *testing.T, policy string) (*satV2CompletionFixture, report, string) {
		f := newSATV2CompletionFixture(t)
		ctx := context.Background()
		for _, stmt := range []string{
			"UPDATE exam_schedules SET sat_session_mode = 'classroom' WHERE id = ?",
			"UPDATE exam_entities e JOIN exam_schedules sch ON sch.exam_id = e.id SET e.sat_score_report_enabled = TRUE WHERE sch.id = ?",
		} {
			if _, err := f.db.ExecContext(ctx, stmt, f.scheduleID); err != nil {
				t.Fatal(err)
			}
		}
		if _, err := f.db.ExecContext(ctx, `INSERT INTO assessment_scoring_policies (id, exam_version_id, policy_key, policy_config)
			SELECT UUID(), published_version_id, 'estimated_sat', ? FROM student_attempts WHERE id = ?`, policy, f.attemptID); err != nil {
			t.Fatal(err)
		}
		if err := f.submit(ctx); err != nil {
			t.Fatal(err)
		}
		// Base 2/3 + higher 2/3: raw 4 of 6 operational in a full_higher section.
		if _, err := f.db.ExecContext(ctx, "UPDATE assessment_module_attempts SET raw_correct = 2, operational_question_count = 3 WHERE attempt_id = ?", f.attemptID); err != nil {
			t.Fatal(err)
		}
		if _, _, err := terminalization.RepairClassroomResults(ctx, f.db, 50); err != nil {
			t.Fatal(err)
		}
		var status, payload string
		if err := f.db.QueryRowContext(ctx, "SELECT release_status, CAST(score_payload AS CHAR) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", f.attemptID).Scan(&status, &payload); err != nil {
			t.Fatal(err)
		}
		var doc struct {
			Raw report `json:"classroomRaw"`
		}
		if err := json.Unmarshal([]byte(payload), &doc); err != nil || status != "released" || len(doc.Raw.Sections) != 1 {
			t.Fatalf("release status=%s payload=%s (%v)", status, payload, err)
		}
		if doc.Raw.Sections[0].Roles != nil {
			t.Fatalf("internal roles leaked into the report: %s", payload)
		}
		return &f, doc.Raw, payload
	}

	t.Run("converted and pinned", func(t *testing.T) {
		f, r, payload := release(t, converter("classroom-v1", "full_higher", 6))
		s := r.Sections[0]
		if r.Conversion == nil || r.Conversion.ConverterVersion != "classroom-v1" || r.Conversion.ScoreType != "estimated_sat" ||
			s.ConversionStatus != "converted" || s.Topology != "full_higher" || s.RawCorrect != 4 || s.Total != 6 ||
			s.Scaled == nil || s.Scaled.Low != 480 || s.Scaled.High != 500 {
			t.Fatalf("converted report = %s", payload)
		}
		if r.TotalScaled != nil {
			t.Fatalf("one section must not produce a 400–1600 total: %s", payload)
		}
		// A later converter edit never rewrites a released result.
		ctx := context.Background()
		if _, err := f.db.ExecContext(ctx, "UPDATE assessment_scoring_policies SET policy_config = ? WHERE exam_version_id = (SELECT published_version_id FROM student_attempts WHERE id = ?)", converter("classroom-v2", "full_higher", 6), f.attemptID); err != nil {
			t.Fatal(err)
		}
		if _, _, err := terminalization.RepairClassroomResults(ctx, f.db, 50); err != nil {
			t.Fatal(err)
		}
		var after string
		if err := f.db.QueryRowContext(ctx, "SELECT CAST(score_payload AS CHAR) FROM assessment_results WHERE attempt_id = ? AND provider_key = 'sat'", f.attemptID).Scan(&after); err != nil || after != payload {
			t.Fatalf("released report changed after a converter edit: %v\n%s\n%s", err, payload, after)
		}
	})
	for name, policy := range map[string]string{
		"operational count mismatch": converter("classroom-v1", "full_higher", 5),
		"standalone table only":      converter("classroom-v1", "m2_higher_only", 6),
		"lower route table only":     converter("classroom-v1", "full_lower", 6),
	} {
		t.Run(name, func(t *testing.T) {
			_, r, payload := release(t, policy)
			s := r.Sections[0]
			if r.Conversion == nil || s.ConversionStatus != "unavailable" || s.Scaled != nil || r.TotalScaled != nil || s.RawCorrect != 4 {
				t.Fatalf("must fail closed with the raw score kept: %s", payload)
			}
		})
	}
}

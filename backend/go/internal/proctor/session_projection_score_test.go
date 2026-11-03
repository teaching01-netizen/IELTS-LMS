package proctor

// Live SAT score projection for the staff room (zero-click scores): counts
// only, never key material. These tests pin the builder rules — sealed sets
// correctness, an open module withholds it, pretest rows never count, an
// invalidated attempt never scores, a missing plan withholds the total — plus
// the loader fences (is_pretest exclusion, terminal_generation outcome fence)
// and the best-effort contract (failures omit keys, never fail the room).

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"github.com/google/uuid"

	platformdb "example.com/ielts-proctoring/internal/platform/db"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func scoreTestPlan() []SessionPlanSection {
	return []SessionPlanSection{
		{SectionKey: "reading-writing", Label: "Reading & Writing"},
		{SectionKey: "math", Label: "Math"},
	}
}

func scoreI64(v int64) *int64 { v2 := v; return &v2 }

func scoreTestFact(attempt, module, section, state string, raw, ops *int64, plan, answered int64) scoreModuleFacts {
	f := scoreModuleFacts{
		attemptID:  attempt,
		moduleKey:  module,
		sectionKey: section,
		state:      state,
		planCount:  plan,
		answered:   answered,
	}
	if raw != nil {
		f.rawCorrect = sql.NullInt64{Int64: *raw, Valid: true}
	}
	if ops != nil {
		f.operationalCount = sql.NullInt64{Int64: *ops, Valid: true}
	}
	return f
}

func scoreTestRow(attempt string) studentSessionRow {
	return studentSessionRow{
		id: attempt, candidateID: "cand-1", candidateName: "Candidate",
		scheduleID: "sched-1", currentModule: "Module 1", phase: "exam",
		examID: "exam-1", examTitle: "SAT", updatedAt: time.Now().UTC(),
		proctorStatus: "active", providerKey: "sat",
		attemptRevision: 3,
	}
}

func scoreTestRuntime() SessionRuntime {
	return SessionRuntime{Status: "live", ServerNow: time.Now().UTC()}
}

func mustScoreProj(t *testing.T, m map[string]*studentScoreProjection, id string) *studentScoreProjection {
	t.Helper()
	p, ok := m[id]
	if !ok || p == nil {
		t.Fatalf("attempt %s has no projection", id)
	}
	return p
}

func intVal(t *testing.T, p *int, what string) int {
	t.Helper()
	if p == nil {
		t.Fatalf("%s is nil, want a value", what)
	}
	return *p
}

func strVal(t *testing.T, p *string, what string) string {
	t.Helper()
	if p == nil {
		t.Fatalf("%s is nil, want a value", what)
	}
	return *p
}

// A sealed attempt (every module locked + raw_correct present) publishes the
// exact summed correct, total, answered split, and per-module breakdown.
func TestBuildScoreProjectionsSealedPublishesExactCorrect(t *testing.T) {
	facts := []scoreModuleFacts{
		scoreTestFact("att-1", "rw-m1", "reading-writing", "locked", scoreI64(9), scoreI64(13), 13, 11),
		scoreTestFact("att-1", "rw-m2", "reading-writing", "locked", scoreI64(9), scoreI64(14), 14, 14),
		scoreTestFact("att-2", "math-m1", "math", "active", nil, nil, 10, 3),
	}
	got := buildScoreProjections(scoreTestPlan(), facts, map[string]string{}, []string{"att-1", "att-2", "att-3"})

	sealed := mustScoreProj(t, got, "att-1")
	if sealed.status != ScoreStatusScored {
		t.Fatalf("sealed status = %q, want scored", sealed.status)
	}
	if c := intVal(t, sealed.correct, "sealed correct"); c != 18 {
		t.Fatalf("sealed correct = %d, want 18", c)
	}
	if total := intVal(t, sealed.total, "sealed total"); total != 27 {
		t.Fatalf("sealed total = %d, want 27", total)
	}
	if sealed.answered != 25 {
		t.Fatalf("sealed answered = %d, want 25", sealed.answered)
	}
	if len(sealed.modules) != 2 {
		t.Fatalf("sealed modules = %d, want 2", len(sealed.modules))
	}
	if sealed.modules[0].ModuleKey != "rw-m1" || intVal(t, sealed.modules[0].Correct, "m1 correct") != 9 || sealed.modules[0].Total != 13 || sealed.modules[0].Answered != 11 {
		t.Fatalf("m1 projection wrong: %+v", sealed.modules[0])
	}
	if sealed.modules[1].ModuleKey != "rw-m2" || intVal(t, sealed.modules[1].Correct, "m2 correct") != 9 || sealed.modules[1].Total != 14 || sealed.modules[1].Answered != 14 {
		t.Fatalf("m2 projection wrong: %+v", sealed.modules[1])
	}

	open := mustScoreProj(t, got, "att-2")
	if open.status != ScoreStatusAnswering {
		t.Fatalf("open status = %q, want answering", open.status)
	}
	if open.correct != nil {
		t.Fatalf("open correct = %d, want nil (module still active)", *open.correct)
	}
	if total := intVal(t, open.total, "open total"); total != 10 {
		t.Fatalf("open total = %d, want 10 (plan-count fallback)", total)
	}
	if open.answered != 3 {
		t.Fatalf("open answered = %d, want 3", open.answered)
	}
	if len(open.modules) != 1 || open.modules[0].Correct != nil {
		t.Fatalf("open module must withhold correct: %+v", open.modules)
	}

	fresh := mustScoreProj(t, got, "att-3")
	if fresh.status != ScoreStatusUnstarted {
		t.Fatalf("untaken status = %q, want unstarted", fresh.status)
	}
	if fresh.total != nil || fresh.correct != nil || len(fresh.modules) != 0 || fresh.answered != 0 {
		t.Fatalf("untaken attempt must carry no counts: %+v", fresh)
	}
}

// Any open module withholds attempt correctness, even when a sibling module
// is already sealed and scored.
func TestBuildScoreProjectionsOpenModuleWithholdsCorrect(t *testing.T) {
	facts := []scoreModuleFacts{
		scoreTestFact("att-1", "rw-m1", "reading-writing", "locked", scoreI64(9), scoreI64(13), 13, 13),
		scoreTestFact("att-1", "rw-m2", "reading-writing", "review", nil, nil, 14, 5),
	}
	got := buildScoreProjections(scoreTestPlan(), facts, map[string]string{}, []string{"att-1"})
	p := mustScoreProj(t, got, "att-1")
	if p.status != ScoreStatusAnswering {
		t.Fatalf("status = %q, want answering", p.status)
	}
	if p.correct != nil {
		t.Fatalf("correct must be nil while a module is open, got %d", *p.correct)
	}
	if total := intVal(t, p.total, "total"); total != 27 {
		t.Fatalf("total = %d, want 27", total)
	}
	for _, m := range p.modules {
		if m.Correct != nil {
			t.Fatalf("module %s must withhold correct while the attempt is open", m.ModuleKey)
		}
	}
}

// Every module sealed but at least one not yet graded: scoring, not scored,
// and correctness stays nil.
func TestBuildScoreProjectionsSealedUnscoredIsScoring(t *testing.T) {
	facts := []scoreModuleFacts{
		scoreTestFact("att-1", "rw-m1", "reading-writing", "submitted", nil, nil, 13, 13),
	}
	got := buildScoreProjections(scoreTestPlan(), facts, map[string]string{}, []string{"att-1"})
	p := mustScoreProj(t, got, "att-1")
	if p.status != ScoreStatusScoring {
		t.Fatalf("status = %q, want scoring", p.status)
	}
	if p.correct != nil {
		t.Fatalf("correct must be nil while grading is pending")
	}
	if total := intVal(t, p.total, "total"); total != 13 {
		t.Fatalf("total = %d, want 13", total)
	}
}

// An invalidated attempt never scores, even with sealed raw_correct present:
// Not scored, never 0/total.
func TestBuildScoreProjectionsInvalidatedIsNotScored(t *testing.T) {
	facts := []scoreModuleFacts{
		scoreTestFact("att-1", "rw-m1", "reading-writing", "locked", scoreI64(9), scoreI64(13), 13, 13),
	}
	for _, outcome := range []string{"invalidated_proctor", "invalidated_timeout", "unscored"} {
		got := buildScoreProjections(scoreTestPlan(), facts, map[string]string{"att-1": outcome}, []string{"att-1"})
		p := mustScoreProj(t, got, "att-1")
		if p.status != ScoreStatusNotScored {
			t.Fatalf("outcome %s: status = %q, want not_scored", outcome, p.status)
		}
		if p.correct != nil {
			t.Fatalf("outcome %s: correct must be nil", outcome)
		}
		for _, m := range p.modules {
			if m.Correct != nil {
				t.Fatalf("outcome %s: module correct must be nil", outcome)
			}
		}
		if total := intVal(t, p.total, "total"); total != 13 {
			t.Fatalf("outcome %s: total = %d, want 13", outcome, total)
		}
	}
}

// A missing plan withholds the total (the room shows a dash) but still
// projects answering state, answered counts, and exact correctness.
func TestBuildScoreProjectionsMissingPlanWithholdsTotal(t *testing.T) {
	facts := []scoreModuleFacts{
		scoreTestFact("att-1", "rw-m1", "reading-writing", "locked", scoreI64(9), scoreI64(13), 13, 13),
	}
	got := buildScoreProjections(nil, facts, map[string]string{}, []string{"att-1"})
	p := mustScoreProj(t, got, "att-1")
	if p.total != nil {
		t.Fatalf("total must be nil without a plan, got %d", *p.total)
	}
	if p.status != ScoreStatusScored {
		t.Fatalf("status = %q, want scored", p.status)
	}
	if c := intVal(t, p.correct, "correct"); c != 9 {
		t.Fatalf("correct = %d, want 9", c)
	}
	if len(p.modules) != 1 || p.modules[0].Total != 13 {
		t.Fatalf("per-module totals survive a missing plan: %+v", p.modules)
	}
}

// Totals and correctness cover the same scoped module set: a taken module
// outside the plan still lists (factual) but contributes to neither sum, so
// the implied percentage can never exceed 100%.
func TestBuildScoreProjectionsScopeExcludesUnscopedModules(t *testing.T) {
	plan := []SessionPlanSection{{SectionKey: "reading-writing", Label: "RW"}}
	facts := []scoreModuleFacts{
		scoreTestFact("att-1", "rw-m1", "reading-writing", "locked", scoreI64(9), scoreI64(13), 13, 13),
		scoreTestFact("att-1", "math-m1", "math", "locked", scoreI64(5), scoreI64(10), 10, 10),
	}
	got := buildScoreProjections(plan, facts, map[string]string{}, []string{"att-1"})
	p := mustScoreProj(t, got, "att-1")
	if p.status != ScoreStatusScored {
		t.Fatalf("status = %q, want scored", p.status)
	}
	if total := intVal(t, p.total, "total"); total != 13 {
		t.Fatalf("total = %d, want 13 (math excluded)", total)
	}
	if c := intVal(t, p.correct, "correct"); c != 9 {
		t.Fatalf("correct = %d, want 9 (math excluded)", c)
	}
	if len(p.modules) != 2 {
		t.Fatalf("both taken modules still list: %+v", p.modules)
	}
}

// RULE-H (F-H, T-08): answered covers the same counted scope as the total:
// a taken module outside the plan still lists (factual) but contributes
// to neither sum, while the per-module listing preserves its answers.
func TestBuildScoreProjectionsAnsweredExcludesUnscopedModules(t *testing.T) {
	plan := []SessionPlanSection{{SectionKey: "reading-writing", Label: "RW"}}
	facts := []scoreModuleFacts{
		scoreTestFact("att-1", "rw-m1", "reading-writing", "locked", scoreI64(9), scoreI64(13), 13, 11),
		scoreTestFact("att-1", "math-m1", "math", "locked", scoreI64(5), scoreI64(10), 10, 7),
	}
	got := buildScoreProjections(plan, facts, map[string]string{}, []string{"att-1"})
	p := mustScoreProj(t, got, "att-1")
	if p.status != ScoreStatusScored {
		t.Fatalf("status = %q, want scored", p.status)
	}
	if p.answered != 11 {
		t.Fatalf("answered = %d, want 11 (out-of-scope answers excluded)", p.answered)
	}
	if total := intVal(t, p.total, "total"); total != 13 {
		t.Fatalf("total = %d, want 13 (math excluded)", total)
	}
	if c := intVal(t, p.correct, "correct"); c != 9 {
		t.Fatalf("correct = %d, want 9 (math excluded)", c)
	}
	if len(p.modules) != 2 {
		t.Fatalf("both taken modules still list: %+v", p.modules)
	}
	if p.modules[1].ModuleKey != "math-m1" || p.modules[1].Answered != 7 {
		t.Fatalf("out-of-scope module must still list factually: %+v", p.modules[1])
	}
	if p.modules[1].Correct != nil {
		t.Fatalf("out-of-scope module must withhold correct, got %d", *p.modules[1].Correct)
	}
}

// RULE-I (F-I, T-09): a zero-question counted scope never pairs with
// scored: the total is withheld (nil, never &0) and the attempt reads
// scoring with correctness withheld.
func TestBuildScoreProjectionsZeroTotalIsScoringWithNilTotal(t *testing.T) {
	plan := []SessionPlanSection{{SectionKey: "reading-writing", Label: "RW"}}
	facts := []scoreModuleFacts{
		scoreTestFact("att-1", "rw-m1", "reading-writing", "locked", scoreI64(0), scoreI64(0), 0, 0),
	}
	got := buildScoreProjections(plan, facts, map[string]string{}, []string{"att-1"})
	p := mustScoreProj(t, got, "att-1")
	if p.total != nil {
		t.Fatalf("total must be nil for a zero-question counted scope, got %d", *p.total)
	}
	if p.status == ScoreStatusScored {
		t.Fatalf("status must never be scored with a zero total")
	}
	if p.status != ScoreStatusScoring {
		t.Fatalf("status = %q, want scoring", p.status)
	}
	if p.correct != nil {
		t.Fatalf("correct must be nil while scoring, got %d", *p.correct)
	}
	for _, m := range p.modules {
		if m.Correct != nil {
			t.Fatalf("module %s must withhold correct while scoring", m.ModuleKey)
		}
	}
}

// attemptRowToSession applies the roll-up and stays key-free on the wire.
func TestAttemptRowToSessionAppliesScoreProjection(t *testing.T) {
	row := scoreTestRow("att-1")
	proj := &studentScoreProjection{
		answered: 25, total: intPtr(27), correct: intPtr(18),
		status: ScoreStatusScored,
		modules: []ScoreModuleProjection{
			{ModuleKey: "rw-m1", Answered: 11, Correct: intPtr(9), Total: 13},
			{ModuleKey: "rw-m2", Answered: 14, Correct: intPtr(9), Total: 14},
		},
	}
	got := attemptRowToSession(row, scoreTestRuntime(), proj)
	if strVal(t, got.ScoreStatus, "status") != ScoreStatusScored {
		t.Fatalf("status = %v, want scored", got.ScoreStatus)
	}
	if intVal(t, got.ScoreCorrect, "correct") != 18 || intVal(t, got.ScoreTotal, "total") != 27 || intVal(t, got.ScoreAnswered, "answered") != 25 {
		t.Fatalf("counts wrong: %+v", got)
	}
	if len(got.ScoreModules) != 2 || got.ScoreModules[0].ModuleKey != "rw-m1" {
		t.Fatalf("modules wrong: %+v", got.ScoreModules)
	}
	// A nil roll-up omits every score key: old clients and old rows see no change.
	plain := attemptRowToSession(row, scoreTestRuntime(), nil)
	wire, err := json.Marshal(plain)
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"scoreAnswered", "scoreTotal", "scoreCorrect", "scoreStatus", "scoreModules"} {
		if strings.Contains(string(wire), key) {
			t.Fatalf("nil projection must omit %s: %s", key, wire)
		}
	}
}

// The projection is counts only: no correct-answer text, key, or verdict
// material may cross into the proctor payload.
func TestScoreProjectionNeverEmitsKeyMaterial(t *testing.T) {
	row := scoreTestRow("att-1")
	proj := &studentScoreProjection{
		answered: 25, total: intPtr(27), correct: intPtr(18),
		status: ScoreStatusScored,
		modules: []ScoreModuleProjection{
			{ModuleKey: "rw-m1", Answered: 11, Correct: intPtr(9), Total: 13},
		},
	}
	wire, err := json.Marshal(attemptRowToSession(row, scoreTestRuntime(), proj))
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"correctAnswer", "CorrectAnswer", "isCorrect", "IsCorrect", "answerDefinition", "acceptedResponse", "correct_option"} {
		if strings.Contains(string(wire), forbidden) {
			t.Fatalf("wire payload must never carry %q: %s", forbidden, wire)
		}
	}
	for _, required := range []string{`"scoreAnswered":25`, `"scoreTotal":27`, `"scoreCorrect":18`, `"scoreStatus":"scored"`, `"moduleKey":"rw-m1"`} {
		if !strings.Contains(string(wire), required) {
			t.Fatalf("wire payload must carry %s: %s", required, wire)
		}
	}
}

func intPtr(v int) *int { return &v }

// The grouped facts query must exclude pretest questions and prefer the V2
// canonical response per question (eq.id match first, mirroring the seal).
func TestLoadScoreModuleFactsPinsFences(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("is_pretest").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"attempt_id", "module_key", "section_key", "state",
			"raw_correct", "operational", "plan", "answered",
		}).
			AddRow("att-1", "rw-m1", "reading-writing", "locked", int64(9), int64(13), int64(13), int64(11)).
			AddRow("att-2", "math-m1", "math", "active", nil, nil, int64(10), int64(3)))

	facts, err := loadScoreModuleFacts(context.Background(), db, "sched-1")
	if err != nil {
		t.Fatalf("facts load must succeed: %v", err)
	}
	if len(facts) != 2 {
		t.Fatalf("facts = %d rows, want 2", len(facts))
	}
	if facts[0].attemptID != "att-1" || !facts[0].rawCorrect.Valid || facts[0].rawCorrect.Int64 != 9 {
		t.Fatalf("first fact wrong: %+v", facts[0])
	}
	if facts[1].rawCorrect.Valid || facts[1].operationalCount.Valid {
		t.Fatalf("open module must carry null sealed counts: %+v", facts[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The outcome read fences on terminal_generation so a stale generation's
// result never marks the live attempt; duplicates resolve invalidation-first.
func TestLoadScoreOutcomesFencesOnTerminalGeneration(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("terminal_generation").
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "outcome_status"}).
			AddRow("att-1", "scored").
			AddRow("att-1", "invalidated_proctor").
			AddRow("att-2", nil))

	outcomes, err := loadScoreOutcomes(context.Background(), db, "sched-1")
	if err != nil {
		t.Fatalf("outcomes load must succeed: %v", err)
	}
	if outcomes["att-1"] != "invalidated_proctor" {
		t.Fatalf("invalidation must win duplicates, got %q", outcomes["att-1"])
	}
	if _, ok := outcomes["att-2"]; ok {
		t.Fatalf("null outcome must be absent, got %v", outcomes)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Best-effort contract: non-SAT providers skip the loads entirely, empty rooms
// skip them, and any grouped-count failure yields nil (omit keys) instead of
// failing the room read.
func TestLoadScoreProjectionsBestEffort(t *testing.T) {
	ctx := context.Background()
	if got := loadScoreProjections(ctx, nil, "sat", "sched-1", scoreTestPlan(), []string{"att-1"}); got != nil {
		t.Fatal("nil querier must yield nil")
	}
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	if got := loadScoreProjections(ctx, db, "ielts", "sched-1", scoreTestPlan(), []string{"att-1"}); got != nil {
		t.Fatal("non-SAT provider must skip score loads")
	}
	if got := loadScoreProjections(ctx, db, "sat", "sched-1", scoreTestPlan(), nil); got != nil {
		t.Fatal("empty room must skip score loads")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	failing, failMock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer failing.Close()
	failMock.ExpectQuery(".*").WillReturnError(sql.ErrConnDone)
	if got := loadScoreProjections(ctx, failing, "sat", "sched-1", scoreTestPlan(), []string{"att-1"}); got != nil {
		t.Fatal("facts failure must omit scores, not fail")
	}

	outcomeFailing, outcomeMock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer outcomeFailing.Close()
	outcomeMock.ExpectQuery("FROM assessment_module_attempts ma").WillReturnRows(
		sqlmock.NewRows([]string{"attempt_id", "module_key", "section_key", "state", "raw_correct", "operational", "plan", "answered"}))
	outcomeMock.ExpectQuery("FROM student_attempts sa").WillReturnError(sql.ErrConnDone)
	if got := loadScoreProjections(ctx, outcomeFailing, "sat", "sched-1", scoreTestPlan(), []string{"att-1"}); got != nil {
		t.Fatal("outcomes failure must omit scores, not fail")
	}
}

// The read-only txn wrapper falls back to the shared handle when a txn
// cannot begin, and reports unavailable when there is no handle at all.
func TestScoreReadQuerierFallback(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), db, nil, nil, nil)
	q, finish := svc.scoreReadQuerier(context.Background())
	defer finish()
	if q == nil {
		t.Fatal("fallback querier must be non-nil")
	}

	none := NewService(nil, nil, nil, nil, nil)
	if q, finish := none.scoreReadQuerier(context.Background()); q != nil {
		finish()
		t.Fatal("no handle must yield no querier")
	}
}

// Integration: real MySQL semantics for the grouped counts — pretest
// exclusion, V2-wins dedup, legacy fallback, plan-count fallback for open
// modules, and the invalidated fence — through the room detail read.
func TestScoreProjectionMySQL(t *testing.T) {
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(4)
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable: %v", err)
	}
	defer conn.Close()
	if _, err := conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS = 0"); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS = 1")

	examID, versionID, scheduleID := uuid.NewString(), "v-score-1", uuid.NewString()
	attSealed, attOpen, attInvalid, attNew := uuid.NewString(), uuid.NewString(), uuid.NewString(), uuid.NewString()
	secID, modID := uuid.NewString(), uuid.NewString()
	eq1, eq2, eqPre := uuid.NewString(), uuid.NewString(), uuid.NewString()
	maSealed, maOpen, maInvalid := uuid.NewString(), uuid.NewString(), uuid.NewString()
	t.Cleanup(func() {
		for _, q := range []string{
			"DELETE FROM attempt_responses_v2 WHERE attempt_id IN (?, ?, ?, ?)",
			"DELETE FROM assessment_question_responses WHERE module_attempt_id IN (?, ?, ?)",
			"DELETE FROM assessment_results WHERE attempt_id IN (?, ?, ?, ?)",
			"DELETE FROM assessment_module_attempts WHERE attempt_id IN (?, ?, ?, ?)",
			"DELETE FROM student_attempts WHERE schedule_id = ?",
			"DELETE FROM assessment_exam_questions WHERE module_id = ?",
			"DELETE FROM assessment_modules WHERE id = ?",
			"DELETE FROM assessment_sections WHERE id = ?",
			"DELETE FROM exam_schedules WHERE id = ?",
			"DELETE FROM exam_versions WHERE id = ?",
			"DELETE FROM exam_entities WHERE id = ?",
		} {
			n := strings.Count(q, "?")
			args := []any{}
			switch {
			case strings.Contains(q, "attempt_responses_v2") || strings.Contains(q, "assessment_results WHERE") || strings.Contains(q, "assessment_module_attempts WHERE"):
				args = []any{attSealed, attOpen, attInvalid, attNew}
			case strings.Contains(q, "assessment_question_responses"):
				args = []any{maSealed, maOpen, maInvalid}
			case strings.Contains(q, "student_attempts WHERE"):
				args = []any{scheduleID}
			case strings.Contains(q, "assessment_exam_questions"):
				args = []any{modID}
			case strings.Contains(q, "assessment_modules"):
				args = []any{modID}
			case strings.Contains(q, "assessment_sections"):
				args = []any{secID}
			case strings.Contains(q, "exam_schedules"):
				args = []any{scheduleID}
			case strings.Contains(q, "exam_versions"):
				args = []any{versionID}
			default:
				args = []any{examID}
			}
			_ = n
			if _, err := db.ExecContext(ctx, q, args...); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
	})
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed: %v\n%s", err, query)
		}
	}
	exec(`INSERT INTO exam_entities (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility, organization_id, owner_id, schema_version, revision)
		VALUES (?, ?, 'score room', 'sat', 'SAT', 'Academic', 'published', 'organization', 'score-org', 'score-owner', 1, 0)`, examID, examID)
	exec(`INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published)
		VALUES (?, ?, 1, '{}', '{}', 'score-owner', TRUE)`, versionID, examID)
	exec(`INSERT INTO exam_schedules (id, exam_id, provider_key, organization_id, exam_title, proctor_display_name, grading_display_name, published_version_id,
			cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, status, created_by, ielts_timing_model)
		VALUES (?, ?, 'sat', 'score-org', 'score room', 'score room', 'score room', ?, 'score-room', 'Codex',
			UTC_TIMESTAMP() - INTERVAL 1 HOUR, UTC_TIMESTAMP() + INTERVAL 4 HOUR, 180, 'proctor_start', 'live', 'score-owner', ?)`,
		scheduleID, examID, versionID, "legacy_section_v1")
	exec(`INSERT INTO assessment_sections (id, exam_version_id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions, tool_policy)
		VALUES (?, ?, 'reading-writing', 'Reading & Writing', 0, 5760, 0, '{}', '{}')`, secID, versionID)
	exec(`INSERT INTO assessment_modules (id, section_id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy)
		VALUES (?, ?, 'rw-m1', 'Module 1', 0, 2100, 2, 'base', '{}', '{}')`, modID, secID)
	exec(`INSERT INTO assessment_exam_questions (id, module_id, question_id, question_revision_id, display_order, is_pretest)
		VALUES (?, ?, 'q-1', 'rev-1', 0, FALSE), (?, ?, 'q-2', 'rev-2', 1, FALSE), (?, ?, 'q-pre', 'rev-pre', 2, TRUE)`,
		eq1, modID, eq2, modID, eqPre, modID)
	seedAttempt := func(id, delivery string, submitted bool) {
		sub, final := "NULL", "NULL"
		if submitted {
			sub, final = "UTC_TIMESTAMP(6)", "'{}'"
		}
		exec(`INSERT INTO student_attempts (id, schedule_id, student_key, exam_id, published_version_id, exam_title, candidate_id, candidate_name, candidate_email,
			phase, current_module, answers, writing_answers, flags, violations_snapshot, integrity, recovery, delivery_status, submitted_at, final_submission, terminal_generation, updated_at) VALUES
			(?, ?, ?, ?, ?, 'score room', ?, ?, ?, 'exam', 'reading', '{}', '{}', '{}', '[]', '{}', '{}', ?, `+sub+`, `+final+`, 0, UTC_TIMESTAMP(6))`,
			id, scheduleID, id, examID, versionID, "cand-"+id[:8], "Candidate", "c@example.test", delivery)
	}
	seedAttempt(attSealed, "submitted", true)
	seedAttempt(attOpen, "running", false)
	seedAttempt(attInvalid, "submitted", true)
	seedAttempt(attNew, "running", false)
	exec(`INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, raw_correct, operational_question_count, tool_state)
		VALUES (?, ?, ?, 'locked', 1800, 1, 2, '{}')`, maSealed, attSealed, modID)
	exec(`INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, tool_state)
		VALUES (?, ?, ?, 'active', 1800, '{}')`, maOpen, attOpen, modID)
	exec(`INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, raw_correct, operational_question_count, tool_state)
		VALUES (?, ?, ?, 'locked', 1800, 2, 2, '{}')`, maInvalid, attInvalid, modID)
	// Sealed: V2 answers q-1; a legacy duplicate must not double-count; the
	// pretest answer must be excluded.
	exec(`INSERT INTO attempt_responses_v2 (attempt_id, question_id, module_id, lease_epoch, control_epoch, client_version, client_write_id, request_hash, response, response_hash, server_revision)
		VALUES (?, ?, ?, 1, 1, 1, ?, 'req-1', '{"answer":"A","markedForReview":false}', 'hash-1', 1)`, attSealed, eq1, modID, uuid.NewString())
	exec(`INSERT INTO attempt_responses_v2 (attempt_id, question_id, module_id, lease_epoch, control_epoch, client_version, client_write_id, request_hash, response, response_hash, server_revision)
		VALUES (?, ?, ?, 1, 1, 1, ?, 'req-pre', '{"answer":"B","markedForReview":false}', 'hash-pre', 1)`, attSealed, eqPre, modID, uuid.NewString())
	exec(`INSERT INTO assessment_question_responses (id, module_attempt_id, exam_question_id, response, eliminated_options, annotations)
		VALUES (?, ?, ?, '"A"', '[]', '{}')`, uuid.NewString(), maSealed, eq1)
	// Open: legacy answers q-1; q-2 has a present-but-null V2 payload that owns
	// the question and clears the legacy answer (V2 wins).
	exec(`INSERT INTO assessment_question_responses (id, module_attempt_id, exam_question_id, response, eliminated_options, annotations)
		VALUES (?, ?, ?, '"A"', '[]', '{}'), (?, ?, ?, '"C"', '[]', '{}')`, uuid.NewString(), maOpen, eq1, uuid.NewString(), maOpen, eq2)
	exec(`INSERT INTO attempt_responses_v2 (attempt_id, question_id, module_id, lease_epoch, control_epoch, client_version, client_write_id, request_hash, response, response_hash, server_revision)
		VALUES (?, ?, ?, 1, 1, 1, ?, 'req-null', '{"answer":null,"markedForReview":false}', 'hash-null', 1)`, attOpen, eq2, modID, uuid.NewString())
	exec(`INSERT INTO assessment_results (id, attempt_id, provider_key, outcome_status, score_payload, terminal_generation)
		VALUES (?, ?, 'sat', 'scored', '{}', 0)`, uuid.NewString(), attSealed)
	exec(`INSERT INTO assessment_results (id, attempt_id, provider_key, outcome_status, score_payload, terminal_generation)
		VALUES (?, ?, 'sat', 'invalidated_proctor', '{}', 0)`, uuid.NewString(), attInvalid)

	plan := []SessionPlanSection{{SectionKey: "reading-writing", Label: "Reading & Writing"}}
	facts, err := loadScoreModuleFacts(ctx, db, scheduleID)
	if err != nil {
		t.Fatalf("facts: %v", err)
	}
	byAttempt := map[string][]scoreModuleFacts{}
	for _, f := range facts {
		byAttempt[f.attemptID] = append(byAttempt[f.attemptID], f)
	}
	if len(byAttempt[attSealed]) != 1 || byAttempt[attSealed][0].answered != 1 || byAttempt[attSealed][0].planCount != 2 {
		t.Fatalf("sealed facts must count q-1 once and exclude the pretest: %+v", byAttempt[attSealed])
	}
	if len(byAttempt[attOpen]) != 1 || byAttempt[attOpen][0].answered != 1 {
		t.Fatalf("open facts must count the legacy answer and drop the V2-nulled one: %+v", byAttempt[attOpen])
	}
	outcomes, err := loadScoreOutcomes(ctx, db, scheduleID)
	if err != nil {
		t.Fatalf("outcomes: %v", err)
	}
	if outcomes[attSealed] != "scored" || outcomes[attInvalid] != "invalidated_proctor" {
		t.Fatalf("outcomes wrong: %v", outcomes)
	}
	if _, ok := outcomes[attOpen]; ok {
		t.Fatalf("open attempt must have no outcome: %v", outcomes)
	}

	proj := buildScoreProjections(plan, facts, outcomes, []string{attSealed, attOpen, attInvalid, attNew})
	sealed := mustScoreProj(t, proj, attSealed)
	if sealed.status != ScoreStatusScored || intVal(t, sealed.correct, "sealed correct") != 1 || intVal(t, sealed.total, "sealed total") != 2 || sealed.answered != 1 {
		t.Fatalf("sealed projection wrong: %+v", sealed)
	}
	open := mustScoreProj(t, proj, attOpen)
	if open.status != ScoreStatusAnswering || open.correct != nil || intVal(t, open.total, "open total") != 2 || open.answered != 1 {
		t.Fatalf("open projection wrong: %+v", open)
	}
	invalid := mustScoreProj(t, proj, attInvalid)
	if invalid.status != ScoreStatusNotScored || invalid.correct != nil {
		t.Fatalf("invalidated projection wrong: %+v", invalid)
	}
	if fresh := mustScoreProj(t, proj, attNew); fresh.status != ScoreStatusUnstarted {
		t.Fatalf("untaken projection wrong: %+v", fresh)
	}

	// End to end: the room detail read carries the projection and never fails.
	svc := NewService(nil, db, nil, nil, SQLAssignmentChecker{})
	detail, err := svc.GetSessionDetail(ctx, Actor{ID: "admin-1", Role: RoleAdmin}, scheduleID, 0, 0)
	if err != nil {
		t.Fatalf("GetSessionDetail must not fail on score loads: %v", err)
	}
	byID := map[string]StudentSessionSummary{}
	for _, s := range detail.Sessions {
		byID[s.AttemptID] = s
	}
	endSealed, ok := byID[attSealed]
	if !ok || strVal(t, endSealed.ScoreStatus, "sealed status") != ScoreStatusScored || intVal(t, endSealed.ScoreCorrect, "sealed correct") != 1 {
		t.Fatalf("detail sealed row wrong: %+v", endSealed)
	}
	endOpen, ok := byID[attOpen]
	if !ok || strVal(t, endOpen.ScoreStatus, "open status") != ScoreStatusAnswering || endOpen.ScoreCorrect != nil {
		t.Fatalf("detail open row wrong: %+v", endOpen)
	}
	wire, err := json.Marshal(detail.Sessions)
	if err != nil {
		t.Fatal(err)
	}
	for _, forbidden := range []string{"correctAnswer", "isCorrect", "answerDefinition"} {
		if strings.Contains(string(wire), forbidden) {
			t.Fatalf("detail payload must never carry %q", forbidden)
		}
	}
}

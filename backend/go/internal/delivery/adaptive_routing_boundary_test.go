package delivery

// SAT adaptive-routing boundary (plan rigorous test 1).
//
// For an operational count of 25 and threshold 13 the router must return:
// rawCorrect 12 -> lower, rawCorrect 13 -> higher, rawCorrect 14 -> higher.
// The boundary cases go further than the route NAME: they drive the full
// finalizeModuleTx path and assert the returned MODULE ID and adaptive role,
// so a correct name paired with the wrong module cannot pass.

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
)

func TestChooseAdaptiveRouteBoundary(t *testing.T) {
	const config = `{"minimumCorrectForHigher":13}`
	cases := []struct {
		rawCorrect int
		want       string
	}{
		{0, "lower"},
		{12, "lower"},
		{13, "higher"},
		{14, "higher"},
		{25, "higher"},
	}
	for _, tc := range cases {
		got, err := chooseAdaptiveRoute(tc.rawCorrect, 25, config)
		if err != nil {
			t.Fatalf("chooseAdaptiveRoute(%d, 25) error: %v", tc.rawCorrect, err)
		}
		if got != tc.want {
			t.Errorf("chooseAdaptiveRoute(%d, 25) = %q, want %q", tc.rawCorrect, got, tc.want)
		}
	}
}

// boundaryScoringRows builds one scoring row per operational question: the
// first `correct` questions answer B (the correct option), the rest answer C.
func boundaryScoringRows(mock sqlmock.Sqlmock, correct, total int) {
	singleChoice := `{"kind":"single_choice","correctOptionId":"B"}`
	rows := sqlmock.NewRows([]string{"eq_id", "is_pretest", "answer_definition", "response", "response_v2", "v_question_id"})
	for i := 0; i < total; i++ {
		response := `"C"`
		if i < correct {
			response = `"B"`
		}
		rows.AddRow("eq-boundary-"+string(rune('a'+i/26))+string(rune('a'+i%26)), false, singleChoice, response, nil, nil)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions")).
		WithArgs("ma-base", "ma-base", "mod-base").
		WillReturnRows(rows)
}

func boundaryRoutePolicy(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "break_after_seconds"}).AddRow("sec-1", 0))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs("mod-base").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "display_order", "adaptive_role", "exam_version_id"}).
			AddRow("sec-1", "reading-writing", 0, "base", "pv-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
		WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "policy_revision"}).
			AddRow("sec-1", "mod-base", "mod-lower", "mod-higher", "threshold", `{"minimumCorrectForHigher":13}`, 1))
}

func boundaryBranchExpectations(mock sqlmock.Sqlmock, moduleID, route, moduleKey, role string, rawCorrect int) {
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_route_decisions")).
		WithArgs(sqlmock.AnyArg(), "att-1", "sec-1", "ma-base", "mod-base", moduleID, route, rawCorrect, 25, "threshold", 1, sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
		WithArgs(moduleID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "section_key", "module_key", "duration_seconds", "adaptive_role", "tool_policy"}).
			AddRow(moduleID, "sec-1", "reading-writing", moduleKey, 3600, role, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(time.Now().UTC()))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM student_attempts sa JOIN exam_session_runtimes")).
		WithArgs("att-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"cohort", "personal"}).AddRow(0, 0))
	mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_module_attempts")).
		WithArgs(sqlmock.AnyArg(), "att-1", moduleID, 3600, sqlmock.AnyArg(), sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(1, 1))
}

func boundaryFinalize(t *testing.T, correct int) *nextModuleRow {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	mock.ExpectBegin()
	now := time.Now().UTC()
	started := now.Add(-time.Minute)
	boundaryScoringRows(mock, correct, 25)
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = ?")).
		WithArgs("locked", true, "time_expired", correct, 25, "ma-base").
		WillReturnResult(sqlmock.NewResult(0, 1))
	boundaryRoutePolicy(mock)
	if correct >= 13 {
		boundaryBranchExpectations(mock, "mod-higher", "higher", "rw-hard", "higher_branch", correct)
	} else {
		boundaryBranchExpectations(mock, "mod-lower", "lower", "rw-easy", "lower_branch", correct)
	}
	tx, txerr := db.BeginTx(context.Background(), nil)
	if txerr != nil {
		t.Fatal(txerr)
	}
	next, err := svc.finalizeModuleTx(context.Background(), tx, "att-1", saveActiveModule{
		id: "ma-base", moduleID: "mod-base",
		state: "active", allocatedSeconds: 3600,
		availableAt: &started, startedAt: &started,
	}, "time_expired")
	if err != nil {
		t.Fatalf("boundary finalize(%d/25) must succeed, got %v", correct, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return next
}

// Routing and module-open observability: a threshold finalize must emit
// sat_adaptive_route_total{section,route} and
// sat_adaptive_module_open_total{role} exactly once with the selected branch.
func TestBoundaryEmitsAdaptiveRoutingMetrics(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	boundaryFinalize(t, 13)
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATAdaptiveRouteTotal, "section", "reading-writing", "route", "higher"); got != 1 {
		t.Fatalf("sat_adaptive_route_total{reading-writing,higher} = %v, want 1", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATAdaptiveModuleOpenTotal, "role", "higher_branch"); got != 1 {
		t.Fatalf("sat_adaptive_module_open_total{higher_branch} = %v, want 1", got)
	}
}

// Exactly at the threshold the router must open the HIGHER module id —
// the assertion is on the module identity, never only on the route name.
func TestBoundaryRoutesHigherModuleIDAtThreshold(t *testing.T) {
	next := boundaryFinalize(t, 13)
	if next == nil {
		t.Fatal("threshold score must produce a follow-up module")
	}
	if next.id != "mod-higher" {
		t.Fatalf("13/25 must open mod-higher, got %q", next.id)
	}
	if next.adaptiveRole != "higher_branch" {
		t.Fatalf("13/25 must open higher_branch, got %q", next.adaptiveRole)
	}
}

// One below the threshold the router must open the LOWER module id.
func TestBoundaryRoutesLowerModuleIDBelowThreshold(t *testing.T) {
	next := boundaryFinalize(t, 12)
	if next == nil {
		t.Fatal("below-threshold score must produce a follow-up module")
	}
	if next.id != "mod-lower" {
		t.Fatalf("12/25 must open mod-lower, got %q", next.id)
	}
	if next.adaptiveRole != "lower_branch" {
		t.Fatalf("12/25 must open lower_branch, got %q", next.adaptiveRole)
	}
}

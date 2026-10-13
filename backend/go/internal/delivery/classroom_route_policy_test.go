package delivery

import (
	"context"
	"database/sql/driver"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// A forced classroom policy overrides the Module 1 score but still commits the
// route decision (with a classroom policy key) in the same transaction.
func TestNextModuleTxForcedRouteIgnoresModule1Score(t *testing.T) {
	cases := []struct {
		policy, route, moduleID, role, key string
		plan                               any
	}{
		{"force_higher", "higher", "mod-higher", "higher_branch", "classroom_force_higher", nil},
		{"force_lower", "lower", "mod-lower", "lower_branch", "classroom_force_lower", nil},
		// A single-branch plan wins over an adaptive session policy.
		{"adaptive", "higher", "mod-higher", "higher_branch", "classroom_force_higher", `{"reading-writing":"m1_hard"}`},
	}
	for _, tc := range cases {
		t.Run(tc.policy, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := deliverySvc(db)
			mock.ExpectBegin()
			txn, err := db.BeginTx(context.Background(), nil)
			if err != nil {
				t.Fatal(err)
			}
			// 1/25 would route Lower adaptively; 25/25 would route Higher.
			rawCorrect := 1
			if tc.route == "lower" {
				rawCorrect = 25
			}
			mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
				WithArgs("mod-base").
				WillReturnRows(nextModuleSectionRows([]driver.Value{"sec-1", "reading-writing", 0, "base", "pv-1"}))
			mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
				WithArgs("sec-1").
				WillReturnRows(sqlmock.NewRows([]string{"section_id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "policy_revision"}).
					AddRow("sec-1", "mod-base", "mod-lower", "mod-higher", "practice_threshold", `{"minimumCorrectForHigher":13}`, 1))
			mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(sch.sat_route_policy, 'adaptive') FROM student_attempts sa")).
				WithArgs("att-1").
				WillReturnRows(sqlmock.NewRows([]string{"policy"}).AddRow(tc.policy))
			mock.ExpectQuery("sat_classroom_plan").WithArgs("pv-1").WillReturnRows(sqlmock.NewRows([]string{"plan"}).AddRow(tc.plan))
			mock.ExpectExec(regexp.QuoteMeta("INSERT INTO assessment_route_decisions")).
				WithArgs(sqlmock.AnyArg(), "att-1", "sec-1", "ma-base", "mod-base", tc.moduleID, tc.route, rawCorrect, 25, tc.key, 1, sqlmock.AnyArg(), nil, "att-1", "mod-base", sqlmock.AnyArg()).
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE m.id = ?")).
				WithArgs(tc.moduleID).
				WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "section_key", "module_key", "duration_seconds", "adaptive_role", "tool_policy"}).
					AddRow(tc.moduleID, "sec-1", "reading-writing", "rw-m2", 3600, tc.role, nil))

			next, err := svc.nextModuleTx(context.Background(), txn, "att-1", "ma-base", "mod-base", rawCorrect, 25, routeAudit{})
			if err != nil {
				t.Fatalf("forced route must succeed: %v", err)
			}
			if next == nil || next.id != tc.moduleID || next.adaptiveRole != tc.role {
				t.Fatalf("forced %s opened %+v, want %s (%s)", tc.policy, next, tc.moduleID, tc.role)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// Late evidence can never "flip" a staff/plan-forced route: those decisions are
// not score-derived, so no review signal or audit row is produced for them.
func TestEvidenceWouldChangeRouteSkipsClassroomDecisions(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	txn, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT selected_route, CAST(policy_config AS CHAR), policy_key FROM assessment_route_decisions")).
		WithArgs("att-1", "ma-base").
		WillReturnRows(sqlmock.NewRows([]string{"selected_route", "policy_config", "policy_key"}).
			AddRow("higher", `{"minimumCorrectForHigher":13}`, "classroom_staff_selects"))
	changed, scored, evidence, err := deliverySvc(db).evidenceWouldChangeRouteTx(context.Background(), txn, "att-1", saveActiveModule{id: "ma-base"}, nil, nil)
	if err != nil || changed || scored != "higher" || evidence != "higher" {
		t.Fatalf("classroom decision must not be flippable: changed=%v %q/%q err=%v", changed, scored, evidence, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

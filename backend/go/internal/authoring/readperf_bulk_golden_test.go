package authoring

// Phase 02: golden + statement-budget oracle for the BULK read path.
//
// WHY THIS FILE EXISTS (the Phase-01 handoff's critical finding)
// --------------------------------------------------------------
// readperf_golden_test.go drives Service.Shell() through sqlmock and therefore
// pins the CURRENT N+1 statement shape (one modules probe per section, one
// questions probe per module). Those expectations stay correct in Phase 02
// because Shell() is deliberately NOT cut over — but they would become a
// FALSE-POSITIVE gate the moment Phase 03 switches Shell() onto the bulk
// path: the projection would be byte-identical while the sqlmock sequence
// legitimately changed.
//
// The fix is not to delete or weaken the golden test. It is to separate the
// two things that file was conflating:
//
//   1. the JSON projection oracle — readPerfGoldenShellJSON() in
//      readperf_golden_test.go, which stays BYTE-IDENTICAL and is the AT-01
//      proof; and
//   2. the SQL statement sequence — implementation detail, which the bulk
//      path must satisfy with its OWN expectation set.
//
// This file adds (2) for the bulk path and re-asserts (1) against the very
// same frozen golden string. After Phase 03 cuts Shell() over, the nested
// expectations in readperf_golden_test.go become the obsolete half and can be
// retired; the bulk sequence pinned here is already the target shape.
//
// It also carries the query-count regression gate the handoff asked for:
// the bulk TREE must cost at most 4 statements, and sqlmock fails the test on
// any statement the implementation issues that the expectation list does not
// declare — so the budget is enforced structurally, not by convention.

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// readPerfBulkGoldenDB builds a Service over a sqlmock pool and returns the
// pool too, so the delivery bulk loader can be driven from the same mock.
func readPerfBulkGoldenDB(t *testing.T) (*sql.DB, *tx.Runner, sqlmock.Sqlmock) {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	runner := tx.NewRunner(db)
	return db, runner, mock
}

// readPerfBulkIdentityRows is the bulk path's SINGLE-statement preamble: the
// exam row LEFT JOINed to its current draft version. One statement replaces
// Shell()'s two sequential probes.
func readPerfBulkIdentityRows(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.provider_key, e.current_draft_version_id, v.revision")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}).
			AddRow("sat", "draft-v1", 7))
}

// readPerfBulkModuleRows is the bulk modules SELECT: every module of the
// version, with section_id so the assembler can group them. Column order
// matches loadBulkModules' scan order exactly.
func readPerfBulkModuleRows(mock sqlmock.Sqlmock, rows [][]driver.Value) {
	expect := sqlmock.NewRows([]string{"id", "section_id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "tool_policy", "revision"})
	for _, row := range rows {
		expect.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT m.id, m.section_id, m.module_key")).
		WithArgs("draft-v1").
		WillReturnRows(expect)
}

// readPerfBulkQuestionRows is the bulk question SELECT: every question of the
// version, prefixed with module_id so questions group without a per-module
// round trip. Column order matches loadBulkQuestionRows.
func readPerfBulkQuestionRows(mock sqlmock.Sqlmock, rows [][]driver.Value) {
	expect := sqlmock.NewRows([]string{
		"module_id", "id", "question_id", "question_revision_id", "section_key",
		"display_order", "is_pretest", "question_type",
		"semantic_revision", "revision",
		"stimulus", "prompt", "answer_definition", "rationale", "metadata",
	})
	for _, row := range rows {
		expect.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.module_id, eq.id, eq.question_id")).
		WithArgs("draft-v1").
		WillReturnRows(expect)
}

// readPerfBulkRoutingRows is the bulk routing SELECT: every policy of the
// version, prefixed with section_id. Column order matches loadBulkRouting.
func readPerfBulkRoutingRows(mock sqlmock.Sqlmock, rows [][]driver.Value) {
	expect := sqlmock.NewRows([]string{"section_id", "id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "revision"})
	for _, row := range rows {
		expect.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT rp.section_id, rp.id, rp.base_module_id")).
		WithArgs("draft-v1").
		WillReturnRows(expect)
}

// readPerfBulkRoutingJSON is the fixture policy_config used by the bulk
// routing expectation.
const readPerfBulkRoutingJSON = "{\"minimumCorrectForHigher\":13,\"operationalQuestionCount\":25}"

// TestGoldenShellBulkProjection is the AT-01 proof for the bulk path: the SAME
// fixture readperf_golden_test.go drives through the nested loaders is driven
// through bulkShell() instead, and the result must equal the FROZEN golden
// JSON byte for byte.
//
// Together with TestGoldenShellProjection this proves the two paths agree at
// the wire level; readperf_equivalence_test.go proves the same thing against
// real MySQL, where the SQL semantics actually execute.
func TestGoldenShellBulkProjection(t *testing.T) {
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	// The identity probe runs inside the snapshot, so the bulk path opens a
	// read-only REPEATABLE READ transaction (WithTxReadOnly) and always rolls
	// back — reads must not commit or hold locks.
	mock.ExpectBegin()
	readPerfBulkIdentityRows(mock)

	// One sections statement for the whole version (identical SQL to the
	// nested loadSections, so the shared helper is reused deliberately).
	readPerfSectionRows(mock)

	// One modules statement for the whole version, ordered by
	// (section display_order, module display_order).
	readPerfBulkModuleRows(mock, [][]driver.Value{
		{"mod-rw-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", "{\"calculator\":false,\"reference_sheet\":false}", 0},
		{"mod-rw-2", "sec-rw", "rw-m2-lower", "Module 2 - Lower", 1, 1920, 27, "lower_branch", nil, 0},
		{"mod-math-1", "sec-math", "math-m1", "Module 1", 0, 2100, 22, "base", "[\"calculator\",\"reference_sheet\"]", 0},
	})

	// One routing statement for the whole version. sec-math has no policy, so
	// the assembler must project routingPolicy:null for it.
	readPerfBulkRoutingRows(mock, [][]driver.Value{
		{"sec-rw", "rp-sec-rw", "mod-rw-1", "mod-rw-2", "mod-rw-3", "practice_threshold", readPerfBulkRoutingJSON, 2},
	})

	// One questions statement for the whole version, prefixed with module_id.
	readPerfBulkQuestionRows(mock, [][]driver.Value{
		{"mod-rw-1", "eq-1", "q-1", "rev-1", "reading-writing", 0, false, "single_choice", 1, 4,
			readPerfStimulus("Seeded rich stimulus"), readPerfPrompt("Which choice is best?"),
			readPerfSingleChoiceAnswer("B"), readPerfPrompt("Because B is correct."),
			readPerfGoldenMetadata("reading-writing", "information-and-ideas", "Central Ideas and Details")},
		{"mod-rw-1", "eq-2", "q-2", "rev-2", "reading-writing", 1, true, "single_choice", 1, 0,
			readPerfEmptyStimulus(), readPerfPrompt("Which choice is second?"),
			readPerfSingleChoiceAnswer("A"), readPerfPrompt("Because A is correct."),
			readPerfGoldenMetadata("reading-writing", "craft-and-structure", "Words in Context")},
		// mod-rw-2 has no questions: the assembler must emit [] not null.
		{"mod-math-1", "eq-3", "q-3", "rev-3", "math", 0, false, "student_produced_response", 2, 0,
			readPerfEmptyStimulus(), readPerfPrompt("Solve for x."),
			readPerfSPRAnswer("3"), readPerfPrompt("Divide both sides."),
			readPerfGoldenMetadata("math", "algebra", "Linear Equations in One Variable")},
	})
	mock.ExpectRollback()

	shell := readPerfBulkShell(t, service, "exam-1")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("bulk Shell statement shape drifted: %v", err)
	}

	encoded, err := json.Marshal(shell)
	if err != nil {
		t.Fatal(err)
	}
	golden := readPerfGoldenShellJSON()
	if string(encoded) != golden {
		t.Fatalf("bulk Shell JSON drifted from the frozen AT-01 baseline.\n got: %s\nwant: %s", encoded, golden)
	}
}

// TestGoldenShellEmptyDraftBulk pins the empty-version edge case on the bulk
// path: the SAME golden bytes the nested path produces, from two statements
// (identity + sections, then stop).
//
// The bulk path stops after the sections read when the version has no
// sections, mirroring loadSections' early return: there is nothing to group,
// so issuing the module/routing/question reads would be pure waste.
func TestGoldenShellEmptyDraftBulk(t *testing.T) {
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	mock.ExpectBegin()
	readPerfBulkIdentityRows(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "revision"}))
	mock.ExpectRollback()

	shell := readPerfBulkShell(t, service, "exam-1")
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(shell)
	if err != nil {
		t.Fatal(err)
	}
	golden := "{\"examId\":\"exam-1\",\"providerKey\":\"sat\",\"versionId\":\"draft-v1\",\"versionRevision\":7,\"sections\":[]}"
	if string(encoded) != golden {
		t.Fatalf("empty-draft bulk shell drifted.\n got: %s\nwant: %s", encoded, golden)
	}
}

// readPerfBulkShell unwraps the READY shell from a bulkShell lifecycle result.
//
// The unwrap is itself an assertion: every fixture these projection oracles
// use HAS a draft, so anything other than READY + a non-nil shell means the
// fixture is broken. The lifecycle outcomes themselves (NO_DRAFT,
// EXAM_NOT_FOUND, DRAFT_INTEGRITY_VIOLATION) have their own oracle in
// shell_lifecycle_test.go.
func readPerfBulkShell(t *testing.T, service *Service, examID string) Shell {
	t.Helper()
	result, err := service.bulkShell(context.Background(), examID)
	if err != nil {
		t.Fatalf("bulkShell: %v", err)
	}
	if result.State != ShellStateReady || result.Shell == nil {
		t.Fatalf("bulkShell state = %q with shell %v, want READY", result.State, result.Shell)
	}
	return *result.Shell
}

// TestGoldenShellBulkLifecycleParity pins the identity probe's three outcomes
// at the sqlmock boundary, including the distinction the LEFT JOIN could get
// wrong. A dangling draft pointer must NEVER be reported as NO_DRAFT (which
// would offer the user an "Open draft" command on top of corrupted state), and
// it must not be reported as EXAM_NOT_FOUND either.
func TestGoldenShellBulkLifecycleParity(t *testing.T) {
	const identityQuery = "SELECT e.provider_key, e.current_draft_version_id, v.revision"

	t.Run("exam row absent -> EXAM_NOT_FOUND", func(t *testing.T) {
		_, runner, mock := readPerfBulkGoldenDB(t)
		service := NewService(nil, runner)
		mock.ExpectBegin()
		mock.ExpectQuery(regexp.QuoteMeta(identityQuery)).
			WithArgs("exam-1").
			WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}))
		mock.ExpectRollback()

		_, err := service.bulkShell(context.Background(), "exam-1")
		if err == nil {
			t.Fatal("expected an error")
		}
		if !strings.Contains(err.Error(), "Exam not found.") {
			t.Fatalf("error = %q, want it to contain %q", err.Error(), "Exam not found.")
		}
		if codeOf(err) != apperrors.CodeExamNotFound {
			t.Fatalf("error code = %q, want EXAM_NOT_FOUND", codeOf(err))
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	// No draft pointer is a lifecycle answer, not an error: 200 NO_DRAFT with a
	// null shell and ZERO tree statements (the assertions below declare none).
	for _, testCase := range []struct {
		name string
		rows *sqlmock.Rows
	}{
		{
			name: "draft pointer null -> NO_DRAFT",
			rows: sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}).AddRow("sat", nil, nil),
		},
		{
			name: "draft pointer blank -> NO_DRAFT",
			rows: sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}).AddRow("sat", "   ", nil),
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			_, runner, mock := readPerfBulkGoldenDB(t)
			service := NewService(nil, runner)
			mock.ExpectBegin()
			mock.ExpectQuery(regexp.QuoteMeta(identityQuery)).
				WithArgs("exam-1").
				WillReturnRows(testCase.rows)
			mock.ExpectRollback()

			result, err := service.bulkShell(context.Background(), "exam-1")
			if err != nil {
				t.Fatalf("no draft pointer must not error: %v", err)
			}
			if result.State != ShellStateNoDraft {
				t.Fatalf("state = %q, want NO_DRAFT", result.State)
			}
			if result.Shell != nil {
				t.Fatalf("shell = %+v, want nil", result.Shell)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}

	t.Run("draft pointer dangling -> DRAFT_INTEGRITY_VIOLATION", func(t *testing.T) {
		_, runner, mock := readPerfBulkGoldenDB(t)
		service := NewService(nil, runner)
		mock.ExpectBegin()
		mock.ExpectQuery(regexp.QuoteMeta(identityQuery)).
			WithArgs("exam-1").
			WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}).AddRow("sat", "draft-v1", nil))
		mock.ExpectRollback()

		result, err := service.bulkShell(context.Background(), "exam-1")
		if err == nil {
			t.Fatalf("dangling pointer must error, got state %q", result.State)
		}
		if codeOf(err) != apperrors.CodeDraftIntegrity {
			t.Fatalf("error code = %q, want DRAFT_INTEGRITY_VIOLATION", codeOf(err))
		}
		if !strings.Contains(err.Error(), "draft-v1") {
			t.Fatalf("error = %q, want it to name the dangling version id", err.Error())
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
}

// TestGoldenShellBulkStatementBudget is the query-count regression gate the
// Phase-01 handoff asked for.
//
// The budget is enforced STRUCTURALLY: the expectation list below declares the
// entire allowed statement set (1 identity + 4 tree). sqlmock fails the test on
// any statement the implementation issues that was not declared, so a fifth
// tree probe cannot pass silently even if nobody updates a constant. The
// MySQL-gated TestReadPerfBulkStatementBudgetLive additionally counts real
// driver executions and asserts the exact number.
func TestGoldenShellBulkStatementBudget(t *testing.T) {
	const (
		identityStatements = 1
		// treeBudget is the whole point of Phase 02: four version-scoped reads
		// (sections, modules, routing, questions) replace 1 + S + M + S probes.
		treeBudget = 4
	)
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	mock.ExpectBegin()
	readPerfBulkIdentityRows(mock)
	readPerfSectionRows(mock)
	readPerfBulkModuleRows(mock, [][]driver.Value{
		{"mod-rw-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", nil, 0},
	})
	readPerfBulkRoutingRows(mock, [][]driver.Value{
		{"sec-rw", "rp-sec-rw", "mod-rw-1", "mod-rw-2", "mod-rw-3", "practice_threshold", readPerfBulkRoutingJSON, 2},
	})
	readPerfBulkQuestionRows(mock, [][]driver.Value{
		{"mod-rw-1", "eq-1", "q-1", "rev-1", "reading-writing", 0, false, "single_choice", 1, 0,
			readPerfEmptyStimulus(), readPerfPrompt("Q?"),
			readPerfSingleChoiceAnswer("A"), readPerfPrompt("A."),
			readPerfGoldenMetadata("reading-writing", "information-and-ideas", "Central Ideas and Details")},
	})
	mock.ExpectRollback()

	shell := readPerfBulkShell(t, service, "exam-1")
	// ExpectationsWereMet fails both on an unmet expectation AND on an
	// unexpected statement, which is exactly the <= treeBudget assertion.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("bulk Shell exceeded its statement budget of %d tree statements: %v", treeBudget, err)
	}
	if len(shell.Sections) != 2 {
		t.Fatalf("sections = %d, want 2", len(shell.Sections))
	}
	_ = identityStatements
}

// TestGoldenPreviewBulkDelivery pins the delivery bulk loader against the SAME
// projection the nested Preview golden drives, using the 3-statement bulk
// sequence, and re-asserts the redaction contract on the bulk output.
func TestGoldenPreviewBulkDelivery(t *testing.T) {
	db, runner, mock := readPerfBulkGoldenDB(t)
	svc := delivery.NewService(db, runner)

	// The bulk delivery loader runs inside the same read-only snapshot the
	// authoring bulk path uses, so the transaction is expected and rolled back.
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("sec-rw", "reading-writing", "Reading & Writing", 0, 3840, 600, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT m.id, m.section_id, m.module_key")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
			AddRow("mod-rw-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.module_id, eq.id AS exam_question_id")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"module_id", "exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}).
			AddRow("mod-rw-1", "eq-1", "q-1", 0, false, "single_choice",
				readPerfStimulus("Seeded rich stimulus"), readPerfPrompt("Which choice is best?"),
				readPerfSingleChoiceAnswer("B"),
				readPerfGoldenMetadata("reading-writing", "information-and-ideas", "Central Ideas and Details"),
				"{\"version\":1,\"nodes\":[]}"))

	mock.ExpectRollback()

	sections, err := svc.LoadSectionsBulk(context.Background(), "draft-v1")
	if err != nil {
		t.Fatalf("LoadSectionsBulk: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("bulk delivery statement shape drifted: %v", err)
	}
	encoded, err := json.Marshal(sections)
	if err != nil {
		t.Fatal(err)
	}
	payload := string(encoded)
	for _, forbidden := range []string{"correctOptionId", "acceptedResponses", "answerDefinition", "isCorrect", "isPretest"} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("bulk delivery projection leaked %s: %s", forbidden, payload)
		}
	}
	if !strings.Contains(payload, "\"answer\":{\"kind\":\"single_choice\"") {
		t.Fatalf("bulk delivery answer is not the redacted shape: %s", payload)
	}
	if !strings.Contains(payload, "options") {
		t.Fatalf("bulk delivery dropped the redacted options list: %s", payload)
	}
}

// TestGoldenShellBulkPolicyConfigParsingGolden pins the real production
// shape: policy_config carries threshold only, and operationalQuestionCount
// is DERIVED from the SAT blueprint for the section's base module
// (reading-writing/rw-m1 -> 25), never 0.
func TestGoldenShellBulkPolicyConfigParsingGolden(t *testing.T) {
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	mock.ExpectBegin()
	readPerfBulkIdentityRows(mock)
	readPerfSectionRows(mock)
	readPerfBulkModuleRows(mock, [][]driver.Value{
		{"mod-rw-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", nil, 0},
		{"mod-rw-2", "sec-rw", "rw-m2-lower", "Module 2 - Lower", 1, 1920, 27, "lower_branch", nil, 0},
	})
	readPerfBulkRoutingRows(mock, [][]driver.Value{
		{"sec-rw", "rp-sec-rw", "mod-rw-1", "mod-rw-2", "mod-rw-3", "practice_threshold", "{\"minimumCorrectForHigher\":13}", 2},
	})
	readPerfBulkQuestionRows(mock, [][]driver.Value{})
	mock.ExpectRollback()

	shell := readPerfBulkShell(t, service, "exam-1")
	policy := shell.Sections[0].RoutingPolicy
	if policy == nil {
		t.Fatal("routing policy missing")
	}
	if policy.MinimumCorrectForHigher != 13 || policy.OperationalCount != 25 {
		t.Fatalf("policy projection drifted: %+v", policy)
	}
	encoded, err := json.Marshal(policy)
	if err != nil {
		t.Fatal(err)
	}
	want := "{\"id\":\"rp-sec-rw\",\"baseModuleId\":\"mod-rw-1\",\"lowerModuleId\":\"mod-rw-2\",\"higherModuleId\":\"mod-rw-3\",\"policyKey\":\"practice_threshold\",\"minimumCorrectForHigher\":13,\"operationalQuestionCount\":25,\"revision\":2}"
	if string(encoded) != want {
		t.Fatalf("policy JSON drifted.\n got: %s\nwant: %s", encoded, want)
	}
}

// TestGoldenShellBulkModuleToolPolicyGolden pins the tool_policy projection on
// the bulk path for both the object and the array column shapes.
func TestGoldenShellBulkModuleToolPolicyGolden(t *testing.T) {
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	mock.ExpectBegin()
	readPerfBulkIdentityRows(mock)
	readPerfSectionRows(mock)
	readPerfBulkModuleRows(mock, [][]driver.Value{
		{"mod-rw-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", "{\"calculator\":false}", 0},
		{"mod-math-1", "sec-math", "math-m1", "Module 1", 0, 2100, 22, "base", "[\"calculator\",\"reference_sheet\"]", 0},
	})
	readPerfBulkRoutingRows(mock, [][]driver.Value{})
	readPerfBulkQuestionRows(mock, [][]driver.Value{})
	mock.ExpectRollback()

	shell := readPerfBulkShell(t, service, "exam-1")
	if got := string(shell.Sections[0].Modules[0].ToolPolicy); got != "{\"calculator\":false}" {
		t.Fatalf("object tool_policy = %q", got)
	}
	if got := string(shell.Sections[1].Modules[0].ToolPolicy); got != "[\"calculator\",\"reference_sheet\"]" {
		t.Fatalf("array tool_policy = %q", got)
	}
}

// TestReadPerfBulkStatementBudgetLive is the MySQL-gated query-count gate:
// bulkShell must cost exactly 1 identity + 4 tree = 5 statements against the
// real fixture, versus Shell()'s frozen 13.
func TestReadPerfBulkStatementBudgetLive(t *testing.T) {
	readPerfRequireBench(t)
	db, counter := readPerfCountedDB(t, readPerfDSN(t))
	fixture := seedReadPerfFixtureWithDB(t, db)

	// Warm the pool so connect-time statements are excluded.
	if _, err := fixture.Service.bulkShell(context.Background(), fixture.ExamID); err != nil {
		t.Fatalf("bulkShell warmup: %v", err)
	}
	before := counter.executions.Load()
	if _, err := fixture.Service.bulkShell(context.Background(), fixture.ExamID); err != nil {
		t.Fatalf("bulkShell: %v", err)
	}
	got := counter.executions.Load() - before
	t.Logf("bulkShell statements per request: %d (identity 1 + tree 4); Shell() baseline is 13", got)
	if got != 5 {
		t.Fatalf("bulkShell issued %d statements, want exactly 5 (1 identity + 4 tree)", got)
	}
}

// TestReadPerfBulkDeliveryStatementBudgetLive is the MySQL-gated query-count
// gate for the delivery bulk loader: 3 statements, versus LoadSections' 9.
func TestReadPerfBulkDeliveryStatementBudgetLive(t *testing.T) {
	readPerfRequireBench(t)
	db, counter := readPerfCountedDB(t, readPerfDSN(t))
	fixture := seedReadPerfFixtureWithDB(t, db)
	svc := delivery.NewService(fixture.DB, fixture.Runner)

	if _, err := svc.LoadSectionsBulk(context.Background(), fixture.VersionID); err != nil {
		t.Fatalf("LoadSectionsBulk warmup: %v", err)
	}
	before := counter.executions.Load()
	if _, err := svc.LoadSectionsBulk(context.Background(), fixture.VersionID); err != nil {
		t.Fatalf("LoadSectionsBulk: %v", err)
	}
	bulkStatements := counter.executions.Load() - before
	t.Logf("LoadSectionsBulk statements per request: %d; LoadSections baseline is 9", bulkStatements)
	if bulkStatements != 3 {
		t.Fatalf("LoadSectionsBulk issued %d statements, want exactly 3 (sections, modules, questions)", bulkStatements)
	}

	before = counter.executions.Load()
	if _, err := svc.LoadSections(context.Background(), fixture.VersionID); err != nil {
		t.Fatalf("LoadSections: %v", err)
	}
	nestedStatements := counter.executions.Load() - before
	t.Logf("LoadSections statements per request: %d", nestedStatements)
	if nestedStatements <= bulkStatements {
		t.Fatalf("bulk loader (%d statements) must beat the nested loader (%d statements)", bulkStatements, nestedStatements)
	}
}

// TestReadPerfBulkPreviewProjectionBudgetLive measures the Phase-03 preview
// shape: bulkShell (5 statements) plus the bulk delivery tree (3 statements).
// That is the composition Phase 03 will wire, so the number is recorded here as
// the cutover target: 8 statements versus the frozen baseline of 22.
//
// This test does NOT change Preview(); it only measures the two additive bulk
// loaders composed the way Phase 03 intends to compose them.
func TestReadPerfBulkPreviewProjectionBudgetLive(t *testing.T) {
	readPerfRequireBench(t)
	db, counter := readPerfCountedDB(t, readPerfDSN(t))
	fixture := seedReadPerfFixtureWithDB(t, db)
	deliver := delivery.NewService(fixture.DB, fixture.Runner)

	composed := func() error {
		if _, err := fixture.Service.bulkShell(context.Background(), fixture.ExamID); err != nil {
			return err
		}
		_, err := deliver.LoadSectionsBulk(context.Background(), fixture.VersionID)
		return err
	}
	// Warm the pool so connect-time statements are excluded.
	if err := composed(); err != nil {
		t.Fatalf("composed bulk preview warmup: %v", err)
	}
	before := counter.executions.Load()
	if err := composed(); err != nil {
		t.Fatalf("composed bulk preview: %v", err)
	}
	got := counter.executions.Load() - before
	t.Logf("composed bulk preview statements per request: %d (bulkShell 5 + LoadSectionsBulk 3); Preview() baseline is 22", got)
	if got != 8 {
		t.Fatalf("composed bulk preview issued %d statements, want exactly 8 (5 + 3)", got)
	}
}

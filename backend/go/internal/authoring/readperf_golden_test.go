package authoring

// Phase 01 read-path performance baseline: golden JSON snapshots for Shell()
// and Preview().
//
// These are the byte-level regression oracle Phase 03 must satisfy. They run
// WITHOUT a live server: sqlmock drives the SQL boundary so the assertions pin
// the exact wire shape (field names, ordering, empty-array-not-null,
// readiness/preview fields) on the CURRENT unoptimized code.
//
// Why sqlmock here rather than MySQL: the contract this file locks is the JSON
// projection, not the SQL plan. Pinning it at the sqlmock boundary means
// Phase 02/03 can rewrite the loaders (bulk reads, single-build preview,
// snapshot reads) and still be held to identical output. The MySQL-gated
// readperf_fixture_test.go covers the real-database shape; this file covers the
// projection.
//
// PHASE 03 NOTE (statement shape vs projection oracle)
// ---------------------------------------------------
// Phase 03 cut Service.Shell()/Preview() over to the bulk path:
//   - shell    -> 1 identity JOIN + 4 version-scoped tree reads, inside one
//                   read-only snapshot (5 statements live; empty draft = 2).
//   - preview  -> identity probe (1, inside the snapshot) + bulk delivery
//                   build (3 statements cache-off; cache-on hit = 0).
// The nested helpers below are RETIRED as live-path expectations — they now
// document the pre-cutover shape the retired nested composition produced, and
// survive only where the nested loaders remain real code: the in-tx
// post-commit shell (buildShellTx) and the equivalence harness's
// legacyNestedShell old-path reference. The live gates are:
//   * the JSON golden string (readPerfGoldenShellJSON) — the AT-01 oracle,
//     asserted UNCHANGED through the LIVE Shell()/Preview() below; and
//   * the bulk statement sequences in readperf_bulk_golden_test.go
//     (readPerfBulkIdentityRows/readPerfBulkModuleRows/...).
// Deliberately retired in Phase 03 (not silently deleted): the nested
// per-section/per-module expectation helpers and the discarded Shell() leg of
// the preview test were replaced by the bulk helpers from
// readperf_bulk_golden_test.go. The retired helpers stay compiled (unused
// warnings avoided via the blank identifier where needed) so the git history
// shows exactly what the old shape was.

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"regexp"
	"strconv"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

// readPerfShellIdentityRows is the RETIRED two-probe preamble the pre-Phase-03
// Shell() made (exam row, then draft revision probe). Retired deliberately in
// Phase 03: the live Shell() uses readPerfBulkIdentityRows (one JOIN) from
// readperf_bulk_golden_test.go. No live test drives this helper anymore; it
// stays compiled as the record of the old shape.
func readPerfShellIdentityRows(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ?")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id"}).
			AddRow("sat", "draft-v1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE")).
		WithArgs("draft-v1", "exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(7))
}

// retiredNestedShapeNote keeps the retired per-section/per-module helpers
// below honest: they pin the pre-Phase-03 N+1 sequence the live path no
// longer issues. New tests must use the readPerfBulk* helpers instead.
var _ = regexp.QuoteMeta

// readPerfSectionRows is the authoring sections SELECT payload: two sections in
// display_order order (reading-writing then math).
func readPerfSectionRows(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "revision"}).
			AddRow("sec-rw", "reading-writing", "Reading & Writing", 0, 3840, 600, 0).
			AddRow("sec-math", "math", "Math", 1, 4200, 0, 0))
}

// readPerfModuleRows is one section's authoring modules SELECT payload.
func readPerfModuleRows(mock sqlmock.Sqlmock, sectionID string, rows [][]driver.Value) {
	expect := sqlmock.NewRows([]string{"id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "tool_policy", "revision"})
	for _, row := range rows {
		expect.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules WHERE section_id = ?")).
		WithArgs(sectionID).
		WillReturnRows(expect)
}

// readPerfQuestionRows is one module's question SELECT payload (the N+1 leg).
func readPerfQuestionRows(mock sqlmock.Sqlmock, moduleID string, rows [][]driver.Value) {
	expect := sqlmock.NewRows([]string{
		"id", "question_id", "question_revision_id", "section_key",
		"display_order", "is_pretest", "question_type",
		"semantic_revision", "revision",
		"stimulus", "prompt", "answer_definition", "rationale", "metadata",
	})
	for _, row := range rows {
		expect.AddRow(row...)
	}
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).
		WithArgs(moduleID).
		WillReturnRows(expect)
}

// readPerfRoutingRows is one section's routing-policy probe.
func readPerfRoutingRows(mock sqlmock.Sqlmock, sectionID, baseID, lowerID, higherID string, threshold int) {
	config := `{"minimumCorrectForHigher":` + strconv.Itoa(threshold) + `,"operationalQuestionCount":` + strconv.Itoa(threshold*2-1) + `}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
		WithArgs(sectionID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "revision"}).
			AddRow("rp-"+sectionID, baseID, lowerID, higherID, "practice_threshold", config, 2))
}

// readPerfNoRoutingRows models a section without an adaptive policy.
func readPerfNoRoutingRows(mock sqlmock.Sqlmock, sectionID string) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_routing_policies WHERE section_id = ?")).
		WithArgs(sectionID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "base_module_id", "lower_module_id", "higher_module_id", "policy_key", "policy_config", "revision"}))
}

// readPerfSingleChoiceAnswer builds a valid single_choice answer_definition.
func readPerfSingleChoiceAnswer(correct string) string {
	option := func(id, text string) string {
		return `{"id":` + strconv.Quote(id) + `,"content":{"nodes":[],"version":2,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":` + strconv.Quote(text) + `}]}]}}}`
	}
	return `{"kind":"single_choice","options":[` + option("A", "Option A") + "," + option("B", "Option B") + "," + option("C", "Option C") + "," + option("D", "Option D") + `],"correctOptionId":` + strconv.Quote(correct) + `}`
}

// readPerfSPRAnswer builds a valid student_produced_response answer_definition.
func readPerfSPRAnswer(response string) string {
	return `{"kind":"student_produced_response","normalizeFraction":true,"normalizeDecimal":true,"numericTolerance":null,"acceptedResponses":[` + strconv.Quote(response) + `]}`
}

// readPerfPrompt is a plain single-paragraph prompt document.
func readPerfPrompt(text string) string {
	return `{"nodes":[],"version":2,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":` + strconv.Quote(text) + `}]}]}}`
}

// readPerfStimulus is a rich multi-block stimulus (forces contentComplexity=rich).
func readPerfStimulus(text string) string {
	return `{"nodes":[],"version":2,"document":{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":` + strconv.Quote(text) + `}]},{"type":"blockMath","attrs":{"latex":"x^2"}}]}}`
}

// readPerfEmptyStimulus is the empty-stimulus shape (hasStimulus=false).
func readPerfEmptyStimulus() string {
	return `{"nodes":[],"version":2,"document":{"type":"doc","content":[]}}`
}

// readPerfMetadata is SAT-valid metadata.
func readPerfGoldenMetadata(section, domain, skill string) string {
	return `{"tags":["baseline"],"skill":` + strconv.Quote(skill) + `,"domain":` + strconv.Quote(domain) + `,"difficulty":"medium","sectionKey":` + strconv.Quote(section) + `}`
}

// TestGoldenShellProjection pins the full LIVE Shell() JSON (bulk path since
// Phase 03): field names, section and module ordering, question ordering,
// readiness summary, routing policy projection, and empty-array-not-null
// behavior for a module with no questions plus a nil routing policy on a
// section without one. The expectation sequence is the BULK shape (1 identity
// JOIN + 4 version-scoped reads inside one read-only snapshot that rolls
// back); the retired nested helpers above are no longer driven. The golden
// string itself is BYTE-IDENTICAL to the Phase-01 oracle.
func TestGoldenShellProjection(t *testing.T) {
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	mock.ExpectBegin()
	readPerfBulkIdentityRows(mock)
	readPerfSectionRows(mock)

	// reading-writing + math modules in (section order, module order); the
	// second rw module is empty (empty-array-not-null).
	readPerfBulkModuleRows(mock, [][]driver.Value{
		{"mod-rw-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", `{"calculator":false,"reference_sheet":false}`, 0},
		{"mod-rw-2", "sec-rw", "rw-m2-lower", "Module 2 - Lower", 1, 1920, 27, "lower_branch", nil, 0},
		{"mod-math-1", "sec-math", "math-m1", "Module 1", 0, 2100, 22, "base", `["calculator","reference_sheet"]`, 0},
	})
	readPerfBulkRoutingRows(mock, [][]driver.Value{
		{"sec-rw", "rp-sec-rw", "mod-rw-1", "mod-rw-2", "mod-rw-3", "practice_threshold", readPerfBulkRoutingJSON, 2},
	})
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
		// sec-math has no routing row: routingPolicy:null.
		{"mod-math-1", "eq-3", "q-3", "rev-3", "math", 0, false, "student_produced_response", 2, 0,
			readPerfEmptyStimulus(), readPerfPrompt("Solve for x."),
			readPerfSPRAnswer("3"), readPerfPrompt("Divide both sides."),
			readPerfGoldenMetadata("math", "algebra", "Linear Equations in One Variable")},
	})
	mock.ExpectRollback()

	shell, err := service.Shell(context.Background(), "exam-1")
	if err != nil {
		t.Fatalf("Shell: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("Shell statement shape drifted from the bulk baseline: %v", err)
	}

	encoded, err := json.Marshal(shell)
	if err != nil {
		t.Fatal(err)
	}
	golden := readPerfGoldenShellJSON()
	if string(encoded) != golden {
		t.Fatalf("Shell JSON drifted from the frozen baseline.\n got: %s\nwant: %s", encoded, golden)
	}
}

// readPerfGoldenShellJSON is the frozen Shell payload for the fixture above.
func readPerfGoldenShellJSON() string {
	return `{"examId":"exam-1","providerKey":"sat","versionId":"draft-v1","versionRevision":7,"sections":[` +
		`{"id":"sec-rw","sectionKey":"reading-writing","title":"Reading \u0026 Writing","displayOrder":0,"durationSeconds":3840,"breakAfterSeconds":600,"revision":0,` +
		`"routingPolicy":{"id":"rp-sec-rw","baseModuleId":"mod-rw-1","lowerModuleId":"mod-rw-2","higherModuleId":"mod-rw-3","policyKey":"practice_threshold","minimumCorrectForHigher":13,"operationalQuestionCount":25,"revision":2},` +
		`"modules":[` +
		`{"id":"mod-rw-1","moduleKey":"rw-m1","title":"Module 1","displayOrder":0,"durationSeconds":1920,"targetQuestionCount":27,"adaptiveRole":"base","toolPolicy":{"calculator":false,"reference_sheet":false},"revision":0,"questions":[` +
		`{"examQuestionId":"eq-1","questionId":"q-1","questionRevisionId":"rev-1","displayOrder":0,"isPretest":false,"questionType":"single_choice","semanticRevision":1,"revision":4,"promptPreview":"Which choice is best?","answerKeyPreview":"B","domain":"information-and-ideas","skill":"Central Ideas and Details","difficulty":"medium","tags":["baseline"],"hasStimulus":true,"contentComplexity":"rich","readiness":{"status":"ready","blockingIssueCount":0,"warningCount":0}},` +
		`{"examQuestionId":"eq-2","questionId":"q-2","questionRevisionId":"rev-2","displayOrder":1,"isPretest":true,"questionType":"single_choice","semanticRevision":1,"revision":0,"promptPreview":"Which choice is second?","answerKeyPreview":"A","domain":"craft-and-structure","skill":"Words in Context","difficulty":"medium","tags":["baseline"],"hasStimulus":false,"contentComplexity":"plain","readiness":{"status":"ready","blockingIssueCount":0,"warningCount":0}}` +
		`]},` +
		`{"id":"mod-rw-2","moduleKey":"rw-m2-lower","title":"Module 2 - Lower","displayOrder":1,"durationSeconds":1920,"targetQuestionCount":27,"adaptiveRole":"lower_branch","toolPolicy":{},"revision":0,"questions":[]}` +
		`]},` +
		`{"id":"sec-math","sectionKey":"math","title":"Math","displayOrder":1,"durationSeconds":4200,"breakAfterSeconds":0,"revision":0,"routingPolicy":null,"modules":[` +
		`{"id":"mod-math-1","moduleKey":"math-m1","title":"Module 1","displayOrder":0,"durationSeconds":2100,"targetQuestionCount":22,"adaptiveRole":"base","toolPolicy":["calculator","reference_sheet"],"revision":0,"questions":[` +
		`{"examQuestionId":"eq-3","questionId":"q-3","questionRevisionId":"rev-3","displayOrder":0,"isPretest":false,"questionType":"student_produced_response","semanticRevision":2,"revision":0,"promptPreview":"Solve for x.","answerKeyPreview":"3","domain":"algebra","skill":"Linear Equations in One Variable","difficulty":"medium","tags":["baseline"],"hasStimulus":false,"contentComplexity":"plain","readiness":{"status":"ready","blockingIssueCount":0,"warningCount":0}}` +
		`]}]}]}`
}

// TestGoldenPreviewRedaction pins the preview projection AND proves the answer
// key never crosses the wire. Preview is a DIFFERENT projection from Shell: it
// carries delivery.DeliverySection (instructions/toolPolicy/answer), and the
// answer must be the redacted delivery shape, never the authoring
// answer_definition.
func TestGoldenPreviewRedaction(t *testing.T) {
	// Phase 03 single-build Preview: identity probe (inside the snapshot)
	// then exactly the bulk delivery projection. The discarded authoring
	// Shell() leg the double-build hotspot paid for is GONE — this test
	// fails with unmet expectations if it regresses. Cache stays nil here
	// so the delivery bulk load runs directly (3 statements).
	db, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	service.SetDeliveryService(delivery.NewService(db, runner))

	// Identity leg: Preview's single resolveShellIdentity (sat gate passes).
	mock.ExpectBegin()
	readPerfBulkIdentityRows(mock)
	mock.ExpectRollback()

	// Delivery leg: ONE bulk delivery build over the same version (3
	// statements: sections + modules + questions, no routing leg).
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("sec-rw", "reading-writing", "Reading & Writing", 0, 3840, 600, nil))
	readPerfBulkModuleRows(mock, [][]driver.Value{
		{"mod-rw-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", nil, 0},
	})
	// NOTE: Preview's delivery leg is the DELIVERY bulk shape (11 columns:
	// module_id, exam_question_id, question_id, display_order, is_pretest,
	// question_type, stimulus, prompt, answer_definition, metadata,
	// accessibility) — not the authoring bulk shape (15 columns with
	// rationale + semantic revisions). readPerfBulkQuestionRows pins the
	// authoring shape, so the delivery leg declares its own rows here.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.module_id, eq.id AS exam_question_id")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"module_id", "exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}).
			AddRow("mod-rw-1", "eq-1", "q-1", 0, false, "single_choice",
				readPerfStimulus("Seeded rich stimulus"), readPerfPrompt("Which choice is best?"),
				readPerfSingleChoiceAnswer("B"),
				readPerfGoldenMetadata("reading-writing", "information-and-ideas", "Central Ideas and Details"),
				"{\"version\":1,\"nodes\":[]}"))
	mock.ExpectRollback()

	preview, err := service.Preview(context.Background(), "exam-1")
	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("Preview statement shape drifted from the baseline: %v", err)
	}

	encoded, err := json.Marshal(preview)
	if err != nil {
		t.Fatal(err)
	}
	payload := string(encoded)

	// AT-02: no answer material anywhere in the preview payload.
	for _, forbidden := range []string{`"correctOptionId"`, `"acceptedResponses"`, `"answerDefinition"`, `"isCorrect"`} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("preview leaked %s: %s", forbidden, payload)
		}
	}
	// The redacted options list survives...
	if !strings.Contains(payload, `"options"`) {
		t.Fatalf("preview dropped the redacted options list: %s", payload)
	}
	// ...and the answer is exactly {kind, options} with no key material.
	if !strings.Contains(payload, `"answer":{"kind":"single_choice"`) {
		t.Fatalf("preview answer is not the redacted delivery shape: %s", payload)
	}

	// Shape assertions the frontend binds.
	var wire map[string]any
	if err := json.Unmarshal(encoded, &wire); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"examId", "providerKey", "versionId", "versionRevision", "sections"} {
		if _, ok := wire[key]; !ok {
			t.Fatalf("preview missing %q: %s", key, payload)
		}
	}
	sections, _ := wire["sections"].([]any)
	if len(sections) != 1 {
		t.Fatalf("preview sections = %d, want 1: %s", len(sections), payload)
	}
	section, _ := sections[0].(map[string]any)
	if _, ok := section["routingPolicy"]; ok {
		t.Fatalf("preview section must not carry an authoring routingPolicy: %s", payload)
	}
	modules, _ := section["modules"].([]any)
	if len(modules) != 1 {
		t.Fatalf("preview modules = %d, want 1: %s", len(modules), payload)
	}
	module, _ := modules[0].(map[string]any)
	questions, _ := module["questions"].([]any)
	if len(questions) != 1 {
		t.Fatalf("preview questions = %d, want 1: %s", len(questions), payload)
	}
	question, _ := questions[0].(map[string]any)
	if _, ok := question["isPretest"]; ok {
		t.Fatalf("preview must not serialize isPretest to candidates: %s", payload)
	}
}

// TestGoldenShellEmptyDraft pins the documented edge case on the LIVE bulk
// path: a draft with no sections returns sections:[] (an empty array), never
// null, from 2 statements (identity + sections, then stop — no
// module/routing/question fanout).
func TestGoldenShellEmptyDraft(t *testing.T) {
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	mock.ExpectBegin()
	readPerfBulkIdentityRows(mock)
	// A draft with no sections: the sections probe returns zero rows and Shell
	// must stop there (no module/routing fanout).
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("draft-v1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "revision"}))
	mock.ExpectRollback()

	shell, err := service.Shell(context.Background(), "exam-1")
	if err != nil {
		t.Fatalf("Shell: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(shell)
	if err != nil {
		t.Fatal(err)
	}
	golden := `{"examId":"exam-1","providerKey":"sat","versionId":"draft-v1","versionRevision":7,"sections":[]}`
	if string(encoded) != golden {
		t.Fatalf("empty-draft shell drifted.\n got: %s\nwant: %s", encoded, golden)
	}
}

// TestGoldenShellMissingDraftPointer pins the NOT_FOUND contract on the LIVE
// bulk path: Shell must fail on the single identity JOIN (inside the snapshot)
// before touching sections.
func TestGoldenShellMissingDraftPointer(t *testing.T) {
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.provider_key, e.current_draft_version_id, v.revision")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}).
			AddRow("sat", nil, nil))
	mock.ExpectRollback()

	if _, err := service.Shell(context.Background(), "exam-1"); codeOf(err) != apperrors.CodeNotFound {
		t.Fatalf("expected NOT_FOUND for a missing draft pointer, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestGoldenPreviewRejectsNonSAT pins the provider gate on the LIVE
// single-build path: Preview resolves identity+revision once (single JOIN
// inside the snapshot), refuses a non-sat draft BEFORE any cache read or
// delivery build, and never issues the tree statements.
func TestGoldenPreviewRejectsNonSAT(t *testing.T) {
	_, runner, mock := readPerfBulkGoldenDB(t)
	service := NewService(nil, runner)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT e.provider_key, e.current_draft_version_id, v.revision")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{"provider_key", "current_draft_version_id", "revision"}).
			AddRow("ielts", "draft-v1", 1))
	mock.ExpectRollback()

	if _, err := service.Preview(context.Background(), "exam-1"); err == nil {
		t.Fatal("Preview must reject a non-sat provider")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

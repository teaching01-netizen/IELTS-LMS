package delivery

// Phase 02: equivalence + redaction proofs for the bulk delivery loader.
//
// LoadSectionsBulk must be indistinguishable from LoadSections on the wire,
// including the answer-key redaction that is the whole point of the delivery
// projection. These tests drive both loaders through sqlmock so they run
// without MySQL; the authoring package's readperf_equivalence_test.go proves
// the same equivalence against the real database and a 147-question fixture.

import (
	"context"
	"encoding/json"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// bulkDeliverySingleChoiceAnswer builds a single_choice answer_definition with
// a correctOptionId and per-option isCorrect flags — both of which the
// redaction must strip.
func bulkDeliverySingleChoiceAnswer() string {
	return `{"kind":"single_choice","correctOptionId":"B","options":[` +
		`{"id":"A","content":{"text":"Option A"},"isCorrect":false},` +
		`{"id":"B","content":{"text":"Option B"},"isCorrect":true},` +
		`{"id":"C","content":{"text":"Option C"},"isCorrect":false},` +
		`{"id":"D","content":{"text":"Option D"},"isCorrect":false}]}`
}

// bulkDeliverySPRAnswer builds a student_produced_response answer_definition
// whose acceptedResponses is key material.
func bulkDeliverySPRAnswer(response string) string {
	return `{"kind":"student_produced_response","normalizeFraction":true,` +
		`"normalizeDecimal":true,"numericTolerance":null,"acceptedResponses":[` +
		response + `]}`
}

// TestDeliveryBulkEquivalence is the delivery-side AT-01 proof: the bulk
// loader must produce byte-identical JSON to the nested loader for the same
// version, including empty-array-not-null for the module with no questions.
func TestDeliveryBulkEquivalence(t *testing.T) {
	// --- Nested path: sections, then one modules probe + one questions probe
	// per module, exactly as LoadSections issues them.
	dbNested, mockNested, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dbNested.Close() })
	mockNested.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("sec-rw", "reading-writing", "Reading & Writing", 0, 3840, 600, `{"version":1,"nodes":[]}`))
	mockNested.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules WHERE section_id = ?")).
		WithArgs("sec-rw").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
			AddRow("mod-1", "rw-m1", "Module 1", 0, 1920, 27, "base", nil, `["calculator"]`).
			AddRow("mod-2", "rw-m2-lower", "Module 2 - Lower", 1, 1920, 27, "lower_branch", nil, nil))
	questionColumns := []string{"exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}
	mockNested.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions qr")).
		WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows(questionColumns).
			AddRow("eq-1", "q-1", 0, false, "single_choice",
				`{"version":2,"nodes":[]}`, `{"version":2,"nodes":[]}`,
				bulkDeliverySingleChoiceAnswer(), `{"tags":["t"]}`, `{"version":1,"nodes":[]}`).
			AddRow("eq-2", "q-2", 1, true, "student_produced_response",
				nil, `{"version":2,"nodes":[]}`,
				bulkDeliverySPRAnswer("3"), `{"tags":["t"]}`, nil))
	// mod-2 has no questions: the nested loader issues its probe and gets none.
	mockNested.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions qr")).
		WithArgs("mod-2").
		WillReturnRows(sqlmock.NewRows(questionColumns))

	nested, err := NewService(dbNested, nil).LoadSections(context.Background(), "v-1")
	if err != nil {
		t.Fatalf("LoadSections: %v", err)
	}
	if err := mockNested.ExpectationsWereMet(); err != nil {
		t.Fatalf("nested delivery statement shape drifted: %v", err)
	}

	// --- Bulk path: THREE version-scoped statements, no transaction (nil runner).
	dbBulk, mockBulk, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = dbBulk.Close() })
	mockBulk.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("sec-rw", "reading-writing", "Reading & Writing", 0, 3840, 600, `{"version":1,"nodes":[]}`))
	mockBulk.ExpectQuery(regexp.QuoteMeta("SELECT m.id, m.section_id, m.module_key")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
			AddRow("mod-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", nil, `["calculator"]`).
			AddRow("mod-2", "sec-rw", "rw-m2-lower", "Module 2 - Lower", 1, 1920, 27, "lower_branch", nil, nil))
	mockBulk.ExpectQuery(regexp.QuoteMeta("SELECT eq.module_id, eq.id AS exam_question_id")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"module_id", "exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}).
			AddRow("mod-1", "eq-1", "q-1", 0, false, "single_choice",
				`{"version":2,"nodes":[]}`, `{"version":2,"nodes":[]}`,
				bulkDeliverySingleChoiceAnswer(), `{"tags":["t"]}`, `{"version":1,"nodes":[]}`).
			AddRow("mod-1", "eq-2", "q-2", 1, true, "student_produced_response",
				nil, `{"version":2,"nodes":[]}`,
				bulkDeliverySPRAnswer("3"), `{"tags":["t"]}`, nil))

	bulk, err := NewService(dbBulk, nil).LoadSectionsBulk(context.Background(), "v-1")
	if err != nil {
		t.Fatalf("LoadSectionsBulk: %v", err)
	}
	if err := mockBulk.ExpectationsWereMet(); err != nil {
		t.Fatalf("bulk delivery statement shape drifted: %v", err)
	}

	nestedJSON, err := json.Marshal(nested)
	if err != nil {
		t.Fatal(err)
	}
	bulkJSON, err := json.Marshal(bulk)
	if err != nil {
		t.Fatal(err)
	}
	if string(nestedJSON) != string(bulkJSON) {
		t.Fatalf("bulk delivery projection differs from the nested loader\n nested: %s\n   bulk: %s", nestedJSON, bulkJSON)
	}

	// Empty-array-not-null for the module with no questions.
	if !strings.Contains(string(bulkJSON), `"questions":[]`) {
		t.Fatalf("empty module must serialize questions:[] not null: %s", bulkJSON)
	}
}

// TestDeliveryBulkRedaction proves the bulk loader runs the SAME redaction as
// the nested loader: no correctOptionId, no acceptedResponses, no per-option
// isCorrect, no pretest marker anywhere in the payload, while the display
// fields (options, normalization contract) survive.
func TestDeliveryBulkRedaction(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("sec-rw", "reading-writing", "RW", 0, 3840, 600, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT m.id, m.section_id, m.module_key")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
			AddRow("mod-1", "sec-rw", "rw-m1", "Module 1", 0, 1920, 27, "base", nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.module_id, eq.id AS exam_question_id")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"module_id", "exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}).
			AddRow("mod-1", "eq-1", "q-1", 0, false, "single_choice",
				nil, nil, bulkDeliverySingleChoiceAnswer(), nil, nil).
			AddRow("mod-1", "eq-2", "q-2", 1, true, "student_produced_response",
				nil, nil, bulkDeliverySPRAnswer("3"), nil, nil))

	sections, err := NewService(db, nil).LoadSectionsBulk(context.Background(), "v-1")
	if err != nil {
		t.Fatalf("LoadSectionsBulk: %v", err)
	}
	encoded, err := json.Marshal(sections)
	if err != nil {
		t.Fatal(err)
	}
	payload := string(encoded)

	for _, forbidden := range []string{"correctOptionId", "acceptedResponses", "answerDefinition", "isCorrect", "isPretest", "is_pretest"} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("bulk delivery projection leaked %s: %s", forbidden, payload)
		}
	}
	// The candidate still needs the option list and the normalization contract.
	for _, required := range []string{"options", "normalizeFraction", "normalizeDecimal"} {
		if !strings.Contains(payload, required) {
			t.Fatalf("bulk delivery projection dropped %s: %s", required, payload)
		}
	}
	if !strings.Contains(payload, `"answer":{"kind":"single_choice","options"`) {
		t.Fatalf("single_choice answer is not the redacted envelope: %s", payload)
	}
}

// TestDeliveryBulkEmptyVersion pins the empty-version short-circuit: ONE
// statement, [] (never null), and no module/question probes.
func TestDeliveryBulkEmptyVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("v-empty").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}))

	sections, err := NewService(db, nil).LoadSectionsBulk(context.Background(), "v-empty")
	if err != nil {
		t.Fatalf("LoadSectionsBulk: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if sections == nil {
		t.Fatal("empty version must return a non-nil slice")
	}
	encoded, err := json.Marshal(sections)
	if err != nil {
		t.Fatal(err)
	}
	if string(encoded) != "[]" {
		t.Fatalf("empty version must serialize as [] not null, got %s", encoded)
	}
}

// TestDeliveryBulkWithRevisionSharesSnapshot pins the cache-compatibility
// variant: the revision probe runs INSIDE the same read-only transaction as
// the three tree reads, so the revision describes the tree it is paired with.
func TestDeliveryBulkWithRevisionSharesSnapshot(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	runner := tx.NewRunner(db)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("sec-rw", "reading-writing", "RW", 0, 3840, 600, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT m.id, m.section_id, m.module_key")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.module_id, eq.id AS exam_question_id")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"module_id", "exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT revision FROM exam_versions WHERE id = ?")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(7))
	mock.ExpectRollback()

	sections, revision, err := NewService(db, runner).LoadSectionsBulkWithRevision(context.Background(), "v-1")
	if err != nil {
		t.Fatalf("LoadSectionsBulkWithRevision: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("bulk delivery statement shape drifted: %v", err)
	}
	if revision != 7 {
		t.Fatalf("revision = %d, want 7", revision)
	}
	if len(sections) != 1 {
		t.Fatalf("sections = %d, want 1", len(sections))
	}
}

// TestDeliveryBulkLoaderAdaptsToVersionCache pins that BulkSectionsLoader
// produces a VersionLoader the EXISTING cache consumes without a signature
// change, and that the revision it reports is the one the snapshot observed.
func TestDeliveryBulkLoaderAdaptsToVersionCache(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id = ?")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT revision FROM exam_versions WHERE id = ?")).
		WithArgs("v-1").
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(4))

	var loader VersionLoader = NewService(db, nil).BulkSectionsLoader(context.Background(), "v-1")
	sections, revision, err := loader()
	if err != nil {
		t.Fatalf("loader: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if revision != 4 {
		t.Fatalf("loader revision = %d, want 4", revision)
	}
	if sections == nil {
		t.Fatal("loader must return a non-nil slice for an empty version")
	}

	// The cache accepts it and reports the stored revision (fail-closed key).
	cache := NewVersionCache(4)
	cache.storeLocked("v-1", sections, 4)
	if cached, ok := cache.PeekRevision("v-1"); !ok || cached != 4 {
		t.Fatalf("cache revision = %d ok=%v, want 4/true", cached, ok)
	}
}

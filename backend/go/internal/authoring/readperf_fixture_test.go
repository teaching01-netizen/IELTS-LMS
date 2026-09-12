package authoring

// Phase 01 read-path performance baseline: deterministic SAT fixture seeder.
//
// Test-only. This file seeds a full SAT draft (2 sections, 6 modules,
// 147 question placements, routing policies, and question revisions with
// representative plain + rich JSON) into an isolated MySQL database and removes
// it again. It exists so the read-path benchmark and the golden snapshot oracle
// measure the SAME dataset every run, and so a second engineer can reproduce the
// Phase-01 baseline with one command.
//
// ISOLATION CONTRACT (why the identifiers are random). Every fixture gets its
// OWN slug (readperf-sat-<uuid>) and every cleanup is scoped to that fixture's
// exam id. Two things must never happen, and both are enforced here:
//
//   1. A test must never delete another test's fixture. Cleanup deletes rows
//      reachable from the fixture's own exam id only. There is deliberately NO
//      "delete everything matching a marker" step: with a shared dev database
//      (two engineers, or a benchmark plus a budget test, running at the same
//      time) a global delete tears down a live fixture mid-measurement and the
//      victim reports bogus NOT_FOUND rows.
//   2. Seeding must never depend on a clean database. A unique slug cannot
//      collide with a leftover row from a crashed run, so seeding is
//      self-healing by construction. cleanupStaleReadPerfFixtures additionally
//      sweeps rows older than an age threshold, which can only be crash
//      leftovers — a live fixture is always younger than the threshold.
//
// Gating mirrors the existing MySQL contract tests
// (cmd/api/contracts_mysql_test.go): TEST_MYSQL_DSN must be set, otherwise the
// test skips. There is no sqlmock path here — the fixture's whole point is real
// MySQL round-trip behavior (the PREPARE/EXECUTE/DEALLOCATE amplification the
// baseline report documents).
//
// Shape provenance: the section/module/adaptive-role blueprint mirrors
// internal/exams/sat_initialization.go (satInitialBlueprint) so the fixture
// matches what exams.Create produces for a real SAT exam. Questions are seeded
// directly (not via LoadSampleExam) because the baseline needs a deterministic,
// reviewable dataset with controlled JSON size variants.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// Fixture identifiers.
const (
	readPerfSlugPrefix = "readperf-sat-"

	readPerfRWModuleKey     = "rw-m1"
	readPerfRWLowerKey      = "rw-m2-lower"
	readPerfRWHigherKey     = "rw-m2-higher"
	readPerfMathModuleKey   = "math-m1"
	readPerfMathLowerKey    = "math-m2-lower"
	readPerfMathHigherKey   = "math-m2-higher"
	readPerfRWQuestionCount = 27
	readPerfMathQCount      = 22

	// readPerfRevision is the draft version revision the fixture seeds. A
	// non-zero value keeps the golden snapshots honest about revision plumbing.
	readPerfRevision = 3

	// readPerfStaleAfter is how old a leftover fixture must be before the
	// defensive sweep removes it. Comfortably longer than any single test run,
	// so a concurrently running fixture is never swept.
	readPerfStaleAfter = 30 * time.Minute
)

// Section selectors used by the question generator.
const (
	readPerfSectionRW   = "reading-writing"
	readPerfSectionMath = "math"
)

// newReadPerfSlug mints a unique fixture slug. Uniqueness is the isolation
// mechanism: no two runs (or two concurrent processes) can collide on it.
func newReadPerfSlug() string {
	return readPerfSlugPrefix + uuid.NewString()
}

// readPerfFixture is the handle the benchmark and golden tests use.
type readPerfFixture struct {
	DB        *sql.DB
	Runner    *tx.Runner
	Service   *Service
	ExamID    string
	VersionID string
	// Slug is this fixture's unique slug; cleanup and the question-row marker
	// derive from it so nothing outside this fixture is ever touched.
	Slug string
	// ModuleIDs maps module_key -> module id.
	ModuleIDs map[string]string
	// SectionIDs maps section_key -> section id.
	SectionIDs map[string]string
	// Revision is the draft version revision after seeding.
	Revision int
	// QuestionCount is the total placement count (147).
	QuestionCount int
	// AnswerByQuestionID maps exam question id -> expected answer key, so the
	// redaction test can assert the preview never emits it.
	AnswerByQuestionID map[string]string
}

// readPerfDSN returns the gated DSN, skipping when unset.
func readPerfDSN(t *testing.T) string {
	t.Helper()
	dsn := strings.TrimSpace(os.Getenv("TEST_MYSQL_DSN"))
	if dsn == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	return dsn
}

// openReadPerfFixture opens the gated pool without seeding.
func openReadPerfFixture(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("mysql", readPerfDSN(t))
	if err != nil {
		t.Fatalf("open mysql: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(64)
	db.SetMaxIdleConns(64)
	db.SetConnMaxLifetime(0)
	return db
}

// seedReadPerfFixture creates the complete SAT draft on its own pool and
// registers cleanup.
func seedReadPerfFixture(t *testing.T) *readPerfFixture {
	t.Helper()
	return seedReadPerfFixtureWithDB(t, openReadPerfFixture(t))
}

// seedReadPerfFixtureWithDB seeds the fixture onto an EXISTING pool. The
// benchmark uses this so its counting driver wrapper observes every statement
// the service issues (seedReadPerfFixture opens its own plain pool).
//
// Each call gets a unique slug, so concurrent fixtures never collide and a
// leftover row from a crashed run cannot cause a duplicate-key failure.
func seedReadPerfFixtureWithDB(t *testing.T, db *sql.DB) *readPerfFixture {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 180*time.Second)
	defer cancel()

	// Defensive: sweep only CRASH leftovers (older than readPerfStaleAfter).
	// A concurrently running fixture is younger than the threshold and is
	// therefore never touched.
	if err := cleanupStaleReadPerfFixtures(ctx, db); err != nil {
		t.Fatalf("sweep stale fixtures: %v", err)
	}

	fixture := &readPerfFixture{
		DB:                 db,
		Runner:             tx.NewRunner(db),
		Slug:               newReadPerfSlug(),
		ModuleIDs:          map[string]string{},
		SectionIDs:         map[string]string{},
		AnswerByQuestionID: map[string]string{},
	}
	fixture.Service = NewService(db, fixture.Runner)

	t.Cleanup(func() {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelCleanup()
		if err := cleanupReadPerfExam(cleanupCtx, db, fixture.ExamID); err != nil {
			t.Errorf("fixture cleanup: %v", err)
		}
	})

	if err := fixture.seed(ctx, fixture.Slug); err != nil {
		t.Fatalf("seed fixture: %v", err)
	}
	fixture.assertRowCounts(ctx, t)
	return fixture
}

// readPerfSectionSpec is one seeded section.
type readPerfSectionSpec struct {
	key, title   string
	breakSeconds int
	duration     int
	modules      []readPerfModuleSpec
}

// readPerfModuleSpec is one seeded module.
type readPerfModuleSpec struct {
	key, title, role string
	duration         int
	questionCount    int
	tools            []string
}

// readPerfBlueprint mirrors satInitialBlueprint
// (internal/exams/sat_initialization.go) so the fixture is shape-identical to a
// real SAT exam created through the API.
var readPerfBlueprint = []readPerfSectionSpec{
	{
		key: "reading-writing", title: "Reading & Writing", breakSeconds: 600, duration: 32 * 60,
		modules: []readPerfModuleSpec{
			{key: readPerfRWModuleKey, title: "Module 1", role: RoleBase, duration: 32 * 60, questionCount: readPerfRWQuestionCount, tools: []string{}},
			{key: readPerfRWLowerKey, title: "Module 2 - Lower", role: RoleLowerBranch, duration: 32 * 60, questionCount: readPerfRWQuestionCount, tools: []string{}},
			{key: readPerfRWHigherKey, title: "Module 2 - Higher", role: RoleHigherBranch, duration: 32 * 60, questionCount: readPerfRWQuestionCount, tools: []string{}},
		},
	},
	{
		key: "math", title: "Math", breakSeconds: 0, duration: 35 * 60,
		modules: []readPerfModuleSpec{
			{key: readPerfMathModuleKey, title: "Module 1", role: RoleBase, duration: 35 * 60, questionCount: readPerfMathQCount, tools: []string{"calculator", "reference_sheet"}},
			{key: readPerfMathLowerKey, title: "Module 2 - Lower", role: RoleLowerBranch, duration: 35 * 60, questionCount: readPerfMathQCount, tools: []string{"calculator", "reference_sheet"}},
			{key: readPerfMathHigherKey, title: "Module 2 - Higher", role: RoleHigherBranch, duration: 35 * 60, questionCount: readPerfMathQCount, tools: []string{"calculator", "reference_sheet"}},
		},
	},
}

// readPerfContent is the version content snapshot for the fixture.
const readPerfContent = `{"providerKey":"sat"}`

// readPerfConfig mirrors the SAT config produced by exams.satInitialConfig.
func readPerfConfig() string {
	value := map[string]any{
		"providerKey": "sat",
		"scoreKind":   "practice",
		"delivery": map[string]any{
			"launchMode":              "proctor_start",
			"transitionMode":          "auto_with_proctor_override",
			"allowedExtensionMinutes": []int{5, 10},
		},
		"progression": map[string]any{
			"autoSubmit": true, "lockAfterSubmit": true, "allowPause": true,
		},
		"security": map[string]any{
			"heartbeatIntervalSeconds":           15,
			"heartbeatMissThreshold":             3,
			"pauseOnOffline":                     true,
			"bufferAnswersOffline":               true,
			"requireDeviceContinuityOnReconnect": true,
		},
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// seed writes the exam, draft version, sections, modules, routing policies, and
// every question placement/revision in one transaction.
func (f *readPerfFixture) seed(ctx context.Context, slug string) error {
	now := time.Now().UTC()
	return f.Runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		f.ExamID = uuid.NewString()
		f.VersionID = uuid.NewString()

		if _, err := q.ExecContext(ctx, `
			INSERT INTO exam_entities
			  (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility,
			   organization_id, owner_id, schema_version, revision, created_at, updated_at)
			VALUES (?, ?, 'Read-perf SAT baseline', 'sat', 'SAT', 'Academic', 'draft', 'private',
			        NULL, ?, 4, 0, ?, ?)`,
			f.ExamID, slug, slug, now, now); err != nil {
			return fmt.Errorf("insert exam_entities: %w", err)
		}

		if _, err := q.ExecContext(ctx, `
			INSERT INTO exam_versions
			  (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_draft, is_published, revision)
			VALUES (?, ?, 1, ?, ?, ?, TRUE, FALSE, ?)`,
			f.VersionID, f.ExamID, readPerfContent, readPerfConfig(), slug, readPerfRevision); err != nil {
			return fmt.Errorf("insert exam_versions: %w", err)
		}

		for sectionIndex, section := range readPerfBlueprint {
			sectionID := uuid.NewString()
			f.SectionIDs[section.key] = sectionID
			if _, err := q.ExecContext(ctx, `
				INSERT INTO assessment_sections
				  (id, exam_version_id, section_key, title, display_order, duration_seconds,
				   break_after_seconds, instructions, tool_policy, revision)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0)`,
				sectionID, f.VersionID, section.key, section.title, sectionIndex,
				section.duration*2, section.breakSeconds, `{"version":1,"nodes":[]}`); err != nil {
				return fmt.Errorf("insert section %s: %w", section.key, err)
			}

			moduleIDs := map[string]string{}
			for moduleIndex, module := range section.modules {
				moduleID := uuid.NewString()
				moduleIDs[module.key] = moduleID
				f.ModuleIDs[module.key] = moduleID
				tools, err := json.Marshal(module.tools)
				if err != nil {
					return err
				}
				if _, err := q.ExecContext(ctx, `
					INSERT INTO assessment_modules
					  (id, section_id, module_key, title, display_order, duration_seconds,
					   target_question_count, adaptive_role, instructions, tool_policy, revision)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
					moduleID, sectionID, module.key, module.title, moduleIndex,
					module.duration, module.questionCount, module.role,
					`{"version":1,"nodes":[]}`, string(tools)); err != nil {
					return fmt.Errorf("insert module %s: %w", module.key, err)
				}
			}

			operational := section.modules[0].questionCount - 2
			threshold := operational/2 + 1
			policyConfig, err := json.Marshal(map[string]int{"minimumCorrectForHigher": threshold})
			if err != nil {
				return err
			}
			if _, err := q.ExecContext(ctx, `
				INSERT INTO assessment_routing_policies
				  (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision)
				VALUES (?, ?, ?, ?, ?, 'practice_threshold', ?, 0)`,
				uuid.NewString(), sectionID,
				moduleIDs[section.modules[0].key], moduleIDs[section.modules[1].key], moduleIDs[section.modules[2].key],
				string(policyConfig)); err != nil {
				return fmt.Errorf("insert routing policy for %s: %w", section.key, err)
			}

			for _, module := range section.modules {
				if err := f.seedModuleQuestions(ctx, q, section.key, module); err != nil {
					return err
				}
			}
		}

		if _, err := q.ExecContext(ctx,
			"UPDATE exam_entities SET current_draft_version_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
			f.VersionID, now, f.ExamID); err != nil {
			return fmt.Errorf("point draft pointer: %w", err)
		}
		f.Revision = readPerfRevision
		return nil
	})
}

// seedModuleQuestions inserts every placement + revision for one module.
//
// JSON variants: Reading & Writing mixes single_choice with rich multi-node
// stimulus (tables, math nodes) and plain single-paragraph prompts; Math mixes
// single_choice with student_produced_response. The mix keeps the CPU profile
// representative of real authoring content (readiness.go validateSATQuestion
// plus per-question json work) rather than a degenerate all-identical corpus.
func (f *readPerfFixture) seedModuleQuestions(ctx context.Context, q tx.Tx, sectionKey string, module readPerfModuleSpec) error {
	section := readPerfSectionRW
	if sectionKey == SectionMath {
		section = readPerfSectionMath
	}
	for index := 0; index < module.questionCount; index++ {
		questionID := uuid.NewString()
		revisionID := uuid.NewString()
		examQuestionID := uuid.NewString()

		if _, err := q.ExecContext(ctx,
			"INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)",
			questionID, f.Slug); err != nil {
			return fmt.Errorf("insert question %d of %s: %w", index, module.key, err)
		}

		payload := readPerfQuestionPayload(section, module, index)
		f.AnswerByQuestionID[examQuestionID] = payload.answerKey

		if _, err := q.ExecContext(ctx, `
			INSERT INTO assessment_question_revisions
			  (id, question_id, semantic_revision, revision, state, question_type,
			   stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by)
			VALUES (?, ?, 1, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
			revisionID, questionID, payload.questionType, payload.stimulus, payload.prompt,
			payload.answer, payload.rationale, payload.metadata,
			`{"version":1,"nodes":[]}`, f.Slug); err != nil {
			return fmt.Errorf("insert revision %d of %s: %w", index, module.key, err)
		}

		// Two pretests per module mirror the SAT blueprint
		// (satBlueprintModule pretestCount) so isPretest is exercised in the
		// golden snapshot.
		isPretest := index >= module.questionCount-2
		if _, err := q.ExecContext(ctx, `
			INSERT INTO assessment_exam_questions
			  (id, module_id, question_id, question_revision_id, display_order, is_pretest)
			VALUES (?, ?, ?, ?, ?, ?)`,
			examQuestionID, f.ModuleIDs[module.key], questionID, revisionID, index, isPretest); err != nil {
			return fmt.Errorf("insert placement %d of %s: %w", index, module.key, err)
		}
	}
	return nil
}

// readPerfQuestion is one generated question payload.
type readPerfQuestion struct {
	questionType string
	stimulus     string
	prompt       string
	answer       string
	rationale    string
	metadata     string
	answerKey    string
}

// readPerfRichDocument builds a multi-block TipTap document so the fixture
// covers the non-fast-path (rich) contentComplexity branch.
func readPerfRichDocument(text string) string {
	value := map[string]any{
		"nodes":   []any{},
		"version": 2,
		"document": map[string]any{
			"type": "doc",
			"content": []any{
				map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}},
				map[string]any{"type": "table", "content": []any{
					map[string]any{"type": "tableRow", "content": []any{
						map[string]any{"type": "tableCell", "content": []any{map[string]any{"type": "text", "text": "Sample"}}},
						map[string]any{"type": "tableCell", "content": []any{map[string]any{"type": "text", "text": "Result"}}},
					}},
				}},
				map[string]any{"type": "blockMath", "attrs": map[string]any{"latex": "x^2 + y^2 = z^2"}},
			},
		},
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// readPerfPlainDocument builds a single-paragraph TipTap document: the
// fast-plain-editing shape (contentComplexity == plain).
func readPerfPlainDocument(text string) string {
	value := map[string]any{
		"nodes":   []any{},
		"version": 2,
		"document": map[string]any{
			"type":    "doc",
			"content": []any{map[string]any{"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}}}},
		},
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// readPerfEmptyDocument is the empty stimulus shape.
func readPerfEmptyDocument() string {
	return `{"nodes":[],"version":2,"document":{"type":"doc","content":[]}}`
}

// readPerfMetadata builds SAT-valid metadata for the section.
func readPerfMetadata(section string, moduleKey string, index int) string {
	var domain, skill string
	if section == readPerfSectionRW {
		domains := []struct{ domain, skill string }{
			{"information-and-ideas", "Central Ideas and Details"},
			{"craft-and-structure", "Words in Context"},
			{"expression-of-ideas", "Transitions"},
			{"standard-english-conventions", "Boundaries"},
		}
		pick := domains[index%len(domains)]
		domain, skill = pick.domain, pick.skill
	} else {
		domains := []struct{ domain, skill string }{
			{"algebra", "Linear Equations in One Variable"},
			{"advanced-math", "Equivalent Expressions"},
			{"problem-solving-and-data-analysis", "Percentages"},
			{"geometry-and-trigonometry", "Area and Volume"},
		}
		pick := domains[index%len(domains)]
		domain, skill = pick.domain, pick.skill
	}
	difficulties := []string{"easy", "medium", "hard"}
	value := map[string]any{
		"tags":       []string{"readperf-baseline", moduleKey},
		"skill":      skill,
		"domain":     domain,
		"difficulty": difficulties[index%len(difficulties)],
		"sectionKey": section,
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(encoded)
}

// readPerfQuestionPayload generates one deterministic question.
//
// The rich/plain shapes are selected by index so the dataset has a stable,
// documented content mix (see plans/authoring-read-perf/baseline-report.md).
func readPerfQuestionPayload(section string, module readPerfModuleSpec, index int) readPerfQuestion {
	metadata := readPerfMetadata(section, module.key, index)
	rationale := readPerfPlainDocument("Seeded rationale for baseline measurement.")

	// Every 4th item in a Math module is a student-produced response; all
	// Reading & Writing items are single choice (SAT blueprint rule).
	if section == readPerfSectionMath && index%4 == 3 {
		answerValue := map[string]any{
			"kind":              "student_produced_response",
			"normalizeFraction": true,
			"normalizeDecimal":  true,
			"numericTolerance":  nil,
			"acceptedResponses": []string{fmt.Sprintf("%d", index)},
		}
		answer, err := json.Marshal(answerValue)
		if err != nil {
			panic(err)
		}
		return readPerfQuestion{
			questionType: "student_produced_response",
			stimulus:     readPerfEmptyDocument(),
			prompt:       readPerfPlainDocument(fmt.Sprintf("Solve for x: %dx + %d = %d. Enter the value of x.", index+2, index, index*3+2)),
			answer:       string(answer),
			rationale:    rationale,
			metadata:     metadata,
			answerKey:    fmt.Sprintf("%d", index),
		}
	}

	// Rich stimulus every 3rd item; plain stimulus otherwise.
	stimulus := readPerfPlainDocument(fmt.Sprintf("Seeded stimulus text for %s item %d.", module.key, index))
	if index%3 == 0 {
		stimulus = readPerfRichDocument(fmt.Sprintf("Seeded rich stimulus with table and math for %s item %d.", module.key, index))
	}

	optionText := []string{"First option", "Second option", "Third option", "Fourth option"}
	options := make([]any, 0, 4)
	for optionIndex, text := range optionText {
		options = append(options, map[string]any{
			"id":      string(rune('A' + optionIndex)),
			"content": json.RawMessage(readPerfPlainDocument(fmt.Sprintf("%s for %s item %d.", text, module.key, index))),
		})
	}
	correct := string(rune('A' + index%4))
	answerValue := map[string]any{
		"kind":            "single_choice",
		"options":         options,
		"correctOptionId": correct,
	}
	answer, err := json.Marshal(answerValue)
	if err != nil {
		panic(err)
	}
	return readPerfQuestion{
		questionType: "single_choice",
		stimulus:     stimulus,
		prompt:       readPerfPlainDocument(fmt.Sprintf("Which choice best answers %s item %d?", module.key, index)),
		answer:       string(answer),
		rationale:    rationale,
		metadata:     metadata,
		answerKey:    correct,
	}
}

// assertRowCounts pins the seeded shape so a silent seeder regression fails
// loudly instead of quietly shrinking the measured dataset.
func (f *readPerfFixture) assertRowCounts(ctx context.Context, t *testing.T) {
	t.Helper()
	wantModules := len(readPerfBlueprint[0].modules) + len(readPerfBlueprint[1].modules)
	var sections, modules, policies, questions int
	if err := f.DB.QueryRowContext(ctx,
		"SELECT COUNT(*) FROM assessment_sections WHERE exam_version_id = ?", f.VersionID).Scan(&sections); err != nil {
		t.Fatalf("count sections: %v", err)
	}
	if err := f.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?`, f.VersionID).Scan(&modules); err != nil {
		t.Fatalf("count modules: %v", err)
	}
	if err := f.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM assessment_routing_policies rp
		JOIN assessment_sections s ON s.id = rp.section_id
		WHERE s.exam_version_id = ?`, f.VersionID).Scan(&policies); err != nil {
		t.Fatalf("count routing policies: %v", err)
	}
	if err := f.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?`, f.VersionID).Scan(&questions); err != nil {
		t.Fatalf("count questions: %v", err)
	}
	wantQuestions := readPerfRWQuestionCount*3 + readPerfMathQCount*3
	if sections != 2 || modules != wantModules || policies != 2 || questions != wantQuestions {
		t.Fatalf("fixture shape drift: sections=%d modules=%d policies=%d questions=%d (want 2/%d/2/%d)",
			sections, modules, policies, questions, wantModules, wantQuestions)
	}
	f.QuestionCount = questions
}

// readPerfExamVersions returns every version id owned by one exam.
func readPerfExamVersions(ctx context.Context, db *sql.DB, examID string) ([]string, error) {
	rows, err := db.QueryContext(ctx, "SELECT id FROM exam_versions WHERE exam_id = ?", examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	versionIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		versionIDs = append(versionIDs, id)
	}
	return versionIDs, rows.Err()
}

// readPerfExamQuestionIDs returns the question ids reachable from one exam's
// versions. This MUST be collected before placements are deleted, because the
// placement table is the only link from an exam to its questions.
func readPerfExamQuestionIDs(ctx context.Context, db *sql.DB, examID string) ([]string, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT DISTINCT eq.question_id
		FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN exam_versions v ON v.id = s.exam_version_id
		WHERE v.exam_id = ?`, examID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	questionIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		questionIDs = append(questionIDs, id)
	}
	return questionIDs, rows.Err()
}

// cleanupReadPerfExam removes exactly the rows owned by one exam. It is the
// ONLY deletion path, and it is scoped by exam id: it can never touch another
// fixture's data.
//
// Delete order follows the FK graph. exam_versions.parent_version_id is a
// NO ACTION self-FK, so lineage is detached first (mirrors the production
// Delete path).
func cleanupReadPerfExam(ctx context.Context, db *sql.DB, examID string) error {
	if strings.TrimSpace(examID) == "" {
		return nil
	}
	versionIDs, err := readPerfExamVersions(ctx, db, examID)
	if err != nil {
		return fmt.Errorf("list versions: %w", err)
	}
	questionIDs, err := readPerfExamQuestionIDs(ctx, db, examID)
	if err != nil {
		return fmt.Errorf("list question ids: %w", err)
	}

	for _, query := range []string{
		"DELETE FROM exam_schedules WHERE exam_id = ?",
		"DELETE FROM exam_events WHERE exam_id = ?",
		"DELETE FROM sat_workbook_imports WHERE exam_id = ?",
		"DELETE FROM assessment_access_links WHERE exam_id = ?",
	} {
		if _, err := db.ExecContext(ctx, query, examID); err != nil {
			return fmt.Errorf("%s: %w", query, err)
		}
	}

	for _, versionID := range versionIDs {
		if _, err := db.ExecContext(ctx, `
			DELETE eq FROM assessment_exam_questions eq
			JOIN assessment_modules m ON m.id = eq.module_id
			JOIN assessment_sections s ON s.id = m.section_id
			WHERE s.exam_version_id = ?`, versionID); err != nil {
			return fmt.Errorf("delete placements: %w", err)
		}
	}

	for _, questionID := range questionIDs {
		if _, err := db.ExecContext(ctx,
			"DELETE FROM assessment_question_revisions WHERE question_id = ?", questionID); err != nil {
			return fmt.Errorf("delete revisions for %s: %w", questionID, err)
		}
		if _, err := db.ExecContext(ctx,
			"DELETE FROM assessment_questions WHERE id = ?", questionID); err != nil {
			return fmt.Errorf("delete question %s: %w", questionID, err)
		}
	}

	if _, err := db.ExecContext(ctx, "UPDATE exam_versions SET parent_version_id = NULL WHERE exam_id = ?", examID); err != nil {
		return fmt.Errorf("detach version lineage: %w", err)
	}
	if _, err := db.ExecContext(ctx, "DELETE FROM exam_versions WHERE exam_id = ?", examID); err != nil {
		return fmt.Errorf("delete versions: %w", err)
	}
	if _, err := db.ExecContext(ctx, "DELETE FROM exam_entities WHERE id = ?", examID); err != nil {
		return fmt.Errorf("delete exam: %w", err)
	}
	return nil
}

// cleanupStaleReadPerfFixtures removes CRASH leftovers only: fixtures whose slug
// matches this harness AND whose row is older than readPerfStaleAfter. A
// concurrently running fixture is always younger, so it is never swept.
//
// This is what makes seeding self-healing without reintroducing the
// cross-process teardown bug: uniqueness handles correctness, this only stops
// crashed runs from accumulating forever.
func cleanupStaleReadPerfFixtures(ctx context.Context, db *sql.DB) error {
	rows, err := db.QueryContext(ctx,
		"SELECT id FROM exam_entities WHERE slug LIKE ? AND created_at < ?",
		readPerfSlugPrefix+"%", time.Now().UTC().Add(-readPerfStaleAfter))
	if err != nil {
		return err
	}
	staleIDs := []string{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		staleIDs = append(staleIDs, id)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return err
	}
	for _, examID := range staleIDs {
		if err := cleanupReadPerfExam(ctx, db, examID); err != nil {
			return fmt.Errorf("cleanup stale fixture %s: %w", examID, err)
		}
	}
	return nil
}

// TestReadPerfFixtureSeedsFullSATShape proves the seeder produces the exact
// dataset the baseline depends on.
func TestReadPerfFixtureSeedsFullSATShape(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	ctx := context.Background()

	if fixture.QuestionCount != 147 {
		t.Fatalf("question count = %d, want 147", fixture.QuestionCount)
	}

	shell, err := fixture.Service.Shell(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("Shell on seeded fixture: %v", err)
	}
	if shell.ProviderKey != "sat" {
		t.Fatalf("providerKey = %q, want sat", shell.ProviderKey)
	}
	if shell.VersionID != fixture.VersionID {
		t.Fatalf("versionId = %q, want %q", shell.VersionID, fixture.VersionID)
	}
	if shell.VersionRevision != readPerfRevision {
		t.Fatalf("versionRevision = %d, want %d", shell.VersionRevision, readPerfRevision)
	}
	if len(shell.Sections) != 2 {
		t.Fatalf("sections = %d, want 2", len(shell.Sections))
	}

	wantModuleOrder := map[string][]string{
		readPerfSectionRW:   {readPerfRWModuleKey, readPerfRWLowerKey, readPerfRWHigherKey},
		readPerfSectionMath: {readPerfMathModuleKey, readPerfMathLowerKey, readPerfMathHigherKey},
	}
	wantCounts := map[string]int{
		readPerfRWModuleKey:   readPerfRWQuestionCount,
		readPerfRWLowerKey:    readPerfRWQuestionCount,
		readPerfRWHigherKey:   readPerfRWQuestionCount,
		readPerfMathModuleKey: readPerfMathQCount,
		readPerfMathLowerKey:  readPerfMathQCount,
		readPerfMathHigherKey: readPerfMathQCount,
	}
	for _, section := range shell.Sections {
		if section.RoutingPolicy == nil {
			t.Fatalf("section %s has no routing policy", section.SectionKey)
		}
		got := make([]string, 0, len(section.Modules))
		for _, module := range section.Modules {
			got = append(got, module.ModuleKey)
			if len(module.Questions) != wantCounts[module.ModuleKey] {
				t.Fatalf("module %s has %d questions, want %d", module.ModuleKey, len(module.Questions), wantCounts[module.ModuleKey])
			}
			for index, question := range module.Questions {
				if question.DisplayOrder != index {
					t.Fatalf("module %s question %d displayOrder = %d, want %d", module.ModuleKey, index, question.DisplayOrder, index)
				}
				if question.Readiness.Status != "ready" {
					t.Fatalf("module %s question %d readiness = %q (%d blocking); seeded questions must validate clean",
						module.ModuleKey, index, question.Readiness.Status, question.Readiness.BlockingIssueCount)
				}
			}
		}
		want := wantModuleOrder[section.SectionKey]
		if len(got) != len(want) {
			t.Fatalf("section %s modules = %v, want %v", section.SectionKey, got, want)
		}
		for i := range want {
			if got[i] != want[i] {
				t.Fatalf("section %s module order = %v, want %v", section.SectionKey, got, want)
			}
		}
	}
}

// TestReadPerfFixtureIsolatesConcurrentInstances proves the isolation contract:
// two fixtures alive at once have distinct slugs and distinct exams, and
// deleting one leaves the other completely intact. This is the regression test
// for the cross-process teardown bug (a shared slug plus a global
// marker-scoped delete let one run destroy another's live fixture).
func TestReadPerfFixtureIsolatesConcurrentInstances(t *testing.T) {
	ctx := context.Background()
	db := openReadPerfFixture(t)

	first := seedReadPerfFixtureWithDB(t, db)
	second := seedReadPerfFixtureWithDB(t, db)

	if first.Slug == second.Slug {
		t.Fatalf("fixtures share a slug (%q); concurrent runs would collide", first.Slug)
	}
	if first.ExamID == second.ExamID {
		t.Fatalf("fixtures share an exam id (%q)", first.ExamID)
	}

	// Destroy the first fixture explicitly; the second must survive untouched.
	if err := cleanupReadPerfExam(ctx, db, first.ExamID); err != nil {
		t.Fatalf("cleanup first fixture: %v", err)
	}

	shell, err := second.Service.Shell(ctx, second.ExamID)
	if err != nil {
		t.Fatalf("second fixture was damaged by the first fixture's cleanup: %v", err)
	}
	if len(shell.Sections) != 2 {
		t.Fatalf("second fixture sections = %d, want 2", len(shell.Sections))
	}
	total := 0
	for _, section := range shell.Sections {
		for _, module := range section.Modules {
			total += len(module.Questions)
		}
	}
	if total != 147 {
		t.Fatalf("second fixture questions = %d, want 147", total)
	}

	// And the deleted fixture must really be gone.
	if _, err := first.Service.Shell(ctx, first.ExamID); err == nil {
		t.Fatal("first fixture still readable after cleanup")
	}
}

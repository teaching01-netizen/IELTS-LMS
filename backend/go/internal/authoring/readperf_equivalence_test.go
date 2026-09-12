package authoring

// Phase 02 equivalence harness — THE cutover safety net for Phase 03.
//
// This file runs the OLD nested loaders and the NEW bulk loaders against the
// SAME real MySQL fixture and asserts the two projections are byte-identical
// after canonical JSON encoding. sqlmock cannot prove this: it pins the
// statement sequence, not the semantics of the SQL. Only a real database with
// a real fixture can show that
//
//     loadSections/loadModules/loadSummaries/loadRouting  ==  bulk path
//
// which is the AT-01 oracle for the Phase-03 cutover.
//
// Coverage (spec §2.10):
//   - empty version            -> sections:[] (never null), no fanout
//   - single section/module    -> grouping, no routing -> null, [] questions
//   - full SAT fixture         -> 2 sections / 6 modules / 147 questions,
//                                 including rich + SPR content and 12 pretests
//
// Plus a per-level comparison (section/module/question/routing) so a future
// change to any single loader is localized by the failure message instead of
// only telling us "the tree differs".
//
// Gated on TEST_MYSQL_DSN like readperf_fixture_test.go; skips otherwise.

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// canonicalJSON renders a projection with the same encoder the wire uses.
// Both sides of every comparison go through this, so "byte-identical" means
// byte-identical on the wire, including empty-array-vs-null and field order.
func canonicalJSON(t *testing.T, label string, value any) string {
	t.Helper()
	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal %s: %v", label, err)
	}
	return string(encoded)
}

// requireIdentical fails with a bounded, useful diff when two canonical
// payloads differ. The first divergence index is reported because a full
// 98 KB payload dump is unreadable and hides the actual difference.
func requireIdentical(t *testing.T, what, oldPayload, newPayload string) {
	t.Helper()
	if oldPayload == newPayload {
		return
	}
	index := 0
	for index < len(oldPayload) && index < len(newPayload) && oldPayload[index] == newPayload[index] {
		index++
	}
	window := func(s string) string {
		start := index - 80
		if start < 0 {
			start = 0
		}
		end := index + 160
		if end > len(s) {
			end = len(s)
		}
		return s[start:end]
	}
	t.Fatalf("%s differs between the nested loader and the bulk loader\n"+
		"old len=%d new len=%d first divergence at byte %d\n"+
		"old: ...%s...\nnew: ...%s...",
		what, len(oldPayload), len(newPayload), index, window(oldPayload), window(newPayload))
}

// ---------------------------------------------------------------------------
// Minimal version seeder for the equivalence fixtures.
// ---------------------------------------------------------------------------

// equivModuleSpec is one seeded module.
type equivModuleSpec struct {
	key           string
	title         string
	role          string
	questionCount int
	// sprEvery seeds a student_produced_response every N items (0 = never).
	sprEvery int
	// richEvery seeds a rich multi-block stimulus every N items (0 = never).
	richEvery int
	// toolsJSON is the raw tool_policy column value; "" seeds SQL NULL.
	toolsJSON string
}

// equivSectionSpec is one seeded section.
type equivSectionSpec struct {
	key         string
	title       string
	modules     []equivModuleSpec
	withRouting bool
	// routingConfig is the raw policy_config JSON; "" seeds a config without
	// the numeric keys, exercising the "unparseable/absent" branch.
	routingConfig string
}

// seedEquivVersion inserts a draft exam + version with the given shape and
// returns (examID, versionID). Cleanup is registered so the shared MySQL is
// left exactly as it was found.
func seedEquivVersion(t *testing.T, db *sql.DB, runner *tx.Runner, sections []equivSectionSpec) (string, string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 120*time.Second)
	defer cancel()

	examID := uuid.NewString()
	versionID := uuid.NewString()
	slug := newReadPerfSlug() + "-equiv"
	now := time.Now().UTC()

	t.Cleanup(func() {
		cleanupCtx, cancelCleanup := context.WithTimeout(context.Background(), 60*time.Second)
		defer cancelCleanup()
		if err := cleanupReadPerfExam(cleanupCtx, db, examID); err != nil {
			t.Errorf("equivalence fixture cleanup: %v", err)
		}
	})

	sectionIDs := map[string]string{}
	moduleIDs := map[string]string{}

	err := runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if _, err := q.ExecContext(ctx, `
			INSERT INTO exam_entities
			  (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility,
			   organization_id, owner_id, schema_version, revision, created_at, updated_at)
			VALUES (?, ?, 'Phase 02 equivalence fixture', 'sat', 'SAT', 'Academic', 'draft', 'private',
			        NULL, ?, 4, 0, ?, ?)`,
			examID, slug, slug, now, now); err != nil {
			return fmt.Errorf("insert exam_entities: %w", err)
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO exam_versions
			  (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_draft, is_published, revision)
			VALUES (?, ?, 1, ?, ?, ?, TRUE, FALSE, ?)`,
			versionID, examID, readPerfContent, readPerfConfig(), slug, readPerfRevision); err != nil {
			return fmt.Errorf("insert exam_versions: %w", err)
		}
		for sectionIndex, section := range sections {
			sectionID := uuid.NewString()
			sectionIDs[section.key] = sectionID
			if _, err := q.ExecContext(ctx, `
				INSERT INTO assessment_sections
				  (id, exam_version_id, section_key, title, display_order, duration_seconds,
				   break_after_seconds, instructions, tool_policy, revision)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', 0)`,
				sectionID, versionID, section.key, section.title, sectionIndex,
				32*60, 600, `{"version":1,"nodes":[]}`); err != nil {
				return fmt.Errorf("insert section %s: %w", section.key, err)
			}
			for moduleIndex, module := range section.modules {
				moduleID := uuid.NewString()
				moduleIDs[module.key] = moduleID
				// assessment_modules.tool_policy is JSON NOT NULL, so a real row
				// can never be NULL or blank; the "{}" default in loadModules /
				// moduleToolPolicy is a defensive branch for rows that predate the
				// column, and it is covered by the golden sqlmock test plus the
				// pure-assembler unit test instead.
				tools := strings.TrimSpace(module.toolsJSON)
				if tools == "" {
					tools = "[]"
				}
				if _, err := q.ExecContext(ctx, `
					INSERT INTO assessment_modules
					  (id, section_id, module_key, title, display_order, duration_seconds,
					   target_question_count, adaptive_role, instructions, tool_policy, revision)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
					moduleID, sectionID, module.key, module.title, moduleIndex,
					32*60, module.questionCount, module.role,
					`{"version":1,"nodes":[]}`, tools); err != nil {
					return fmt.Errorf("insert module %s: %w", module.key, err)
				}
				if err := seedEquivQuestions(ctx, q, section, module, moduleID, slug); err != nil {
					return err
				}
			}
			if section.withRouting {
				config := section.routingConfig
				if strings.TrimSpace(config) == "" {
					config = `{"minimumCorrectForHigher":7,"operationalQuestionCount":13}`
				}
				baseID, lowerID, higherID := "", "", ""
				if len(section.modules) > 0 {
					baseID = moduleIDs[section.modules[0].key]
				}
				if len(section.modules) > 1 {
					lowerID = moduleIDs[section.modules[1].key]
				}
				if len(section.modules) > 2 {
					higherID = moduleIDs[section.modules[2].key]
				} else {
					// The routing FK requires three module ids; reuse the base
					// module so a single-module section can still carry a
					// policy (the equivalence test only compares projections).
					lowerID, higherID = baseID, baseID
				}
				if _, err := q.ExecContext(ctx, `
					INSERT INTO assessment_routing_policies
					  (id, section_id, base_module_id, lower_module_id, higher_module_id, policy_key, policy_config, revision)
					VALUES (?, ?, ?, ?, ?, 'practice_threshold', ?, 2)`,
					uuid.NewString(), sectionID, baseID, lowerID, higherID, config); err != nil {
					return fmt.Errorf("insert routing for %s: %w", section.key, err)
				}
			}
		}
		if _, err := q.ExecContext(ctx,
			"UPDATE exam_entities SET current_draft_version_id = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
			versionID, now, examID); err != nil {
			return fmt.Errorf("point draft pointer: %w", err)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("seed equivalence version: %v", err)
	}
	_ = sectionIDs
	return examID, versionID
}

// seedEquivQuestions inserts one module's placements + revisions.
func seedEquivQuestions(ctx context.Context, q tx.Tx, section equivSectionSpec, module equivModuleSpec, moduleID, slug string) error {
	sectionKey := section.key
	for index := 0; index < module.questionCount; index++ {
		questionID := uuid.NewString()
		revisionID := uuid.NewString()
		examQuestionID := uuid.NewString()

		questionType := "single_choice"
		stimulus := readPerfPlainDocument(fmt.Sprintf("Phase 02 equivalence stimulus for %s item %d.", module.key, index))
		if module.richEvery > 0 && index%module.richEvery == 0 {
			stimulus = readPerfRichDocument(fmt.Sprintf("Phase 02 rich stimulus for %s item %d.", module.key, index))
		}
		answer := readPerfSingleChoiceAnswer(string(rune('A' + index%4)))
		if module.sprEvery > 0 && index%module.sprEvery == 0 {
			questionType = "student_produced_response"
			stimulus = readPerfEmptyDocument()
			answer = readPerfSPRAnswer(fmt.Sprintf("%d", index))
		}
		metadata := readPerfGoldenMetadata(sectionKey, "information-and-ideas", "Central Ideas and Details")
		rationale := readPerfPlainDocument("Phase 02 equivalence rationale.")

		if _, err := q.ExecContext(ctx,
			"INSERT INTO assessment_questions (id, provider_key, created_by) VALUES (?, 'sat', ?)",
			questionID, slug); err != nil {
			return fmt.Errorf("insert question %d of %s: %w", index, module.key, err)
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO assessment_question_revisions
			  (id, question_id, semantic_revision, revision, state, question_type,
			   stimulus, prompt, answer_definition, rationale, metadata, accessibility, created_by)
			VALUES (?, ?, 1, 0, 'draft', ?, ?, ?, ?, ?, ?, ?, ?)`,
			revisionID, questionID, questionType, stimulus,
			readPerfPlainDocument(fmt.Sprintf("Phase 02 prompt %d.", index)),
			answer, rationale, metadata, `{"version":1,"nodes":[]}`, slug); err != nil {
			return fmt.Errorf("insert revision %d of %s: %w", index, module.key, err)
		}
		if _, err := q.ExecContext(ctx, `
			INSERT INTO assessment_exam_questions
			  (id, module_id, question_id, question_revision_id, display_order, is_pretest)
			VALUES (?, ?, ?, ?, ?, ?)`,
			examQuestionID, moduleID, questionID, revisionID, index, index >= module.questionCount-1); err != nil {
			return fmt.Errorf("insert placement %d of %s: %w", index, module.key, err)
		}
	}
	return nil
}

// ---------------------------------------------------------------------------
// Equivalence assertions
// ---------------------------------------------------------------------------

// legacyNestedShell runs the pre-Phase-03 Shell() body verbatim (two
// identity probes + loadSections N+1). Phase 03 cut Service.Shell over to the
// bulk path, so the harness can no longer call Shell() as the OLD path — that
// would compare the bulk path against itself and prove nothing. This helper
// keeps the retired nested composition alive as the equivalence reference;
// the per-entity loaders it drives (loadSections/loadModules/loadSummaries/
// loadRouting) still exist because the in-tx post-commit shell (buildShellTx)
// stays on the nested path by design.
func legacyNestedShell(ctx context.Context, db *sql.DB, service *Service, examID string) (Shell, error) {
	var providerKey string
	var draftID sql.NullString
	if err := db.QueryRowContext(ctx, "SELECT provider_key, current_draft_version_id FROM exam_entities WHERE id = ?", examID).Scan(&providerKey, &draftID); err != nil {
		if err == sql.ErrNoRows {
			return Shell{}, notFoundError("Exam not found.")
		}
		return Shell{}, err
	}
	if !draftID.Valid || strings.TrimSpace(draftID.String) == "" {
		return Shell{}, notFoundError("Draft version not found.")
	}
	var rev int
	if err := db.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ? AND exam_id = ? AND is_draft = TRUE", draftID.String, examID).Scan(&rev); err != nil {
		if err == sql.ErrNoRows {
			return Shell{}, notFoundError("Draft version not found.")
		}
		return Shell{}, err
	}
	sections, err := service.loadSections(ctx, db, draftID.String)
	if err != nil {
		return Shell{}, err
	}
	return Shell{ExamID: examID, ProviderKey: providerKey, VersionID: draftID.String, VersionRevision: rev, Sections: sections}, nil
}

// compareShellPaths runs the retired nested composition (legacyNestedShell)
// and the LIVE production Shell() (bulk path since Phase 03) over the same
// exam and asserts identical canonical JSON. It also runs the per-level
// comparison so a failure names the level that drifted.
func compareShellPaths(t *testing.T, db *sql.DB, runner *tx.Runner, examID, versionID string) {
	t.Helper()
	ctx := context.Background()
	service := NewService(db, runner)

	oldShell, err := legacyNestedShell(ctx, db, service, examID)
	if err != nil {
		t.Fatalf("legacy nested shell: %v", err)
	}
	newShell, err := service.Shell(ctx, examID)
	if err != nil {
		t.Fatalf("Shell (bulk): %v", err)
	}
	requireIdentical(t, "Shell projection",
		canonicalJSON(t, "nested shell", oldShell),
		canonicalJSON(t, "bulk shell", newShell))

	// Nil-runner fallback: the direct-read path must project the same tree.
	directService := NewService(db, nil)
	directShell, err := directService.Shell(ctx, examID)
	if err != nil {
		t.Fatalf("Shell with a nil runner: %v", err)
	}
	requireIdentical(t, "Shell projection (nil runner fallback)",
		canonicalJSON(t, "nested shell", oldShell),
		canonicalJSON(t, "bulk shell (no snapshot)", directShell))

	comparePerLevel(t, db, service, oldShell, versionID)
}

// comparePerLevel walks the OLD per-entity loaders and the NEW bulk loaders for
// every section/module and diffs each level independently.
func comparePerLevel(t *testing.T, db *sql.DB, service *Service, oldShell Shell, versionID string) {
	t.Helper()
	ctx := context.Background()

	oldSections, err := service.loadSections(ctx, db, versionID)
	if err != nil {
		t.Fatalf("loadSections (nested): %v", err)
	}
	requireIdentical(t, "sections[] (loadSections vs Shell.Sections)",
		canonicalJSON(t, "loadSections", oldSections),
		canonicalJSON(t, "Shell.Sections", oldShell.Sections))

	bulkSections, _, err := loadBulkSections(ctx, db, versionID)
	if err != nil {
		t.Fatalf("loadBulkSections: %v", err)
	}
	bulkModules, err := loadBulkModules(ctx, db, versionID)
	if err != nil {
		t.Fatalf("loadBulkModules: %v", err)
	}
	bulkRouting, err := loadBulkRouting(ctx, db, versionID)
	if err != nil {
		t.Fatalf("loadBulkRouting: %v", err)
	}
	bulkQuestions, err := loadBulkQuestionRows(ctx, db, versionID)
	if err != nil {
		t.Fatalf("loadBulkQuestionRows: %v", err)
	}
	requireIdentical(t, "sections[] (loadSections vs loadBulkSections)",
		canonicalJSON(t, "loadSections", oldSections),
		canonicalJSON(t, "assembleShellTree", assembleShellTree(
			shellIdentity{providerKey: oldShell.ProviderKey, versionID: versionID, revision: oldShell.VersionRevision},
			bulkSections, bulkModules, bulkRouting, bulkQuestions, oldShell.ExamID).Sections))

	for _, section := range oldSections {
		oldModules, err := service.loadModules(ctx, db, section.ID)
		if err != nil {
			t.Fatalf("loadModules(%s): %v", section.ID, err)
		}
		// Compare the modules level through the ASSEMBLER (not a hand-built
		// Module literal): the assembler is what Phase 03 will use, so the
		// comparison must exercise its tool_policy defaulting too. Both sides
		// have their question lists stripped so this failure names the module
		// projection rather than the question projection.
		bulkSectionModules := []Module{}
		for _, m := range bulkModules {
			if m.sectionID == section.ID {
				bulkSectionModules = append(bulkSectionModules, Module{
					ID: m.id, ModuleKey: m.moduleKey, Title: m.title,
					DisplayOrder: m.displayOrder, DurationSeconds: m.duration,
					TargetQuestionCount: m.targetCount, AdaptiveRole: m.adaptiveRole,
					ToolPolicy: moduleToolPolicy(m), Revision: m.revision,
				})
			}
		}
		stripQuestions := func(in []Module) []Module {
			out := make([]Module, 0, len(in))
			for _, m := range in {
				m.Questions = nil
				out = append(out, m)
			}
			return out
		}
		requireIdentical(t, "modules[] for section "+section.SectionKey,
			canonicalJSON(t, "loadModules", stripQuestions(oldModules)),
			canonicalJSON(t, "loadBulkModules", stripQuestions(bulkSectionModules)))

		oldRouting, err := service.loadRouting(ctx, db, section.ID)
		if err != nil {
			t.Fatalf("loadRouting(%s): %v", section.ID, err)
		}
		var bulkSectionRouting *RoutingPolicy
		for i := range bulkRouting {
			if bulkRouting[i].sectionID == section.ID {
				assembled := assembleShellTree(
					shellIdentity{},
					[]bulkSectionRow{{id: section.ID}},
					nil, bulkRouting[i:i+1], nil, "x").Sections
				bulkSectionRouting = assembled[0].RoutingPolicy
				break
			}
		}
		requireIdentical(t, "routingPolicy for section "+section.SectionKey,
			canonicalJSON(t, "loadRouting", oldRouting),
			canonicalJSON(t, "loadBulkRouting", bulkSectionRouting))

		for _, module := range oldModules {
			oldQuestions, err := service.loadSummaries(ctx, db, module.ID)
			if err != nil {
				t.Fatalf("loadSummaries(%s): %v", module.ID, err)
			}
			bulkModuleQuestions := []QuestionSummary{}
			for _, row := range bulkQuestions {
				if row.moduleID == module.ID {
					bulkModuleQuestions = append(bulkModuleQuestions, row.asValidationRow().summary())
				}
			}
			requireIdentical(t, "questions[] for module "+module.ModuleKey,
				canonicalJSON(t, "loadSummaries", oldQuestions),
				canonicalJSON(t, "loadBulkQuestionRows", bulkModuleQuestions))
		}
	}
}

// comparePreviewPaths runs the nested delivery loader and the bulk delivery
// loader over the same version and asserts identical canonical JSON.
func comparePreviewPaths(t *testing.T, db *sql.DB, runner *tx.Runner, versionID string) {
	t.Helper()
	ctx := context.Background()

	oldSections, err := delivery.NewService(db, runner).LoadSections(ctx, versionID)
	if err != nil {
		t.Fatalf("delivery LoadSections (nested): %v", err)
	}
	newSections, err := delivery.NewService(db, runner).LoadSectionsBulk(ctx, versionID)
	if err != nil {
		t.Fatalf("delivery LoadSectionsBulk: %v", err)
	}
	requireIdentical(t, "delivery tree",
		canonicalJSON(t, "LoadSections", oldSections),
		canonicalJSON(t, "LoadSectionsBulk", newSections))

	// Nil-runner fallback must project the same tree too.
	directSections, err := delivery.NewService(db, nil).LoadSectionsBulk(ctx, versionID)
	if err != nil {
		t.Fatalf("LoadSectionsBulk with a nil runner: %v", err)
	}
	requireIdentical(t, "delivery tree (nil runner fallback)",
		canonicalJSON(t, "LoadSections", oldSections),
		canonicalJSON(t, "LoadSectionsBulk (no snapshot)", directSections))

	// The revision reported by the bulk loader must be the one that describes
	// the tree it returned (VersionCache fails closed on a mismatch).
	_, reportedRevision, err := delivery.NewService(db, runner).LoadSectionsBulkWithRevision(ctx, versionID)
	if err != nil {
		t.Fatalf("LoadSectionsBulkWithRevision: %v", err)
	}
	var storedRevision int64
	if err := db.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ?", versionID).Scan(&storedRevision); err != nil {
		t.Fatalf("probe revision: %v", err)
	}
	if reportedRevision != storedRevision {
		t.Fatalf("bulk loader reported revision %d, exam_versions.revision is %d", reportedRevision, storedRevision)
	}
}

// assertPreviewRedacted proves the bulk delivery loader runs the same
// redaction as the nested one: no key material anywhere in the payload.
func assertPreviewRedacted(t *testing.T, payload string) {
	t.Helper()
	for _, forbidden := range []string{"correctOptionId", "acceptedResponses", "answerDefinition", "isCorrect", "isPretest"} {
		if strings.Contains(payload, forbidden) {
			t.Fatalf("bulk delivery projection leaked %s", forbidden)
		}
	}
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// TestEquivalenceFullSATFixture is the primary Phase-02 proof: the full
// 147-question SAT draft projects byte-identically through the nested loaders
// and the bulk loaders.
func TestEquivalenceFullSATFixture(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	if fixture.QuestionCount != 147 {
		t.Fatalf("fixture question count = %d, want 147", fixture.QuestionCount)
	}
	compareShellPaths(t, fixture.DB, fixture.Runner, fixture.ExamID, fixture.VersionID)
	comparePreviewPaths(t, fixture.DB, fixture.Runner, fixture.VersionID)

	ctx := context.Background()
	oldPreview, err := fixture.Service.Preview(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("Preview: %v", err)
	}
	oldPayload := canonicalJSON(t, "Preview", oldPreview)
	assertPreviewRedacted(t, oldPayload)

	// The bulk delivery loader must produce the same section tree the nested
	// Preview endpoint produced.
	newSections, err := delivery.NewService(fixture.DB, fixture.Runner).LoadSectionsBulk(ctx, fixture.VersionID)
	if err != nil {
		t.Fatalf("LoadSectionsBulk: %v", err)
	}
	requireIdentical(t, "Preview sections vs bulk delivery tree",
		canonicalJSON(t, "Preview.Sections", oldPreview.Sections),
		canonicalJSON(t, "LoadSectionsBulk", newSections))
	assertPreviewRedacted(t, canonicalJSON(t, "LoadSectionsBulk", newSections))

	// The fixture's real answer keys must be present in the authoring shell and
	// absent from the delivery projection — otherwise "redaction passed" would
	// be vacuous.
	shell, err := fixture.Service.Shell(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("Shell: %v", err)
	}
	answerKeySeen := false
	for _, answerKey := range fixture.AnswerByQuestionID {
		if strings.Contains(canonicalJSON(t, "Shell", shell), `"answerKeyPreview":"`+answerKey+`"`) {
			answerKeySeen = true
			break
		}
	}
	if !answerKeySeen {
		t.Fatal("the equivalence fixture must expose at least one answer key in the authoring shell")
	}
}

// TestEquivalenceEmptyVersion pins the documented edge case on real MySQL: a
// draft with no sections projects sections:[] through both paths.
func TestEquivalenceEmptyVersion(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	examID, versionID := seedEquivVersion(t, fixture.DB, fixture.Runner, nil)

	compareShellPaths(t, fixture.DB, fixture.Runner, examID, versionID)
	comparePreviewPaths(t, fixture.DB, fixture.Runner, versionID)

	ctx := context.Background()
	shell, err := NewService(fixture.DB, fixture.Runner).Shell(ctx, examID)
	if err != nil {
		t.Fatalf("Shell on an empty version: %v", err)
	}
	if shell.Sections == nil {
		t.Fatal("empty version must project sections:[] not null")
	}
	payload := canonicalJSON(t, "bulk shell", shell)
	if !strings.Contains(payload, `"sections":[]`) {
		t.Fatalf("empty version payload is not an empty array: %s", payload)
	}
}

// TestEquivalenceSingleSectionModule pins grouping and the two nil-shaped edge
// cases (no routing policy, a module with no questions) on real MySQL.
func TestEquivalenceSingleSectionModule(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	examID, versionID := seedEquivVersion(t, fixture.DB, fixture.Runner, []equivSectionSpec{
		{
			key:   "reading-writing",
			title: "Reading & Writing",
			modules: []equivModuleSpec{
				{key: "rw-m1", title: "Module 1", role: RoleBase, questionCount: 3, richEvery: 2},
				{key: "rw-m2-lower", title: "Module 2 - Lower", role: RoleLowerBranch, questionCount: 0},
			},
			// No routing policy: the projection must be null on both paths.
			withRouting: false,
		},
	})

	compareShellPaths(t, fixture.DB, fixture.Runner, examID, versionID)
	comparePreviewPaths(t, fixture.DB, fixture.Runner, versionID)

	ctx := context.Background()
	shell, err := NewService(fixture.DB, fixture.Runner).Shell(ctx, examID)
	if err != nil {
		t.Fatalf("Shell: %v", err)
	}
	if len(shell.Sections) != 1 {
		t.Fatalf("sections = %d, want 1", len(shell.Sections))
	}
	section := shell.Sections[0]
	if section.RoutingPolicy != nil {
		t.Fatalf("a section without a routing row must project routingPolicy:null, got %+v", section.RoutingPolicy)
	}
	if len(section.Modules) != 2 {
		t.Fatalf("modules = %d, want 2", len(section.Modules))
	}
	if section.Modules[1].Questions == nil {
		t.Fatal("a module with no questions must project questions:[] not null")
	}
	if len(section.Modules[1].Questions) != 0 {
		t.Fatalf("empty module questions = %d, want 0", len(section.Modules[1].Questions))
	}
	// assessment_modules.tool_policy is JSON NOT NULL, so the "{}" default is
	// unreachable from a real row; the seeded value must pass through verbatim
	// instead (the default branch is covered by TestAssembleShellTreeToolPolicyDefault).
	if string(section.Modules[0].ToolPolicy) != "[]" {
		t.Fatalf("tool_policy must pass through verbatim, got %q", string(section.Modules[0].ToolPolicy))
	}
	payload := canonicalJSON(t, "bulk shell", shell)
	if !strings.Contains(payload, `"routingPolicy":null`) {
		t.Fatalf("missing routingPolicy:null in payload: %s", payload)
	}
	if !strings.Contains(payload, `"questions":[]`) {
		t.Fatalf("missing questions:[] in payload: %s", payload)
	}
}

// TestEquivalenceRoutingConfigParsing pins policy_config handling on real
// MySQL, including the absent-keys branch (both numeric fields stay 0).
func TestEquivalenceRoutingConfigParsing(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	examID, versionID := seedEquivVersion(t, fixture.DB, fixture.Runner, []equivSectionSpec{
		{
			key:   "math",
			title: "Math",
			modules: []equivModuleSpec{
				{key: "math-m1", title: "Module 1", role: RoleBase, questionCount: 2, toolsJSON: `["calculator"]`},
			},
			withRouting:   true,
			routingConfig: `{"unrelatedKey":1}`,
		},
	})

	compareShellPaths(t, fixture.DB, fixture.Runner, examID, versionID)

	ctx := context.Background()
	shell, err := NewService(fixture.DB, fixture.Runner).Shell(ctx, examID)
	if err != nil {
		t.Fatalf("Shell: %v", err)
	}
	policy := shell.Sections[0].RoutingPolicy
	if policy == nil {
		t.Fatal("routing policy missing")
	}
	if policy.MinimumCorrectForHigher != 0 || policy.OperationalCount != 0 {
		t.Fatalf("absent policy_config keys must stay 0, got %+v", policy)
	}
	if policy.Revision != 2 {
		t.Fatalf("routing revision = %d, want 2", policy.Revision)
	}
}

// TestEquivalenceNotFoundParity pins the 404 contract on both paths: the
// retired nested composition (legacyNestedShell) and the live bulk Shell().
func TestEquivalenceNotFoundParity(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	ctx := context.Background()
	service := NewService(fixture.DB, fixture.Runner)

	// Unknown exam id -> "Exam not found." on both paths.
	oldErr := func() error {
		_, err := legacyNestedShell(ctx, fixture.DB, service, "00000000-0000-0000-0000-000000000000")
		return err
	}()
	newErr := func() error {
		_, err := service.Shell(ctx, "00000000-0000-0000-0000-000000000000")
		return err
	}()
	if codeOf(oldErr) != apperrors.CodeNotFound || codeOf(newErr) != apperrors.CodeNotFound {
		t.Fatalf("unknown exam must be NOT_FOUND on both paths, got nested=%v bulk=%v", oldErr, newErr)
	}
	if oldErr.Error() != newErr.Error() {
		t.Fatalf("error message drift: nested=%q bulk=%q", oldErr.Error(), newErr.Error())
	}

	// Exam without a draft pointer -> "Draft version not found." on both paths.
	examID, _ := seedEquivVersion(t, fixture.DB, fixture.Runner, nil)
	if _, err := fixture.DB.ExecContext(ctx, "UPDATE exam_entities SET current_draft_version_id = NULL WHERE id = ?", examID); err != nil {
		t.Fatalf("clear draft pointer: %v", err)
	}
	oldErr = func() error { _, err := legacyNestedShell(ctx, fixture.DB, service, examID); return err }()
	newErr = func() error { _, err := service.Shell(ctx, examID); return err }()
	if codeOf(oldErr) != apperrors.CodeNotFound || codeOf(newErr) != apperrors.CodeNotFound {
		t.Fatalf("missing draft pointer must be NOT_FOUND on both paths, got nested=%v bulk=%v", oldErr, newErr)
	}
	if oldErr.Error() != newErr.Error() {
		t.Fatalf("error message drift: nested=%q bulk=%q", oldErr.Error(), newErr.Error())
	}

	// Draft pointer set but the version row is gone -> "Draft version not
	// found." on both paths (the LEFT JOIN must not collapse to Exam-not-found).
	examID2, versionID2 := seedEquivVersion(t, fixture.DB, fixture.Runner, nil)
	if _, err := fixture.DB.ExecContext(ctx, "DELETE FROM exam_versions WHERE id = ?", versionID2); err != nil {
		t.Fatalf("delete draft version: %v", err)
	}
	oldErr = func() error { _, err := legacyNestedShell(ctx, fixture.DB, service, examID2); return err }()
	newErr = func() error { _, err := service.Shell(ctx, examID2); return err }()
	if codeOf(oldErr) != apperrors.CodeNotFound || codeOf(newErr) != apperrors.CodeNotFound {
		t.Fatalf("dangling draft pointer must be NOT_FOUND on both paths, got nested=%v bulk=%v", oldErr, newErr)
	}
}

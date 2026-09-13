package authoring

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// Bulk, version-scoped read path for the authoring shell (Phase 02).
//
// The shell projection is a fixed four-level tree (version -> sections ->
// modules -> questions) plus one routing row per section. Loading it with
// per-section/per-module queries costs 2 identity probes + 1 sections + S
// module probes + S routing probes + M question fanouts = 13 statements for a
// full SAT draft (2 sections / 6 modules), and on MySQL each statement costs
// three protocol round trips (PREPARE/EXECUTE/DEALLOCATE).
//
// This file loads the SAME tree in one identity statement plus four
// version-scoped statements, inside a single read-only REPEATABLE READ
// transaction so every level observes one snapshot revision: a concurrent save
// can never splice a section from revision N onto questions from revision N+1
// (AT-05).
//
// EQUIVALENCE CONTRACT (proved by readperf_equivalence_test.go against real
// MySQL): the assembler below reproduces the nested loaders byte for byte —
// same ordering keys, same empty-array-not-null behavior, same routing nil,
// same tool_policy default, same error codes. Every ORDER BY below is
// deliberately IDENTICAL to the per-entity query it replaces; no new
// tie-breakers are invented, because adding one would both change the
// contract and defeat the (exam_version_id, display_order) index that makes
// the old queries cheap (see baseline-report.md §4).
//
// Nothing here is wired into Shell() yet: Phase 02 is additive. Phase 03
// performs the cutover.

// shellIdentity is the exam/draft header resolved before the tree load.
type shellIdentity struct {
	providerKey string
	versionID   string
	revision    int
}

// queryRowContexter is the narrow read surface shared by *sql.DB, *sql.Tx and
// tx.Tx. Keeping the loaders on this interface lets the equivalence harness
// run them through the pool and through the snapshot transaction unchanged.
type queryRowContexter interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
}

// resolveShellIdentity resolves the provider, current draft version id and
// draft revision in ONE statement, replacing Shell()'s two sequential probes.
//
// Error parity with the two-probe original is exact:
//   - exam row absent                      -> "Exam not found."            (404)
//   - draft pointer NULL/empty             -> "Draft version not found."   (404)
//   - pointer set but version row absent,
//     owned by another exam, or not draft  -> "Draft version not found."   (404)
//
// The draft predicate lives in the JOIN's ON clause (not WHERE) so a missing
// or non-draft version keeps the exam row and yields a NULL revision instead
// of collapsing into ErrNoRows — which would have reported "Exam not found."
// for an exam that exists.
func resolveShellIdentity(ctx context.Context, q queryRowContexter, examID string) (shellIdentity, error) {
	var providerKey string
	var draftID sql.NullString
	var revision sql.NullInt64
	err := q.QueryRowContext(ctx, `
		SELECT e.provider_key, e.current_draft_version_id, v.revision
		FROM exam_entities e
		LEFT JOIN exam_versions v ON v.id = e.current_draft_version_id
			AND v.exam_id = e.id AND v.is_draft = TRUE
		WHERE e.id = ?`, examID).Scan(&providerKey, &draftID, &revision)
	if err == sql.ErrNoRows {
		return shellIdentity{}, notFoundError("Exam not found.")
	}
	if err != nil {
		return shellIdentity{}, err
	}
	if !draftID.Valid || strings.TrimSpace(draftID.String) == "" {
		return shellIdentity{}, notFoundError("Draft version not found.")
	}
	if !revision.Valid {
		return shellIdentity{}, notFoundError("Draft version not found.")
	}
	return shellIdentity{
		providerKey: providerKey,
		versionID:   strings.TrimSpace(draftID.String),
		revision:    int(revision.Int64),
	}, nil
}

// bulkSectionRow is one assessment_sections row (authoring projection).
type bulkSectionRow struct {
	id, sectionKey, title       string
	displayOrder, duration, brk int
	revision                    int
}

// bulkModuleRow is one assessment_modules row plus its owning section.
type bulkModuleRow struct {
	id, sectionID, moduleKey, title, adaptiveRole string
	displayOrder, duration, targetCount           int
	toolPolicy                                    sql.NullString
	revision                                      int
}

// bulkRoutingRow is one assessment_routing_policies row plus its section.
type bulkRoutingRow struct {
	sectionID, id, baseModuleID, lowerModuleID, higherModuleID, policyKey string
	policyConfig                                                          sql.NullString
	revision                                                              int
}

// bulkQuestionRow carries exactly the columns loadQuestionValidationRows
// selected, plus module_id so questions can be grouped without a per-module
// round trip. It narrows to questionValidationRow so readiness/preview
// projection (row.summary()) stays in exactly one place.
type bulkQuestionRow struct {
	moduleID       string
	examQuestionID string
	questionID     string
	revisionID     string
	sectionKey     string
	displayOrder   int
	isPretest      bool
	questionType   string
	semanticRev    int
	revision       int
	stimulus       string
	prompt         string
	answer         string
	rationale      string
	metadata       string
}

// asValidationRow narrows a bulk row to the readiness projection input. Field
// order mirrors loadQuestionValidationRows' scan so the two are trivially
// diffable.
func (r bulkQuestionRow) asValidationRow() questionValidationRow {
	return questionValidationRow{
		examQuestionID:   r.examQuestionID,
		questionID:       r.questionID,
		revisionID:       r.revisionID,
		sectionKey:       r.sectionKey,
		displayOrder:     r.displayOrder,
		semanticRevision: r.semanticRev,
		revision:         r.revision,
		isPretest:        r.isPretest,
		questionType:     r.questionType,
		stimulus:         r.stimulus,
		prompt:           r.prompt,
		answer:           r.answer,
		rationale:        r.rationale,
		metadata:         r.metadata,
	}
}

// loadBulkSections reads every section of one version.
//
// ORDER BY display_order ASC is byte-identical to loadSections. missingTable
// reports the same isMissingTable tolerance the nested loader has: a
// deployment without the assessment tables projects an empty shell rather than
// a 500, so the bulk path must short-circuit instead of failing on the next
// query.
func loadBulkSections(ctx context.Context, q queryRowContexter, versionID string) (out []bulkSectionRow, missingTable bool, err error) {
	rows, err := q.QueryContext(ctx, "SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, revision FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order ASC", versionID)
	if err != nil {
		if isMissingTable(err) {
			return []bulkSectionRow{}, true, nil
		}
		return nil, false, err
	}
	defer rows.Close()
	out = []bulkSectionRow{}
	for rows.Next() {
		var r bulkSectionRow
		if err := rows.Scan(&r.id, &r.sectionKey, &r.title, &r.displayOrder, &r.duration, &r.brk, &r.revision); err != nil {
			return nil, false, err
		}
		out = append(out, r)
	}
	return out, false, rows.Err()
}

// loadBulkModules reads every module of one version in
// (section display_order, module display_order) order. Within a section this
// is exactly loadModules' "ORDER BY display_order ASC", so grouping by
// section_id preserves the nested loader's per-section module order.
//
// loadModules has no isMissingTable tolerance, so neither does this: the error
// propagates unchanged.
func loadBulkModules(ctx context.Context, q queryRowContexter, versionID string) ([]bulkModuleRow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT m.id, m.section_id, m.module_key, m.title, m.display_order,
		       m.duration_seconds, m.target_question_count, m.adaptive_role,
		       m.tool_policy, m.revision
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order ASC, m.display_order ASC`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []bulkModuleRow{}
	for rows.Next() {
		var r bulkModuleRow
		if err := rows.Scan(&r.id, &r.sectionID, &r.moduleKey, &r.title, &r.displayOrder, &r.duration, &r.targetCount, &r.adaptiveRole, &r.toolPolicy, &r.revision); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// loadBulkRouting reads every routing policy of one version.
//
// loadRouting tolerates both sql.ErrNoRows (section has no policy) and
// isMissingTable (assessment tables absent); the bulk reader collapses both
// into "no rows for this section", which the assembler projects as a nil
// *RoutingPolicy — the same value the nested loader returned.
func loadBulkRouting(ctx context.Context, q queryRowContexter, versionID string) ([]bulkRoutingRow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT rp.section_id, rp.id, rp.base_module_id, rp.lower_module_id, rp.higher_module_id,
		       rp.policy_key, rp.policy_config, rp.revision
		FROM assessment_routing_policies rp
		JOIN assessment_sections s ON s.id = rp.section_id
		WHERE s.exam_version_id = ?`, versionID)
	if err != nil {
		if isMissingTable(err) {
			return []bulkRoutingRow{}, nil
		}
		return nil, err
	}
	defer rows.Close()
	out := []bulkRoutingRow{}
	for rows.Next() {
		var r bulkRoutingRow
		if err := rows.Scan(&r.sectionID, &r.id, &r.baseModuleID, &r.lowerModuleID, &r.higherModuleID, &r.policyKey, &r.policyConfig, &r.revision); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// loadBulkQuestionRows reads every question of one version in
// (section order, module order, question order) order.
//
// Within one module the rows are ordered by eq.display_order ASC — exactly
// loadQuestionValidationRows' ordering — because a module belongs to exactly
// one section, so the leading section/module keys are constant per group.
// The CAST(... AS CHAR) JSON handling is preserved verbatim so the strings
// handed to row.summary() are identical to the nested path's.
func loadBulkQuestionRows(ctx context.Context, q queryRowContexter, versionID string) ([]bulkQuestionRow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT eq.module_id, eq.id, eq.question_id, eq.question_revision_id, s.section_key,
		       eq.display_order, eq.is_pretest, r.question_type,
		       r.semantic_revision, r.revision,
		       CAST(r.stimulus AS CHAR), CAST(r.prompt AS CHAR),
		       CAST(r.answer_definition AS CHAR), CAST(r.rationale AS CHAR),
		       CAST(r.metadata AS CHAR)
		FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_question_revisions r ON r.id = eq.question_revision_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order ASC, m.display_order ASC, eq.display_order ASC`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []bulkQuestionRow{}
	for rows.Next() {
		var r bulkQuestionRow
		if err := rows.Scan(&r.moduleID, &r.examQuestionID, &r.questionID, &r.revisionID, &r.sectionKey,
			&r.displayOrder, &r.isPretest, &r.questionType, &r.semanticRev, &r.revision,
			&r.stimulus, &r.prompt, &r.answer, &r.rationale, &r.metadata); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// moduleToolPolicy applies loadModules' tool_policy projection rule: a
// NULL/blank column becomes the empty JSON object, otherwise the raw column
// text is passed through verbatim. It is shared by the assembler and the
// equivalence harness so the modules level is compared through the same code
// Phase 03 will run.
func moduleToolPolicy(m bulkModuleRow) json.RawMessage {
	if m.toolPolicy.Valid && strings.TrimSpace(m.toolPolicy.String) != "" {
		return json.RawMessage(m.toolPolicy.String)
	}
	return json.RawMessage("{}")
}

// assembleShellTree rebuilds the nested Shell projection from the four flat
// result sets. It is pure — no database, no clock, no globals — so it is
// table-tested directly (bulk_read_test.go) and reused by the equivalence
// harness.
//
// Equivalence rules, each mirroring the nested loader it replaces:
//   - sections: iteration order of the input (already display_order ASC),
//     always a non-nil slice (empty version -> [] not null).
//   - modules: grouped by section_id preserving input order; a section with no
//     modules -> [] not null.
//   - questions: grouped by module_id preserving input order, projected with
//     the shared row.summary(); a module with no questions -> [] not null.
//   - routing: at most one policy per section (uq_assessment_routing_section).
//     The FIRST row wins, mirroring QueryRowContext's first-row semantics in
//     loadRouting; a section with no row -> nil (serialized as null).
//   - tool_policy: NULL/blank -> {} (loadModules' default), else the raw column
//     text verbatim.
//   - policy_config: minimumCorrectForHigher read as float64 and truncated
//     to int, exactly as loadRouting does; an unparseable config leaves it
//     at its zero value.
//   - operationalQuestionCount is DERIVED, never read from policy_config:
//     writers persist threshold-only JSON (sat_initialization.go,
//     UpdateDeliverySettings) and the key is absent on every real row, so
//     reading it projected 0 and the release page clamped to 1 (stuck-at-1).
//     operational = base module target_question_count - authored pretest
//     placements in the base module, floored at 1 — the same derivation the
//     UpdateDeliverySettings upper-bound check and readiness gate use.
//
// derivedOperationalCount is the candidate-facing operational question count
// for one section: base module target minus pretest, floored at 1. The SAT
// blueprint (questionCount - pretestCount) wins when the base module is a
// known blueprint module, so a partially-authored draft still projects the
// stable provider contract (RW 25, Math 20) — exactly the bound the
// UpdateDeliverySettings upper-bound check and the readiness gate enforce.
// Otherwise it falls back to target minus authored pretest placements.
// authoredPretest is the live pretest placement count in the base module.
func derivedOperationalCount(sectionKey, baseModuleKey string, targetCount, authoredPretest int) int {
	if spec, ok := satBlueprintModule(sectionKey, baseModuleKey); ok {
		if operational := spec.questionCount - spec.pretestCount; operational >= 1 {
			return operational
		}
		return 1
	}
	if operational := targetCount - authoredPretest; operational >= 1 {
		return operational
	}
	return 1
}

func assembleShellTree(identity shellIdentity, sections []bulkSectionRow, modules []bulkModuleRow, routing []bulkRoutingRow, questions []bulkQuestionRow, examID string) Shell {
	questionsByModule := make(map[string][]QuestionSummary, len(modules))
	for _, row := range questions {
		questionsByModule[row.moduleID] = append(questionsByModule[row.moduleID], row.asValidationRow().summary())
	}

	modulesBySection := make(map[string][]Module, len(sections))
	for _, m := range modules {
		tool := moduleToolPolicy(m)
		qs := questionsByModule[m.id]
		if qs == nil {
			qs = []QuestionSummary{}
		}
		modulesBySection[m.sectionID] = append(modulesBySection[m.sectionID], Module{
			ID:                  m.id,
			ModuleKey:           m.moduleKey,
			Title:               m.title,
			DisplayOrder:        m.displayOrder,
			DurationSeconds:     m.duration,
			TargetQuestionCount: m.targetCount,
			AdaptiveRole:        m.adaptiveRole,
			ToolPolicy:          tool,
			Revision:            m.revision,
			Questions:           qs,
		})
	}

	// Routing needs the grouped modules + questions (modulesBySection and
	// questionsByModule are built first) because OperationalCount is derived
	// from the base module, not parsed from policy_config.
	type routingSeed struct {
		rp        *RoutingPolicy
		sectionID string
	}
	seeds := make([]routingSeed, 0, len(routing))
	seenRouting := make(map[string]bool, len(routing))
	for _, r := range routing {
		if seenRouting[r.sectionID] {
			continue // first row wins (see doc comment)
		}
		seenRouting[r.sectionID] = true
		rp := &RoutingPolicy{
			ID:             r.id,
			BaseModuleID:   r.baseModuleID,
			LowerModuleID:  r.lowerModuleID,
			HigherModuleID: r.higherModuleID,
			PolicyKey:      r.policyKey,
			Revision:       r.revision,
		}
		if r.policyConfig.Valid {
			var parsed map[string]any
			if json.Unmarshal([]byte(r.policyConfig.String), &parsed) == nil {
				if v, ok := parsed["minimumCorrectForHigher"].(float64); ok {
					rp.MinimumCorrectForHigher = int(v)
				}
				// NOTE: operationalQuestionCount is intentionally NOT parsed:
				// real rows never carry the key, and a stale stored value
				// would disagree with the live module/question shape. It is
				// derived below from the base module.
			}
		}
		seeds = append(seeds, routingSeed{rp: rp, sectionID: r.sectionID})
	}

	routingBySection := make(map[string]*RoutingPolicy, len(seeds))
	for _, s := range seeds {
		mods := modulesBySection[s.sectionID]
		var sectionKey, baseKey string
		target, pretest := 0, 0
		for _, section := range sections {
			if section.id == s.sectionID {
				sectionKey = section.sectionKey
				break
			}
		}
		for _, m := range mods {
			if m.ID == s.rp.BaseModuleID {
				baseKey, target = m.ModuleKey, m.TargetQuestionCount
				for _, q := range questionsByModule[m.ID] {
					if q.IsPretest {
						pretest++
					}
				}
				break
			}
		}
		s.rp.OperationalCount = derivedOperationalCount(sectionKey, baseKey, target, pretest)
		routingBySection[s.sectionID] = s.rp
	}

	out := make([]Section, 0, len(sections))
	for _, sr := range sections {
		mods := modulesBySection[sr.id]
		if mods == nil {
			mods = []Module{}
		}
		out = append(out, Section{
			ID:              sr.id,
			SectionKey:      sr.sectionKey,
			Title:           sr.title,
			DisplayOrder:    sr.displayOrder,
			DurationSeconds: sr.duration,
			BreakAfterSecs:  sr.brk,
			Revision:        sr.revision,
			RoutingPolicy:   routingBySection[sr.id],
			Modules:         mods,
		})
	}
	return Shell{
		ExamID:          examID,
		ProviderKey:     identity.providerKey,
		VersionID:       identity.versionID,
		VersionRevision: identity.revision,
		Sections:        out,
	}
}

// loadShellTree runs the four version-scoped reads and assembles the tree.
// Four statements, no more — asserted by
// TestGoldenShellBulkStatementBudget and TestReadPerfStatementBudget.
func loadShellTree(ctx context.Context, q queryRowContexter, identity shellIdentity, examID string) (Shell, error) {
	sections, missingTable, err := loadBulkSections(ctx, q, identity.versionID)
	if err != nil {
		return Shell{}, err
	}
	// Short-circuit on an empty (or absent) sections result. This is not just
	// an optimization: loadSections iterates its section rows, so a version with
	// no sections issues ZERO module/routing/question probes. Stopping here
	// keeps the bulk path's statement count identical to the nested path's for
	// this shape (2 statements: identity + sections) instead of issuing three
	// queries whose results the assembler would discard. It also covers the
	// missingTable case, where the follow-up reads would fail on the same
	// absent schema.
	if missingTable || len(sections) == 0 {
		return assembleShellTree(identity, sections, nil, nil, nil, examID), nil
	}
	modules, err := loadBulkModules(ctx, q, identity.versionID)
	if err != nil {
		return Shell{}, err
	}
	routing, err := loadBulkRouting(ctx, q, identity.versionID)
	if err != nil {
		return Shell{}, err
	}
	questions, err := loadBulkQuestionRows(ctx, q, identity.versionID)
	if err != nil {
		return Shell{}, err
	}
	return assembleShellTree(identity, sections, modules, routing, questions, examID), nil
}

// withReadSnapshot runs fn inside a read-only REPEATABLE READ transaction so
// every bulk read observes one snapshot revision (AT-05). It never takes row
// locks, never writes, and always rolls back.
//
// Nil-runner safety: a Service constructed without a runner (test
// constructions) degrades to direct reads through the pool, which is correct
// but not snapshot-isolated — the equivalence harness covers both. A Service
// with neither runner nor pool reports an error instead of panicking, because
// this is reachable from a handler.
func (s *Service) withReadSnapshot(ctx context.Context, fn func(ctx context.Context, q queryRowContexter) error) error {
	if s == nil {
		return errNoDatabase
	}
	// A runner carries its own pool (tx.NewRunner(db)), so a Service built as
	// NewService(nil, runner) is fully functional; only the runner-less
	// construction needs s.db.
	if s.runner != nil {
		return s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
			return fn(ctx, q)
		})
	}
	if s.db == nil {
		return errNoDatabase
	}
	return fn(ctx, s.db)
}

// errNoDatabase guards the nil/nil test construction (NewService(nil, nil))
// so a mis-wired service fails closed with an error instead of a nil-pointer
// panic inside a request.
var errNoDatabase = sql.ErrConnDone

// bulkShell loads the current draft shell through the bulk path: one identity
// statement plus four tree statements, all inside ONE read-only snapshot.
//
// Resolving the identity INSIDE the snapshot matters: probing the draft
// revision outside the transaction and the tree inside it could report a
// revision that does not describe the tree that was returned.
//
// NOT wired into Shell() (Phase 03 owns the cutover). Note there is
// deliberately NO provider gate here: Shell() has none, and adding one would
// change the contract for non-SAT drafts. OpenShell/Preview keep their gates.
func (s *Service) bulkShell(ctx context.Context, examID string) (Shell, error) {
	if s == nil {
		return Shell{}, errNoDatabase
	}
	var shell Shell
	if err := s.withReadSnapshot(ctx, func(ctx context.Context, q queryRowContexter) error {
		identity, err := resolveShellIdentity(ctx, q, examID)
		if err != nil {
			return err
		}
		loaded, err := loadShellTree(ctx, q, identity, examID)
		if err != nil {
			return err
		}
		shell = loaded
		return nil
	}); err != nil {
		return Shell{}, err
	}
	return shell, nil
}

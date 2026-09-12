package delivery

// Phase 02: version-scoped bulk delivery loader.
//
// LoadSections (service.go) walks the delivery tree with one statement per
// section plus one per module: 1 + S + M statements (9 for a full SAT draft:
// 1 sections + 2 module probes + 6 question probes). On MySQL each statement
// costs three protocol round trips, so the authoring Preview endpoint — which
// runs LoadSections over the SAME version it already walked for Shell() — pays
// 27 extra round trips for content it already had.
//
// LoadSectionsBulk reads the identical projection in THREE version-scoped
// statements (sections, modules, questions) inside one read-only REPEATABLE
// READ snapshot, then assembles the tree in memory.
//
// REDACTION IS NOT FORKED. The question projection calls the same rawJSON +
// deliveredAnswer helpers loadQuestions uses, so the answer-key allowlist has
// exactly one implementation. TestDeliveryBulkEquivalence and the authoring
// equivalence harness both assert the bulk tree is byte-identical to
// LoadSections and carries no key material.
//
// ORDERING is byte-identical to LoadSections: sections by display_order,
// modules by display_order within a section, questions by display_order
// within a module. The nested loader used a single leading key per statement
// because it filtered to one parent; the bulk statements prepend the parent
// keys, which are constant per group, so per-group order is unchanged. No id
// tie-break is added: the nested loader had none, and adding one would both
// change the contract and defeat the (parent_id, display_order) indexes the
// baseline report confirms are already optimal.
//
// Nothing calls LoadSectionsBulk yet — Phase 03 wires it into Preview.

import (
	"context"
	"database/sql"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// deliveryQuerier is the narrow read surface shared by *sql.DB, *sql.Tx and
// tx.Tx. QueryRowContext is needed by the cache-compatibility variant, which
// probes exam_versions.revision inside the same snapshot.
type deliveryQuerier interface {
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// bulkDeliverySectionRow is one assessment_sections row (delivery projection).
type bulkDeliverySectionRow struct {
	sec          DeliverySection
	instructions sql.NullString
}

// bulkDeliveryModuleRow is one assessment_modules row plus its owning section.
type bulkDeliveryModuleRow struct {
	mod          DeliveryModule
	sectionID    string
	instructions sql.NullString
	toolPolicy   sql.NullString
}

// bulkDeliveryQuestionRow is one delivered question plus its owning module.
type bulkDeliveryQuestionRow struct {
	moduleID string
	q        DeliveredQuestion
}

// loadBulkDeliverySections reads every section of one version.
func loadBulkDeliverySections(ctx context.Context, q deliveryQuerier, versionID string) ([]bulkDeliverySectionRow, error) {
	rows, err := q.QueryContext(ctx,
		"SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order",
		versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []bulkDeliverySectionRow{}
	for rows.Next() {
		var r bulkDeliverySectionRow
		if err := rows.Scan(&r.sec.ID, &r.sec.SectionKey, &r.sec.Title, &r.sec.DisplayOrder,
			&r.sec.DurationSeconds, &r.sec.BreakAfterSeconds, &r.instructions); err != nil {
			return nil, err
		}
		r.sec.Instructions = rawJSON(r.instructions)
		r.sec.Modules = []DeliveryModule{}
		out = append(out, r)
	}
	return out, rows.Err()
}

// loadBulkDeliveryModules reads every module of one version in
// (section display_order, module display_order) order.
func loadBulkDeliveryModules(ctx context.Context, q deliveryQuerier, versionID string) ([]bulkDeliveryModuleRow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT m.id, m.section_id, m.module_key, m.title, m.display_order,
		       m.duration_seconds, m.target_question_count, m.adaptive_role,
		       m.instructions, m.tool_policy
		FROM assessment_modules m
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order, m.display_order`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []bulkDeliveryModuleRow{}
	for rows.Next() {
		var r bulkDeliveryModuleRow
		// Scan order MUST follow the SELECT list: id, section_id, module_key, ...
		if err := rows.Scan(&r.mod.ID, &r.sectionID, &r.mod.ModuleKey, &r.mod.Title, &r.mod.DisplayOrder,
			&r.mod.DurationSeconds, &r.mod.TargetQuestionCount, &r.mod.AdaptiveRole,
			&r.instructions, &r.toolPolicy); err != nil {
			return nil, err
		}
		r.mod.Instructions = rawJSON(r.instructions)
		r.mod.ToolPolicy = rawJSON(r.toolPolicy)
		r.mod.Questions = []DeliveredQuestion{}
		out = append(out, r)
	}
	return out, rows.Err()
}

// loadBulkDeliveryQuestions reads every delivered question of one version in
// (section order, module order, question order) order, running the SAME
// deliveredAnswer redaction loadQuestions runs.
func loadBulkDeliveryQuestions(ctx context.Context, q deliveryQuerier, versionID string) ([]bulkDeliveryQuestionRow, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT eq.module_id, eq.id AS exam_question_id, eq.question_id, eq.display_order,
		       eq.is_pretest, qr.question_type, qr.stimulus, qr.prompt,
		       qr.answer_definition, qr.metadata, qr.accessibility
		FROM assessment_exam_questions eq
		JOIN assessment_modules m ON m.id = eq.module_id
		JOIN assessment_sections s ON s.id = m.section_id
		JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
		WHERE s.exam_version_id = ?
		ORDER BY s.display_order, m.display_order, eq.display_order`, versionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []bulkDeliveryQuestionRow{}
	for rows.Next() {
		var r bulkDeliveryQuestionRow
		var isPretest bool
		var stimulus, prompt, answer, metadata, accessibility sql.NullString
		if err := rows.Scan(&r.moduleID, &r.q.ExamQuestionID, &r.q.QuestionID, &r.q.DisplayOrder, &isPretest,
			&r.q.QuestionType, &stimulus, &prompt, &answer, &metadata, &accessibility); err != nil {
			return nil, err
		}
		_ = isPretest // server-side only; never serialized to candidates
		r.q.Stimulus = rawJSON(stimulus)
		r.q.Prompt = rawJSON(prompt)
		// Reuse the single redaction implementation; do not fork the allowlist.
		redacted, err := deliveredAnswer(rawJSON(answer))
		if err != nil {
			return nil, err
		}
		r.q.Answer = redacted
		r.q.Metadata = rawJSON(metadata)
		r.q.Accessibility = rawJSON(accessibility)
		out = append(out, r)
	}
	return out, rows.Err()
}

// assembleDeliveryTree rebuilds the nested delivery projection from the three
// flat result sets. Pure: table-tested directly and shared with the
// equivalence harness.
//
// Grouping rules mirror LoadSections exactly: iteration order of each input is
// preserved, and every empty collection is a non-nil empty slice so it
// serializes as [] rather than null.
func assembleDeliveryTree(sections []bulkDeliverySectionRow, modules []bulkDeliveryModuleRow, questions []bulkDeliveryQuestionRow) []DeliverySection {
	questionsByModule := make(map[string][]DeliveredQuestion, len(modules))
	for _, row := range questions {
		questionsByModule[row.moduleID] = append(questionsByModule[row.moduleID], row.q)
	}
	modulesBySection := make(map[string][]DeliveryModule, len(sections))
	for _, m := range modules {
		qs := questionsByModule[m.mod.ID]
		if qs == nil {
			qs = []DeliveredQuestion{}
		}
		m.mod.Questions = qs
		modulesBySection[m.sectionID] = append(modulesBySection[m.sectionID], m.mod)
	}
	out := make([]DeliverySection, 0, len(sections))
	for _, sr := range sections {
		mods := modulesBySection[sr.sec.ID]
		if mods == nil {
			mods = []DeliveryModule{}
		}
		sr.sec.Modules = mods
		out = append(out, sr.sec)
	}
	return out
}

// LoadSectionsBulk is LoadSections with O(1) round trips: three version-scoped
// statements inside one read-only snapshot instead of 1 + S + M statements.
// Output is byte-identical (asserted by TestDeliveryBulkEquivalence and the
// authoring equivalence harness).
func (s *Service) LoadSectionsBulk(ctx context.Context, versionID string) ([]DeliverySection, error) {
	var sections []DeliverySection
	if err := s.withDeliverySnapshot(ctx, func(ctx context.Context, q deliveryQuerier) error {
		loaded, err := loadDeliveryTree(ctx, q, versionID)
		if err != nil {
			return err
		}
		sections = loaded
		return nil
	}); err != nil {
		return nil, err
	}
	return sections, nil
}

// LoadSectionsBulkWithRevision is LoadSectionsBulk plus the
// exam_versions.revision observed INSIDE the same snapshot, so a caller can
// store a revision that actually describes the content it cached (the
// VersionCache fails closed on a revision mismatch). Four statements: the
// three tree reads plus one revision probe.
//
// The revision probe deliberately shares the snapshot with the tree reads.
// Probing outside could observe a revision that does not describe the tree
// that was returned — the exact inconsistency the snapshot exists to prevent.
func (s *Service) LoadSectionsBulkWithRevision(ctx context.Context, versionID string) ([]DeliverySection, int64, error) {
	var sections []DeliverySection
	var revision int64
	if err := s.withDeliverySnapshot(ctx, func(ctx context.Context, q deliveryQuerier) error {
		loaded, err := loadDeliveryTree(ctx, q, versionID)
		if err != nil {
			return err
		}
		sections = loaded
		return q.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ?", versionID).Scan(&revision)
	}); err != nil {
		return nil, 0, err
	}
	return sections, revision, nil
}

// BulkSectionsLoader adapts LoadSectionsBulkWithRevision to the
// VersionCache.VersionLoader shape (versioncache.go) so Phase 03 can hand it
// to VersionCache.GetChecked without changing cache semantics: the loader
// returns the tree plus the revision observed by the same snapshot, and
// GetChecked still decides hit/miss on the caller's cheap probe.
func (s *Service) BulkSectionsLoader(ctx context.Context, versionID string) VersionLoader {
	return func() ([]DeliverySection, int64, error) {
		return s.LoadSectionsBulkWithRevision(ctx, versionID)
	}
}

// loadDeliveryTree runs the three version-scoped reads and assembles the tree.
func loadDeliveryTree(ctx context.Context, q deliveryQuerier, versionID string) ([]DeliverySection, error) {
	secs, err := loadBulkDeliverySections(ctx, q, versionID)
	if err != nil {
		return nil, err
	}
	if len(secs) == 0 {
		// Short-circuit: LoadSections iterates its section rows, so a version
		// with no sections issues ZERO module/question probes. Stopping here
		// keeps the statement count identical for this shape (1 statement).
		return []DeliverySection{}, nil
	}
	mods, err := loadBulkDeliveryModules(ctx, q, versionID)
	if err != nil {
		return nil, err
	}
	qs, err := loadBulkDeliveryQuestions(ctx, q, versionID)
	if err != nil {
		return nil, err
	}
	return assembleDeliveryTree(secs, mods, qs), nil
}

// withDeliverySnapshot runs fn inside one read-only REPEATABLE READ snapshot,
// falling back to direct reads when no runner is wired (test constructions,
// mirroring the authoring bulk path's nil-runner behavior).
func (s *Service) withDeliverySnapshot(ctx context.Context, fn func(ctx context.Context, q deliveryQuerier) error) error {
	if s == nil {
		return sql.ErrConnDone
	}
	if s.runner != nil {
		return s.runner.WithTxReadOnly(ctx, func(ctx context.Context, q tx.Tx) error {
			return fn(ctx, q)
		})
	}
	if s.db == nil {
		return sql.ErrConnDone
	}
	return fn(ctx, s.db)
}

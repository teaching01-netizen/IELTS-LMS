package authoring

// Clone INTEGRITY, separated from clone CONCURRENCY.
//
// openshell_concurrency_test.go proves the topology of the published → no-draft
// open: exactly one opener wins and one draft exists. It does not prove what is
// INSIDE the winning draft, and that is the half a "the editor came up empty"
// report is about. This file proves the content contract on its own:
//
//   published → draft
//     ids remapped  (version, section, module, placement, revision)
//     identity kept (the stable question id)
//     semantics advanced (semantic_revision = source max + 1, revision 0, draft)
//     every content field byte-identical (stimulus, prompt, answer, rationale,
//     metadata, accessibility, display order, is_pretest)
//     the published source left exactly as it was
//
// Gated on TEST_MYSQL_DSN like the other MySQL contract tests; skips otherwise.
// It reuses the read-perf fixture (a complete SAT tree) and publishes it with
// two UPDATEs, the same shape the concurrency proof uses.

import (
	"context"
	"database/sql"
	"fmt"
	"reflect"
	"testing"

	"github.com/google/uuid"
)

// cloneQuestionRow is one question placement of a version, with its revision's
// content. JSON columns are read as text so the comparison is about the stored
// value, not about driver decoding.
type cloneQuestionRow struct {
	PlacementID   string
	ModuleKey     string
	QuestionID    string
	RevisionID    string
	Semantic      int64
	Revision      int64
	State         string
	QuestionType  string
	Stimulus      string
	Prompt        string
	Answer        string
	Rationale     string
	Metadata      string
	Accessibility string
	DisplayOrder  int
	IsPretest     bool
}

// readVersionQuestions reads every placement of one version in the SAME order
// the clone copies them, so the two slices line up position by position.
func readVersionQuestions(t *testing.T, ctx context.Context, db *sql.DB, versionID string) []cloneQuestionRow {
	t.Helper()
	rows, err := db.QueryContext(ctx, `SELECT eq.id, m.module_key, eq.question_id, qr.id, qr.semantic_revision, qr.revision, qr.state, qr.question_type,
       CAST(qr.stimulus AS CHAR), CAST(qr.prompt AS CHAR), CAST(qr.answer_definition AS CHAR), CAST(qr.rationale AS CHAR),
       CAST(qr.metadata AS CHAR), CAST(qr.accessibility AS CHAR), eq.display_order, eq.is_pretest
FROM assessment_exam_questions eq
JOIN assessment_modules m ON m.id = eq.module_id
JOIN assessment_sections s ON s.id = m.section_id
JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id
WHERE s.exam_version_id = ?
ORDER BY s.display_order, m.display_order, eq.display_order, eq.id`, versionID)
	if err != nil {
		t.Fatalf("read version questions: %v", err)
	}
	defer rows.Close()
	result := []cloneQuestionRow{}
	for rows.Next() {
		var q cloneQuestionRow
		if err := rows.Scan(&q.PlacementID, &q.ModuleKey, &q.QuestionID, &q.RevisionID, &q.Semantic, &q.Revision, &q.State, &q.QuestionType,
			&q.Stimulus, &q.Prompt, &q.Answer, &q.Rationale, &q.Metadata, &q.Accessibility, &q.DisplayOrder, &q.IsPretest); err != nil {
			t.Fatalf("scan version question: %v", err)
		}
		result = append(result, q)
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate version questions: %v", err)
	}
	return result
}

// maxSemanticByQuestion reads the highest semantic revision each question has
// ever had. The clone must mint source-max + 1 so a cloned draft can never be
// confused with an already-published semantic revision of the same question.
func maxSemanticByQuestion(t *testing.T, ctx context.Context, db *sql.DB, versionID string) map[string]int64 {
	t.Helper()
	rows, err := db.QueryContext(ctx, `SELECT DISTINCT eq.question_id, (SELECT MAX(r2.semantic_revision) FROM assessment_question_revisions r2 WHERE r2.question_id = eq.question_id)
FROM assessment_exam_questions eq
JOIN assessment_modules m ON m.id = eq.module_id
JOIN assessment_sections s ON s.id = m.section_id
WHERE s.exam_version_id = ?`, versionID)
	if err != nil {
		t.Fatalf("read max semantic revisions: %v", err)
	}
	defer rows.Close()
	result := map[string]int64{}
	for rows.Next() {
		var questionID string
		var semantic sql.NullInt64
		if err := rows.Scan(&questionID, &semantic); err != nil {
			t.Fatalf("scan max semantic revision: %v", err)
		}
		result[questionID] = semantic.Int64
	}
	if err := rows.Err(); err != nil {
		t.Fatalf("iterate max semantic revisions: %v", err)
	}
	return result
}

// publishReadPerfFixture points the fixture's exam at its seeded version as
// PUBLISHED with no draft, i.e. the shape "Open draft" continues from.
func publishReadPerfFixture(t *testing.T, ctx context.Context, fixture *readPerfFixture) {
	t.Helper()
	if _, err := fixture.DB.ExecContext(ctx, "UPDATE exam_versions SET is_draft = FALSE, is_published = TRUE, revision = revision + 1 WHERE id = ?", fixture.VersionID); err != nil {
		t.Fatalf("publish seeded version: %v", err)
	}
	if _, err := fixture.DB.ExecContext(ctx, "UPDATE exam_entities SET current_published_version_id = ?, current_draft_version_id = NULL WHERE id = ?", fixture.VersionID, fixture.ExamID); err != nil {
		t.Fatalf("point exam at the published version: %v", err)
	}
}

// TestOpenShellClonePreservesPublishedQuestionContent is the content contract
// of "Open draft" after a publish: cloning a published SAT version must carry
// every question's content into the new draft, under new placement and revision
// ids, without touching the published source.
func TestOpenShellClonePreservesPublishedQuestionContent(t *testing.T) {
	fixture := seedReadPerfFixture(t)
	ctx := context.Background()
	actor := "openshell-clone-content-" + uuid.NewString()
	authors := NewService(fixture.DB, fixture.Runner)

	publishReadPerfFixture(t, ctx, fixture)

	publishedBefore := readVersionQuestions(t, ctx, fixture.DB, fixture.VersionID)
	if len(publishedBefore) == 0 {
		t.Fatal("the fixture's published version has no questions to clone")
	}
	maxSemantic := maxSemanticByQuestion(t, ctx, fixture.DB, fixture.VersionID)
	var publishedRevision int
	if err := fixture.DB.QueryRowContext(ctx, "SELECT revision FROM exam_versions WHERE id = ?", fixture.VersionID).Scan(&publishedRevision); err != nil {
		t.Fatalf("read published version revision: %v", err)
	}

	shell, err := authors.OpenShell(ctx, fixture.ExamID, actor)
	if err != nil {
		t.Fatalf("OpenShell on published+no-draft: %v", err)
	}
	if shell.VersionID == fixture.VersionID {
		t.Fatal("OpenShell returned the PUBLISHED version instead of a cloned draft")
	}
	if shell.ExamID != fixture.ExamID || shell.ProviderKey != "sat" {
		t.Fatalf("unexpected shell identity: %+v", shell)
	}

	// The draft version row: a child of the published source, a draft, unpublished.
	var isDraft, isPublished bool
	var parentVersionID string
	if err := fixture.DB.QueryRowContext(ctx, "SELECT is_draft, is_published, parent_version_id FROM exam_versions WHERE id = ?", shell.VersionID).Scan(&isDraft, &isPublished, &parentVersionID); err != nil {
		t.Fatalf("read cloned version: %v", err)
	}
	if !isDraft || isPublished {
		t.Fatalf("cloned version is_draft=%v is_published=%v, want a draft", isDraft, isPublished)
	}
	if parentVersionID != fixture.VersionID {
		t.Fatalf("cloned version parent = %q, want the published version %q", parentVersionID, fixture.VersionID)
	}

	cloned := readVersionQuestions(t, ctx, fixture.DB, shell.VersionID)
	if len(cloned) != len(publishedBefore) {
		t.Fatalf("cloned %d placements, published source has %d", len(cloned), len(publishedBefore))
	}

	draftRevisionMade := false
	seenPerQuestion := map[string]int{}
	for index, source := range publishedBefore {
		next := cloned[index]
		where := fmt.Sprintf("placement %d (%s order %d)", index, source.ModuleKey, source.DisplayOrder)

		// Remapped: a draft never shares a placement or a revision row with the
		// published version it came from.
		if next.PlacementID == source.PlacementID {
			t.Fatalf("%s: placement id was not remapped (%s)", where, source.PlacementID)
		}
		if next.RevisionID == source.RevisionID {
			t.Fatalf("%s: question revision id was not remapped (%s)", where, source.RevisionID)
		}
		// Preserved: the stable question identity follows the content.
		if next.QuestionID != source.QuestionID {
			t.Fatalf("%s: question id = %q, want %q", where, next.QuestionID, source.QuestionID)
		}
		if next.ModuleKey != source.ModuleKey || next.DisplayOrder != source.DisplayOrder || next.IsPretest != source.IsPretest {
			t.Fatalf("%s: placement shape changed: module=%q order=%d pretest=%v (source module=%q order=%d pretest=%v)",
				where, next.ModuleKey, next.DisplayOrder, next.IsPretest, source.ModuleKey, source.DisplayOrder, source.IsPretest)
		}
		// Advanced: a new semantic revision of the same question, back in draft.
		attempt := seenPerQuestion[source.QuestionID]
		seenPerQuestion[source.QuestionID] = attempt + 1
		wantSemantic := maxSemantic[source.QuestionID] + 1 + int64(attempt)
		if next.Semantic != wantSemantic {
			t.Fatalf("%s: semantic revision = %d, want %d (source had %d)", where, next.Semantic, wantSemantic, source.Semantic)
		}
		if next.Revision != 0 || next.State != "draft" {
			t.Fatalf("%s: cloned revision state = %q revision %d, want draft/0", where, next.State, next.Revision)
		}
		draftRevisionMade = true

		// The content itself: every field the author wrote, unchanged.
		if next.QuestionType != source.QuestionType {
			t.Fatalf("%s: question type = %q, want %q", where, next.QuestionType, source.QuestionType)
		}
		if next.Prompt != source.Prompt {
			t.Fatalf("%s: prompt changed by the clone:\n published: %s\n     draft: %s", where, source.Prompt, next.Prompt)
		}
		if next.Stimulus != source.Stimulus {
			t.Fatalf("%s: stimulus changed by the clone:\n published: %s\n     draft: %s", where, source.Stimulus, next.Stimulus)
		}
		if next.Answer != source.Answer {
			t.Fatalf("%s: answer_definition changed by the clone:\n published: %s\n     draft: %s", where, source.Answer, next.Answer)
		}
		if next.Rationale != source.Rationale {
			t.Fatalf("%s: rationale changed by the clone:\n published: %s\n     draft: %s", where, source.Rationale, next.Rationale)
		}
		if next.Metadata != source.Metadata {
			t.Fatalf("%s: metadata changed by the clone:\n published: %s\n     draft: %s", where, source.Metadata, next.Metadata)
		}
		if next.Accessibility != source.Accessibility {
			t.Fatalf("%s: accessibility changed by the clone:\n published: %s\n     draft: %s", where, source.Accessibility, next.Accessibility)
		}
	}
	if !draftRevisionMade {
		t.Fatal("no cloned question revision was checked")
	}

	// The published source is untouched, row for row and revision for revision.
	publishedAfter := readVersionQuestions(t, ctx, fixture.DB, fixture.VersionID)
	if !reflect.DeepEqual(publishedBefore, publishedAfter) {
		t.Fatal("the clone mutated the published source's placements or revisions")
	}
	var afterRevision int
	var sourceStillDraft, sourceStillPublished bool
	if err := fixture.DB.QueryRowContext(ctx, "SELECT revision, is_draft, is_published FROM exam_versions WHERE id = ?", fixture.VersionID).Scan(&afterRevision, &sourceStillDraft, &sourceStillPublished); err != nil {
		t.Fatalf("re-read published version: %v", err)
	}
	if afterRevision != publishedRevision || sourceStillDraft || !sourceStillPublished {
		t.Fatalf("published source changed: revision %d → %d, is_draft=%v is_published=%v",
			publishedRevision, afterRevision, sourceStillDraft, sourceStillPublished)
	}

	// Exactly one editable draft exists for the exam, and the lifecycle read
	// now answers READY on it.
	assertDraftCount(t, ctx, fixture, 1)
	after, err := authors.ShellLifecycle(ctx, fixture.ExamID)
	if err != nil {
		t.Fatalf("ShellLifecycle after the open: %v", err)
	}
	if after.State != ShellStateReady || after.Shell == nil || after.Shell.VersionID != shell.VersionID {
		t.Fatalf("post-open lifecycle = %q/%v, want READY on %s", after.State, after.Shell, shell.VersionID)
	}

	t.Logf("cloned %d published placements into draft %s with identical content, source intact",
		len(cloned), shell.VersionID)
}

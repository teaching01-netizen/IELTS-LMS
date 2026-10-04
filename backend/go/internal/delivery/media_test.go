package delivery

import (
	"context"
	"encoding/json"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// expectAttemptMediaRows seeds a version with a base module and an adaptive
// lower branch module, each with one question referencing a distinct asset.
// `opened` is the set of module ids the attempt owns
// (assessment_module_attempts rows).
func expectAttemptMediaRows(mock sqlmock.Sqlmock, linkScope string, opened ...string) {
	expectAttemptMediaQueries(mock, true, linkScope, opened...)
}

// expectAttemptMediaQueries skips the section tree reads when loadTree is
// false, as on a version-cache hit.
func expectAttemptMediaQueries(mock sqlmock.Sqlmock, loadTree bool, linkScope string, opened ...string) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT schedule_id, published_version_id FROM student_attempts WHERE id = ?")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "published_version_id"}).AddRow("schedule-1", "version-1"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT revision FROM exam_versions WHERE id = ?")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(1))
	if loadTree {
		expectAttemptMediaTree(mock)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT sat_publish_scope FROM exam_versions WHERE id = ?")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"sat_publish_scope"}).AddRow("full"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT enabled_sections FROM assessment_access_links WHERE schedule_id = ?")).
		WithArgs("schedule-1").
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections"}).AddRow(linkScope))
	// The assigned-module fence: only modules the attempt owns are readable.
	rows := sqlmock.NewRows([]string{"module_id"})
	for _, moduleID := range opened {
		rows.AddRow(moduleID)
	}
	mock.ExpectQuery(regexp.QuoteMeta("SELECT module_id FROM assessment_module_attempts WHERE attempt_id = ?")).
		WithArgs("attempt-1").
		WillReturnRows(rows)
}

func expectAttemptMediaTree(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("section-1", "reading-writing", "Reading and Writing", 1, 30, 0, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy FROM assessment_modules WHERE section_id = ? ORDER BY display_order")).
		WithArgs("section-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
			AddRow("module-1", "rw-m1", "Module 1", 1, 30, 1, "base", nil, nil).
			AddRow("module-lower", "rw-m2-lower", "Module 2 - Lower", 2, 30, 1, "lower_branch", nil, nil))
	imageContent := `{"version":1,"nodes":[{"type":"image","attrs":{"assetId":"asset-pinned"}}]}`
	answer := `{"kind":"single_choice","options":[{"id":"A","content":` + imageContent + `}]}`
	questionRows := func(examQuestionID, prompt string) *sqlmock.Rows {
		return sqlmock.NewRows([]string{"exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}).
			AddRow(examQuestionID, examQuestionID, 1, false, "single_choice", nil, prompt, answer, nil, nil)
	}
	branchContent := `{"version":1,"nodes":[{"type":"image","attrs":{"assetId":"asset-branch"}}]}`
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.id AS exam_question_id, eq.question_id, eq.display_order, eq.is_pretest, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.module_id = ? ORDER BY eq.display_order")).
		WithArgs("module-1").
		WillReturnRows(questionRows("question-1", imageContent))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.id AS exam_question_id, eq.question_id, eq.display_order, eq.is_pretest, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.module_id = ? ORDER BY eq.display_order")).
		WithArgs("module-lower").
		WillReturnRows(questionRows("question-branch", branchContent))
}

// The memoized index must not carry one request's fence or scope into the
// next: those stay per request, only the asset map is shared.
func TestCanAttemptReadMediaCachedIndexKeepsPerRequestFence(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	service := NewService(db, nil).SetVersionCache(NewVersionCache(VersionCacheMaxVersions))
	for i, step := range []struct {
		linkScope string
		opened    []string
		want      bool
	}{
		{linkScope: `["reading-writing"]`, opened: []string{"module-1"}, want: false},
		{linkScope: `["reading-writing"]`, opened: []string{"module-1", "module-lower"}, want: true},
		{linkScope: `["math"]`, opened: []string{"module-1", "module-lower"}, want: false},
	} {
		expectAttemptMediaQueries(mock, i == 0, step.linkScope, step.opened...)
		allowed, err := service.CanAttemptReadMedia(context.Background(), "schedule-1", "attempt-1", "asset-branch")
		if err != nil {
			t.Fatalf("step %d: CanAttemptReadMedia() error = %v", i, err)
		}
		if allowed != step.want {
			t.Fatalf("step %d: CanAttemptReadMedia() = %v, want %v", i, allowed, step.want)
		}
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if len(service.mediaIndex) != 1 {
		t.Fatalf("media index entries = %d, want 1", len(service.mediaIndex))
	}
}

func TestCanAttemptReadMediaUsesPinnedVersionAndSectionScope(t *testing.T) {
	for _, test := range []struct {
		name      string
		linkScope string
		assetID   string
		opened    []string
		want      bool
	}{
		{name: "referenced image in enabled section", linkScope: `["reading-writing"]`, assetID: "asset-pinned", opened: []string{"module-1"}, want: true},
		{name: "referenced image outside enabled section", linkScope: `["math"]`, assetID: "asset-pinned", opened: []string{"module-1"}, want: false},
		{name: "unassigned adaptive branch asset is unreadable", linkScope: `["reading-writing"]`, assetID: "asset-branch", opened: []string{"module-1"}, want: false},
		{name: "assigned adaptive branch asset is readable", linkScope: `["reading-writing"]`, assetID: "asset-branch", opened: []string{"module-1", "module-lower"}, want: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			expectAttemptMediaRows(mock, test.linkScope, test.opened...)
			allowed, err := NewService(db, nil).CanAttemptReadMedia(context.Background(), "schedule-1", "attempt-1", test.assetID)
			if err != nil {
				t.Fatalf("CanAttemptReadMedia() error = %v", err)
			}
			if allowed != test.want {
				t.Fatalf("CanAttemptReadMedia() = %v, want %v", allowed, test.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestModuleMediaIndexIncludesLegacyManagedImagesOnlyForScience(t *testing.T) {
	legacyImage := json.RawMessage(`<img src="/api/v1/media/asset-legacy/content">`)
	sections := []DeliverySection{
		{
			SectionKey: "science",
			Modules: []DeliveryModule{{
				ID:        "science-module",
				Questions: []DeliveredQuestion{{ExamQuestionID: "science-question", Stimulus: legacyImage}},
			}},
		},
		{
			SectionKey: "reading-writing",
			Modules: []DeliveryModule{{
				ID:        "reading-module",
				Questions: []DeliveredQuestion{{ExamQuestionID: "reading-question", Stimulus: legacyImage}},
			}},
		},
	}

	index := moduleMediaIndex(sections)
	if _, ok := index["science-module"]["asset-legacy"]; !ok {
		t.Fatal("managed legacy image referenced by pinned Science content must be indexed")
	}
	if _, ok := index["reading-module"]["asset-legacy"]; ok {
		t.Fatal("legacy HTML image URL must not expand the non-Science media allowlist")
	}
}

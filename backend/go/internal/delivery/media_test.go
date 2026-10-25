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
	expectAttemptMediaQueries(mock, true, false, linkScope, opened...)
}

// expectAttemptMediaQueries skips the section tree reads when loadTree is
// false, as on a version-cache hit. A cached load also reads the revision it
// observed alongside the tree.
func expectAttemptMediaQueries(mock sqlmock.Sqlmock, loadTree, cached bool, linkScope string, opened ...string) {
	// The attempt, its version's revision and release scope, and the link
	// scope arrive in one statement.
	mock.ExpectQuery(`(?s)SELECT a\.schedule_id, a\.published_version_id, a\.sat_start_code_required, a\.sat_start_code_accepted_at,\s+v\.revision, v\.sat_publish_scope, l\.enabled_sections\s+FROM student_attempts a\s+LEFT JOIN exam_versions v ON v\.id = a\.published_version_id\s+LEFT JOIN assessment_access_links l ON l\.schedule_id = a\.schedule_id\s+WHERE a\.id = \?`).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "published_version_id", "sat_start_code_required", "sat_start_code_accepted_at", "revision", "sat_publish_scope", "enabled_sections"}).
			AddRow("schedule-1", "version-1", false, nil, 1, "full", linkScope))
	if loadTree {
		expectAttemptMediaTree(mock)
		if cached {
			mock.ExpectQuery(regexp.QuoteMeta("SELECT revision FROM exam_versions WHERE id = ?")).
				WithArgs("version-1").
				WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(1))
		}
	}
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
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m JOIN assessment_sections s ON s.id = m.section_id WHERE s.exam_version_id = ?")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
			AddRow("module-1", "section-1", "rw-m1", "Module 1", 1, 30, 1, "base", nil, nil).
			AddRow("module-lower", "section-1", "rw-m2-lower", "Module 2 - Lower", 2, 30, 1, "lower_branch", nil, nil))
	imageContent := `{"version":1,"nodes":[{"type":"image","attrs":{"assetId":"asset-pinned"}}]}`
	answer := `{"kind":"single_choice","options":[{"id":"A","content":` + imageContent + `}]}`
	branchContent := `{"version":1,"nodes":[{"type":"image","attrs":{"assetId":"asset-branch"}}]}`
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.module_id, eq.id AS exam_question_id")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"module_id", "exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}).
			AddRow("module-1", "question-1", "question-1", 1, false, "single_choice", nil, imageContent, answer, nil, nil).
			AddRow("module-lower", "question-branch", "question-branch", 1, false, "single_choice", nil, branchContent, answer, nil, nil))
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
		expectAttemptMediaQueries(mock, i == 0, true, step.linkScope, step.opened...)
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
	if len(service.mediaIndex.entries) != 1 {
		t.Fatalf("media index entries = %d, want 1", len(service.mediaIndex.entries))
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

// The joined read keeps the separate reads' outcomes: a pinned version with no
// row is an error, and a schedule with no access link is not narrowed.
func TestCanAttemptReadMediaJoinedReadEdges(t *testing.T) {
	joined := regexp.QuoteMeta("FROM student_attempts a")
	columns := []string{"schedule_id", "published_version_id", "sat_start_code_required", "sat_start_code_accepted_at", "revision", "sat_publish_scope", "enabled_sections"}

	t.Run("missing version row", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		mock.ExpectQuery(joined).WithArgs("attempt-1").
			WillReturnRows(sqlmock.NewRows(columns).AddRow("schedule-1", "version-1", false, nil, nil, nil, nil))
		if _, err := NewService(db, nil).CanAttemptReadMedia(context.Background(), "schedule-1", "attempt-1", "asset-pinned"); err == nil {
			t.Fatal("a pinned version without a row must fail closed with an error")
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})

	t.Run("no access link", func(t *testing.T) {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		defer db.Close()
		mock.ExpectQuery(joined).WithArgs("attempt-1").
			WillReturnRows(sqlmock.NewRows(columns).AddRow("schedule-1", "version-1", false, nil, 1, "full", nil))
		expectAttemptMediaTree(mock)
		mock.ExpectQuery(regexp.QuoteMeta("SELECT module_id FROM assessment_module_attempts WHERE attempt_id = ?")).
			WithArgs("attempt-1").
			WillReturnRows(sqlmock.NewRows([]string{"module_id"}).AddRow("module-1"))
		allowed, err := NewService(db, nil).CanAttemptReadMedia(context.Background(), "schedule-1", "attempt-1", "asset-pinned")
		if err != nil || !allowed {
			t.Fatalf("CanAttemptReadMedia() = %v, %v; want true without an access link", allowed, err)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
	})
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

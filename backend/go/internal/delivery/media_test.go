package delivery

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func expectAttemptMediaRows(mock sqlmock.Sqlmock, linkScope string) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT schedule_id, published_version_id FROM student_attempts WHERE id = ?")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "published_version_id"}).AddRow("schedule-1", "version-1"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT revision FROM exam_versions WHERE id = ?")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(1))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, section_key, title, display_order, duration_seconds, break_after_seconds, instructions FROM assessment_sections WHERE exam_version_id = ? ORDER BY display_order")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("section-1", "reading-writing", "Reading and Writing", 1, 30, 0, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, module_key, title, display_order, duration_seconds, target_question_count, adaptive_role, instructions, tool_policy FROM assessment_modules WHERE section_id = ? ORDER BY display_order")).
		WithArgs("section-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
			AddRow("module-1", "module-1", "Module", 1, 30, 1, "base", nil, nil))
	imageContent := `{"version":1,"nodes":[{"type":"image","attrs":{"assetId":"asset-pinned"}}]}`
	answer := `{"kind":"single_choice","options":[{"id":"A","content":` + imageContent + `}]}`
	mock.ExpectQuery(regexp.QuoteMeta("SELECT eq.id AS exam_question_id, eq.question_id, eq.display_order, eq.is_pretest, qr.question_type, qr.stimulus, qr.prompt, qr.answer_definition, qr.metadata, qr.accessibility FROM assessment_exam_questions eq JOIN assessment_question_revisions qr ON qr.id = eq.question_revision_id WHERE eq.module_id = ? ORDER BY eq.display_order")).
		WithArgs("module-1").
		WillReturnRows(sqlmock.NewRows([]string{"exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}).
			AddRow("question-1", "question-1", 1, false, "single_choice", nil, imageContent, answer, nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT sat_publish_scope FROM exam_versions WHERE id = ?")).
		WithArgs("version-1").
		WillReturnRows(sqlmock.NewRows([]string{"sat_publish_scope"}).AddRow("full"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT enabled_sections FROM assessment_access_links WHERE schedule_id = ?")).
		WithArgs("schedule-1").
		WillReturnRows(sqlmock.NewRows([]string{"enabled_sections"}).AddRow(linkScope))
}

func TestCanAttemptReadMediaUsesPinnedVersionAndSectionScope(t *testing.T) {
	for _, test := range []struct {
		name      string
		linkScope string
		want      bool
	}{
		{name: "referenced image in enabled section", linkScope: `["reading-writing"]`, want: true},
		{name: "referenced image outside enabled section", linkScope: `["math"]`, want: false},
	} {
		t.Run(test.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			expectAttemptMediaRows(mock, test.linkScope)
			allowed, err := NewService(db, nil).CanAttemptReadMedia(context.Background(), "schedule-1", "attempt-1", "asset-pinned")
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

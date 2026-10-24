package delivery

import (
	"context"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func sectionListRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
		AddRow("sec-1", "rw", "Reading", 1, 3600, 0, `{}`)
}

func moduleListRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"id", "section_id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
		AddRow("mod-1", "sec-1", "rw-1", "R/W 1", 1, 3600, 10, "base", `{}`, `{}`)
}

func questionListRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"module_id", "exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}).
		AddRow("mod-1", "eq-1", "q-1", 1, false, "mcq", `{}`, `{}`, `{"kind":"single_choice","options":[]}`, `{}`, `{}`)
}

// expectFullTree stages the three version-scoped tree reads. A cached load
// (observed >= 0) also reads the revision the same snapshot observed.
func expectFullTree(mock sqlmock.Sqlmock, observed int64) {
	mock.ExpectQuery("FROM assessment_sections").
		WithArgs("v-1").WillReturnRows(sectionListRows())
	mock.ExpectQuery("FROM assessment_modules").
		WithArgs("v-1").WillReturnRows(moduleListRows())
	mock.ExpectQuery("FROM assessment_exam_questions").
		WithArgs("v-1").WillReturnRows(questionListRows())
	if observed >= 0 {
		mock.ExpectQuery("SELECT revision FROM exam_versions").
			WithArgs("v-1").WillReturnRows(sqlmock.NewRows([]string{"revision"}).AddRow(observed))
	}
}

// D1 RED: first call loads the tree; second call at the same revision
// issues ZERO section queries (cache hit).
func TestCachedSectionsHitSkipsQueries(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil).SetVersionCache(NewVersionCache(50))
	ctx := context.Background()
	expectFullTree(mock, 7)
	first, err := svc.cachedSections(ctx, "v-1", 7)
	if err != nil {
		t.Fatalf("first: %v", err)
	}
	if len(first) != 1 || len(first[0].Modules) != 1 || len(first[0].Modules[0].Questions) != 1 {
		t.Fatalf("tree shape wrong: %+v", first)
	}
	// No further expectations: any section query now fails the test.
	second, err := svc.cachedSections(ctx, "v-1", 7)
	if err != nil {
		t.Fatalf("second: %v", err)
	}
	if len(second) != 1 || second[0].Modules[0].Questions[0].QuestionID != "q-1" {
		t.Fatalf("cached tree wrong: %+v", second)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// D1 RED: revision bump reloads (no stale tree).
func TestCachedSectionsRevBumpReloads(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil).SetVersionCache(NewVersionCache(50))
	ctx := context.Background()
	expectFullTree(mock, 7)
	if _, err := svc.cachedSections(ctx, "v-1", 7); err != nil {
		t.Fatal(err)
	}
	expectFullTree(mock, 8)
	if _, err := svc.cachedSections(ctx, "v-1", 8); err != nil {
		t.Fatalf("rev bump must reload: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// D1 RED: cache off (nil) loads every time (today's behavior preserved).
func TestCachedSectionsOffLoadsAlways(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(db, nil)
	ctx := context.Background()
	expectFullTree(mock, -1)
	if _, err := svc.cachedSections(ctx, "v-1", 7); err != nil {
		t.Fatal(err)
	}
	expectFullTree(mock, -1)
	if _, err := svc.cachedSections(ctx, "v-1", 7); err != nil {
		t.Fatalf("cache-off must reload: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

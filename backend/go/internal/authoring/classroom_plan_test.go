package authoring

import (
	"context"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
	"example.com/ielts-proctoring/internal/satpublish"
)

func TestGetClassroomPlanUsesDraftBeforePublishedPlan(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities e")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"current_draft_version_id", "current_published_version_id", "id", "is_draft", "is_published", "sat_classroom_plan",
		}).AddRow("draft-1", "published-1", "draft-1", true, false, `{"math":"m2_easy"}`))

	plan, err := NewService(db, tx.NewRunner(db)).GetClassroomPlan(context.Background(), "exam-1")
	if err != nil {
		t.Fatalf("get draft plan: %v", err)
	}
	if plan.ShapeFor(satpublish.SectionMath) != satpublish.ShapeM2Easy {
		t.Fatalf("expected the current draft plan, got %#v", plan)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetClassroomPlanFallsBackToPublishedPlanWithoutDraft(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities e")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"current_draft_version_id", "current_published_version_id", "id", "is_draft", "is_published", "sat_classroom_plan",
		}).AddRow(nil, "published-1", "published-1", false, true, `{"math":"m2_hard"}`))

	plan, err := NewService(db, tx.NewRunner(db)).GetClassroomPlan(context.Background(), "exam-1")
	if err != nil {
		t.Fatalf("get published plan: %v", err)
	}
	if plan.ShapeFor(satpublish.SectionMath) != satpublish.ShapeM2Hard {
		t.Fatalf("expected the published plan, got %#v", plan)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetClassroomPlanFailsClosedWhenNoActiveVersion(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_entities e")).
		WithArgs("exam-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"current_draft_version_id", "current_published_version_id", "id", "is_draft", "is_published", "sat_classroom_plan",
		}).AddRow(nil, nil, nil, nil, nil, nil))

	_, err = NewService(db, tx.NewRunner(db)).GetClassroomPlan(context.Background(), "exam-1")
	if err == nil || !strings.Contains(err.Error(), "no current draft or published version") {
		t.Fatalf("missing active version must not be treated as the default plan, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

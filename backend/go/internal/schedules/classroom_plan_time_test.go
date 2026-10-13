package schedules

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/satpublish"
)

// An M2-only or single-branch classroom section is timed by the modules the
// student receives, not by base + the longer branch.
func TestPlannedSectionSecondsByKey(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m")).WithArgs("v1").
		WillReturnRows(sqlmock.NewRows([]string{"k", "role", "s"}).
			AddRow("reading-writing", "base", 1920).AddRow("reading-writing", "lower_branch", 1920).AddRow("reading-writing", "higher_branch", 1920).
			AddRow("math", "base", 2100).AddRow("math", "lower_branch", 2100).AddRow("math", "higher_branch", 0))
	got, err := plannedSectionSecondsByKey(context.Background(), db, "v1", satpublish.Plan{
		"reading-writing": satpublish.ShapeM2Hard, // branch only
		"math":            satpublish.ShapeM1Hard, // higher branch has no time: unprovable, left generic
	})
	if err != nil {
		t.Fatal(err)
	}
	if got["reading-writing"] != 1920 {
		t.Fatalf("M2-only must be one module long, got %v", got)
	}
	if _, ok := got["math"]; ok {
		t.Fatalf("an unprovable plan must fall back to the generic length, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

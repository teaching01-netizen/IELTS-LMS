package act

import (
	"context"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestListScienceReportsUsesUnquotedSectionPredicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectation := mock.ExpectQuery(regexp.QuoteMeta("JSON_UNQUOTE(JSON_EXTRACT(a.final_submission, '$.section')) = 'science'"))
	expectation.WithArgs("schedule-1", 10, 0).WillReturnRows(sqlmock.NewRows([]string{
		"attempt_id",
		"schedule_id",
		"student_id",
		"student_name",
		"total_score",
		"max_score",
		"percentage",
		"release_status",
	}).AddRow("attempt-1", "schedule-1", "student-1", "Alice", "1", "1", "100", "ready_to_release"))

	reports, err := NewService(db, nil).ListScienceReports(context.Background(), ReportFilter{
		ScheduleID: "schedule-1",
		Limit:      10,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(reports) != 1 || reports[0].AttemptID != "attempt-1" || reports[0].Percentage != 100 {
		t.Fatalf("unexpected ACT report: %+v", reports)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package results

import (
	"context"
	"reflect"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestSATDomainAccuracyCountsOperationalQuestionsByDomain(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	key := `{"kind":"single_choice","correctOptionId":"B"}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"section_key", "module_key", "module_display_order", "question_display_order",
			"exam_question_id", "question_id", "is_pretest", "marked_for_review", "response", "answer_definition",
			"response_v2", "v2_present", "v_question_id", "config_snapshot",
		}).
			AddRow("math", "m1", 1, 1, "eq-1", "q-1", false, false, `"B"`, key, nil, false, nil, nil).
			AddRow("math", "m1", 1, 2, "eq-2", "q-2", false, false, `"A"`, key, nil, false, nil, nil).
			AddRow("math", "m1", 1, 3, "eq-3", "q-3", false, false, nil, key, nil, false, nil, nil).
			AddRow("math", "m1", 1, 4, "eq-4", "q-pre", true, false, `"B"`, key, nil, false, nil, nil).
			AddRow("math", "m1", 1, 5, "eq-5", "q-none", false, false, `"B"`, key, nil, false, nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("JSON_EXTRACT(qr.metadata, '$.domain')")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{"section_key", "module_key", "question_id", "domain"}).
			AddRow("math", "m1", "q-1", "Algebra").
			AddRow("math", "m1", "q-2", "Algebra").
			AddRow("math", "m1", "q-3", "Geometry and Trigonometry").
			AddRow("math", "m1", "q-pre", "Algebra").
			AddRow("math", "m1", "q-none", nil))
	got, err := SATDomainAccuracyQ(context.Background(), db, "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	want := []SATDomainAccuracy{
		{SectionKey: "math", Domain: "Algebra", Correct: 1, Total: 2},
		{SectionKey: "math", Domain: "Geometry and Trigonometry", Correct: 0, Total: 1},
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("got %+v want %+v", got, want)
	}
}

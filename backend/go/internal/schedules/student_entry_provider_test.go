package schedules

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestEffectiveScheduleProviderUsesExamTypeWithoutChangingOtherProviders(t *testing.T) {
	for _, tc := range []struct {
		name       string
		stored     string
		examType   string
		wantKey    string
		wantModule string
	}{
		{name: "legacy ACT schedule", stored: "ielts", examType: "ACT", wantKey: "act", wantModule: "science"},
		{name: "IELTS schedule", stored: "ielts", examType: "Academic", wantKey: "ielts", wantModule: "listening"},
		{name: "SAT schedule", stored: "sat", examType: "Digital SAT", wantKey: "sat", wantModule: "reading"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()

			if tc.stored == "ielts" || tc.stored == "" {
				mock.ExpectQuery(regexp.QuoteMeta("SELECT exam_type FROM exam_entities WHERE id = ?")).
					WithArgs("exam-1").
					WillReturnRows(sqlmock.NewRows([]string{"exam_type"}).AddRow(tc.examType))
			}

			providerKey, err := effectiveScheduleProvider(context.Background(), db, Schedule{
				ExamID:      "exam-1",
				ProviderKey: tc.stored,
			})
			if err != nil {
				t.Fatalf("effectiveScheduleProvider() error = %v", err)
			}
			if providerKey != tc.wantKey {
				t.Fatalf("effective provider = %q, want %q", providerKey, tc.wantKey)
			}
			if module := initialModuleForProvider(providerKey); module != tc.wantModule {
				t.Fatalf("initial module = %q, want %q", module, tc.wantModule)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

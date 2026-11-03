package authoring

import (
	"context"
	"regexp"
	"strings"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// The flexible-count flag is version-lifecycle state: a published flexible
// exam whose draft comes back with flag 0 flips to strict gates and becomes
// unpublishable. The clone must carry the flag (and the plan) together.
//
// These run without MySQL: the published side is stubbed just far enough to
// reach the version INSERT (flag + plan asserted on the wire), then the
// section copy refuses the empty published tree. The full content contract
// (ids remapped, content byte-identical) stays in openshell_clone_test.go.
func TestClonePublishedSATToDraftTxPreservesFlexibleFlag(t *testing.T) {
	for _, flag := range []int64{0, 1} {
		t.Run(map[int64]string{0: "strict", 1: "flexible"}[flag], func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			svc := NewService(db, tx.NewRunner(db))

			// The SELECT must project the flag column, or there is nothing to copy.
			mock.ExpectQuery(regexp.QuoteMeta("sat_flexible_count")).
				WithArgs("pub-1", "exam-1").
				WillReturnRows(sqlmock.NewRows([]string{"content_snapshot", "config_snapshot", "sat_classroom_plan", "sat_flexible_count"}).
					AddRow("{}", "{}", `{"math":"m1_only"}`, flag))
			mock.ExpectQuery(regexp.QuoteMeta("COALESCE(MAX(version_number), 0) + 1")).
				WithArgs("exam-1").
				WillReturnRows(sqlmock.NewRows([]string{"version_number"}).AddRow(4))
			// The INSERT must store the flag next to the plan, with the
			// published value — not a default.
			mock.ExpectExec(regexp.QuoteMeta("sat_flexible_count")).
				WithArgs(sqlmock.AnyArg(), "exam-1", 4, "pub-1", "{}", "{}", "actor-1", `{"math":"m1_only"}`, flag).
				WillReturnResult(sqlmock.NewResult(1, 1))
			mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id")).
				WithArgs("pub-1").
				WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions", "tool_policy"}))

			_, err = svc.clonePublishedSATToDraftTx(context.Background(), db, "exam-1", "pub-1", "actor-1")
			if err == nil || !strings.Contains(err.Error(), "no assessment sections") {
				t.Fatalf("clone must reach the section copy with the flag stored, got %v", err)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

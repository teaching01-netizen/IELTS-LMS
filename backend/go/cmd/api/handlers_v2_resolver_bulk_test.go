package main

// Audit finding 4, resolver half: a multi-answer flush used to pay one
// question->module query per answer — and, for legacy snapshot exams, one full
// content-snapshot read and JSON parse per answer — while the attempt row lock
// was held. v2Resolver.ResolveMany resolves the whole batch in one normalized
// query and shares one snapshot load, keeping the same per-question verdicts
// (including the SAT gate and NOT_FOUND) so the write loop still reports each
// error at the command that owns it.
import (
	"context"
	"database/sql/driver"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func resolveManyWithMockDB(t *testing.T, prepare func(mock sqlmock.Sqlmock), questionIDs []string) map[string]attempts.QuestionVerdict {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	prepare(mock)
	mock.ExpectRollback()
	verdicts, err := (v2Resolver{}).ResolveMany(context.Background(), tx, "att-1", questionIDs)
	if err != nil {
		t.Fatalf("ResolveMany: %v", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return verdicts
}

func bulkNormalizedRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{"exam_question_id", "question_id", "module_id", "section_key", "state", "provider_key"}).
		AddRow("q-0", "q-0-inner", "mod-a", "reading-writing", "active", "ielts").
		AddRow("eq-1-other", "q-1", "mod-b", "math", "review", "ielts")
}

func bulkQuestionIDs() []string { return []string{"q-0", "q-1", "q-2", "q-3", "q-4", "q-5"} }

// TestV2ResolverResolveManyIsSetBased drives six questions (two normalized, four
// snapshot-backed) through one ResolveMany call: exactly one normalized query,
// one provider-gate query and one snapshot load, with per-question verdicts.
func TestV2ResolverResolveManyIsSetBased(t *testing.T) {
	const snapshot = `{"sections":{"reading":[{"questionId":"q-3"}]}}`
	verdicts := resolveManyWithMockDB(t, func(mock sqlmock.Sqlmock) {
		ids := bulkQuestionIDs()
		args := []driver.Value{"att-1"}
		for _, id := range ids {
			args = append(args, id)
		}
		for _, id := range ids {
			args = append(args, id)
		}
		args = append(args, "att-1")
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).WithArgs(args...).WillReturnRows(bulkNormalizedRows())
		// Provider gate: once for the batch, not once per unanswered question.
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules")).
			WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("ielts"))
		// ... and one shared snapshot load.
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a JOIN exam_versions v")).
			WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(snapshot))
	}, bulkQuestionIDs())

	if len(verdicts) != 6 {
		t.Fatalf("expected a verdict for every question, got %d", len(verdicts))
	}
	// Matched by assessment_exam_questions.id: the id arm wins.
	if got := verdicts["q-0"]; got.Err != nil || got.Owner.ModuleID != "mod-a" || got.Owner.ModuleState != "active" || got.Owner.SectionKey != "reading-writing" {
		t.Fatalf("q-0 verdict = %+v", got)
	}
	// Matched by question_id, state passing through untouched.
	if got := verdicts["q-1"]; got.Err != nil || got.Owner.ModuleID != "mod-b" || got.Owner.ModuleState != "review" {
		t.Fatalf("q-1 verdict = %+v", got)
	}
	// Snapshot-backed question resolves active from the shared tree.
	if got := verdicts["q-3"]; got.Err != nil || got.Owner.ModuleState != "active" {
		t.Fatalf("q-3 verdict = %+v", got)
	}
	// Absent everywhere: per-question NOT_FOUND, not a batch failure.
	for _, id := range []string{"q-2", "q-4", "q-5"} {
		got := verdicts[id]
		appErr, ok := apperrors.As(got.Err)
		if !ok || appErr.Code != apperrors.CodeNotFound {
			t.Fatalf("%s must be NOT_FOUND per question, got %+v", id, got)
		}
	}
}

// TestV2ResolverResolveManySATGateSkipsSnapshot keeps defect 6 intact at batch
// scale: for a SAT attempt the snapshot tree is never consulted (the strict mock
// has no snapshot expectation, so a read would fail the run) and every
// snapshot-only question is refused per question.
func TestV2ResolverResolveManySATGateSkipsSnapshot(t *testing.T) {
	verdicts := resolveManyWithMockDB(t, func(mock sqlmock.Sqlmock) {
		ids := bulkQuestionIDs()
		args := []driver.Value{"att-1"}
		for _, id := range ids {
			args = append(args, id)
		}
		for _, id := range ids {
			args = append(args, id)
		}
		args = append(args, "att-1")
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).WithArgs(args...).
			WillReturnRows(sqlmock.NewRows([]string{"exam_question_id", "question_id", "module_id", "section_key", "state", "provider_key"}))
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules")).
			WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("sat"))
	}, bulkQuestionIDs())

	for _, id := range bulkQuestionIDs() {
		appErr, ok := apperrors.As(verdicts[id].Err)
		if !ok || appErr.Code != apperrors.CodeNotFound {
			t.Fatalf("SAT question %s must be refused per question, got %+v", id, verdicts[id])
		}
	}
}

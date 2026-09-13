package act

import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"github.com/DATA-DOG/go-sqlmock"
)

// The list predicate must use the effective-provider identity
// (provider_key='act' OR exam_type='ACT') so legacy ACT rows survive the
// report listing after the 0054 heal window (Phase 02 blocker 4).
// SealedContentHash is deterministic: identical sealed content hashes
// equally regardless of input shape (nested vs compact), and any key change
// moves the hash (Phase 02 blocker 2: seal vs replay identity).
func TestSealedContentHashDeterministic(t *testing.T) {
	nested := normalizeScienceContent(mustLoadContractFixture(t, "nested_science_content.json"))
	compact := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	if SealedContentHash(nested) != SealedContentHash(compact) {
		t.Fatal("identical sealed content must hash equally across shapes")
	}
	tampered := normalizeScienceContent(mustLoadContractFixture(t, "compact_scoring_projection.json"))
	if questions, ok := tampered["questions"].([]any); ok && len(questions) > 0 {
		if first, ok := questions[0].(map[string]any); ok {
			first["correctAnswer"] = "tampered"
		}
	}
	if SealedContentHash(tampered) == SealedContentHash(compact) {
		t.Fatal("a changed sealed key must move the content hash")
	}
}

func TestListScienceReportsUsesEffectiveProviderPredicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	expectation := mock.ExpectQuery(regexp.QuoteMeta("(e.provider_key = 'act' OR e.exam_type = 'ACT')"))
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

func TestGetScienceDetailReplaysKeyVerdicts(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	finalSubmission := `{"section":"science","score":{"totalScore":1,"maxScore":3,"percentage":33.3},"content":{"questions":[{"questionId":"q1","correctAnswer":"A"},{"questionId":"q2","correctAnswer":"B"},{"questionId":"q3","correctAnswer":"C"}]},"answers":{"q1":"a","q2":"zzz"}}`
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a")).
		WithArgs("attempt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"schedule_id", "candidate_id", "candidate_name",
			"final_submission", "submitted_at",
			"outcome_status", "release_status",
		}).AddRow("schedule-1", "student-1", "Alice", finalSubmission, time.Now().UTC(), "scored", "ready_to_release"))
	platform := auth.NewActorContext("admin-1", auth.RoleAdmin)
	detail, err := NewService(db, nil).GetScienceDetail(context.Background(), platform, "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	if detail.TotalScore != 1 || detail.MaxScore != 3 || len(detail.Questions) != 3 {
		t.Fatalf("unexpected ACT detail: %+v", detail)
	}
	byID := map[string]ScienceQuestion{}
	for _, question := range detail.Questions {
		byID[question.QuestionID] = question
	}
	// Case-insensitive science convention: "a" matches key "A".
	if byID["q1"].IsCorrect == nil || !*byID["q1"].IsCorrect {
		t.Fatalf("expected q1 correct, got %+v", byID["q1"])
	}
	if byID["q2"].IsCorrect == nil || *byID["q2"].IsCorrect {
		t.Fatalf("expected q2 incorrect, got %+v", byID["q2"])
	}
	// Unanswered rows keep a null verdict and never render incorrect.
	if byID["q3"].IsCorrect != nil || byID["q3"].Answered {
		t.Fatalf("expected q3 unanswered null verdict, got %+v", byID["q3"])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetScienceDetailFailsClosedWithoutTenant(t *testing.T) {
	scope, args := actResultScope(auth.NewActorContext("grader-1", auth.RoleGrader))
	if scope != " AND 1 = 0" || args != nil {
		t.Fatalf("expected fail-closed scope, got %q %#v", scope, args)
	}
}

func TestGetScienceDetailNarrowsTenantToAssignment(t *testing.T) {
	actor := auth.NewActorContext("grader-1", auth.RoleGrader).WithOrgID("org-1")
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a")).
		WithArgs("attempt-9", "org-1", "grader-1", auth.RoleGrader).
		WillReturnError(sql.ErrNoRows)
	if _, err := NewService(db, nil).GetScienceDetail(context.Background(), actor, "attempt-9"); err == nil {
		t.Fatal("expected scoped miss to surface, not cross-schedule state")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetScienceDetailMissingAttemptIsNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a")).
		WithArgs("missing").
		WillReturnError(sql.ErrNoRows)
	platform := auth.NewActorContext("admin-1", auth.RoleAdmin)
	if _, err := NewService(db, nil).GetScienceDetail(context.Background(), platform, "missing"); err == nil {
		t.Fatal("expected NOT_FOUND for missing attempt")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

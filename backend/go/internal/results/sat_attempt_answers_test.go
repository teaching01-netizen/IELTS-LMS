package results

import (
	"context"
	"regexp"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

var satAnswerColumns = []string{"section_key", "module_key", "display_order", "exam_question_id", "question_id", "legacy_response", "marked_for_review", "legacy_updated_at", "v2_response", "v2_updated_at"}

func TestSATAttemptAnswersReturnsLastAcknowledgedV2Save(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	stamp := time.Date(2026, 9, 24, 11, 5, 0, 0, time.UTC)
	mock.ExpectBegin()
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a")).WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{"id", "exam_title", "version_number", "candidate_id", "candidate_name", "cohort_name", "delivery_status", "protocol_version", "response_revision", "outcome_status"}).
			AddRow("attempt-1", "SAT", 14, "S1", "Student", "Morning", "running", 2, 8, nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts ma")).WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows(satAnswerColumns).
			AddRow("reading-writing", "module-1", 1, "eq-1", "q-1", `"old"`, false, stamp.Add(-time.Minute), `{"answer":"B","markedForReview":true}`, stamp).
			AddRow("reading-writing", "module-1", 2, "eq-2", "q-2", nil, false, nil, nil, nil))
	mock.ExpectCommit()
	out, err := NewService(db).GetSATAttemptAnswers(context.Background(), auth.NewActorContext("admin", auth.RoleAdmin), "attempt-1")
	if err != nil {
		t.Fatal(err)
	}
	if out.SavedAnswerCount != 1 || out.ResponseRevision == nil || *out.ResponseRevision != 8 || out.LastSavedAt == nil || !out.LastSavedAt.Equal(stamp) {
		t.Fatalf("incorrect saved snapshot: %#v", out)
	}
	if len(out.Questions) != 2 || out.Questions[0].Response != "B" || !out.Questions[0].MarkedForReview || out.Questions[1].Response != nil {
		t.Fatalf("V2 must win over legacy and unanswered questions stay visible: %#v", out.Questions)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSATAttemptAnswersEmptyAndInvalidatedLegacy(t *testing.T) {
	for _, tc := range []struct {
		name      string
		protocol  int
		status    string
		outcome   any
		legacy    any
		canonical any
		count     int
	}{
		{"empty active", 2, "running", nil, nil, nil, 0},
		{"cleared answer", 2, "running", nil, nil, `{"answer":""}`, 0},
		{"invalidated legacy", 1, "terminated", "invalidated_proctor", `"C"`, nil, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			stamp := time.Date(2026, 9, 24, 11, 5, 0, 0, time.UTC)
			mock.ExpectBegin()
			mock.ExpectQuery("FROM student_attempts a").WithArgs("attempt-1").WillReturnRows(
				sqlmock.NewRows([]string{"id", "exam_title", "version_number", "candidate_id", "candidate_name", "cohort_name", "delivery_status", "protocol_version", "response_revision", "outcome_status"}).
					AddRow("attempt-1", "SAT", 14, "S1", "Student", "Morning", tc.status, tc.protocol, 0, tc.outcome))
			mock.ExpectQuery("FROM assessment_module_attempts ma").WithArgs("attempt-1").WillReturnRows(
				sqlmock.NewRows(satAnswerColumns).AddRow("math", "module-1", 1, "eq-1", "q-1", tc.legacy, false, stamp, tc.canonical, stamp))
			mock.ExpectCommit()
			out, err := NewService(db).GetSATAttemptAnswers(context.Background(), auth.NewActorContext("admin", auth.RoleAdmin), "attempt-1")
			if err != nil {
				t.Fatal(err)
			}
			if out.SavedAnswerCount != tc.count || len(out.Questions) != 1 {
				t.Fatalf("unexpected answers: %#v", out)
			}
			if tc.name == "empty active" && (out.LastSavedAt != nil || out.Questions[0].Response != nil) {
				t.Fatalf("empty attempt invented a save: %#v", out)
			}
			if tc.name == "cleared answer" && (out.LastSavedAt == nil || out.Questions[0].Response != "") {
				t.Fatalf("cleared answer should have a save time but no answer count: %#v", out)
			}
			if tc.protocol == 1 && (out.ResponseRevision != nil || out.Status != "invalidated_proctor" || out.Questions[0].Response != "C") {
				t.Fatalf("legacy result lost its answer or outcome: %#v", out)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestSATAttemptAnswersRejectsUnassignedStaffBeforeResponseRead(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	mock.ExpectQuery("(?s)FROM student_attempts a.*schedule_staff_assignments").WithArgs("attempt-1", "org-1", "grader-1", auth.RoleGrader).
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_title", "version_number", "candidate_id", "candidate_name", "cohort_name", "delivery_status", "protocol_version", "response_revision", "outcome_status"}))
	mock.ExpectRollback()
	_, err = NewService(db).GetSATAttemptAnswers(context.Background(), auth.NewActorContext("grader-1", auth.RoleGrader).WithOrgID("org-1"), "attempt-1")
	if appErr, ok := apperrors.As(err); !ok || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("expected scoped not found, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

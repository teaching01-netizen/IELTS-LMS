package grading

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/auth"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func gradingSessionRows() *sqlmock.Rows {
	now := time.Date(2026, 3, 1, 12, 0, 0, 0, time.UTC)
	return sqlmock.NewRows([]string{
		"id", "schedule_id", "exam_id", "exam_title", "published_version_id",
		"cohort_name", "institution", "start_time", "end_time", "status",
		"total_students", "submitted_count", "pending_manual_reviews", "in_progress_reviews",
		"finalized_reviews", "overdue_reviews", "assigned_teachers",
		"created_at", "created_by", "updated_at",
	}).AddRow(
		"sess-1", "sched-1", "exam-1", "IELTS Mock", "ver-1",
		"Cohort A", "Campus", now, now, "live",
		10, 8, 2, 1, 5, 0, `[]`,
		now, "admin-1", now,
	)
}

// Legacy list clamps ?limit= above 500 down to 500 (limit clamp).
func TestGradingListSessionsClampsLimit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	mock.ExpectQuery(regexp.QuoteMeta("FROM grading_sessions")).
		WithArgs(500).WillReturnRows(gradingSessionRows())
	got, err := svc.ListSessions(context.Background(), auth.RoleAdmin, nil, nil, 9000)
	if err != nil {
		t.Fatalf("ListSessions must succeed: %v", err)
	}
	if len(got) != 1 || got[0].ID != "sess-1" || got[0].ScheduleID != "sched-1" {
		t.Fatalf("unexpected sessions: %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGradingSessionListIncludesACTProvider(t *testing.T) {
	where := sessionListWhere(auth.RoleAdmin, nil, nil, "")
	if !strings.Contains(where.clause, "e.provider_key IN ('ielts','act')") {
		t.Fatalf("grading queue provider scope = %q, want IELTS and ACT", where.clause)
	}
}

// A grader with no assignments sees no rows (WHERE 1=0, no stray binds).
func TestGradingListSessionsGraderWithoutAssignmentsEmpty(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	mock.ExpectQuery(regexp.QuoteMeta("FROM grading_sessions")).
		WithArgs(200).WillReturnRows(sqlmock.NewRows([]string{
		"id", "schedule_id", "exam_id", "exam_title", "published_version_id",
		"cohort_name", "institution", "start_time", "end_time", "status",
		"total_students", "submitted_count", "pending_manual_reviews", "in_progress_reviews",
		"finalized_reviews", "overdue_reviews", "assigned_teachers",
		"created_at", "created_by", "updated_at",
	}))
	got, err := svc.ListSessions(context.Background(), auth.RoleGrader, []string{}, nil, 0)
	if err != nil {
		t.Fatalf("ListSessions must succeed: %v", err)
	}
	if len(got) != 0 {
		t.Fatalf("grader without assignments must see no rows, got %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Unknown session id surfaces NOT_FOUND (detail NotFound).
func TestGradingSessionDetailNotFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := gradingSvc(db)
	mock.ExpectQuery(regexp.QuoteMeta("FROM grading_sessions")).
		WithArgs("sess-missing").WillReturnRows(sqlmock.NewRows([]string{
		"id", "schedule_id", "exam_id", "exam_title", "published_version_id",
		"cohort_name", "institution", "start_time", "end_time", "status",
		"total_students", "submitted_count", "pending_manual_reviews", "in_progress_reviews",
		"finalized_reviews", "overdue_reviews", "assigned_teachers",
		"created_at", "created_by", "updated_at",
	}))
	_, err = svc.GetSessionDetail(context.Background(), auth.RoleAdmin, nil, nil, "sess-missing", 1, 25)
	if e, ok := apperrors.As(err); !ok || e.Code != apperrors.CodeNotFound {
		t.Fatalf("expected NOT_FOUND for missing session, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

package proctor

import (
	"context"
	"regexp"
	"testing"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// ListSessions with no schedules returns an empty (non-nil) slice and only
// touches exam_schedules: every grouped-count / runtime / degraded query
// short-circuits on the empty id set, mirroring Rust load_grouped_counts.
func TestListSessionsEmptySchedules(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), db, nil, nil, nil)

	cols := "id, exam_id, provider_key, organization_id, exam_title, " +
		"proctor_display_name, grading_display_name, published_version_id, " +
		"cohort_name, institution, start_time, end_time, " +
		"planned_duration_minutes, delivery_mode, recurrence_type, " +
		"recurrence_interval, recurrence_end_date, buffer_before_minutes, " +
		"buffer_after_minutes, auto_start, auto_stop, status, created_at, " +
		"created_by, updated_at, revision"
	mock.ExpectQuery(regexp.QuoteMeta("SELECT " + cols)).
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "exam_id", "provider_key", "organization_id", "exam_title",
			"proctor_display_name", "grading_display_name", "published_version_id",
			"cohort_name", "institution", "start_time", "end_time",
			"planned_duration_minutes", "delivery_mode", "recurrence_type",
			"recurrence_interval", "recurrence_end_date", "buffer_before_minutes",
			"buffer_after_minutes", "auto_start", "auto_stop", "status", "created_at",
			"created_by", "updated_at", "revision",
		}))

	got, err := svc.ListSessions(context.Background(), Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}, true)
	if err != nil {
		t.Fatalf("ListSessions must succeed: %v", err)
	}
	if got == nil || len(got) != 0 {
		t.Fatalf("empty schedules must yield an empty non-nil slice, got %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// Non-reader roles see NOT_FOUND on session reads (anti-enumeration, same
// as the write gate).
func TestListSessionsRejectsStudent(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), db, nil, nil, nil)

	if _, err := svc.ListSessions(context.Background(), Actor{ID: "stu-1", Role: "student"}, true); err == nil {
		t.Fatal("student ListSessions must fail")
	}
	if _, err := svc.GetSessionDetail(context.Background(), Actor{ID: "stu-1", Role: "student"}, "sched-1", 0, 0); err == nil {
		t.Fatal("student GetSessionDetail must fail")
	}
}

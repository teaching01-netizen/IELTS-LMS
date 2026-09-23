package proctor

import (
	"context"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// scheduleProbeRows builds the 26-column session-schedule row with a
// non-live status (pages then skip the runtime load: 2 queries total).
func scheduleProbeRows() *sqlmock.Rows {
	cols := []string{"id", "exam_id", "provider_key", "organization_id", "exam_title", "proctor_display_name", "grading_display_name", "published_version_id", "cohort_name", "institution", "start_time", "end_time", "planned_duration_minutes", "delivery_mode", "recurrence_type", "recurrence_interval", "recurrence_end_date", "buffer_before_minutes", "buffer_after_minutes", "auto_start", "auto_stop", "status", "created_at", "created_by", "updated_at", "revision", "publish_scope"}
	now := time.Now().UTC()
	return sqlmock.NewRows(cols).AddRow(
		"sched-1", "exam-1", "ielts", nil, "Exam", "P", "G", "v-1", "cohort", nil, now, now, 60, "online", "none", 0, nil, nil, nil, false, false, "scheduled", now, "admin", now, 1, nil,
	)
}

// rosterPageRows builds full 29-column roster rows (scanStudentSessionRow
// shape) so the page hydrates real summaries: the live attempt columns include
// the runtime identity fence (sa.revision + the active SAT module attempt's id,
// module id and revision) the proctor merge orders projections by.
func rosterPageRows() *sqlmock.Rows {
	cols := []string{"id", "candidate_id", "candidate_name", "candidate_email", "schedule_id", "current_module", "phase", "integrity", "violations_snapshot", "exam_id", "exam_title", "updated_at", "proctor_status", "last_warning_id", "last_heartbeat_at", "last_heartbeat_status", "provider_key", "title", "module_key", "adaptive_role", "started_at", "paused_at", "allocated_seconds", "extension_seconds", "accumulated_paused_seconds", "revision", "id", "module_id", "revision"}
	return sqlmock.NewRows(cols).
		AddRow("att-3", "c3", "Cara", "c@x", "sched-1", "listening", "live", `{}`, `[]`, "exam-1", "Exam", time.Now().UTC(), "active", nil, nil, nil, "ielts", nil, nil, nil, nil, nil, nil, nil, nil, int64(3), nil, nil, nil).
		AddRow("att-2", "c2", "Bob", "b@x", "sched-1", "listening", "live", `{}`, `[]`, "exam-1", "Exam", time.Now().UTC(), "active", nil, nil, nil, "ielts", nil, nil, nil, nil, nil, nil, nil, nil, int64(2), nil, nil, nil).
		AddRow("att-1", "c1", "Ann", "a@x", "sched-1", "listening", "live", `{}`, `[]`, "exam-1", "Exam", time.Now().UTC(), "active", nil, nil, nil, "ielts", nil, nil, nil, nil, nil, nil, nil, nil, int64(1), nil, nil, nil)
}

// D4 RED: cursor page returns rows + next cursor (no gaps/dups contract:
// keyset on (updated_at, id), limit+1 probe).
func TestLoadStudentSessionsPage(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(nil, db, nil, nil, nil)
	mock.ExpectQuery("FROM exam_schedules WHERE id").
		WithArgs("sched-1").
		WillReturnRows(scheduleProbeRows())
	mock.ExpectQuery("ORDER BY sa.updated_at").
		WithArgs("sched-1", 3).
		WillReturnRows(rosterPageRows())
	page, err := svc.LoadStudentSessionsPage(context.Background(), "sched-1", RosterCursor{}, 2, "")
	if err != nil {
		t.Fatalf("page: %v", err)
	}
	if len(page.Rows) != 2 || !page.HasMore {
		t.Fatalf("limit+1 probe must signal more: %+v", page)
	}
	if page.Next.UpdatedAt.IsZero() || page.Next.ID == "" {
		t.Fatalf("next cursor must advance: %+v", page.Next)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// D4 RED: status filter narrows (no full-cohort scan for filtered views).
func TestLoadStudentSessionsPageStatusFilter(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(nil, db, nil, nil, nil)
	mock.ExpectQuery("FROM exam_schedules WHERE id").
		WithArgs("sched-1").
		WillReturnRows(scheduleProbeRows())
	mock.ExpectQuery("delivery_status").
		WithArgs("sched-1", "submitted", 11).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))
	page, err := svc.LoadStudentSessionsPage(context.Background(), "sched-1", RosterCursor{}, 10, "submitted")
	if err != nil {
		t.Fatalf("page: %v", err)
	}
	if len(page.Rows) != 0 || page.HasMore {
		t.Fatalf("empty page must not signal more: %+v", page)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

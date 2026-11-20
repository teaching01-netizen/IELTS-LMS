package proctor

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"errors"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// sessionScheduleMockCols mirrors the explicit exam_schedules projection the
// query scans (sessionScheduleColumns), so a mocked schedule row scans.
func sessionScheduleMockCols() []string {
	return []string{
		"id", "exam_id", "provider_key", "organization_id", "exam_title",
		"proctor_display_name", "grading_display_name", "published_version_id",
		"cohort_name", "institution", "start_time", "end_time",
		"planned_duration_minutes", "delivery_mode", "recurrence_type",
		"recurrence_interval", "recurrence_end_date", "buffer_before_minutes",
		"buffer_after_minutes", "auto_start", "auto_stop", "status", "created_at",
		"created_by", "updated_at", "revision", "publish_scope", "sat_timing_model",
		"ielts_timing_model", "sat_start_mode",
	}
}

// sessionScheduleMockRow is one scannable exam_schedules row for id.
func sessionScheduleMockRow(id string) *sqlmock.Rows {
	now := time.Now().UTC()
	return sqlmock.NewRows(sessionScheduleMockCols()).AddRow(
		id, "exam-1", "sat", nil, "Practice", "Practice", "Practice", "pv-1", "Morning", nil,
		now, now.Add(4*time.Hour), 180, "proctor_start", "none", 1, nil, nil, nil, false, false, "scheduled",
		now, "admin", now, 0, "reading-writing", "sat_personal_v1", "", "proctor",
	)
}

// recordingSessionQuerier delegates to the real *sql.DB (and therefore the
// sqlmock expectations) while capturing the exact SQL and args the production
// query builder emitted, so the tests can assert on predicate content rather
// than trusting the mock pattern alone.
type recordingSessionQuerier struct {
	sessionQuerier
	query string
	args  []any
}

func (r *recordingSessionQuerier) QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error) {
	r.query = query
	r.args = args
	return r.sessionQuerier.QueryContext(ctx, query, args...)
}

const legacySessionSchedulesQuery = "SELECT " + sessionScheduleColumns + " FROM exam_schedules ORDER BY start_time ASC, created_at DESC"

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

	// Zero scope must still issue the legacy query byte-for-byte, with no
	// bound scope arguments.
	mock.ExpectQuery(regexp.QuoteMeta(legacySessionSchedulesQuery)).
		WithoutArgs().
		WillReturnRows(sqlmock.NewRows(sessionScheduleMockCols()))

	got, err := svc.ListSessions(context.Background(), Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}, true, SessionListScope{})
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

// TestLoadSessionSchedulesScopeSQL pins the semijoin predicates: provider and
// proctor scopes are pushed into the schedule query (before runtimes and
// grouped counts), compose with AND, bind one argument each, and the zero
// scope renders the legacy query exactly.
func TestLoadSessionSchedulesScopeSQL(t *testing.T) {
	providerPredicate := "EXISTS (SELECT 1 FROM exam_entities WHERE exam_entities.id = exam_schedules.exam_id AND exam_entities.provider_key = ?)"
	assignmentPredicate := "EXISTS (SELECT 1 FROM schedule_staff_assignments WHERE schedule_staff_assignments.schedule_id = exam_schedules.id AND schedule_staff_assignments.user_id = ? AND schedule_staff_assignments.role = 'proctor' AND schedule_staff_assignments.revoked_at IS NULL)"

	cases := []struct {
		name      string
		scope     sessionScheduleScope
		wantQuery string
		wantArgs  []driver.Value
		check     func(t *testing.T, query string, args []any)
	}{
		{
			name:      "zero scope is the legacy query",
			scope:     sessionScheduleScope{},
			wantQuery: legacySessionSchedulesQuery,
			wantArgs:  nil,
			check: func(t *testing.T, query string, args []any) {
				t.Helper()
				if query != legacySessionSchedulesQuery {
					t.Fatalf("zero scope query diverged from legacy:\n got: %s\nwant: %s", query, legacySessionSchedulesQuery)
				}
				if len(args) != 0 {
					t.Fatalf("zero scope must bind no arguments, got %v", args)
				}
			},
		},
		{
			name:      "provider only",
			scope:     sessionScheduleScope{ProviderKey: "sat"},
			wantQuery: "SELECT " + sessionScheduleColumns + " FROM exam_schedules WHERE " + providerPredicate + " ORDER BY start_time ASC, created_at DESC",
			wantArgs:  []driver.Value{"sat"},
			check: func(t *testing.T, query string, args []any) {
				t.Helper()
				if !strings.Contains(query, "EXISTS (SELECT 1 FROM exam_entities") {
					t.Fatalf("provider scope must use the exam_entities semijoin, got: %s", query)
				}
				if strings.Contains(query, "schedule_staff_assignments") {
					t.Fatalf("provider-only scope must not add the assignment predicate, got: %s", query)
				}
				if len(args) != 1 || args[0] != "sat" {
					t.Fatalf("provider scope must bind only the provider key, got %v", args)
				}
			},
		},
		{
			name:      "proctor only",
			scope:     sessionScheduleScope{ProctorUserID: ptrString("proctor-1")},
			wantQuery: "SELECT " + sessionScheduleColumns + " FROM exam_schedules WHERE " + assignmentPredicate + " ORDER BY start_time ASC, created_at DESC",
			wantArgs:  []driver.Value{"proctor-1"},
			check: func(t *testing.T, query string, args []any) {
				t.Helper()
				if !strings.Contains(query, "EXISTS (SELECT 1 FROM schedule_staff_assignments") {
					t.Fatalf("proctor scope must use the assignment semijoin, got: %s", query)
				}
				for _, fragment := range []string{"role = 'proctor'", "revoked_at IS NULL"} {
					if !strings.Contains(query, fragment) {
						t.Fatalf("proctor assignment predicate must contain %q, got: %s", fragment, query)
					}
				}
				if strings.Contains(query, "exam_entities") {
					t.Fatalf("proctor-only scope must not add the provider predicate, got: %s", query)
				}
				if len(args) != 1 || args[0] != "proctor-1" {
					t.Fatalf("proctor scope must bind only the proctor user id, got %v", args)
				}
			},
		},
		{
			name:      "provider and proctor compose with AND",
			scope:     sessionScheduleScope{ProviderKey: "sat", ProctorUserID: ptrString("proctor-1")},
			wantQuery: "SELECT " + sessionScheduleColumns + " FROM exam_schedules WHERE " + providerPredicate + " AND " + assignmentPredicate + " ORDER BY start_time ASC, created_at DESC",
			wantArgs:  []driver.Value{"sat", "proctor-1"},
			check: func(t *testing.T, query string, args []any) {
				t.Helper()
				providerAt := strings.Index(query, providerPredicate)
				assignmentAt := strings.Index(query, assignmentPredicate)
				if providerAt < 0 || assignmentAt < 0 {
					t.Fatalf("composed scope must contain both predicates, got: %s", query)
				}
				if providerAt > assignmentAt {
					t.Fatalf("composed scope must keep provider then assignment order, got: %s", query)
				}
				if !strings.Contains(query, providerPredicate+" AND "+assignmentPredicate) {
					t.Fatalf("composed scope must join predicates with AND, got: %s", query)
				}
				if len(args) != 2 || args[0] != "sat" || args[1] != "proctor-1" {
					t.Fatalf("composed scope must bind provider then proctor, got %v", args)
				}
			},
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			rec := &recordingSessionQuerier{sessionQuerier: db}
			expectation := mock.ExpectQuery(regexp.QuoteMeta(tc.wantQuery))
			if len(tc.wantArgs) > 0 {
				expectation = expectation.WithArgs(tc.wantArgs...)
			} else {
				expectation = expectation.WithoutArgs()
			}
			expectation.WillReturnRows(sessionScheduleMockRow("sched-1"))

			got, err := loadSessionSchedules(context.Background(), rec, tc.scope)
			if err != nil {
				t.Fatalf("loadSessionSchedules must succeed: %v", err)
			}
			if len(got) != 1 || got[0].ID != "sched-1" {
				t.Fatalf("want the mocked schedule row, got %+v", got)
			}
			if rec.query != tc.wantQuery {
				t.Fatalf("emitted query:\n got: %s\nwant: %s", rec.query, tc.wantQuery)
			}
			tc.check(t, rec.query, rec.args)
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

// TestListSessionsScheduleQueryFailsClosed proves a synthetic MySQL error on
// the schedule selection returns an error and no partial summaries, instead of
// serving an empty or partial room list.
func TestListSessionsScheduleQueryFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := NewService(tx.NewRunner(db), db, nil, nil, nil)

	boom := errors.New("synthetic mysql failure")
	mock.ExpectQuery(regexp.QuoteMeta(legacySessionSchedulesQuery)).
		WithoutArgs().
		WillReturnError(boom)

	got, err := svc.ListSessions(context.Background(), Actor{ID: "admin-1", Role: RoleAdmin, CSRFVerified: true}, true, SessionListScope{})
	if err == nil {
		t.Fatalf("a failed schedule query must fail the list, got %d summaries", len(got))
	}
	if !errors.Is(err, boom) {
		t.Fatalf("the SQL error must surface, got %v", err)
	}
	if got != nil {
		t.Fatalf("a failed schedule query must return no partial summaries, got %+v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// ptrString returns a pointer to v for scope literals.
func ptrString(v string) *string { return &v }

func TestLoadSessionScheduleIncludesPinnedSATScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT " + sessionScheduleColumns + " FROM exam_schedules WHERE id = ?")).
		WithArgs("sched-1").
		WillReturnRows(sessionScheduleMockRow("sched-1"))

	schedule, err := loadSessionSchedule(context.Background(), db, "sched-1")
	if err != nil {
		t.Fatalf("loadSessionSchedule must succeed: %v", err)
	}
	if schedule.PublishScope != "reading-writing" {
		t.Fatalf("session schedule must carry its immutable version scope, got %q", schedule.PublishScope)
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

	if _, err := svc.ListSessions(context.Background(), Actor{ID: "stu-1", Role: "student"}, true, SessionListScope{ProviderKey: "sat"}); err == nil {
		t.Fatal("student ListSessions must fail")
	}
	if _, err := svc.GetSessionDetail(context.Background(), Actor{ID: "stu-1", Role: "student"}, "sched-1", 0, 0); err == nil {
		t.Fatal("student GetSessionDetail must fail")
	}
}

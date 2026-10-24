package proctor

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	platformdb "example.com/ielts-proctoring/internal/platform/db"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// TestRosterPageReadsOnlyItsPageMySQL pins the staff roster page on a
// 2,000-candidate room next to a second room. Keyset paging must return every
// row of the room exactly once in (updated_at, id) order, including ties on
// updated_at; and with migration 0102 applied, each page must be chosen from
// the index in order (one page of index entries, no sort of the room) and
// hydrate only its own rows. The plans and per-page timing are logged as
// qualification evidence.
func TestRosterPageReadsOnlyItsPageMySQL(t *testing.T) {
	raw := os.Getenv("TEST_MYSQL_DSN")
	if raw == "" {
		t.Skip("TEST_MYSQL_DSN not set; requires isolated MySQL")
	}
	dsn, err := platformdb.NormalizeDSN(raw)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("mysql", dsn)
	if err != nil {
		t.Fatal(err)
	}
	// A cleanup, not a defer: the row cleanups below run after the test
	// returns and need the pool.
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(4)
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable: %v", err)
	}
	defer conn.Close()
	// The page reads attempts, the exam row and optional joins; skip the
	// unrelated parents of the synthetic rows.
	if _, err := conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS = 0"); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS = 1")

	const roomSize = 2000
	base := time.Now().UTC().Truncate(time.Second)
	examID := uuid.NewString()
	scheduleIDs := []string{uuid.NewString(), uuid.NewString()}
	runtimeIDs := []string{uuid.NewString(), uuid.NewString()}
	t.Cleanup(func() {
		for i, scheduleID := range scheduleIDs {
			if _, err := db.ExecContext(ctx, "DELETE FROM student_attempts WHERE schedule_id = ?", scheduleID); err != nil {
				t.Errorf("cleanup: %v", err)
			}
			if _, err := db.ExecContext(ctx, "DELETE FROM exam_session_runtime_sections WHERE runtime_id = ?", runtimeIDs[i]); err != nil {
				t.Errorf("cleanup: %v", err)
			}
			if _, err := db.ExecContext(ctx, "DELETE FROM exam_session_runtimes WHERE id = ?", runtimeIDs[i]); err != nil {
				t.Errorf("cleanup: %v", err)
			}
			if _, err := db.ExecContext(ctx, "DELETE FROM exam_schedules WHERE id = ?", scheduleID); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
		if _, err := db.ExecContext(ctx, "DELETE FROM exam_entities WHERE id = ?", examID); err != nil {
			t.Errorf("cleanup: %v", err)
		}
	})
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	exec(`INSERT INTO exam_entities (id, slug, title, provider_key, provider_exam_type, exam_type, status, visibility, organization_id, owner_id, schema_version, revision)
		VALUES (?, ?, 'roster plan', 'ielts', 'IELTS', 'Academic', 'published', 'organization', 'roster-plan-org', 'roster-plan', 1, 0)`, examID, examID)
	for i, scheduleID := range scheduleIDs {
		exec(`INSERT INTO exam_schedules (id, exam_id, provider_key, organization_id, exam_title, proctor_display_name, grading_display_name, published_version_id,
				cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, status, created_by, ielts_timing_model)
			VALUES (?, ?, 'ielts', 'roster-plan-org', 'roster plan', 'roster plan', 'roster plan', ?, 'roster-plan', 'Codex',
				UTC_TIMESTAMP() - INTERVAL 1 HOUR, UTC_TIMESTAMP() + INTERVAL 4 HOUR, 180, 'proctor_start', 'live', 'roster-plan', ?)`,
			scheduleID, examID, uuid.NewString(), examruntime.TimingModelIELTSPersonal)
		exec(`INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model, actual_start_at, active_section_key)
			VALUES (?, ?, ?, 'ielts', 'live', '{}', ?, UTC_TIMESTAMP(6) - INTERVAL 10 MINUTE, 'listening')`, runtimeIDs[i], scheduleID, examID, examruntime.TimingModelIELTSPersonal)
		exec(`INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, label, section_order, planned_duration_minutes, status, actual_start_at)
			VALUES (?, ?, 'listening', 'Listening', 0, 30, 'live', UTC_TIMESTAMP(6) - INTERVAL 10 MINUTE)`, uuid.NewString(), runtimeIDs[i])
		for start := 0; start < roomSize; start += 250 {
			var b strings.Builder
			args := []any{}
			b.WriteString(`INSERT INTO student_attempts (id, schedule_id, student_key, exam_id, published_version_id, exam_title, candidate_id, candidate_name, candidate_email,
				phase, current_module, answers, writing_answers, flags, violations_snapshot, integrity, recovery, delivery_status, updated_at) VALUES `)
			for n := start; n < start+250; n++ {
				if n > start {
					b.WriteString(", ")
				}
				// Spread activity times with ties: groups of three attempts share
				// one updated_at, so the id tiebreak is exercised. Every seventh
				// attempt has submitted, for the status filter.
				b.WriteString(`(?, ?, ?, ?, ?, 'roster plan', ?, ?, 'c@example.test', 'exam', 'listening', '{}', '{}', '{}', '[]', '{}', '{}', ?, ? - INTERVAL ? MICROSECOND)`)
				id := uuid.NewString()
				delivery := "running"
				if n%7 == 0 {
					delivery = "submitted"
				}
				args = append(args, id, scheduleID, id, examID, uuid.NewString(), fmt.Sprintf("C%04d", n), fmt.Sprintf("Candidate %04d", n), delivery, base, ((n/3)*7919)%3_600_000_000)
			}
			exec(b.String(), args...)
		}
	}
	exec("ANALYZE TABLE student_attempts")

	scheduleID := scheduleIDs[0]
	svc := NewService(nil, db, nil, nil, SQLAssignmentChecker{})

	// Independent order: every attempt of the room, as the keyset defines it.
	orderedIDs := func(status string) []string {
		t.Helper()
		query := `SELECT id FROM student_attempts WHERE schedule_id = ?`
		args := []any{scheduleID}
		if status != "" {
			query += ` AND COALESCE(delivery_status, 'running') = ?`
			args = append(args, status)
		}
		rows, err := conn.QueryContext(ctx, query+` ORDER BY updated_at, id`, args...)
		if err != nil {
			t.Fatal(err)
		}
		defer rows.Close()
		var ids []string
		for rows.Next() {
			var id string
			if err := rows.Scan(&id); err != nil {
				t.Fatal(err)
			}
			ids = append(ids, id)
		}
		return ids
	}
	for _, status := range []string{"", "submitted"} {
		want := orderedIDs(status)
		var got []string
		cursor := RosterCursor{}
		for pages := 0; ; pages++ {
			page, err := svc.LoadStudentSessionsPage(ctx, scheduleID, cursor, 50, status)
			if err != nil {
				t.Fatal(err)
			}
			for _, row := range page.Rows {
				got = append(got, row.AttemptID)
			}
			if !page.HasMore {
				break
			}
			if pages > roomSize {
				t.Fatal("keyset paging does not terminate")
			}
			cursor = page.Next
		}
		if strings.Join(got, ",") != strings.Join(want, ",") {
			t.Fatalf("status %q: keyset paging returned %d rows, want the room's %d in (updated_at, id) order", status, len(got), len(want))
		}
	}

	var indexed bool
	if err := conn.QueryRowContext(ctx, `SELECT COUNT(*) > 0 FROM information_schema.statistics
		WHERE table_schema = DATABASE() AND table_name = 'student_attempts' AND index_name = 'idx_student_attempts_schedule_roster'`).Scan(&indexed); err != nil {
		t.Fatal(err)
	}
	var cursorAt time.Time
	var cursorID string
	if err := conn.QueryRowContext(ctx, `SELECT updated_at, id FROM student_attempts WHERE schedule_id = ? ORDER BY updated_at, id LIMIT 1 OFFSET 1000`, scheduleID).Scan(&cursorAt, &cursorID); err != nil {
		t.Fatal(err)
	}
	for _, page := range []struct {
		name   string
		cursor RosterCursor
	}{
		{"first page", RosterCursor{}},
		{"cursor page", RosterCursor{UpdatedAt: cursorAt, ID: cursorID}},
	} {
		query, args := rosterPageQuery(scheduleID, page.cursor, 50, "")
		var plan string
		if err := conn.QueryRowContext(ctx, "EXPLAIN ANALYZE "+query, args...).Scan(&plan); err != nil {
			t.Fatal(err)
		}
		t.Logf("%s plan:\n%s", page.name, plan)
		const pages = 20
		started := time.Now()
		for i := 0; i < pages; i++ {
			got, err := svc.LoadStudentSessionsPage(ctx, scheduleID, page.cursor, 50, "")
			if err != nil || len(got.Rows) != 50 || !got.HasMore {
				t.Fatalf("%s: %d rows hasMore=%v err=%v", page.name, len(got.Rows), got.HasMore, err)
			}
		}
		t.Logf("%s: %.2f ms per LoadStudentSessionsPage (roster index present: %v)", page.name, float64(time.Since(started).Microseconds())/1000/pages, indexed)
		// Hydration joins run once per page row, never once per room row.
		if strings.Contains(plan, fmt.Sprintf("loops=%d)", roomSize)) {
			t.Errorf("%s hydrates the whole room before LIMIT", page.name)
		}
		// Without the index the page sorts the room's own entries; it must
		// never walk a global (updated_at, id) index across all schedules.
		if strings.Contains(plan, "Index scan on page_sa") {
			t.Errorf("%s scans attempts beyond its schedule", page.name)
		}
		if indexed && (strings.Contains(plan, "Sort: page_sa.") || !strings.Contains(plan, "using idx_student_attempts_schedule_roster")) {
			t.Errorf("%s does not read its page from idx_student_attempts_schedule_roster in order", page.name)
		}
	}
}

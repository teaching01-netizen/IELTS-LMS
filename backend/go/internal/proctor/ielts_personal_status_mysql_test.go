package proctor

import (
	"context"
	"database/sql"
	"os"
	"reflect"
	"strings"
	"testing"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/google/uuid"

	platformdb "example.com/ielts-proctoring/internal/platform/db"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// legacyIELTSRosterQuery is the correlated per-row roster discovery the page
// loader replaced; it is the oracle for TestIELTSRosterPageLoaderMatchesCorrelatedQueryMySQL.
const legacyIELTSRosterQuery = `SELECT a.id, COALESCE(open_section.section_key, next_section.section_key, last_section.section_key, ''),
	COALESCE(open_section.state, last_section.state, ''), COALESCE(rt.status, ''),
	COALESCE(rt.completion_reason, ''), COALESCE(a.delivery_status, 'running'), a.submitted_at,
	COALESCE(open_section.section_order, last_section.section_order, next_section.section_order, -1),
	COALESCE((SELECT MAX(last_order.section_order) FROM exam_session_runtime_sections last_order WHERE last_order.runtime_id = rt.id), -1),
	COALESCE(open_section.expected_start_at, last_section.expected_start_at),
	COALESCE(open_section.started_at, last_section.started_at),
	COALESCE(open_section.deadline_at, last_section.deadline_at)
	FROM student_attempts a
	JOIN exam_session_runtimes rt ON rt.schedule_id = a.schedule_id AND rt.timing_model IN (` + examruntime.IELTSPersonalTimingModelsSQL + `)
	LEFT JOIN ielts_attempt_section_timelines open_section ON open_section.id = (
		SELECT current_timeline.id FROM ielts_attempt_section_timelines current_timeline
		WHERE current_timeline.attempt_id = a.id AND current_timeline.state <> 'completed'
		ORDER BY current_timeline.section_order DESC LIMIT 1
	)
	LEFT JOIN ielts_attempt_section_timelines last_section ON last_section.id = (
		SELECT completed_timeline.id FROM ielts_attempt_section_timelines completed_timeline
		WHERE completed_timeline.attempt_id = a.id AND completed_timeline.state = 'completed'
		ORDER BY completed_timeline.section_order DESC LIMIT 1
	)
	LEFT JOIN exam_session_runtime_sections next_section ON next_section.id = (
		SELECT candidate_section.id FROM exam_session_runtime_sections candidate_section
		WHERE candidate_section.runtime_id = rt.id
		  AND NOT EXISTS (
			SELECT 1 FROM ielts_attempt_section_timelines completed_candidate
			WHERE completed_candidate.attempt_id = a.id
			  AND completed_candidate.section_key = candidate_section.section_key
			  AND completed_candidate.state = 'completed'
		  )
		ORDER BY candidate_section.section_order ASC LIMIT 1
	)
	WHERE a.id IN (`

func TestIELTSRosterPageLoaderMatchesCorrelatedQueryMySQL(t *testing.T) {
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
	defer db.Close()
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable: %v", err)
	}
	defer conn.Close()
	// The comparison needs only the four roster tables; skip their parents.
	if _, err := conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS = 0"); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS = 1")

	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	scheduleID, runtimeID := uuid.NewString(), uuid.NewString()
	base := time.Now().UTC().Truncate(time.Second).Add(-time.Hour)
	exec(`INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model) VALUES (?, ?, ?, 'ielts', 'live', '{}', ?)`,
		runtimeID, scheduleID, uuid.NewString(), examruntime.TimingModelIELTSPersonal)
	for order, key := range []string{"listening", "reading", "writing"} {
		exec(`INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, label, section_order, planned_duration_minutes, status) VALUES (?, ?, ?, ?, ?, 30, 'live')`,
			uuid.NewString(), runtimeID, key, key, order)
	}
	type tl struct {
		key, state string
		order      int
		started    bool
	}
	shapes := [][]tl{
		{},
		{{"listening", "preparing", 0, false}},
		{{"listening", "active", 0, true}},
		{{"listening", "completed", 0, true}, {"reading", "preparing", 1, false}},
		{{"listening", "completed", 0, true}, {"reading", "completed", 1, true}, {"writing", "completed", 2, true}},
		{{"listening", "unable", 0, false}},
		{{"listening", "completed", 0, true}, {"reading", "active", 1, true}},
		{{"listening", "completed", 0, true}},
		{{"reading", "completed", 1, true}},
	}
	var sessions []StudentSessionSummary
	var ids []any
	for i, shape := range shapes {
		attemptID := uuid.NewString()
		delivery := "running"
		if i == 4 {
			delivery = "submitted"
		}
		exec(`INSERT INTO student_attempts (id, schedule_id, student_key, exam_id, published_version_id, exam_title, candidate_id, candidate_name, candidate_email, phase, current_module, answers, writing_answers, flags, violations_snapshot, integrity, recovery, delivery_status)
			VALUES (?, ?, ?, ?, ?, 't', 'c', 'n', 'e', 'exam', 'listening', '{}', '{}', '{}', '[]', '{}', '{}', ?)`,
			attemptID, scheduleID, attemptID, uuid.NewString(), uuid.NewString(), delivery)
		for _, timeline := range shape {
			expected := base.Add(time.Duration(timeline.order) * 40 * time.Minute)
			var started, deadline any
			if timeline.started {
				started, deadline = expected.Add(time.Minute), expected.Add(31*time.Minute)
			}
			exec(`INSERT INTO ielts_attempt_section_timelines (id, attempt_id, runtime_id, section_key, section_order, state, expected_start_at, preparation_deadline_at, started_at, deadline_at)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				uuid.NewString(), attemptID, runtimeID, timeline.key, timeline.order, timeline.state, expected, expected.Add(2*time.Minute), started, deadline)
		}
		sessions = append(sessions, StudentSessionSummary{AttemptID: attemptID})
		ids = append(ids, attemptID)
	}
	t.Cleanup(func() {
		cleanup := []string{
			"DELETE FROM ielts_attempt_section_timelines WHERE runtime_id = ?",
			"DELETE FROM exam_session_runtime_sections WHERE runtime_id = ?",
		}
		for _, q := range cleanup {
			_, _ = db.ExecContext(ctx, q, runtimeID)
		}
		_, _ = db.ExecContext(ctx, "DELETE FROM student_attempts WHERE schedule_id = ?", scheduleID)
		_, _ = db.ExecContext(ctx, "DELETE FROM exam_session_runtimes WHERE id = ?", runtimeID)
	})

	rows, err := conn.QueryContext(ctx, legacyIELTSRosterQuery+strings.TrimSuffix(strings.Repeat("?,", len(ids)), ",")+")", ids...)
	if err != nil {
		t.Fatal(err)
	}
	want := map[string]ieltsPersonalRosterState{}
	for rows.Next() {
		var attemptID string
		var state ieltsPersonalRosterState
		if err := rows.Scan(&attemptID, &state.sectionKey, &state.state, &state.runtime, &state.reason,
			&state.delivery, &state.submitted, &state.order, &state.lastOrder,
			&state.expected, &state.started, &state.deadline); err != nil {
			t.Fatal(err)
		}
		want[attemptID] = state
	}
	rows.Close()
	got, err := loadIELTSPersonalRosterStates(ctx, conn, sessions, time.Now().UTC())
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != len(shapes) || len(want) != len(shapes) {
		t.Fatalf("rows: got %d want %d (shapes %d)", len(got), len(want), len(shapes))
	}
	for i, session := range sessions {
		if !reflect.DeepEqual(got[session.AttemptID], want[session.AttemptID]) {
			t.Errorf("shape %d:\n page loader = %+v\n correlated  = %+v", i, got[session.AttemptID], want[session.AttemptID])
		}
	}
}

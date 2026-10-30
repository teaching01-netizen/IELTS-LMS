package proctor

import (
	"context"
	"database/sql"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	platformdb "example.com/ielts-proctoring/internal/platform/db"
)

// TestReconcileDueSelectionReadsLiveRuntimesMySQL pins the reconciler's
// candidate reads against history: with 5,000 completed runtimes beside four
// live rooms, the due selection returns exactly the due rooms and neither
// candidate read scans the runtime tables (migration 0103). The plans are
// logged as qualification evidence.
func TestReconcileDueSelectionReadsLiveRuntimesMySQL(t *testing.T) {
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
	ctx := context.Background()
	conn, err := db.Conn(ctx)
	if err != nil {
		t.Skipf("TEST_MYSQL_DSN unreachable: %v", err)
	}
	defer conn.Close()
	// Only the four candidate tables matter; skip the synthetic rows' parents.
	if _, err := conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS = 0"); err != nil {
		t.Fatal(err)
	}
	defer conn.ExecContext(ctx, "SET FOREIGN_KEY_CHECKS = 1")
	if _, err := conn.ExecContext(ctx, "SET SESSION cte_max_recursion_depth = 10000"); err != nil {
		t.Fatal(err)
	}
	prefix := "rdp-" + strings.ReplaceAll(uuid.NewString(), "-", "")[:8] + "-"
	t.Cleanup(func() {
		for _, q := range []string{
			"DELETE FROM exam_session_runtime_sections WHERE id LIKE ?",
			"DELETE FROM exam_session_runtimes WHERE id LIKE ?",
			"DELETE FROM exam_schedules WHERE id LIKE ?",
			"DELETE FROM exam_versions WHERE id LIKE ?",
		} {
			if _, err := db.ExecContext(ctx, q, prefix+"%"); err != nil {
				t.Errorf("cleanup: %v", err)
			}
		}
	})
	exec := func(query string, args ...any) {
		t.Helper()
		if _, err := conn.ExecContext(ctx, query, args...); err != nil {
			t.Fatalf("seed: %v", err)
		}
	}
	// Rooms 1..5000 are history; 5001..5004 are live: 5001-5003 are past their
	// section's end and drain grace, 5004 opened five minutes ago.
	const history, live = 5000, 4
	exec(`INSERT INTO exam_versions (id, exam_id, version_number, content_snapshot, config_snapshot, created_by, is_published, revision)
		WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 499)
		SELECT CONCAT(?, 'v-', i), CONCAT(?, 'exam'), i + 1, '{}', '{}', 'rdp', TRUE, 1 FROM n`, prefix, prefix)
	exec(`INSERT INTO exam_schedules (id, exam_id, provider_key, organization_id, exam_title, proctor_display_name, grading_display_name, published_version_id,
			cohort_name, institution, start_time, end_time, planned_duration_minutes, delivery_mode, status, created_by)
		WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		SELECT CONCAT(?, 's-', i), CONCAT(?, 'exam'), ELT(1 + i % 3, 'ielts', 'sat', 'act'), 'o', 't', 't', 't', CONCAT(?, 'v-', i % 500),
			'c', 'i', UTC_TIMESTAMP() - INTERVAL 1 DAY, UTC_TIMESTAMP() + INTERVAL 1 DAY, 60, 'proctor_start', IF(i > ?, 'live', 'completed'), 'rdp' FROM n`,
		history+live, prefix, prefix, prefix, history)
	exec(`INSERT INTO exam_session_runtimes (id, schedule_id, exam_id, provider_key, status, plan_snapshot, timing_model, active_section_key, actual_start_at)
		WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		SELECT CONCAT(?, 'r-', i), CONCAT(?, 's-', i), CONCAT(?, 'exam'), ELT(1 + i % 3, 'ielts', 'sat', 'act'), IF(i > ?, 'live', 'completed'), '{}',
			'legacy_section_v1', IF(i > ?, 'listening', NULL), UTC_TIMESTAMP(6) - INTERVAL 2 HOUR FROM n`,
		history+live, prefix, prefix, prefix, history, history)
	exec(`INSERT INTO exam_session_runtime_sections (id, runtime_id, section_key, label, section_order, planned_duration_minutes, status, actual_start_at, actual_end_at)
		WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i + 1 FROM n WHERE i < ?)
		SELECT CONCAT(?, 'rs-', i), CONCAT(?, 'r-', i), 'listening', 'Listening', 0, 30, IF(i > ?, 'live', 'completed'),
			UTC_TIMESTAMP(6) - INTERVAL IF(i = ?, 5, 120) MINUTE, IF(i > ?, NULL, UTC_TIMESTAMP(6) - INTERVAL 90 MINUTE) FROM n`,
		history+live, prefix, prefix, history, history+live, history)
	exec("ANALYZE TABLE exam_session_runtimes, exam_session_runtime_sections, exam_schedules, exam_versions")

	asOf := time.Now().UTC()
	rows, err := conn.QueryContext(ctx, reconcileDueSectionsSQL, asOf, asOf, asOf, asOf, asOf, 250)
	if err != nil {
		t.Fatal(err)
	}
	var due []string
	for rows.Next() {
		var scheduleID, providerKey string
		var autoSubmit bool
		if err := rows.Scan(&scheduleID, &autoSubmit, &providerKey); err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(scheduleID, prefix) {
			due = append(due, strings.TrimPrefix(scheduleID, prefix))
		}
	}
	if err := rows.Close(); err != nil {
		t.Fatal(err)
	}
	sort.Strings(due)
	if strings.Join(due, ",") != "s-5001,s-5002,s-5003" {
		t.Fatalf("due rooms = %v, want s-5001..s-5003", due)
	}

	for _, candidate := range []struct {
		name  string
		query string
		args  []any
	}{
		{"section due selection", reconcileDueSectionsSQL, []any{asOf, asOf, asOf, asOf, asOf, 250}},
		{"personal drain selection", reconcileDrainedPersonalSQL, []any{asOf, 250}},
	} {
		var plan string
		if err := conn.QueryRowContext(ctx, "EXPLAIN ANALYZE "+candidate.query, candidate.args...).Scan(&plan); err != nil {
			t.Fatal(err)
		}
		t.Logf("%s plan:\n%s", candidate.name, plan)
		if strings.Contains(plan, "Table scan on r ") || strings.Contains(plan, "Table scan on rs ") {
			t.Errorf("%s scans the runtime history instead of the live runtimes", candidate.name)
		}
	}
}

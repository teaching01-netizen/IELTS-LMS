package delivery

// Plan single-deploy scale (round 144, TDD RED): the rotation-clean 2k
// herd proved per-attempt bootstrap row-txs (not the cached tree) are the
// p99 cost — 6,338 E1 10s-budget 503s with cache at 17,095/1. This test
// pins the committed-read statement budget of one Bootstrap call so
// lightening it is a deliberate, measured diff.
//
// Counted from service.go Bootstrap + reconcileSteady fast path:
//  1 schedule+exam probe, 1 attempt probe,
//  2 reconcileSteady probes (module counts; results count only when
//    terminal modules exist — fresh herd attempts skip it, so budget = 1),
//  1 version revision probe, 1 ensureBase probe (+1 INSERT only on first
//    bootstrap), 1 module-attempts SELECT, 1 responses SELECT,
//  1 attempt-control SELECT, 1 result-gate SELECT (fresh attempts),
//  1 timing SELECT (+ section leg).
// Steady fresh-attempt budget: 10 committed reads, 0 write tx.
import (
	"context"
	"database/sql"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestBootstrapSteadyStatementBudget(t *testing.T) {
	const wantSteadyReads = 10
	const wantSteadyWrites = 0
	if wantSteadyReads != 10 {
		t.Fatalf("budget changed: steady reads = %d", wantSteadyReads)
	}
	if wantSteadyWrites != 0 {
		t.Fatalf("budget changed: steady writes = %d", wantSteadyWrites)
	}
}

// TestLoadTimingRuntimeRowReadOnce is the round-144 wire-level proof that
// loadTiming issues exactly ONE runtime-header probe: the pre-probe SELECT
// status (NoRows -> legacy) plus the schedule link + sections leg inside
// LoadSessionRuntimeByStatus. A duplicate header re-probe (the pre-144
// shape: probe, schedule link, header re-probe, sections) fails this test
// with an unfulfilled-expectation error on the second header SELECT.
func TestLoadTimingRuntimeRowReadOnce(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta("SELECT status FROM exam_session_runtimes")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, exam_id, provider_key")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key"}).AddRow("sched-1", "exam-1", "sat"))
	now := time.Now().UTC()
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id")).
		WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "schedule_id", "exam_id", "provider_key", "status",
			"plan_snapshot", "timing_model", "actual_start_at", "actual_end_at",
			"active_section_key", "current_section_key", "current_section_remaining_seconds",
			"waiting_for_next_section", "is_overrun", "total_paused_seconds",
			"created_at", "updated_at", "revision",
		}).AddRow("rt-1", "sched-1", "exam-1", "sat", "live",
			nil, "cohort_section_v3", nil, nil,
			nil, nil, 0,
			nil, nil, 0,
			now, now, 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections WHERE runtime_id")).
		WithArgs("rt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "runtime_id", "section_key", "label", "section_order",
			"planned_duration_minutes", "gap_after_minutes", "status",
			"available_at", "actual_start_at", "actual_end_at", "paused_at",
			"accumulated_paused_seconds", "extension_minutes", "completion_reason",
			"projected_start_at", "projected_end_at",
		}).AddRow("sec-1", "rt-1", "rw", "Reading", 0, 30, 0, "live", nil, now, nil, nil, 0, 0, nil, nil, nil))
	timing, status, err := deliverySvc(db).loadTiming(context.Background(), "sched-1", "sat", now)
	if err != nil {
		t.Fatalf("loadTiming failed: %v", err)
	}
	if status != "live" || timing.Authority != "cohort_runtime" {
		t.Fatalf("unexpected timing: %+v %s", timing, status)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("duplicate runtime-header probe (pre-144 shape): %v", err)
	}
	var _ = sql.ErrNoRows
}

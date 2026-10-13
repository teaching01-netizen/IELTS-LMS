package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/delivery"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// NT-7 (F7): a binary that predates the classroom route policy inserts an
// adaptive route decision when it closes Module 1. Migration 0084 must refuse
// that row for staff_selects and for a contradicting forced policy, so a
// mixed-version fleet can never route without staff. Current-binary paths are
// covered by the other classroom MySQL tests, which run with the fence installed.
func TestSATRoutePolicyFenceRefusesOldBinaryDecisionsMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	var fence int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema = DATABASE() AND trigger_name = 'assessment_route_decisions_policy_fence'").Scan(&fence); err != nil {
		t.Fatal(err)
	}
	if fence != 1 {
		t.Skip("route policy fence not installed; apply migration 0084")
	}
	cases := []struct {
		policy, route, basis string
		refused              bool
	}{
		{"staff_selects", "higher", "window_closed", true},
		{"staff_selects", "higher", "", true},
		{"force_lower", "higher", "window_closed", true},
		{"force_higher", "lower", "client_confirmed", true},
		{"force_lower", "lower", "window_closed", false},
		{"adaptive", "higher", "window_closed", false},
	}
	for _, c := range cases {
		t.Run(c.policy+"/"+c.route+"/"+c.basis, func(t *testing.T) {
			schedule, attempt, base, low, high := seedStaleETagExam(t, db)
			mode := "classroom"
			if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = ?, sat_route_policy = ? WHERE id = ?", mode, c.policy, schedule); err != nil {
				t.Fatal(err)
			}
			var sectionID, baseAttemptID string
			if err := db.QueryRowContext(ctx, "SELECT m.section_id, ma.id FROM assessment_module_attempts ma JOIN assessment_modules m ON m.id = ma.module_id WHERE ma.attempt_id = ? AND ma.module_id = ?", attempt, base).Scan(&sectionID, &baseAttemptID); err != nil {
				t.Fatal(err)
			}
			selected := high
			if c.route == "lower" {
				selected = low
			}
			var basis any
			if c.basis != "" {
				basis = c.basis
			}
			config, _ := json.Marshal(map[string]any{"threshold": 2})
			_, err := db.ExecContext(ctx,
				"INSERT INTO assessment_route_decisions (id, attempt_id, section_id, base_module_attempt_id, base_module_id, selected_module_id, selected_route, raw_correct, operational_question_count, policy_key, policy_revision, policy_config, route_basis) VALUES (?, ?, ?, ?, ?, ?, ?, 3, 3, 'sat_threshold', 1, ?, ?)",
				uuid.NewString(), attempt, sectionID, baseAttemptID, base, selected, c.route, string(config), basis)
			if c.refused {
				if err == nil || !strings.Contains(err.Error(), "chk_route_decision_route") {
					t.Fatalf("old-binary decision must be refused by the fence, got err=%v", err)
				}
				var n int
				if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_route_decisions WHERE attempt_id = ?", attempt).Scan(&n); err != nil || n != 0 {
					t.Fatalf("refused decision persisted: n=%d err=%v", n, err)
				}
				return
			}
			if err != nil {
				t.Fatalf("policy-consistent decision refused: %v", err)
			}
		})
	}

	// The staff path itself still commits through the fence.
	schedule, attempt, _, _, _ := seedStaleETagExam(t, db)
	if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = 'staff_selects' WHERE id = ?", schedule); err != nil {
		t.Fatal(err)
	}
	svc := delivery.NewService(db, tx.NewRunner(db))
	if _, err := svc.ReconcileAttemptTimeout(ctx, schedule, attempt, time.Now().UTC()); err != nil {
		t.Fatal(err)
	}
	if _, err := svc.AssignStaffRoute(ctx, "staff-1", schedule, attempt, "reading-writing", "higher"); err != nil {
		t.Fatalf("staff assignment through the fence: %v", err)
	}
}

package main

import (
	"context"
	"encoding/json"
	"strings"
	"testing"

	"github.com/google/uuid"
)

// A version-pinned module plan must remain authoritative when an older API
// binary reaches the database write boundary. These cases model the SQL an
// old binary would issue without consulting sat_classroom_plan.
func TestSATClassroomPlanFenceBlocksLegacyWritesMySQL(t *testing.T) {
	db := staleETagTestDB(t)
	ctx := context.Background()
	var triggers int
	if err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM information_schema.triggers
		WHERE trigger_schema = DATABASE() AND trigger_name IN (
			'assessment_route_decisions_classroom_plan_fence',
			'assessment_module_attempts_classroom_plan_fence'
		)`).Scan(&triggers); err != nil {
		t.Fatal(err)
	}
	if triggers != 2 {
		t.Skip("classroom plan fences not installed; apply migration 0086")
	}

	t.Run("rejects a legacy route excluded by a fixed plan", func(t *testing.T) {
		schedule, attempt, base, low, high := seedStaleETagExam(t, db)
		if _, err := db.ExecContext(ctx, `
			UPDATE exam_versions v JOIN exam_schedules s ON s.published_version_id = v.id
			SET v.sat_classroom_plan = ? WHERE s.id = ?`, `{"reading-writing":"m1_hard"}`, schedule); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = 'adaptive' WHERE id = ?", schedule); err != nil {
			t.Fatal(err)
		}
		var sectionID, baseAttemptID string
		if err := db.QueryRowContext(ctx, `
			SELECT m.section_id, ma.id FROM assessment_module_attempts ma
			JOIN assessment_modules m ON m.id = ma.module_id
			WHERE ma.attempt_id = ? AND ma.module_id = ?`, attempt, base).Scan(&sectionID, &baseAttemptID); err != nil {
			t.Fatal(err)
		}
		config, _ := json.Marshal(map[string]any{"minimumCorrectForHigher": 2})
		insert := func(route, selected string) error {
			_, err := db.ExecContext(ctx, `
				INSERT INTO assessment_route_decisions
				(id, attempt_id, section_id, base_module_attempt_id, base_module_id, selected_module_id,
				 selected_route, raw_correct, operational_question_count, policy_key, policy_revision, policy_config, route_basis)
				VALUES (?, ?, ?, ?, ?, ?, ?, 3, 3, 'sat_threshold', 1, ?, 'window_closed')`,
				uuid.NewString(), attempt, sectionID, baseAttemptID, base, selected, route, string(config))
			return err
		}
		if err := insert("lower", low); err == nil || !strings.Contains(err.Error(), "chk_route_decision_route") {
			t.Fatalf("legacy lower decision must violate the immutable m1_hard plan, got %v", err)
		}
		if err := insert("higher", high); err != nil {
			t.Fatalf("plan-consistent higher decision should remain valid: %v", err)
		}
	})

	t.Run("rejects a legacy M1 seed for standalone M2", func(t *testing.T) {
		schedule, attempt, base, _, high := seedStaleETagExam(t, db)
		if _, err := db.ExecContext(ctx, `
			UPDATE exam_versions v JOIN exam_schedules s ON s.published_version_id = v.id
			SET v.sat_classroom_plan = ? WHERE s.id = ?`, `{"reading-writing":"m2_hard"}`, schedule); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "UPDATE exam_schedules SET sat_session_mode = 'classroom', sat_route_policy = 'adaptive' WHERE id = ?", schedule); err != nil {
			t.Fatal(err)
		}
		if _, err := db.ExecContext(ctx, "DELETE FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ?", attempt, base); err != nil {
			t.Fatal(err)
		}
		insert := func(module string) error {
			_, err := db.ExecContext(ctx, `
				INSERT INTO assessment_module_attempts (id, attempt_id, module_id, state, allocated_seconds, tool_state)
				VALUES (?, ?, ?, 'not_started', 3600, '{}')`, uuid.NewString(), attempt, module)
			return err
		}
		if err := insert(base); err == nil || !strings.Contains(strings.ToLower(err.Error()), "foreign key") {
			t.Fatalf("legacy base seed must be refused for standalone M2, got %v", err)
		}
		if err := insert(high); err != nil {
			t.Fatalf("configured standalone Higher entry must remain valid: %v", err)
		}
	})
}

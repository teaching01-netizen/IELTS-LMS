package authoring

import (
	"context"
	"database/sql"
	"fmt"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// UpdateDeliverySettings rewrites section break + module timings + routing
// threshold under locks (mirrors update_section_delivery_settings with
// revision fencing on section, modules, and routing rows).
func (s *Service) UpdateDeliverySettings(ctx context.Context, examID, sectionID string, req DeliverySettingsRequest) (Shell, error) {
	if req.BreakAfterSeconds < 0 {
		return Shell{}, validationError("Break duration cannot be negative.")
	}
	for _, t := range req.ModuleTimings {
		if t.DurationSeconds <= 0 {
			return Shell{}, validationError("Every SAT module duration must be greater than zero.")
		}
	}
	var shell Shell
	err := s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		// SELECT ... FOR UPDATE on the draft version serializes settings edits.
		var draftID string
		if err := q.QueryRowContext(ctx, "SELECT v.id FROM assessment_sections s JOIN exam_versions v ON v.id = s.exam_version_id JOIN exam_entities e ON e.id = v.exam_id WHERE s.id = ? AND e.id = ? AND v.is_draft = TRUE AND e.current_draft_version_id = v.id FOR UPDATE", sectionID, examID).Scan(&draftID); err != nil {
			if err == sql.ErrNoRows {
				return notFoundError("Section not found in the current draft.")
			}
			return err
		}
		// SELECT ... FOR UPDATE on the section row fences break/timing edits.
		var sectionRev int
		if err := q.QueryRowContext(ctx, "SELECT revision FROM assessment_sections WHERE id = ? FOR UPDATE", sectionID).Scan(&sectionRev); err != nil {
			return err
		}
		if sectionRev != req.ExpectedSectionRevision {
			return conflictError("Section delivery settings changed while you were editing.")
		}
		// SELECT ... FOR UPDATE on module rows fences per-module timing edits.
		type modRow struct {
			id, role string
			rev      int
		}
		rows, err := q.QueryContext(ctx, "SELECT id, adaptive_role, revision FROM assessment_modules WHERE section_id = ? ORDER BY display_order FOR UPDATE", sectionID)
		if err != nil {
			return err
		}
		mods := []modRow{}
		for rows.Next() {
			var m modRow
			if err := rows.Scan(&m.id, &m.role, &m.rev); err != nil {
				rows.Close()
				return err
			}
			mods = append(mods, m)
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			return err
		}
		if len(mods) != len(req.ModuleTimings) {
			return validationError("Delivery settings must include every module in the section.")
		}
		byID := map[string]modRow{}
		for _, m := range mods {
			byID[m.id] = m
		}
		for _, t := range req.ModuleTimings {
			m, ok := byID[t.ModuleID]
			if !ok {
				return validationError("Delivery settings contain an unknown or missing module.")
			}
			if m.rev != t.ExpectedRevision {
				return conflictError("Module timing changed while you were editing.")
			}
		}
		// SELECT ... FOR UPDATE on the routing row fences threshold edits.
		var routingID, baseID, lowerID, higherID string
		var routingRev int
		if err := q.QueryRowContext(ctx, "SELECT id, base_module_id, lower_module_id, higher_module_id, revision FROM assessment_routing_policies WHERE section_id = ? FOR UPDATE", sectionID).Scan(&routingID, &baseID, &lowerID, &higherID, &routingRev); err != nil {
			if err == sql.ErrNoRows {
				return validationError("Adaptive routing policy is missing.")
			}
			return err
		}
		if routingRev != req.ExpectedRoutingRevision {
			return conflictError("Adaptive routing settings changed while you were editing.")
		}
		hasBase, hasLower, hasHigher := false, false, false
		for _, m := range mods {
			switch m.role {
			case RoleBase:
				hasBase = hasBase || true
				if m.id != baseID {
					return validationError("Adaptive routing policy does not match the section module roles.")
				}
			case RoleLowerBranch:
				hasLower = true
				if m.id != lowerID {
					return validationError("Adaptive routing policy does not match the section module roles.")
				}
			case RoleHigherBranch:
				hasHigher = true
				if m.id != higherID {
					return validationError("Adaptive routing policy does not match the section module roles.")
				}
			}
		}
		if !hasBase || !hasLower || !hasHigher {
			return validationError("Each section needs lower and higher adaptive branches.")
		}
		if req.MinimumCorrectForHigher < 1 {
			return validationError("Higher-route threshold must be between 1 and the operational question count.")
		}
		{
			// Upper bound mirrors the Rust blueprint derivation
			// (target_question_count - pretest_count).max(1) against the live base module.
			var targetCount int
			if err := q.QueryRowContext(ctx, "SELECT target_question_count FROM assessment_modules WHERE id = ?", baseID).Scan(&targetCount); err != nil {
				return err
			}
			var pretestCount int
			if err := q.QueryRowContext(ctx, "SELECT COUNT(*) FROM assessment_exam_questions WHERE module_id = ? AND is_pretest = TRUE", baseID).Scan(&pretestCount); err != nil {
				return err
			}
			operational := targetCount - pretestCount
			if operational < 1 {
				operational = 1
			}
			if req.MinimumCorrectForHigher > operational {
				return validationError("Higher-route threshold must be between 1 and the operational question count.")
			}
		}
		for _, t := range req.ModuleTimings {
			res, err := q.ExecContext(ctx, "UPDATE assessment_modules SET duration_seconds = ?, revision = revision + 1, updated_at = NOW(6) WHERE id = ? AND section_id = ? AND revision = ?", t.DurationSeconds, t.ModuleID, sectionID, t.ExpectedRevision)
			if err != nil {
				return err
			}
			if n, _ := res.RowsAffected(); n != 1 {
				return conflictError("Module timing changed while you were editing.")
			}
		}
		sectionDuration := 0
		for _, t := range req.ModuleTimings {
			sectionDuration += t.DurationSeconds
		}
		res, err := q.ExecContext(ctx, "UPDATE assessment_sections SET duration_seconds = ?, break_after_seconds = ?, revision = revision + 1, updated_at = NOW(6) WHERE id = ? AND revision = ?", sectionDuration, req.BreakAfterSeconds, sectionID, req.ExpectedSectionRevision)
		if err != nil {
			return err
		}
		if n, _ := res.RowsAffected(); n != 1 {
			return conflictError("Section delivery settings changed while you were editing.")
		}
		if _, err := q.ExecContext(ctx, "UPDATE assessment_routing_policies SET policy_config = ?, revision = revision + 1 WHERE id = ? AND revision = ?", fmt.Sprintf("{\"minimumCorrectForHigher\":%d}", req.MinimumCorrectForHigher), routingID, req.ExpectedRoutingRevision); err != nil {
			return err
		}
		if _, err := q.ExecContext(ctx, "UPDATE exam_versions SET revision = revision + 1 WHERE id = ?", draftID); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return Shell{}, err
	}
	shell, err = s.Shell(ctx, examID)
	return shell, err
}

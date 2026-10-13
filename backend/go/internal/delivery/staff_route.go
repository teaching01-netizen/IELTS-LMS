package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/liveupdates"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// StaffRouteResult is the committed Module 2 assignment for a staff_selects
// attempt. Replayed is true when an identical assignment had already committed.
type StaffRouteResult struct {
	SectionKey       string `json:"sectionKey"`
	Route            string `json:"route"`
	SelectedModuleID string `json:"selectedModuleId"`
	Replayed         bool   `json:"replayed"`
}

// AssignStaffRoute commits staff's Module 2 choice for one student's section
// under a staff_selects classroom session: the route decision and the selected
// Module 2 attempt are written together (docs/sat_newmode.md 5.3). The caller
// has already authorized the actor for the schedule. The attempt row lock and
// the (attempt_id, section_id) decision key serialize two teachers: an identical
// repeat replays the committed decision, an opposite choice is a 409.
func (s *Service) AssignStaffRoute(ctx context.Context, actorID, scheduleID, attemptID, sectionKey, route string) (*StaffRouteResult, error) {
	route = strings.ToLower(strings.TrimSpace(route))
	sectionKey = strings.TrimSpace(sectionKey)
	if route != "lower" && route != "higher" {
		return nil, apperrors.New(apperrors.CodeValidation, "route must be lower or higher.")
	}
	if sectionKey == "" {
		return nil, apperrors.New(apperrors.CodeValidation, "sectionKey is required.")
	}
	var out *StaffRouteResult
	var hubEvents []liveupdates.Event
	err := s.runner.WithTx(ctx, func(ctx context.Context, t tx.Tx) error {
		out, hubEvents = nil, nil
		var policy string
		var sealed bool
		if err := t.QueryRowContext(ctx,
			"SELECT COALESCE(sch.sat_route_policy, 'adaptive'), (sa.submitted_at IS NOT NULL OR sa.phase = 'post-exam') FROM student_attempts sa JOIN exam_schedules sch ON sch.id = sa.schedule_id WHERE sa.id = ? AND sa.schedule_id = ? FOR UPDATE",
			attemptID, scheduleID).Scan(&policy, &sealed); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		if policy != "staff_selects" {
			return assessmentConflict("ROUTE_NOT_STAFF_SELECTED", "This session does not let staff choose Module 2.")
		}
		var sectionID, moduleID, moduleAttemptID, state string
		var raw, operational sql.NullInt64
		if err := t.QueryRowContext(ctx,
			"SELECT s.id, m.id, ma.id, ma.state, ma.raw_correct, ma.operational_question_count FROM assessment_module_attempts ma JOIN assessment_modules m ON m.id = ma.module_id AND m.adaptive_role = 'base' JOIN assessment_sections s ON s.id = m.section_id WHERE ma.attempt_id = ? AND s.section_key = ?",
			attemptID, sectionKey).Scan(&sectionID, &moduleID, &moduleAttemptID, &state, &raw, &operational); err != nil {
			if err == sql.ErrNoRows {
				return assessmentConflict("MODULE_ONE_NOT_FOUND", "The student has no Module 1 in this section to route from.")
			}
			return err
		}
		var existing string
		err := t.QueryRowContext(ctx,
			"SELECT selected_route FROM assessment_route_decisions WHERE attempt_id = ? AND section_id = ?",
			attemptID, sectionID).Scan(&existing)
		if err == nil {
			if existing != route {
				return assessmentConflict("ROUTE_ALREADY_ASSIGNED", "Module 2 was already assigned for this student; it cannot be changed.")
			}
			out = &StaffRouteResult{SectionKey: sectionKey, Route: route, Replayed: true}
			return t.QueryRowContext(ctx,
				"SELECT selected_module_id FROM assessment_route_decisions WHERE attempt_id = ? AND section_id = ?",
				attemptID, sectionID).Scan(&out.SelectedModuleID)
		}
		if err != sql.ErrNoRows {
			return err
		}
		// Sealing refuses a new assignment only; a committed choice still replays (F3).
		if sealed {
			return assessmentConflict("ATTEMPT_SEALED", "This attempt is already finished; Module 2 cannot be assigned.")
		}
		if state != "submitted" && state != "locked" {
			return assessmentConflict("MODULE_ONE_OPEN", "Module 1 has not finished; Module 2 cannot be assigned yet.")
		}
		var questions int
		if err := t.QueryRowContext(ctx,
			"SELECT COUNT(eq.id) FROM assessment_modules m LEFT JOIN assessment_exam_questions eq ON eq.module_id = m.id WHERE m.section_id = ? AND m.adaptive_role = ?",
			sectionID, route+"_branch").Scan(&questions); err != nil {
			return err
		}
		if questions == 0 {
			return apperrors.New(apperrors.CodeValidation, "The selected Module 2 branch has no questions.")
		}
		audit := routeAudit{basis: routeBasisStaffSelected, staffRoute: route}
		next, err := s.nextModuleTx(ctx, t, attemptID, moduleAttemptID, moduleID, int(raw.Int64), int(operational.Int64), audit)
		if err != nil {
			return err
		}
		if next == nil || next.awaitingRoute {
			return apperrors.New(apperrors.CodeValidation, "This section's classroom plan does not allow a staff-selected Module 2.")
		}
		var breakAfterSeconds int
		if err := t.QueryRowContext(ctx, "SELECT break_after_seconds FROM assessment_sections WHERE id = ?", sectionID).Scan(&breakAfterSeconds); err != nil {
			return err
		}
		if err := s.openFollowUpModuleTx(ctx, t, attemptID, sectionID, breakAfterSeconds, next, audit, routeBasisStaffSelected); err != nil {
			return err
		}
		payload, _ := json.Marshal(map[string]any{"sectionKey": sectionKey, "route": route, "moduleId": next.id})
		if _, err := t.ExecContext(ctx,
			"INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, ?, 'SAT_ROUTE_ASSIGNED', ?, ?, UTC_TIMESTAMP(6))",
			uuid.NewString(), scheduleID, actorID, attemptID, string(payload)); err != nil {
			return err
		}
		rev, err := s.appendModuleEventsTx(ctx, t, scheduleID, attemptID, liveEventModuleSubmitted)
		if err != nil {
			return err
		}
		hubEvents = dualModuleEvents(scheduleID, attemptID, rev, liveEventModuleSubmitted)
		out = &StaffRouteResult{SectionKey: sectionKey, Route: route, SelectedModuleID: next.id}
		return nil
	})
	if err != nil {
		return nil, err
	}
	s.publishHubEvents(hubEvents)
	return out, nil
}

// StaffRouteWaiting is one student whose Module 1 is closed with no route yet.
type StaffRouteWaiting struct {
	AttemptID   string `json:"attemptId"`
	StudentName string `json:"studentName"`
	SectionKey  string `json:"sectionKey"`
	RawCorrect  *int   `json:"rawCorrect"`
	Total       *int   `json:"total"`
}

// StaffRouteQueue is the staff view of a schedule's pending Module 2 choices.
// Enabled is false for any session that is not staff_selects.
type StaffRouteQueue struct {
	Enabled bool                `json:"enabled"`
	Items   []StaffRouteWaiting `json:"items"`
}

// ListStaffRouteQueue returns the attempts waiting for staff (derived, oldest first).
func (s *Service) ListStaffRouteQueue(ctx context.Context, scheduleID string) (*StaffRouteQueue, error) {
	out := &StaffRouteQueue{Items: []StaffRouteWaiting{}}
	var policy string
	if err := s.db.QueryRowContext(ctx, "SELECT COALESCE(sat_route_policy, 'adaptive') FROM exam_schedules WHERE id = ?", scheduleID).Scan(&policy); err != nil {
		if err == sql.ErrNoRows {
			return nil, apperrors.New(apperrors.CodeNotFound, "Schedule not found.")
		}
		return nil, err
	}
	if policy != "staff_selects" {
		return out, nil
	}
	out.Enabled = true
	rows, err := s.db.QueryContext(ctx, `
		SELECT sa.id, sa.candidate_name, s.section_key, ma.raw_correct, ma.operational_question_count
		FROM student_attempts sa
		JOIN assessment_module_attempts ma ON ma.attempt_id = sa.id AND ma.state IN ('submitted', 'locked')
		JOIN assessment_modules m ON m.id = ma.module_id AND m.adaptive_role = 'base'
		JOIN assessment_sections s ON s.id = m.section_id
		WHERE sa.schedule_id = ?
		AND NOT EXISTS (SELECT 1 FROM assessment_route_decisions d WHERE d.attempt_id = sa.id AND d.section_id = s.id)
		ORDER BY ma.updated_at, sa.id`, scheduleID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var w StaffRouteWaiting
		var raw, total sql.NullInt64
		if err := rows.Scan(&w.AttemptID, &w.StudentName, &w.SectionKey, &raw, &total); err != nil {
			return nil, err
		}
		if raw.Valid && total.Valid {
			r, t := int(raw.Int64), int(total.Int64)
			w.RawCorrect, w.Total = &r, &t
		}
		out.Items = append(out.Items, w)
	}
	return out, rows.Err()
}

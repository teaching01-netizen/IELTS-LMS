package proctor

import (
	"context"
	"database/sql"
	"strings"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// UpsertSessionNote stores a note for a schedule. The caller-supplied author
// is intentionally ignored: authorship comes from the authenticated staff
// actor so a client cannot impersonate another proctor.
func (s *Service) UpsertSessionNote(ctx context.Context, actor Actor, note SessionNote) (SessionNote, error) {
	if strings.TrimSpace(note.ScheduleID) == "" {
		return SessionNote{}, badInput("Schedule id is required.")
	}
	if strings.TrimSpace(note.ID) == "" {
		note.ID = uuid.NewString()
	}
	if strings.TrimSpace(note.Content) == "" {
		return SessionNote{}, badInput("Note content is required.")
	}
	if len(note.Content) > 16_000 {
		return SessionNote{}, badInput("Note content is too long.")
	}
	if note.Category != "general" && note.Category != "incident" && note.Category != "handover" {
		return SessionNote{}, badInput("Note category is invalid.")
	}
	returnNote := SessionNote{}
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, note.ScheduleID); err != nil {
			return err
		}
		var existingSchedule string
		err := q.QueryRowContext(ctx, "SELECT schedule_id FROM session_notes WHERE id = ? FOR UPDATE", note.ID).Scan(&existingSchedule)
		switch {
		case err == nil:
			if existingSchedule != note.ScheduleID {
				return notFound("Session note not found.")
			}
			_, err = q.ExecContext(ctx, "UPDATE session_notes SET category = ?, content = ?, is_resolved = ?, updated_at = UTC_TIMESTAMP(6) WHERE id = ? AND schedule_id = ?", note.Category, note.Content, note.IsResolved, note.ID, note.ScheduleID)
		case err == sql.ErrNoRows:
			_, err = q.ExecContext(ctx, "INSERT INTO session_notes (id, schedule_id, author, category, content, is_resolved, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", note.ID, note.ScheduleID, actor.ID, note.Category, note.Content, note.IsResolved)
		default:
			return err
		}
		if err != nil {
			return err
		}
		return scanSessionNote(q.QueryRowContext(ctx, "SELECT id, schedule_id, author, category, content, is_resolved, created_at, updated_at FROM session_notes WHERE id = ? AND schedule_id = ?", note.ID, note.ScheduleID), &returnNote)
	})
	return returnNote, err
}

// DeleteSessionNote removes one note after re-checking the actor's schedule
// assignment inside the same transaction.
func (s *Service) DeleteSessionNote(ctx context.Context, actor Actor, scheduleID, noteID string) error {
	if strings.TrimSpace(scheduleID) == "" || strings.TrimSpace(noteID) == "" {
		return badInput("Schedule id and note id are required.")
	}
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		var existingSchedule string
		err := q.QueryRowContext(ctx, "SELECT schedule_id FROM session_notes WHERE id = ? FOR UPDATE", noteID).Scan(&existingSchedule)
		if err == sql.ErrNoRows || existingSchedule != scheduleID {
			return notFound("Session note not found.")
		}
		if err != nil {
			return err
		}
		_, err = q.ExecContext(ctx, "DELETE FROM session_notes WHERE id = ? AND schedule_id = ?", noteID, scheduleID)
		return err
	})
}

// DeleteSessionNoteByID is the legacy repository surface where only the note
// id is available. The schedule is resolved and authorized in one transaction.
func (s *Service) DeleteSessionNoteByID(ctx context.Context, actor Actor, noteID string) error {
	if strings.TrimSpace(noteID) == "" {
		return badInput("Note id is required.")
	}
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var scheduleID string
		err := q.QueryRowContext(ctx, "SELECT schedule_id FROM session_notes WHERE id = ? FOR UPDATE", noteID).Scan(&scheduleID)
		if err == sql.ErrNoRows {
			return notFound("Session note not found.")
		}
		if err != nil {
			return err
		}
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		_, err = q.ExecContext(ctx, "DELETE FROM session_notes WHERE id = ? AND schedule_id = ?", noteID, scheduleID)
		return err
	})
}

// ListSessionNotes returns notes visible to the assigned staff actor.
func (s *Service) ListSessionNotes(ctx context.Context, actor Actor, scheduleID string) ([]SessionNote, error) {
	if strings.TrimSpace(scheduleID) == "" {
		return nil, badInput("Schedule id is required.")
	}
	var notes []SessionNote
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeRead(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		var err error
		notes, err = loadSessionNotes(ctx, q, scheduleID)
		return err
	})
	return notes, err
}

// ListAllSessionNotes is the repository compatibility surface used by the
// legacy admin panels. It remains assignment-scoped; it never exposes notes
// from schedules the authenticated staff actor cannot inspect.
func (s *Service) ListAllSessionNotes(ctx context.Context, actor Actor) ([]SessionNote, error) {
	if actor.Role != RoleAdmin && actor.Role != RoleProctor {
		return nil, notFound("Notes not found.")
	}
	var notes []SessionNote
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		rows, err := q.QueryContext(ctx, "SELECT n.id, n.schedule_id, n.author, n.category, n.content, n.is_resolved, n.created_at, n.updated_at FROM session_notes n WHERE EXISTS (SELECT 1 FROM schedule_staff_assignments a WHERE a.schedule_id = n.schedule_id AND (a.actor_id = ? OR a.user_id = ?) AND a.revoked_at IS NULL) ORDER BY n.created_at DESC", actor.ID, actor.ID)
		if err != nil {
			return err
		}
		defer rows.Close()
		for rows.Next() {
			var note SessionNote
			if err := scanSessionNote(rows, &note); err != nil {
				return err
			}
			notes = append(notes, note)
		}
		return rows.Err()
	})
	return notes, err
}

// UpsertViolationRule stores an enabled/disabled automatic-action rule for a
// schedule. As with notes, createdBy is owned by the authenticated actor.
func (s *Service) UpsertViolationRule(ctx context.Context, actor Actor, rule ViolationRule) (ViolationRule, error) {
	if strings.TrimSpace(rule.ScheduleID) == "" {
		return ViolationRule{}, badInput("Schedule id is required.")
	}
	if strings.TrimSpace(rule.ID) == "" {
		rule.ID = uuid.NewString()
	}
	if rule.Threshold <= 0 {
		return ViolationRule{}, badInput("Rule threshold must be greater than zero.")
	}
	if rule.TriggerType != "violation_count" && rule.TriggerType != "specific_violation_type" && rule.TriggerType != "severity_threshold" {
		return ViolationRule{}, badInput("Rule trigger type is invalid.")
	}
	if rule.Action != "warn" && rule.Action != "pause" && rule.Action != "notify_proctor" && rule.Action != "terminate" {
		return ViolationRule{}, badInput("Rule action is invalid.")
	}
	if rule.TriggerType == "specific_violation_type" && strings.TrimSpace(valueOrEmpty(rule.SpecificViolationType)) == "" {
		return ViolationRule{}, badInput("Specific violation type is required for this trigger.")
	}
	if rule.TriggerType == "severity_threshold" {
		severity := valueOrEmpty(rule.SpecificSeverity)
		if severity != "low" && severity != "medium" && severity != "high" && severity != "critical" {
			return ViolationRule{}, badInput("Specific severity is required for this trigger.")
		}
	}
	if rule.SpecificSeverity != nil {
		severity := *rule.SpecificSeverity
		if severity != "low" && severity != "medium" && severity != "high" && severity != "critical" {
			return ViolationRule{}, badInput("Specific severity is invalid.")
		}
	}
	returnRule := ViolationRule{}
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, rule.ScheduleID); err != nil {
			return err
		}
		var existingSchedule string
		err := q.QueryRowContext(ctx, "SELECT schedule_id FROM violation_rules WHERE id = ? FOR UPDATE", rule.ID).Scan(&existingSchedule)
		switch {
		case err == nil:
			if existingSchedule != rule.ScheduleID {
				return notFound("Violation rule not found.")
			}
			_, err = q.ExecContext(ctx, "UPDATE violation_rules SET trigger_type = ?, threshold = ?, specific_violation_type = ?, specific_severity = ?, action = ?, is_enabled = ? WHERE id = ? AND schedule_id = ?", rule.TriggerType, rule.Threshold, nullableString(rule.SpecificViolationType), nullableString(rule.SpecificSeverity), rule.Action, rule.IsEnabled, rule.ID, rule.ScheduleID)
		case err == sql.ErrNoRows:
			_, err = q.ExecContext(ctx, "INSERT INTO violation_rules (id, schedule_id, trigger_type, threshold, specific_violation_type, specific_severity, action, is_enabled, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?)", rule.ID, rule.ScheduleID, rule.TriggerType, rule.Threshold, nullableString(rule.SpecificViolationType), nullableString(rule.SpecificSeverity), rule.Action, rule.IsEnabled, actor.ID)
		default:
			return err
		}
		if err != nil {
			return err
		}
		return scanViolationRule(q.QueryRowContext(ctx, "SELECT id, schedule_id, trigger_type, threshold, specific_violation_type, specific_severity, action, is_enabled, created_at, created_by FROM violation_rules WHERE id = ? AND schedule_id = ?", rule.ID, rule.ScheduleID), &returnRule)
	})
	return returnRule, err
}

// DeleteViolationRule removes one rule after checking schedule ownership.
func (s *Service) DeleteViolationRule(ctx context.Context, actor Actor, scheduleID, ruleID string) error {
	if strings.TrimSpace(scheduleID) == "" || strings.TrimSpace(ruleID) == "" {
		return badInput("Schedule id and rule id are required.")
	}
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		var existingSchedule string
		err := q.QueryRowContext(ctx, "SELECT schedule_id FROM violation_rules WHERE id = ? FOR UPDATE", ruleID).Scan(&existingSchedule)
		if err == sql.ErrNoRows || existingSchedule != scheduleID {
			return notFound("Violation rule not found.")
		}
		if err != nil {
			return err
		}
		_, err = q.ExecContext(ctx, "DELETE FROM violation_rules WHERE id = ? AND schedule_id = ?", ruleID, scheduleID)
		return err
	})
}

// DeleteViolationRuleByID is the legacy repository surface where only the
// rule id is available. The schedule is resolved and authorized in one
// transaction.
func (s *Service) DeleteViolationRuleByID(ctx context.Context, actor Actor, ruleID string) error {
	if strings.TrimSpace(ruleID) == "" {
		return badInput("Rule id is required.")
	}
	return s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var scheduleID string
		err := q.QueryRowContext(ctx, "SELECT schedule_id FROM violation_rules WHERE id = ? FOR UPDATE", ruleID).Scan(&scheduleID)
		if err == sql.ErrNoRows {
			return notFound("Violation rule not found.")
		}
		if err != nil {
			return err
		}
		if err := s.authorizeWrite(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		_, err = q.ExecContext(ctx, "DELETE FROM violation_rules WHERE id = ? AND schedule_id = ?", ruleID, scheduleID)
		return err
	})
}

// ListViolationRules returns rules visible to the assigned staff actor.
func (s *Service) ListViolationRules(ctx context.Context, actor Actor, scheduleID string) ([]ViolationRule, error) {
	if strings.TrimSpace(scheduleID) == "" {
		return nil, badInput("Schedule id is required.")
	}
	var rules []ViolationRule
	err := s.tx.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		if err := s.authorizeRead(ctx, q, actor, scheduleID); err != nil {
			return err
		}
		var err error
		rules, err = loadViolationRules(ctx, q, scheduleID)
		return err
	})
	return rules, err
}

func (s *Service) authorizeRead(ctx context.Context, q tx.Tx, actor Actor, scheduleID string) error {
	if actor.Role != RoleAdmin && actor.Role != RoleProctor {
		return notFound("Schedule not found.")
	}
	if actor.Role == RoleAdmin {
		return nil
	}
	ok, err := s.assign.HasLiveAssignment(ctx, q, scheduleID, actor.ID)
	if err != nil {
		return err
	}
	if !ok {
		return notFound("Schedule not found.")
	}
	return nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanSessionNote(row rowScanner, note *SessionNote) error {
	var resolved sql.NullBool
	if err := row.Scan(&note.ID, &note.ScheduleID, &note.Author, &note.Category, &note.Content, &resolved, &note.CreatedAt, &note.UpdatedAt); err != nil {
		return err
	}
	note.IsResolved = resolved.Valid && resolved.Bool
	return nil
}

func scanViolationRule(row rowScanner, rule *ViolationRule) error {
	var threshold int64
	var specificType, specificSeverity sql.NullString
	var enabled sql.NullBool
	if err := row.Scan(&rule.ID, &rule.ScheduleID, &rule.TriggerType, &threshold, &specificType, &specificSeverity, &rule.Action, &enabled, &rule.CreatedAt, &rule.CreatedBy); err != nil {
		return err
	}
	rule.Threshold = int(threshold)
	rule.SpecificViolationType = nullStringPtr(specificType)
	rule.SpecificSeverity = nullStringPtr(specificSeverity)
	rule.IsEnabled = enabled.Valid && enabled.Bool
	return nil
}

func nullableString(value *string) any {
	if value == nil || strings.TrimSpace(*value) == "" {
		return nil
	}
	return *value
}

func valueOrEmpty(value *string) string {
	if value == nil {
		return ""
	}
	return strings.TrimSpace(*value)
}

func badInput(message string) error {
	return &apperrors.Error{Code: apperrors.CodeBadRequest, Message: message, HTTPStatus: 400}
}

func notFound(message string) error {
	return &apperrors.Error{Code: apperrors.CodeNotFound, Message: message, HTTPStatus: 404}
}

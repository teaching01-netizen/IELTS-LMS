package assessmentforms

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"example.com/ielts-proctoring/internal/assessmentforms/definition"
	"example.com/ielts-proctoring/internal/lifecycle"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

type SectionEntryState struct {
	VersionID   string             `json:"versionId"`
	SectionKey  string             `json:"sectionKey"`
	FormKey     string             `json:"formKey"`
	State       string             `json:"state"`
	ModuleID    string             `json:"moduleId,omitempty"`
	Fields      []definition.Field `json:"fields,omitempty"`
	Answers     definition.Answers `json:"answers,omitempty"`
	SubmittedAt *time.Time         `json:"submittedAt,omitempty"`
	CanSubmit   bool               `json:"canSubmit"`
	CanStart    bool               `json:"canStart"`
}

func sectionEntryDecision(c attemptContext, section, module, state string, pendingBreak bool, response *responseRow) SectionEntryState {
	out := SectionEntryState{VersionID: c.VersionID, SectionKey: section, FormKey: definition.SectionFormKey(section), ModuleID: module, State: "not_applicable"}
	fields := c.Forms.SectionFields(section)
	if len(fields) == 0 || (c.Sections != nil && !c.Sections[section]) {
		out.CanStart = true
		return out
	}
	if c.ClosedAt.Valid || c.ScheduleStatus == "completed" || c.ScheduleStatus == "cancelled" || c.ProctorStatus == "terminated" || c.DeliveryStatus == "submitted" || c.DeliveryStatus == "terminated" || c.DeliveryStatus == "locked" || c.DeliveryStatus == "cancelled" {
		out.State = "closed"
		return out
	}
	if module == "" || pendingBreak {
		out.State = "waiting"
		return out
	}
	out.Fields = fields
	if response != nil {
		out.State = "submitted"
		out.Answers = response.Answers
		out.SubmittedAt = &response.FirstSubmittedAt
		out.CanStart = c.ScheduleStatus == "live" && (c.ProctorStatus == "active" || c.ProctorStatus == "warned")
		return out
	}
	out.State = "required"
	out.CanSubmit = state == "not_started" && c.ProctorStatus != "paused" && c.ScheduleStatus != "paused"
	return out
}

func sectionEntryState(ctx context.Context, q queryer, c attemptContext, section string) (SectionEntryState, error) {
	if c.Recovery != nil && c.Recovery.Target.SectionKey != section {
		return SectionEntryState{}, conflict("RECOVERY_FOCUS", "Only the recovery section is available.", nil)
	}
	if definition.SectionFormKey(section) == "" {
		return SectionEntryState{}, apperrors.New(apperrors.CodeValidation, "Unknown SAT section.")
	}
	if len(c.Forms.SectionFields(section)) == 0 || (c.Sections != nil && !c.Sections[section]) {
		return sectionEntryDecision(c, section, "", "", false, nil), nil
	}
	response, err := loadResponse(ctx, q, c.AttemptID, definition.SectionFormKey(section), "")
	if err != nil {
		return SectionEntryState{}, err
	}
	pendingOnly := ""
	if response == nil {
		pendingOnly = " AND ma.state NOT IN ('submitted','locked')"
	}
	var module, state, runtimeStatus string
	err = q.QueryRowContext(ctx, `SELECT ma.module_id, ma.state, COALESCE(rt.status,'') FROM assessment_module_attempts ma
 JOIN assessment_modules m ON m.id=ma.module_id JOIN assessment_sections sec ON sec.id=m.section_id
 LEFT JOIN exam_session_runtimes rt ON rt.schedule_id=?
 WHERE ma.attempt_id=? AND sec.section_key=?`+pendingOnly+` ORDER BY ma.created_at,m.display_order,ma.id LIMIT 1`, c.ScheduleID, c.AttemptID, section).Scan(&module, &state, &runtimeStatus)
	if err != nil && err != sql.ErrNoRows {
		return SectionEntryState{}, err
	}
	if runtimeStatus != "" && c.ScheduleStatus != "completed" && c.ScheduleStatus != "cancelled" {
		c.ScheduleStatus = runtimeStatus
	}
	var pending bool
	if module != "" {
		if err := q.QueryRowContext(ctx, "SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')", c.AttemptID).Scan(&pending); err != nil {
			return SectionEntryState{}, err
		}
	}
	return sectionEntryDecision(c, section, module, state, pending, response), nil
}

func (s *Service) SectionEntryFor(ctx context.Context, scheduleID, attemptID, section string) (SectionEntryState, error) {
	c, err := loadAttemptContext(ctx, s.db, attemptID)
	if err != nil {
		return SectionEntryState{}, err
	}
	if c.ScheduleID != scheduleID {
		return SectionEntryState{}, apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
	}
	return sectionEntryState(ctx, s.db, c, section)
}

type SubmitSectionEntryCommand struct {
	OperationID string          `json:"operationId"`
	VersionID   string          `json:"versionId"`
	Answers     json.RawMessage `json:"answers"`
}

// SubmitSectionEntry seals the form independently of starting a working clock.
// The shared room fence orders this write against End Exam; the attempt lock
// orders it against explicit module activation, termination and other tabs.
func (s *Service) SubmitSectionEntry(ctx context.Context, cred Credential, section string, cmd SubmitSectionEntryCommand) (EvaAck, error) {
	if definition.SectionFormKey(section) == "" {
		return EvaAck{}, apperrors.New(apperrors.CodeValidation, "Unknown SAT section.")
	}
	var payload map[string]any
	if len(cmd.Answers) > definition.MaxAnswerBytes {
		return EvaAck{}, fieldErrors(map[string]string{"": "Answers exceed the allowed size."})
	}
	if err := json.Unmarshal(cmd.Answers, &payload); err != nil || payload == nil {
		return EvaAck{}, fieldErrors(map[string]string{"": "Answers must be an object."})
	}
	hash, err := lifecycle.Hash("section_entry_submit", struct {
		Section, Version string
		Answers          map[string]any
	}{section, cmd.VersionID, payload})
	if err != nil {
		return EvaAck{}, err
	}
	var out EvaAck
	err = s.runner.WithTx(ctx, func(ctx context.Context, q tx.Tx) error {
		var room string
		if err := q.QueryRowContext(ctx, "SELECT status FROM exam_schedules WHERE id = ? FOR SHARE", cred.ScheduleID).Scan(&room); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Sitting not found.")
			}
			return err
		}
		var owner sql.NullString
		if err := q.QueryRowContext(ctx, "SELECT user_id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE", cred.AttemptID, cred.ScheduleID).Scan(&owner); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		if !owner.Valid || owner.String != cred.UserID {
			return apperrors.New(apperrors.CodeForbidden, "This sitting belongs to another principal.")
		}
		if err := verifySessionTx(ctx, q, cred); err != nil {
			return err
		}
		scope := lifecycle.Scope{ScheduleID: cred.ScheduleID, AttemptID: cred.AttemptID}
		receipt, err := lifecycle.Load(ctx, q, scope, cmd.OperationID, "section_entry_submit", hash)
		if err != nil {
			return err
		}
		if receipt != nil {
			return json.Unmarshal(receipt, &out)
		}
		c, err := loadAttemptContext(ctx, q, cred.AttemptID)
		if err != nil {
			return err
		}
		c.ScheduleStatus = room
		current, err := sectionEntryState(ctx, q, c, section)
		if err != nil {
			return err
		}
		if strings.TrimSpace(cmd.VersionID) != c.VersionID {
			return conflict(ReasonFormVersionChanged, "The section form changed. Refresh and review it.", nil)
		}
		if current.State == "closed" {
			return conflict("SECTION_FORM_CLOSED", "This section is closed.", nil)
		}
		answers, errs := definition.ValidateAnswers(current.Fields, cmd.Answers)
		if len(errs) > 0 {
			return fieldErrors(errs)
		}
		if current.State == "submitted" {
			a, _ := json.Marshal(answers)
			b, _ := json.Marshal(current.Answers)
			if string(a) != string(b) {
				return conflict("SECTION_FORM_ALREADY_SUBMITTED", "This section form has already been submitted.", nil)
			}
			out = EvaAck{Revision: 1, Answers: current.Answers, FirstSubmittedAt: *current.SubmittedAt, UpdatedAt: *current.SubmittedAt}
		} else {
			if !current.CanSubmit {
				return conflict("SECTION_FORM_NOT_AVAILABLE", "This section form is not available yet.", nil)
			}
			encoded, err := json.Marshal(answers)
			if err != nil {
				return err
			}
			if _, err = q.ExecContext(ctx, "INSERT INTO assessment_form_responses (attempt_id, form_key, answers, revision, first_submitted_at, updated_at) VALUES (?, ?, ?, 1, UTC_TIMESTAMP(6), UTC_TIMESTAMP(6))", cred.AttemptID, current.FormKey, string(encoded)); err != nil {
				return err
			}
			// Arm recovery preparation only after acceptance, without setting
			// available_at (the legacy worker interprets it as auto-start).
			// An initial form accepted before staff/code release keeps no deadline.
			if _, err = q.ExecContext(ctx, `INSERT INTO assessment_module_boundaries
              (module_attempt_id,attempt_id,phase,policy_version,entry_deadline_at,next_action_at,run_generation)
              SELECT ma.id,ma.attempt_id,'preparing',JSON_UNQUOTE(JSON_EXTRACT(s.sat_delivery_policy,'$.version')),
                TIMESTAMPADD(SECOND,CAST(JSON_EXTRACT(s.sat_delivery_policy,'$.entryRecoverySeconds') AS SIGNED),UTC_TIMESTAMP(6)),
                TIMESTAMPADD(SECOND,CAST(JSON_EXTRACT(s.sat_delivery_policy,'$.entryRecoverySeconds') AS SIGNED),UTC_TIMESTAMP(6)),ma.run_generation
              FROM assessment_module_attempts ma JOIN student_attempts a ON a.id=ma.attempt_id JOIN exam_schedules s ON s.id=a.schedule_id
              WHERE ma.attempt_id=? AND ma.module_id=? AND ma.state='not_started' AND s.status='live'
                AND s.sat_delivery_policy IS NOT NULL AND (a.sat_start_code_required=0 OR a.sat_start_code_accepted_at IS NOT NULL)
              ON DUPLICATE KEY UPDATE
                next_action_at=IF(assessment_module_boundaries.phase='preparing' AND assessment_module_boundaries.entry_deadline_at IS NULL,VALUES(next_action_at),assessment_module_boundaries.next_action_at),
                entry_deadline_at=IF(assessment_module_boundaries.phase='preparing' AND assessment_module_boundaries.entry_deadline_at IS NULL,VALUES(entry_deadline_at),assessment_module_boundaries.entry_deadline_at)`, cred.AttemptID, current.ModuleID); err != nil {
				return err
			}
			row, err := loadResponse(ctx, q, cred.AttemptID, current.FormKey, "")
			if err != nil {
				return err
			}
			out = EvaAck{Revision: 1, Answers: row.Answers, FirstSubmittedAt: row.FirstSubmittedAt, UpdatedAt: row.UpdatedAt}
		}
		return lifecycle.Store(ctx, q, scope, cmd.OperationID, "section_entry_submit", hash, out)
	})
	return out, err
}

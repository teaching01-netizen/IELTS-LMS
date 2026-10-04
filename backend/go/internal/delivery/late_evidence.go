package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"strings"
	"time"

	"github.com/google/uuid"

	"example.com/ielts-proctoring/internal/assessscore"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
)

// LateEvidenceRequest carries answers a browser still held after their module
// closed. They are evidence only: never applied to responses or scores.
type LateEvidenceRequest struct {
	ModuleID string               `json:"moduleId"`
	Answers  []LateEvidenceAnswer `json:"answers"`
}

// LateEvidenceAnswer is one kept-on-device answer.
type LateEvidenceAnswer struct {
	QuestionID       string          `json:"questionId"`
	WriteID          string          `json:"writeId"`
	Response         json.RawMessage `json:"response"`
	ClientReceivedAt *time.Time      `json:"clientReceivedAt,omitempty"`
}

// LateEvidenceAck reports how many answers were newly recorded. Whether the
// evidence would have changed the route is deliberately NOT returned to the
// candidate: it is a staff review signal (session_audit_logs alert).
type LateEvidenceAck struct {
	Recorded int `json:"recorded"`
}

const lateEvidenceAuditAction = "SAT_LATE_ANSWER_ROUTE_RISK"

// RecordLateEvidence stores late answers for a CLOSED module and checks
// whether, scored together with every earlier piece of evidence for the same
// module, they would have selected the other adaptive branch. A flip raises
// one acknowledgeable proctor alert; the scored route never changes (D3).
func (s *Service) RecordLateEvidence(ctx context.Context, bearerScheduleID, bearerAttemptID, urlScheduleID string, req LateEvidenceRequest, writerBinding ...string) (*LateEvidenceAck, error) {
	if urlScheduleID != bearerScheduleID {
		return nil, apperrors.New(apperrors.CodeForbidden, "Attempt credential does not match the schedule.")
	}
	if strings.TrimSpace(req.ModuleID) == "" || len(req.Answers) == 0 {
		return nil, apperrors.New(apperrors.CodeValidation, "moduleId and at least one answer are required.")
	}
	if len(req.Answers) > maxCloseManifest {
		return nil, apperrors.New(apperrors.CodeValidation, "Too many evidence answers.")
	}
	for _, answer := range req.Answers {
		if strings.TrimSpace(answer.QuestionID) == "" || strings.TrimSpace(answer.WriteID) == "" || len(answer.WriteID) > 64 || !json.Valid(answer.Response) {
			return nil, apperrors.New(apperrors.CodeValidation, "Each evidence answer needs a question id, a write id and a JSON response.")
		}
	}
	scheduleID, examID, providerKey, _, err := s.startScheduleBinding(ctx, bearerScheduleID)
	if err != nil {
		return nil, err
	}
	if providerKey != "sat" {
		return nil, apperrors.New(apperrors.CodeUnsupportedProvider, "The assessment provider is not supported.")
	}
	if err := s.saveAttemptBinding(ctx, scheduleID, bearerAttemptID, examID); err != nil {
		return nil, err
	}
	recorded := 0
	flipped := false
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, t tx.Tx) error {
		recorded, flipped = 0, false
		var lockedID string
		if err := t.QueryRowContext(ctx,
			"SELECT id FROM student_attempts WHERE id = ? AND schedule_id = ? FOR UPDATE",
			bearerAttemptID, scheduleID).Scan(&lockedID); err != nil {
			if err == sql.ErrNoRows {
				return apperrors.New(apperrors.CodeNotFound, "Attempt not found.")
			}
			return err
		}
		if err := enforceWriterSessionTx(ctx, t, scheduleID, bearerAttemptID, writerBinding...); err != nil {
			return err
		}
		module, err := lockModuleAttemptTx(ctx, t, bearerAttemptID, req.ModuleID)
		if err != nil {
			return err
		}
		if module.state != "locked" && module.state != "submitted" {
			return assessmentConflict("MODULE_NOT_CLOSED", "Answers for an open module are saved normally, not as evidence.")
		}
		scoring, _, err := queryScoringRowsV2FirstTx(ctx, t, module.id, module.moduleID)
		if err != nil {
			return err
		}
		inModule := make(map[string]bool, len(scoring))
		for _, row := range scoring {
			inModule[row.examQuestionID] = true
		}
		for _, answer := range req.Answers {
			if !inModule[answer.QuestionID] {
				return apperrors.New(apperrors.CodeValidation, "An evidence answer names a question outside this module.")
			}
		}
		for _, answer := range req.Answers {
			res, err := t.ExecContext(ctx,
				"INSERT INTO assessment_late_answer_evidence (id, attempt_id, module_attempt_id, module_id, question_id, write_id, response, client_received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE id = id",
				uuid.NewString(), bearerAttemptID, module.id, module.moduleID, answer.QuestionID, answer.WriteID, string(answer.Response), answer.ClientReceivedAt)
			if err != nil {
				return err
			}
			if n, err := res.RowsAffected(); err != nil {
				return err
			} else if n == 1 {
				recorded++
			}
		}
		if recorded == 0 {
			return nil
		}
		wouldChange, scoredRoute, evidenceRoute, err := s.evidenceWouldChangeRouteTx(ctx, t, bearerAttemptID, module, scoring)
		if err != nil || !wouldChange {
			return err
		}
		flipped = true
		var alreadyFlagged bool
		if err := t.QueryRowContext(ctx,
			"SELECT EXISTS(SELECT 1 FROM assessment_late_answer_evidence WHERE module_attempt_id = ? AND would_change_route = TRUE)",
			module.id).Scan(&alreadyFlagged); err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx,
			"UPDATE assessment_late_answer_evidence SET would_change_route = TRUE WHERE module_attempt_id = ?",
			module.id); err != nil {
			return err
		}
		if alreadyFlagged {
			return nil
		}
		payload, err := json.Marshal(map[string]any{
			"moduleId":        module.moduleID,
			"moduleAttemptId": module.id,
			"scoredRoute":     scoredRoute,
			"evidenceRoute":   evidenceRoute,
		})
		if err != nil {
			return err
		}
		if _, err := t.ExecContext(ctx,
			"INSERT INTO session_audit_logs (id, schedule_id, actor, action_type, target_student_id, payload, created_at) VALUES (?, ?, 'system', ?, ?, ?, UTC_TIMESTAMP(6))",
			uuid.NewString(), scheduleID, lateEvidenceAuditAction, bearerAttemptID, string(payload)); err != nil {
			return err
		}
		return nil
	})
	if err != nil {
		return nil, err
	}
	if recorded > 0 {
		telemetry.IncCounter(telemetry.MSATLateAnswerEvidenceTotal, "would_change_route", boolLabel(flipped))
	}
	return &LateEvidenceAck{Recorded: recorded}, nil
}

// evidenceWouldChangeRouteTx rescored the closed module with every stored
// evidence answer overlaid on its durable responses, through the same scorer
// and the same policy snapshot the route decision recorded. A module without
// a route decision (not an adaptive base module) cannot flip a route.
func (s *Service) evidenceWouldChangeRouteTx(ctx context.Context, t tx.Tx, attemptID string, module saveActiveModule, scoring []scoringRow) (bool, string, string, error) {
	var scoredRoute, policyConfig string
	err := t.QueryRowContext(ctx,
		"SELECT selected_route, CAST(policy_config AS CHAR) FROM assessment_route_decisions WHERE attempt_id = ? AND base_module_attempt_id = ?",
		attemptID, module.id).Scan(&scoredRoute, &policyConfig)
	if err == sql.ErrNoRows {
		return false, "", "", nil
	}
	if err != nil {
		return false, "", "", err
	}
	rows, err := t.QueryContext(ctx,
		"SELECT question_id, CAST(response AS CHAR) FROM assessment_late_answer_evidence WHERE module_attempt_id = ?",
		module.id)
	if err != nil {
		return false, "", "", err
	}
	evidence := make(map[string]string)
	for rows.Next() {
		var questionID, response string
		if err := rows.Scan(&questionID, &response); err != nil {
			rows.Close()
			return false, "", "", err
		}
		evidence[questionID] = response
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return false, "", "", err
	}
	rows.Close()
	overlaid := make([]scoringRow, len(scoring))
	copy(overlaid, scoring)
	for i := range overlaid {
		response, ok := evidence[overlaid[i].examQuestionID]
		if !ok {
			continue
		}
		input, answered := assessscore.V2ResponseToScorerInput(response)
		overlaid[i].response = sql.NullString{String: input, Valid: answered}
	}
	rawCorrect, operationalCount := scoreScoringRows(overlaid)
	evidenceRoute, err := chooseAdaptiveRoute(rawCorrect, operationalCount, policyConfig)
	if err != nil {
		return false, "", "", err
	}
	return evidenceRoute != scoredRoute, scoredRoute, evidenceRoute, nil
}

func boolLabel(v bool) string {
	if v {
		return "true"
	}
	return "false"
}

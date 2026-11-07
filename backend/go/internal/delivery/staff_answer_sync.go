package delivery

import (
	"context"
	"database/sql"
	"encoding/json"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
)

func (s *Service) syncStaffMovedAnswers(ctx context.Context, scheduleID, attemptID string, req LateEvidenceRequest, writerBinding ...string) (*LateEvidenceAck, error) {
	prepared, err := prepareLateEvidence(req)
	if err != nil {
		return nil, err
	}
	out := &LateEvidenceAck{}
	err = s.runner.WithTxRCRetry(ctx, 3, func(ctx context.Context, q tx.Tx) error {
		out.Recorded = 0
		var terminal bool
		var lease uint64
		if err := q.QueryRowContext(ctx, `SELECT (submitted_at IS NOT NULL OR phase='post-exam' OR COALESCE(delivery_status,'running') IN ('submitted','terminated','locked','cancelled') OR COALESCE(proctor_status,'active')='terminated'),lease_epoch FROM student_attempts WHERE id=? AND schedule_id=? FOR UPDATE`, attemptID, scheduleID).Scan(&terminal, &lease); err != nil {
			return err
		}
		if err := enforceWriterSessionTx(ctx, q, scheduleID, attemptID, writerBinding...); err != nil {
			return err
		}
		if terminal {
			return nil
		}
		now, err := dbTimeTx(ctx, q)
		if err != nil {
			return err
		}
		changed := false
		for _, entry := range prepared {
			a := entry.answer
			if a.OriginControlEpoch == nil || *a.OriginControlEpoch == 0 || a.OriginLeaseEpoch == nil || *a.OriginLeaseEpoch < 1 || uint64(*a.OriginLeaseEpoch) != lease || a.ClientVersion == nil || *a.ClientVersion < 1 {
				continue
			}
			var cutoff uint64
			err := q.QueryRowContext(ctx, `SELECT response_revision FROM assessment_staff_move_sources WHERE attempt_id=? AND module_id=? AND lease_epoch=? AND control_epoch>=? ORDER BY control_epoch LIMIT 1`, attemptID, req.ModuleID, lease, *a.OriginControlEpoch).Scan(&cutoff)
			if err == sql.ErrNoRows {
				continue
			}
			if err != nil {
				return err
			}
			var belongs bool
			if err := q.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM assessment_exam_questions eq JOIN assessment_modules m ON m.id=eq.module_id JOIN assessment_sections sec ON sec.id=m.section_id JOIN student_attempts a ON a.published_version_id=sec.exam_version_id WHERE a.id=? AND eq.id=? AND eq.module_id=?)`, attemptID, a.QuestionID, req.ModuleID).Scan(&belongs); err != nil {
				return err
			}
			if !belongs {
				return apperrors.New(apperrors.CodeValidation, "The delayed answer does not belong to its original module.")
			}
			var payload attempts.ResponsePayload
			if err := json.Unmarshal(a.Response, &payload); err != nil {
				return err
			}
			applied, err := attempts.RestoreStaffMovedResponseInTx(ctx, q, attemptID, req.ModuleID, lease, *a.OriginControlEpoch, cutoff, attempts.ResponseCommand{WriteID: a.WriteID, QuestionID: a.QuestionID, ClientVersion: uint64(*a.ClientVersion), Response: payload}, now)
			if err != nil {
				return err
			}
			changed = changed || applied
			out.Recorded++
		}
		if !changed {
			return nil
		}
		// Keep closed-module scores current without rerouting or touching timers.
		var moduleAttemptID, state string
		err = q.QueryRowContext(ctx, "SELECT id,state FROM assessment_module_attempts WHERE attempt_id=? AND module_id=?", attemptID, req.ModuleID).Scan(&moduleAttemptID, &state)
		if err != nil {
			return err
		}
		if state == "locked" || state == "submitted" {
			scoring, err := loadScoringRowsTx(ctx, q, moduleAttemptID, req.ModuleID)
			if err != nil {
				return err
			}
			correct, total := scoreScoringRows(scoring)
			if _, err := q.ExecContext(ctx, "UPDATE assessment_module_attempts SET raw_correct=?,operational_question_count=?,revision=revision+1 WHERE id=?", correct, total, moduleAttemptID); err != nil {
				return err
			}
		}
		return nil
	})
	return out, err
}

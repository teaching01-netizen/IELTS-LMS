package student

import (
	"context"
	"database/sql"
	"encoding/json"

	"example.com/ielts-proctoring/internal/platform/answerblobs"
)

// getSessionRowFirst serves GetSession under the B3 row-first posture:
// protocol-2 attempts resolve answers through the attempt_responses_v2
// materializer (blob columns go stale on the write path); protocol-1
// attempts keep column-authoritative blobs; unknown protocol fails closed
// to the columns (never an empty view for a V1 attempt).
func (s *Service) getSessionRowFirst(ctx context.Context, attemptID string) (Session, error) {
	var out Session
	var answers sql.NullString
	var protocol sql.NullInt64
	err := s.db.QueryRowContext(ctx, "SELECT id, schedule_id, phase, CAST(answers AS CHAR), COALESCE(protocol_version,1) FROM student_attempts WHERE id = ?", attemptID).Scan(&out.AttemptID, &out.ScheduleID, &out.Phase, &answers, &protocol)
	if err != nil {
		return Session{}, err
	}
	if !protocol.Valid || protocol.Int64 != 2 {
		if answers.Valid && answers.String != "" {
			out.Answers = json.RawMessage(answers.String)
		} else {
			out.Answers = json.RawMessage("{}")
		}
		return out, nil
	}
	blobs, err := materializeAttempt(ctx, s.db, attemptID)
	if err != nil {
		return Session{}, err
	}
	out.Answers = json.RawMessage(blobs.Answers)
	return out, nil
}

// getBootstrapRowFirst serves Bootstrap.flags under row-first: protocol-2
// attempts resolve flags through the materializer; protocol-1 keeps columns.
func (s *Service) getBootstrapRowFirst(ctx context.Context, attemptID string) (Bootstrap, error) {
	var out Bootstrap
	var flags, recovery sql.NullString
	var protocol sql.NullInt64
	err := s.db.QueryRowContext(ctx, "SELECT id, CAST(flags AS CHAR), CAST(recovery AS CHAR), COALESCE(protocol_version,1) FROM student_attempts WHERE id = ?", attemptID).Scan(&out.AttemptID, &flags, &recovery, &protocol)
	if err != nil {
		return Bootstrap{}, err
	}
	if recovery.Valid && recovery.String != "" {
		out.Recovery = json.RawMessage(recovery.String)
	} else {
		out.Recovery = json.RawMessage("{}")
	}
	if !protocol.Valid || protocol.Int64 != 2 {
		if flags.Valid && flags.String != "" {
			out.Flags = json.RawMessage(flags.String)
		} else {
			out.Flags = json.RawMessage("{}")
		}
		return out, nil
	}
	blobs, err := materializeAttempt(ctx, s.db, attemptID)
	if err != nil {
		return Bootstrap{}, err
	}
	out.Flags = json.RawMessage(blobs.Flags)
	return out, nil
}

// materializeAttempt rebuilds the legacy triple from response rows via the
// shared leaf codec (same bytes as the seal-time materialization).
func materializeAttempt(ctx context.Context, db *sql.DB, attemptID string) (answerblobs.Blobs, error) {
	rows, err := db.QueryContext(ctx,
		`SELECT r.question_id, r.module_id, COALESCE(s.section_key, ''), CAST(r.response AS CHAR)
		 FROM attempt_responses_v2 r
		 LEFT JOIN assessment_modules m ON m.id = r.module_id
		 LEFT JOIN assessment_sections s ON s.id = m.section_id
		 WHERE r.attempt_id = ? ORDER BY r.question_id`,
		attemptID)
	if err != nil {
		return answerblobs.Blobs{}, err
	}
	defer rows.Close()
	var cells []answerblobs.Cell
	for rows.Next() {
		var questionID, moduleID, sectionKey, raw string
		if err := rows.Scan(&questionID, &moduleID, &sectionKey, &raw); err != nil {
			return answerblobs.Blobs{}, err
		}
		cells = append(cells, answerblobs.Cell{QuestionID: questionID, ModuleID: moduleID, SectionKey: sectionKey, Canonical: json.RawMessage(raw)})
	}
	if err := rows.Err(); err != nil {
		return answerblobs.Blobs{}, err
	}
	return answerblobs.Assemble(cells)
}

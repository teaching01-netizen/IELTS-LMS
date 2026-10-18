package main

import (
	"context"
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"regexp"
	"strings"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/tx"
)

// jsonObjectField matches one JSON argument that must be a JSON object and
// asserts a set of value paths inside it. The compatibility final_submission is
// a JSON document, so an equality expectation cannot express "carries the
// sealed answers". A mismatch records which path failed, because
// "arguments do not match" alone would not say whether the answers were lost or
// merely renamed.
type jsonObjectField struct {
	paths  [][]string
	detail *string
}

func (m jsonObjectField) Match(value driver.Value) bool {
	raw, ok := value.(string)
	if !ok {
		m.record("expected a JSON string argument, got " + fmt.Sprintf("%T", value))
		return false
	}
	var object any
	if err := json.Unmarshal([]byte(raw), &object); err != nil {
		m.record("argument is not JSON: " + err.Error())
		return false
	}
	for _, path := range m.paths {
		current := object
		for index, step := range path {
			next, ok := current.(map[string]any)
			if !ok {
				m.record(strings.Join(path[:index], ".") + " is not an object in " + raw)
				return false
			}
			current, ok = next[step]
			if !ok || current == nil {
				m.record(strings.Join(path[:index+1], ".") + " is missing in " + raw)
				return false
			}
		}
		switch typed := current.(type) {
		case string:
			if typed == "" {
				m.record(strings.Join(path, ".") + " is empty in " + raw)
				return false
			}
		case []any:
			if len(typed) == 0 {
				m.record(strings.Join(path, ".") + " is empty in " + raw)
				return false
			}
		}
	}
	return true
}

func (m jsonObjectField) record(detail string) {
	if m.detail != nil {
		*m.detail = detail
	}
}

// A student's own V2 submit used to stamp a final_submission with receipt
// fields only. The IELTS grading projection reads answers/writingAnswers from
// that document, so a fully answered exam projected every section as an empty
// answer map — indistinguishable from answers that were never saved.
func TestTerminalSealerSealSubmittedPublishesSealedAnswerMaps(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	defer db.Close()

	detail := ""
	jsonField := func(paths ...[]string) jsonObjectField {
		return jsonObjectField{paths: paths, detail: &detail}
	}
	field := func(name string) []string { return []string{name} }

	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta(
		"SELECT outcome FROM attempt_terminalizations WHERE attempt_id = ? FOR UPDATE",
	)).WithArgs("attempt-1").WillReturnRows(sqlmock.NewRows([]string{"outcome"}))
	mock.ExpectQuery(regexp.QuoteMeta(
		"SELECT answer_revision, revision, organization_id FROM student_attempts WHERE id = ?",
	)).WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{"answer_revision", "revision", "organization_id"}).AddRow(3, 5, nil),
	)
	mock.ExpectExec(regexp.QuoteMeta(
		"INSERT INTO attempt_terminalizations (attempt_id, organization_id, terminalization_id, schedule_id, outcome, reason, actor_kind, actor_id, effective_at, recorded_at, answer_revision, final_snapshot, request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(6), ?, ?, ?)",
	)).WithArgs("attempt-1", nil, sqlmock.AnyArg(), "schedule-1", "submitted", "student_submit", "student", "student-1", sqlmock.AnyArg(), 3, sqlmock.AnyArg(), "3f2a1c9e-0000-4000-8000-000000000001").
		WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectQuery(regexp.QuoteMeta(
		"SELECT COALESCE(protocol_version, 1), answers, writing_answers, flags FROM student_attempts WHERE id = ? FOR UPDATE",
	)).WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{"protocol_version", "answers", "writing_answers", "flags"}).
			AddRow(2, `{"stale":"never surfaced"}`, `{}`, `{}`),
	)
	mock.ExpectQuery(regexp.QuoteMeta(`
		SELECT r.question_id, r.module_id, COALESCE(s.section_key, ''), CAST(r.response AS CHAR)
		FROM attempt_responses_v2 r
		LEFT JOIN assessment_modules m ON m.id = r.module_id
		LEFT JOIN assessment_sections s ON s.id = m.section_id
		WHERE r.attempt_id = ? ORDER BY r.question_id`)).WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{"question_id", "module_id", "section_key", "response"}).
			AddRow("reading-q1", "reading", "", `{"answer":"option-b","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`).
			AddRow("match-block", "reading", "", `{"answer":["i",""],"markedForReview":false,"eliminatedOptions":[],"annotations":[]}`).
			AddRow("task1", "writing", "", `{"answer":"<p>My essay.</p>","markedForReview":false,"eliminatedOptions":[],"annotations":[]}`),
	)
	mock.ExpectExec(regexp.QuoteMeta(
		"UPDATE student_attempts SET answers=?, writing_answers=?, flags=? WHERE id=?",
	)).WithArgs(jsonField(field("reading-q1"), field("match-block")), jsonField(field("task1")), "{}", "attempt-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(
		"UPDATE student_attempts SET phase = 'post-exam', delivery_status = 'submitted', final_submission = ?, submitted_at = COALESCE(submitted_at, ?), updated_at = UTC_TIMESTAMP(6), revision = revision + 1, control_epoch = control_epoch + 1 WHERE id = ? AND schedule_id = ? AND ((submitted_at IS NULL AND phase <> 'post-exam') OR (delivery_status = 'submitted' AND phase = 'post-exam' AND final_submission IS NULL)) AND COALESCE(proctor_status, 'active') <> 'terminated'",
	)).WithArgs(
		jsonField([]string{"answers", "reading-q1"}, []string{"answers", "match-block"}, []string{"writingAnswers", "task1"}),
		sqlmock.AnyArg(), "attempt-1", "schedule-1",
	).WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	sealer := terminalSealer{outboxExecOnly: true}
	runErr := tx.NewRunner(db).WithTxRetry(context.Background(), 1, func(ctx context.Context, q tx.Tx) error {
		return sealer.SealSubmitted(ctx, q, "attempt-1", "schedule-1", "3f2a1c9e-0000-4000-8000-000000000001", "digest-1", "ielts", "student-1", time.Date(2026, time.October, 18, 3, 24, 2, 0, time.UTC))
	})
	if runErr != nil {
		if detail != "" {
			t.Fatalf("SealSubmitted: %v (%s)", runErr, detail)
		}
		t.Fatalf("SealSubmitted: %v", runErr)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("sql expectations: %v", err)
	}
}

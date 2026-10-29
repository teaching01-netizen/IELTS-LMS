package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/platform/apperrors"
	"example.com/ielts-proctoring/internal/platform/tx"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

func TestRecoveryCloseAckLoadsOnlySelectedModuleMetadata(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	moduleColumns := []string{
		"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at",
		"accumulated_paused_seconds", "extension_seconds", "completion_reason", "raw_correct",
		"operational_question_count", "tool_state", "revision", "entry_generation", "entry_starts_at",
		"entry_confirmed_at", "entry_entered_at", "auto_start_at", "control_epoch", "route_basis",
		"late_answer_count", "selected_route", "server_now",
	}
	mock.ExpectQuery("SELECT ma.id, ma.module_id, ma.state").WithArgs("m1", "attempt-1").WillReturnRows(
		sqlmock.NewRows(moduleColumns).
			AddRow("attempt-m1", "m1", "locked", 600, now.Add(-time.Minute), now.Add(-11*time.Minute), nil,
				0, 0, "time_expired", 25, 27, "{}", 3, 0, nil, nil, nil, nil, 4,
				"client_confirmed", 0, "higher", now).
			AddRow("attempt-m2", "m2", "not_started", 600, now, nil, nil,
				0, 0, nil, nil, nil, "{}", 1, 1, nil, nil, nil, nil, 4,
				"client_confirmed", 0, "higher", now),
	)
	mock.ExpectQuery("FROM assessment_attempt_breaks").WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{
			"id", "after_section_id", "duration_seconds", "state", "starts_at", "deadline_at",
			"entered_at", "paused_at", "accumulated_paused_seconds", "entry_generation",
			"entry_starts_at", "entry_confirmed_at", "entry_entered_at", "revision",
		}).AddRow("break-1", "section-rw", 600, "pending", nil, nil, nil, nil, 0, 0, nil, nil, nil, 0),
	)
	mock.ExpectQuery("SELECT sec.id, sec.section_key").WithArgs("version-1", "m2", "schedule-1", "attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{
			"section_id", "section_key", "section_title", "section_order", "section_duration",
			"break_after", "section_instructions", "module_id", "module_key", "module_title",
			"module_order", "module_duration", "target_question_count", "adaptive_role",
			"tool_policy", "publish_scope", "enabled_sections",
		}).AddRow("section-1", "math", "Math", 1, 2100, 600, `{"direction":"read"}`,
			"m2", "math-m2", "Math Module 2", 2, 600, 27, "higher",
			`{"calculator":true}`, nil, nil),
	)

	ack, err := NewService(db, tx.NewRunner(db)).closeAck(
		context.Background(), "schedule-1", "attempt-1", "version-1", "m1", "m2", false, true,
	)
	if err != nil {
		t.Fatalf("closeAck: %v", err)
	}
	if len(ack.PersonalBreaks) != 1 {
		t.Fatalf("expected the commit-time break projection, got %#v", ack.PersonalBreaks)
	}
	if brk := ack.PersonalBreaks[0]; brk.ID != "break-1" || brk.AfterSectionID != "section-rw" ||
		brk.DurationSeconds != 600 || brk.State != "pending" || brk.Revision != 0 {
		t.Fatalf("break projection changed: %#v", brk)
	}
	if ack.SelectedSection == nil || len(ack.SelectedSection.Modules) != 1 {
		t.Fatalf("expected one selected module stub, got %#v", ack.SelectedSection)
	}
	module := ack.SelectedSection.Modules[0]
	if module.ID != "m2" || !module.ContentWithheld || len(module.Questions) != 0 || module.Instructions != nil {
		t.Fatalf("recovery close exposed unstarted module content: %#v", module)
	}
	if string(ack.SelectedSection.Instructions) != `{"direction":"read"}` {
		t.Fatalf("section directions changed: %s", json.RawMessage(ack.SelectedSection.Instructions))
	}
	if ack.ModuleAttempts[1].DeadlineAt != nil || ack.ModuleAttempts[1].RemainingSeconds == nil || *ack.ModuleAttempts[1].RemainingSeconds != 600 {
		t.Fatalf("unstarted module timing projection changed: %#v", ack.ModuleAttempts[1])
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A break projection read failure must not turn a committed close into a
// refused one: the module rows are already durable and the client's bounded
// boundary pull is the recovery path.
func TestCloseAckBreakProjectionFailureIsNonFatal(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT ma.id, ma.module_id, ma.state").WithArgs("m1", "attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{
			"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at",
			"accumulated_paused_seconds", "extension_seconds", "completion_reason", "raw_correct",
			"operational_question_count", "tool_state", "revision", "entry_generation", "entry_starts_at",
			"entry_confirmed_at", "entry_entered_at", "auto_start_at", "control_epoch", "route_basis",
			"late_answer_count", "selected_route", "server_now",
		}).
			AddRow("attempt-m1", "m1", "locked", 600, now.Add(-time.Minute), now.Add(-11*time.Minute), nil,
				0, 0, "time_expired", 25, 27, "{}", 3, 0, nil, nil, nil, nil, 4,
				"client_confirmed", 0, "higher", now),
	)
	mock.ExpectQuery("FROM assessment_attempt_breaks").WithArgs("attempt-1").
		WillReturnError(errors.New("breaks unavailable"))

	ack, err := NewService(db, tx.NewRunner(db)).closeAck(
		context.Background(), "schedule-1", "attempt-1", "version-1", "m1", "", false, true,
	)
	if err != nil {
		t.Fatalf("a committed close must still answer: %v", err)
	}
	if ack == nil {
		t.Fatal("closeAck returned a nil ack")
	}
	if ack.PersonalBreaks == nil || len(ack.PersonalBreaks) != 0 {
		t.Fatalf("failed projection must answer with an empty, non-nil list: %#v", ack.PersonalBreaks)
	}
	body, err := json.Marshal(ack)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), `"personalBreaks":[]`) {
		t.Fatalf("wire contract must stay an array: %s", body)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The read is unconditional: a close that crosses no boundary (or one whose
// break is already finished) still returns every row the attempt owns, so a
// merge can never resurrect an advanced break.
func TestCloseAckReturnsEveryBreakRow(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT ma.id, ma.module_id, ma.state").WithArgs("m2", "attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{
			"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at",
			"accumulated_paused_seconds", "extension_seconds", "completion_reason", "raw_correct",
			"operational_question_count", "tool_state", "revision", "entry_generation", "entry_starts_at",
			"entry_confirmed_at", "entry_entered_at", "auto_start_at", "control_epoch", "route_basis",
			"late_answer_count", "selected_route", "server_now",
		}).
			AddRow("attempt-m2", "m2", "locked", 600, now, nil, nil,
				0, 0, "time_expired", 20, 27, "{}", 2, 0, nil, nil, nil, nil, 4,
				"client_confirmed", 0, "higher", now),
	)
	mock.ExpectQuery("FROM assessment_attempt_breaks").WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{
			"id", "after_section_id", "duration_seconds", "state", "starts_at", "deadline_at",
			"entered_at", "paused_at", "accumulated_paused_seconds", "entry_generation",
			"entry_starts_at", "entry_confirmed_at", "entry_entered_at", "revision",
		}).
			AddRow("break-rw", "section-rw", 600, "completed", now.Add(-20*time.Minute), now.Add(-10*time.Minute),
				now.Add(-19*time.Minute), nil, 0, 2, nil, nil, nil, 3),
	)

	ack, err := NewService(db, tx.NewRunner(db)).closeAck(
		context.Background(), "schedule-1", "attempt-1", "version-1", "m2", "", false, true,
	)
	if err != nil {
		t.Fatalf("closeAck: %v", err)
	}
	if len(ack.PersonalBreaks) != 1 || ack.PersonalBreaks[0].State != "completed" ||
		ack.PersonalBreaks[0].Revision != 3 {
		t.Fatalf("expected the full break projection, got %#v", ack.PersonalBreaks)
	}
	if ack.NextModuleID != nil || ack.SelectedSection != nil {
		t.Fatalf("a same-section close must not invent a follow-up: %#v", ack)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The reconciler can win the close race: the browser's retry then sees
// alreadyClosed, and the ack is rebuilt by the same closeAck builder. It must
// still carry the break the first close created.
func TestAlreadyClosedAckReusesTheBreakProjection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	now := time.Date(2026, 10, 22, 12, 0, 0, 0, time.UTC)
	mock.ExpectQuery("SELECT ma.id, ma.module_id, ma.state").WithArgs("m1", "attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{
			"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at",
			"accumulated_paused_seconds", "extension_seconds", "completion_reason", "raw_correct",
			"operational_question_count", "tool_state", "revision", "entry_generation", "entry_starts_at",
			"entry_confirmed_at", "entry_entered_at", "auto_start_at", "control_epoch", "route_basis",
			"late_answer_count", "selected_route", "server_now",
		}).
			AddRow("attempt-m1", "m1", "locked", 600, now.Add(-time.Minute), now.Add(-11*time.Minute), nil,
				0, 0, "time_expired", 25, 27, "{}", 3, 0, nil, nil, nil, nil, 4,
				"client_confirmed", 0, "higher", now),
	)
	mock.ExpectQuery("FROM assessment_attempt_breaks").WithArgs("attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{
			"id", "after_section_id", "duration_seconds", "state", "starts_at", "deadline_at",
			"entered_at", "paused_at", "accumulated_paused_seconds", "entry_generation",
			"entry_starts_at", "entry_confirmed_at", "entry_entered_at", "revision",
		}).AddRow("break-rw", "section-rw", 600, "pending", nil, nil, nil, nil, 0, 0, nil, nil, nil, 0),
	)

	ack, err := NewService(db, tx.NewRunner(db)).closeAck(
		context.Background(), "schedule-1", "attempt-1", "version-1", "m1", "", true, true,
	)
	if err != nil {
		t.Fatalf("closeAck: %v", err)
	}
	if !ack.AlreadyClosed {
		t.Fatal("expected an alreadyClosed ack")
	}
	if len(ack.PersonalBreaks) != 1 || ack.PersonalBreaks[0].ID != "break-rw" ||
		ack.PersonalBreaks[0].State != "pending" {
		t.Fatalf("alreadyClosed must project the existing break: %#v", ack.PersonalBreaks)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestSelectedModuleSectionMetadataEnforcesPublishedSectionScope(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT sec.id, sec.section_key").WithArgs("version-1", "m2", "schedule-1", "attempt-1").WillReturnRows(
		sqlmock.NewRows([]string{
			"section_id", "section_key", "section_title", "section_order", "section_duration",
			"break_after", "section_instructions", "module_id", "module_key", "module_title",
			"module_order", "module_duration", "target_question_count", "adaptive_role",
			"tool_policy", "publish_scope", "enabled_sections",
		}).AddRow("section-1", "math", "Math", 1, 2100, 600, nil,
			"m2", "math-m2", "Math Module 2", 2, 600, 27, "higher", nil,
			"reading_writing", nil),
	)

	_, err = NewService(db, tx.NewRunner(db)).selectedModuleSectionMetadata(
		context.Background(), "attempt-1", "schedule-1", "version-1", "m2",
	)
	e, ok := apperrors.As(err)
	if !ok || e.Code != apperrors.CodeNotFound {
		t.Fatalf("out-of-scope module metadata must remain hidden, got %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestCloseRequiresExactDurableWrite(t *testing.T) {
	for _, tc := range []struct {
		name          string
		write         string
		version       int64
		lease         int64
		hash          string
		ledgerWrite   any
		ledgerVersion any
		ledgerLease   any
		ledgerHash    any
		pending       int
	}{
		{"exact", "wanted", 1, 2, "hash", "wanted", int64(1), int64(2), "hash", 0},
		{"old writer high version", "old", 20, 1, "oldhash", "old", int64(20), int64(1), "oldhash", 1},
		{"projection without ledger", "wanted", 1, 2, "hash", nil, nil, nil, nil, 1},
		{"hash disagreement", "wanted", 1, 2, "hash", "wanted", int64(1), int64(2), "other", 1},
		{"lease disagreement", "wanted", 1, 2, "hash", "wanted", int64(1), int64(1), "hash", 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			mock.ExpectBegin()
			tr, err := db.BeginTx(context.Background(), &sql.TxOptions{})
			if err != nil {
				t.Fatal(err)
			}
			mock.ExpectQuery("FROM assessment_exam_questions eq LEFT JOIN attempt_responses_v2").WithArgs("a1", "m1", "q1").WillReturnRows(sqlmock.NewRows([]string{"id", "client_version", "lease_epoch", "client_write_id", "response_hash", "ledger_write_id", "ledger_version", "ledger_lease", "ledger_hash"}).AddRow("q1", tc.version, tc.lease, tc.write, tc.hash, tc.ledgerWrite, tc.ledgerVersion, tc.ledgerLease, tc.ledgerHash))
			pending, err := pendingCloseWritesTx(context.Background(), tr, "a1", "m1", []ModuleCloseAnswer{{QuestionID: "q1", WriteID: "wanted", ClientVersion: 1}})
			if err != nil || len(pending) != tc.pending {
				t.Fatalf("pending=%v err=%v", pending, err)
			}
			mock.ExpectRollback()
			_ = tr.Rollback()
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func TestPendingCloseWritesRejectsDuplicateAndInvalidEntries(t *testing.T) {
	for _, entries := range [][]ModuleCloseAnswer{
		{{QuestionID: "q1", WriteID: "w1", ClientVersion: 0}},
		{{QuestionID: "", WriteID: "w1", ClientVersion: 1}},
		{{QuestionID: "q1", ClientVersion: 1}},
		{{QuestionID: "q1", WriteID: "w1", ClientVersion: 1}, {QuestionID: "q1", WriteID: "w2", ClientVersion: 2}},
	} {
		_, err := pendingCloseWritesTx(context.Background(), nil, "a1", "m1", entries)
		e, ok := apperrors.As(err)
		if !ok || e.Code != apperrors.CodeValidation {
			t.Fatalf("expected validation, got %v", err)
		}
	}
}

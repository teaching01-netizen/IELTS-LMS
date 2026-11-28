package delivery

import (
	"context"
	"regexp"
	"strings"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func keyPolicyRows(visible, keys bool) *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"policy_revision", "report_visible", "include_answer_key_in_pdf",
		"study_enabled", "study_required_completions", "study_reveal_answers", "study_untimed", "unlimited_retakes", "pause_on_leave",
	}).AddRow(int64(4), visible, keys, false, int64(1), true, true, false, false)
}

func expectKeyGate(mock sqlmock.Sqlmock, deliveryStatus, proctor, outcome string, submitted any, visible, keys bool) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT sa.schedule_id, COALESCE(sa.delivery_status")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id", "delivery_status", "proctor_status", "outcome", "submitted_at"}).
			AddRow("sched-1", deliveryStatus, proctor, outcome, submitted))
	mock.ExpectQuery(regexp.QuoteMeta("FROM sat_activity_policies WHERE schedule_id")).
		WithArgs("sched-1").
		WillReturnRows(keyPolicyRows(visible, keys))
}

func TestKeyedPDFAllowed(t *testing.T) {
	now := time.Date(2026, 11, 18, 0, 0, 0, 0, time.UTC)
	for _, tc := range []struct {
		name      string
		status    string
		proctor   string
		outcome   string
		submitted any
		visible   bool
		keys      bool
		want      bool
	}{
		{name: "valid completed keyed", status: "submitted", proctor: "active", outcome: "submitted", submitted: now, visible: true, keys: true, want: true},
		{name: "report hidden", status: "submitted", proctor: "active", outcome: "submitted", submitted: now, visible: false, keys: false},
		{name: "key permission revoked", status: "submitted", proctor: "active", outcome: "submitted", submitted: now, visible: true, keys: false},
		{name: "not submitted", status: "running", proctor: "active", outcome: "", submitted: nil, visible: true, keys: true},
		{name: "terminated outcome", status: "submitted", proctor: "active", outcome: "terminated", submitted: now, visible: true, keys: true},
		{name: "proctor terminated", status: "terminated", proctor: "terminated", outcome: "submitted", submitted: now, visible: true, keys: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			db, mock, err := sqlmock.New()
			if err != nil {
				t.Fatal(err)
			}
			defer db.Close()
			expectKeyGate(mock, tc.status, tc.proctor, tc.outcome, tc.submitted, tc.visible, tc.keys)
			service := &Service{db: db}
			got, err := service.KeyedPDFAllowed(context.Background(), "att-1")
			if err != nil {
				t.Fatal(err)
			}
			if got != tc.want {
				t.Fatalf("allowed = %v, want %v", got, tc.want)
			}
			if err := mock.ExpectationsWereMet(); err != nil {
				t.Fatal(err)
			}
		})
	}
}

func keyedExam() *AnsweredExam {
	return &AnsweredExam{
		AttemptID: "att-1",
		VersionID: "ver-1",
		Attempt:   AttemptSnapshot{ID: "att-1", ModuleAttempts: []ModuleAttempt{{ID: "ma-1", ModuleID: "mod-1", StartedAt: nil}}},
	}
}

func expectKeyRows(mock sqlmock.Sqlmock, rows *sqlmock.Rows) {
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules m")).
		WithArgs("att-1", "att-1", "ver-1", "mod-1").
		WillReturnRows(rows)
}

func expectKeyPolicyLookup(mock sqlmock.Sqlmock) {
	mock.ExpectQuery(regexp.QuoteMeta("SELECT schedule_id FROM student_attempts WHERE id = ?")).
		WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"schedule_id"}).AddRow("sched-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM sat_activity_policies WHERE schedule_id")).
		WithArgs("sched-1").
		WillReturnRows(keyPolicyRows(true, true))
}

func TestAttachAnswerKeyProjectsAllAcceptedForms(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	rows := sqlmock.NewRows([]string{"module_id", "exam_question_id", "is_pretest", "answer_definition", "config_snapshot", "v2", "legacy", "rationale"}).
		AddRow("mod-1", "eq-1", false,
			`{"kind":"student_produced_response","acceptedResponses":["2/3",".6667","0.6667"]}`,
			"{}", `{"answer":"2/3"}`, nil, "{}").
		AddRow("mod-1", "eq-2", false,
			`{"kind":"single_choice","correctOptionId":"opt-b","options":[{"id":"opt-a","content":{"text":"Alpha"}},{"id":"opt-b","content":{"text":"Beta"}}]}`,
			"{}", nil, `"opt-a"`, `{"version":1,"nodes":[{"type":"paragraph","text":"Only Beta fits."}]}`).
		AddRow("mod-1", "eq-3", true, `{"kind":"single_choice"}`, "{}", nil, nil, "{}")
	expectKeyRows(mock, rows)
	expectKeyPolicyLookup(mock)

	exam := keyedExam()
	if err := (&Service{db: db}).attachAnswerKey(context.Background(), exam); err != nil {
		t.Fatal(err)
	}
	if exam.AnswerKey == nil || !exam.AnswerKey.Available || exam.AnswerKey.PolicyRevision != 4 {
		t.Fatalf("answerKey = %+v", exam.AnswerKey)
	}
	if len(exam.AnswerKey.Entries) != 2 {
		t.Fatalf("entries = %+v, want pretest excluded", exam.AnswerKey.Entries)
	}
	spr := exam.AnswerKey.Entries[0]
	if len(spr.CorrectAnswers) != 3 || spr.Result != "correct" || spr.ExamQuestionID != "eq-1" {
		t.Fatalf("spr = %+v", spr)
	}
	choice := exam.AnswerKey.Entries[1]
	if choice.Result != "incorrect" || len(choice.CorrectAnswers) != 1 || choice.CorrectAnswers[0].Label != "B" || !strings.Contains(string(choice.Explanation), "Only Beta fits.") {
		t.Fatalf("choice = %+v", choice)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestAttachAnswerKeyMissingKeyFailsClosed(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	expectKeyRows(mock, sqlmock.NewRows([]string{"module_id", "exam_question_id", "is_pretest", "answer_definition", "config_snapshot", "v2", "legacy", "rationale"}).
		AddRow("mod-1", "eq-1", false, `{"kind":"single_choice","options":[{"id":"a"}]}`, "{}", nil, nil, "{}"))

	err = (&Service{db: db}).attachAnswerKey(context.Background(), keyedExam())
	if keyCodeOf(err) != apperrors.CodeAnswerKeyUnavailable {
		t.Fatalf("err = %v, want ANSWER_KEY_UNAVAILABLE", err)
	}
}

func keyCodeOf(err error) apperrors.Code {
	if typed, ok := apperrors.As(err); ok {
		return typed.Code
	}
	return ""
}

package main

// Audit finding 4, resolver half: a multi-answer flush used to pay one
// question->module query per answer — and, for legacy snapshot exams, one full
// content-snapshot read and JSON parse per answer — while the attempt row lock
// was held. v2Resolver.ResolveMany resolves the whole batch in one normalized
// query and shares one snapshot load, keeping the same per-question verdicts
// (including the SAT gate and NOT_FOUND) so the write loop still reports each
// error at the command that owns it.
import (
	"context"
	"database/sql/driver"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/attempts"
	"example.com/ielts-proctoring/internal/platform/apperrors"
)

func resolveManyWithMockDB(t *testing.T, prepare func(mock sqlmock.Sqlmock), questionIDs []string) map[string]attempts.QuestionVerdict {
	t.Helper()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectBegin()
	tx, err := db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	prepare(mock)
	mock.ExpectRollback()
	verdicts, err := (v2Resolver{}).ResolveMany(context.Background(), tx, "att-1", questionIDs)
	if err != nil {
		t.Fatalf("ResolveMany: %v", err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	return verdicts
}

func bulkNormalizedRows() *sqlmock.Rows {
	return sqlmock.NewRows([]string{
		"exam_question_id", "question_id", "module_id", "section_key", "state", "provider_key",
		"started_at", "allocated_seconds", "extension_seconds", "accumulated_paused_seconds",
		"timing_model", "entry_confirmed_at", "entry_entered_at", "timeline_state", "timeline_started_at", "timeline_deadline_at", "timeline_paused_at",
	}).AddRow("q-0", "q-0-inner", "mod-a", "reading-writing", "active", "ielts", nil, nil, nil, nil, "", nil, nil, "", nil, nil, nil).
		AddRow("eq-1-other", "q-1", "mod-b", "math", "review", "ielts", nil, nil, nil, nil, "", nil, nil, "", nil, nil, nil)
}

func bulkQuestionIDs() []string { return []string{"q-0", "q-1", "q-2", "q-3", "q-4", "q-5"} }

// TestV2ResolverResolveManyIsSetBased drives six questions (two normalized, four
// snapshot-backed) through one ResolveMany call: exactly one normalized query,
// one provider-gate query and one snapshot load, with per-question verdicts.
func TestV2ResolverResolveManyIsSetBased(t *testing.T) {
	const snapshot = `{"sections":{"reading":[{"questionId":"q-3"}]}}`
	verdicts := resolveManyWithMockDB(t, func(mock sqlmock.Sqlmock) {
		ids := bulkQuestionIDs()
		args := []driver.Value{"att-1", "att-1"}
		for _, id := range ids {
			args = append(args, id)
		}
		for _, id := range ids {
			args = append(args, id)
		}
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).WithArgs(args...).WillReturnRows(bulkNormalizedRows())
		// Provider gate: once for the batch, not once per unanswered question.
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules")).
			WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("ielts"))
		// ... and one shared snapshot load.
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a JOIN exam_versions v")).
			WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(snapshot))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(rt.timing_model, '')")).
			WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"timing_model"}).AddRow(""))
	}, bulkQuestionIDs())

	if len(verdicts) != 6 {
		t.Fatalf("expected a verdict for every question, got %d", len(verdicts))
	}
	// Matched by assessment_exam_questions.id: the id arm wins.
	if got := verdicts["q-0"]; got.Err != nil || got.Owner.ModuleID != "mod-a" || got.Owner.ModuleState != "active" || got.Owner.SectionKey != "reading-writing" {
		t.Fatalf("q-0 verdict = %+v", got)
	}
	// Matched by question_id, state passing through untouched.
	if got := verdicts["q-1"]; got.Err != nil || got.Owner.ModuleID != "mod-b" || got.Owner.ModuleState != "review" {
		t.Fatalf("q-1 verdict = %+v", got)
	}
	// Snapshot-backed question resolves active from the shared tree.
	if got := verdicts["q-3"]; got.Err != nil || got.Owner.ModuleState != "active" {
		t.Fatalf("q-3 verdict = %+v", got)
	}
	// Absent everywhere: per-question NOT_FOUND, not a batch failure.
	for _, id := range []string{"q-2", "q-4", "q-5"} {
		got := verdicts[id]
		appErr, ok := apperrors.As(got.Err)
		if !ok || appErr.Code != apperrors.CodeNotFound {
			t.Fatalf("%s must be NOT_FOUND per question, got %+v", id, got)
		}
	}
}

// TestV2ResolverResolveManySATGateSkipsSnapshot keeps defect 6 intact at batch
// scale: for a SAT attempt the snapshot tree is never consulted (the strict mock
// has no snapshot expectation, so a read would fail the run) and every
// snapshot-only question is refused per question.
func TestV2ResolverResolveManySATGateSkipsSnapshot(t *testing.T) {
	verdicts := resolveManyWithMockDB(t, func(mock sqlmock.Sqlmock) {
		ids := bulkQuestionIDs()
		args := []driver.Value{"att-1", "att-1"}
		for _, id := range ids {
			args = append(args, id)
		}
		for _, id := range ids {
			args = append(args, id)
		}
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).WithArgs(args...).
			WillReturnRows(sqlmock.NewRows([]string{
				"exam_question_id", "question_id", "module_id", "section_key", "state", "provider_key",
				"started_at", "allocated_seconds", "extension_seconds", "accumulated_paused_seconds",
				"timing_model", "entry_confirmed_at", "entry_entered_at", "timeline_state", "timeline_started_at", "timeline_deadline_at", "timeline_paused_at",
			}))
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules")).
			WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("sat"))
	}, bulkQuestionIDs())

	for _, id := range bulkQuestionIDs() {
		appErr, ok := apperrors.As(verdicts[id].Err)
		if !ok || appErr.Code != apperrors.CodeNotFound {
			t.Fatalf("SAT question %s must be refused per question, got %+v", id, verdicts[id])
		}
	}
}

func TestV2ResolverPersonalSATBulkCarriesAdmissionClock(t *testing.T) {
	now := time.Date(2026, 10, 7, 12, 0, 0, 0, time.UTC)
	verdicts := resolveManyWithMockDB(t, func(mock sqlmock.Sqlmock) {
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).
			WillReturnRows(sqlmock.NewRows([]string{
				"exam_question_id", "question_id", "module_id", "section_key", "state", "provider_key",
				"started_at", "allocated_seconds", "extension_seconds", "accumulated_paused_seconds",
				"timing_model", "entry_confirmed_at", "entry_entered_at", "timeline_state", "timeline_started_at", "timeline_deadline_at", "timeline_paused_at",
			}).AddRow("eq-1", "q-1", "mod-1", "math", "active", "sat", now, 600, 60, 30, "sat_personal_v1", now, nil, "", nil, nil, nil))
	}, []string{"eq-1"})
	owner := verdicts["eq-1"].Owner
	if owner.ModuleStartedAt == nil || !owner.ModuleStartedAt.Equal(now) {
		t.Fatalf("bulk owner loses personal SAT start: %+v", owner)
	}
	if owner.ModuleDeadlineAt == nil || !owner.ModuleDeadlineAt.Equal(now.Add(690*time.Second)) {
		t.Fatalf("bulk owner deadline = %+v", owner.ModuleDeadlineAt)
	}
	if owner.TimingModel != "sat_personal_v1" || owner.EntryConfirmedAt == nil || !owner.EntryConfirmedAt.Equal(now) {
		t.Fatalf("bulk owner loses captured timing/entry: %+v", owner)
	}
}

// TestV2ResolverResolveManyPersonalIELTSSnapshotBatch resolves several
// snapshot-only IELTS questions, including Writing task IDs, through one shared
// snapshot traversal: the SQL is the same as before (normalized, provider gate,
// snapshot, timing model, timelines) and each owner carries the current
// transaction's timeline for its own section.
func TestV2ResolverResolveManyPersonalIELTSSnapshotBatch(t *testing.T) {
	start := time.Date(2026, 10, 24, 9, 0, 40, 0, time.UTC)
	deadline := start.Add(time.Hour)
	const snapshot = `{"contentSnapshot":{"reading":[{"questionId":"r-1"},{"questionId":"shared"}],"writing":{"tasks":[{"taskId":"task1"},{"taskID":"task2"},{"id":"shared"}]}}}`
	ids := []string{"r-1", "task1", "task2", "shared", "absent"}
	verdicts := resolveManyWithMockDB(t, func(mock sqlmock.Sqlmock) {
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).WillReturnRows(sqlmock.NewRows([]string{
			"exam_question_id", "question_id", "module_id", "section_key", "state", "provider_key",
			"started_at", "allocated_seconds", "extension_seconds", "accumulated_paused_seconds",
			"timing_model", "entry_confirmed_at", "entry_entered_at", "timeline_state", "timeline_started_at", "timeline_deadline_at", "timeline_paused_at",
		}))
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules")).WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("ielts"))
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a JOIN exam_versions v")).WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(snapshot))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(rt.timing_model, '')")).WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"timing_model"}).AddRow("ielts_cohort_personal_v2"))
		mock.ExpectQuery(regexp.QuoteMeta("FROM ielts_attempt_section_timelines WHERE attempt_id = ?")).WithArgs("att-1").
			WillReturnRows(sqlmock.NewRows([]string{"section_key", "state", "started_at", "deadline_at", "paused_at"}).
				AddRow("reading", "active", start, deadline, nil))
	}, ids)

	reading := verdicts["r-1"]
	if reading.Err != nil || reading.Owner.SectionKey != "reading" || reading.Owner.SectionTimelineState != "active" ||
		reading.Owner.SectionTimelineDeadlineAt == nil || !reading.Owner.SectionTimelineDeadlineAt.Equal(deadline) ||
		reading.Owner.TimingModel != "ielts_cohort_personal_v2" {
		t.Fatalf("reading owner must carry its current timeline: %+v", reading)
	}
	if got := verdicts["shared"]; got.Err != nil || got.Owner.SectionKey != "reading" {
		t.Fatalf("first eligible root must own a shared ID: %+v", got)
	}
	// Writing content membership grants no time: no Writing timeline row exists.
	for _, id := range []string{"task1", "task2"} {
		got := verdicts[id]
		if got.Err != nil || got.Owner.SectionKey != "writing" || got.Owner.SectionTimelineState != "" || got.Owner.SectionTimelineStartedAt != nil {
			t.Fatalf("%s must resolve to Writing without an active timeline: %+v", id, got)
		}
	}
	if appErr, ok := apperrors.As(verdicts["absent"].Err); !ok || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("absent question must stay NOT_FOUND, got %+v", verdicts["absent"])
	}
}

func TestV2ResolverResolveManySnapshotAnswersAndFlags(t *testing.T) {
	const snapshot = `{"listening":{"parts":[{"blocks":[{"id":"notes","type":"NOTE_COMPLETION","questions":[{"id":"q39","blanks":[{"id":"b39"},{"id":"b40"}]}]}]}]}}`
	// The answer array is keyed by q39; individual review flags use slot IDs.
	ids := []string{"q39", "q39:b39", "q39:b40", "q39:foreign"}
	verdicts := resolveManyWithMockDB(t, func(mock sqlmock.Sqlmock) {
		args := []driver.Value{"att-1", "att-1"}
		for i := 0; i < 2; i++ {
			for _, id := range ids {
				args = append(args, id)
			}
		}
		mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq")).WithArgs(args...).WillReturnRows(bulkNormalizedRows())
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts sa JOIN exam_schedules")).WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"provider_key"}).AddRow("ielts"))
		mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts a JOIN exam_versions v")).WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"content_snapshot"}).AddRow(snapshot))
		mock.ExpectQuery(regexp.QuoteMeta("SELECT COALESCE(rt.timing_model, '')")).WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"timing_model"}).AddRow(""))
	}, ids)
	for _, id := range ids[:3] {
		got := verdicts[id]
		if got.Err != nil || got.Owner.SectionKey != "listening" || got.Owner.ModuleState != "active" {
			t.Errorf("answer/flag %q must resolve, got %+v", id, got)
		}
	}
	appErr, ok := apperrors.As(verdicts["q39:foreign"].Err)
	if !ok || appErr.Code != apperrors.CodeNotFound {
		t.Fatalf("foreign slot must remain NOT_FOUND: %+v", verdicts["q39:foreign"])
	}
}

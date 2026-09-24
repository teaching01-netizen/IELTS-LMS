package delivery

import (
	"context"
	"regexp"
	"testing"
	"time"

	sqlmock "github.com/DATA-DOG/go-sqlmock"

	"example.com/ielts-proctoring/internal/platform/telemetry"
	"example.com/ielts-proctoring/internal/platform/tx"
	examruntime "example.com/ielts-proctoring/internal/runtime"
)

// Plan 2026-09-24 (7.2): the attempt-owned timing model must be observable
// without candidate PII. The funnel is offer{event} -> entry{result} ->
// frame lead, all labelled by stage (module|break) only, and the
// first-active-frame lead is the release gate: a frame acknowledged after its
// authored start means the student's visible clock began below the authored
// duration.
func TestPersonalFrameLeadRecordsLateFirstFrames(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	startsAt := time.Date(2026, 9, 24, 2, 0, 0, 0, time.UTC)
	// A frame acknowledged 2s before its authored start: the candidate kept
	// their full time, so nothing pages.
	recordPersonalFrameLead(personalStageModule, startsAt, startsAt.Add(-2*time.Second))
	if got := telemetry.GaugeValueForTest(reg, telemetry.MSATPersonalFrameLeadSeconds, "stage", personalStageModule); got != 2 {
		t.Fatalf("frame lead gauge = %v, want 2", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalFrameLateTotal, "stage", personalStageModule); got != 0 {
		t.Fatalf("an early frame must not count late, got %v", got)
	}

	// The same frame 3s AFTER its start lost 3s of authored time: the counter
	// is what the release-gate alert reads.
	recordPersonalFrameLead(personalStageBreak, startsAt, startsAt.Add(3*time.Second))
	if got := telemetry.GaugeValueForTest(reg, telemetry.MSATPersonalFrameLeadSeconds, "stage", personalStageBreak); got != -3 {
		t.Fatalf("late frame lead gauge = %v, want -3", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalFrameLateTotal, "stage", personalStageBreak); got != 1 {
		t.Fatalf("a late frame must count once, got %v", got)
	}
}

func TestPersonalOfferArmCountsTheFunnelByStage(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	for _, stage := range []string{personalStageModule, personalStageBreak} {
		recordPersonalOffer(stage, "armed")
		recordPersonalOffer(stage, "rearmed")
		recordPersonalOffer(stage, "exhausted")
		recordPersonalEntry(stage, "confirmed")
		recordPersonalEntry(stage, "missed")
	}
	for _, stage := range []string{personalStageModule, personalStageBreak} {
		for _, event := range []string{"armed", "rearmed", "exhausted"} {
			// Each (stage, event) series is its own sample: the alert scoping on
			// event="rearmed" must not read another stage's traffic.
			if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalOfferTotal, "stage", stage, "event", event); got != 1 {
				t.Fatalf("offer{%s,%s} = %v, want 1", stage, event, got)
			}
		}
		for _, result := range []string{"confirmed", "missed"} {
			if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalEntryTotal, "stage", stage, "result", result); got != 1 {
				t.Fatalf("entry{%s,%s} = %v, want 1", stage, result, got)
			}
		}
	}
}

// The BREAK path emits the same funnel as the module path, on its own stage
// label — a break whose offer was rearmed or whose entry was missed must be
// visible as break traffic, not folded into the module series.
func TestPersonalBreakPathEmitsTheOfferAndEntryFunnel(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	now := time.Date(2026, 9, 24, 2, 0, 10, 0, time.UTC)
	missedStart := now.Add(-time.Second)
	startsAt := now.Add(3 * time.Second)

	// 1. A break offer whose start passed is a REARM.
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)
	deliverySaveBinding(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	personalBreakRuntimeNow(mock, now)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_attempt_breaks WHERE id = ? AND attempt_id = ? FOR UPDATE")).
		WithArgs("br-1", "att-1").
		WillReturnRows(sqlmock.NewRows([]string{"state", "entry_generation", "entry_starts_at", "starts_at", "entry_entered_at", "entry_proctor_rearm_at"}).
			AddRow("armed", 1, missedStart, nil, nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT s.end_time FROM exam_schedules s JOIN student_attempts sa ON sa.schedule_id = s.id WHERE sa.id = ?")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"end_time"}).AddRow(now.Add(time.Hour)))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_attempt_breaks")).
		WithArgs(personalOfferLeadSeconds, "br-1", "att-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock, now, examruntime.TimingModelPersonal)

	if _, err := svc.StartBreak(context.Background(), "sched-1", "att-1", "sched-1", "br-1", nil, "sess-test", "tok-1"); err != nil {
		t.Fatalf("break rearm: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalOfferTotal, "stage", personalStageBreak, "event", "rearmed"); got != 1 {
		t.Fatalf("break rearm event = %v, want 1", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalOfferTotal, "stage", personalStageBreak, "event", "armed"); got != 0 {
		t.Fatalf("a break rearm must not count as a fresh arm, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}

	// 2. A confirmed break entry counts on the break stage.
	db2, mock2, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db2.Close()
	svc2 := deliverySvc(db2)
	deliverySaveBinding(mock2)
	deliverySaveBegin(mock2)
	deliveryModuleWorkableTx(mock2)
	personalBreakRuntimeNow(mock2, now)
	personalBreakRow(mock2, "armed", 1, startsAt, nil, nil, nil)
	mock2.ExpectExec(personalBreakEnterSetsTheOwnedDeadline).
		WithArgs("br-1", "att-1", 1).WillReturnResult(sqlmock.NewResult(0, 1))
	mock2.ExpectCommit()
	deliveryBootstrapLoadsForModel(mock2, now, examruntime.TimingModelPersonal)

	if _, err := svc2.EnterBreak(context.Background(), "sched-1", "att-1", "sched-1",
		BreakEntryRequest{BreakID: "br-1", Generation: 1}, "sess-test", "tok-1"); err != nil {
		t.Fatalf("break entry: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalEntryTotal, "stage", personalStageBreak, "result", "confirmed"); got != 1 {
		t.Fatalf("break entry confirmed = %v, want 1", got)
	}
	if err := mock2.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// The arm path itself must emit: an offer that existed and whose start passed
// is a REARM, not a fresh arm, so a client that cannot paint inside the lead is
// visible in the funnel instead of only in lost time.
func TestArmPersonalModuleOfferEmitsRearmEvent(t *testing.T) {
	reg := telemetry.NewRegistry()
	old := telemetry.DefaultRegistry
	telemetry.DefaultRegistry = reg
	defer func() { telemetry.DefaultRegistry = old }()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	module := saveActiveModule{id: "ma-1", moduleID: "mod-1", state: "not_started", allocatedSeconds: 120}
	now := time.Date(2026, 9, 24, 2, 0, 10, 0, time.UTC)
	missedStart := now.Add(-time.Second)
	mock.ExpectBegin()
	mock.ExpectExec(regexp.QuoteMeta("SET time_zone = '+00:00'")).WillReturnResult(sqlmock.NewResult(0, 0))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_attempt_breaks WHERE attempt_id = ? AND state <> 'completed')")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"pending"}).AddRow(false))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT entry_generation, entry_starts_at, entry_confirmed_at, entry_entered_at, entry_proctor_rearm_at FROM assessment_module_attempts WHERE id = ? FOR UPDATE")).
		WithArgs("ma-1").WillReturnRows(sqlmock.NewRows([]string{"entry_generation", "entry_starts_at", "entry_confirmed_at", "entry_entered_at", "entry_proctor_rearm_at"}).AddRow(1, missedStart, nil, nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT s.end_time FROM exam_schedules s JOIN student_attempts sa ON sa.schedule_id = s.id WHERE sa.id = ?")).
		WithArgs("att-1").WillReturnRows(sqlmock.NewRows([]string{"end_time"}).AddRow(now.Add(time.Hour)))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT EXISTS(SELECT 1 FROM assessment_question_responses WHERE module_attempt_id = ?)")).
		WithArgs("ma-1", "att-1", "mod-1").WillReturnRows(sqlmock.NewRows([]string{"has_response"}).AddRow(false))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts")).
		WithArgs(personalOfferLeadSeconds, "ma-1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	if err := tx.NewRunner(db).WithTx(context.Background(), func(ctx context.Context, q tx.Tx) error {
		generation := 1
		return deliverySvc(db).armPersonalModuleOfferTx(ctx, q, "att-1", module, now, &generation)
	}); err != nil {
		t.Fatalf("rearm: %v", err)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalOfferTotal, "stage", personalStageModule, "event", "rearmed"); got != 1 {
		t.Fatalf("rearm event = %v, want 1", got)
	}
	if got := telemetry.CounterValueForTest(reg, telemetry.MSATPersonalOfferTotal, "stage", personalStageModule, "event", "armed"); got != 0 {
		t.Fatalf("a rearm must not count as a fresh arm, got %v", got)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

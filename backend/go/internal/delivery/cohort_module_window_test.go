package delivery

import (
	"context"
	"database/sql"
	"encoding/json"
	"regexp"
	"strings"
	"testing"
	"time"

	"example.com/ielts-proctoring/internal/proctor"
	examruntime "example.com/ielts-proctoring/internal/runtime"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
)

// A section-keyed cohort module's window belongs to the ROOM, not to the
// candidate's arrival: Module 1 ends at the section's start plus its authored
// length, and the adaptive branch module that closes the section ends with the
// section's own clock. The section deadline caps both, so an extension, an
// accumulated pause or a repaired section length can never let a module window
// outlive the clock every candidate shares.
func TestCohortModuleWindowEndUsesTheRoomsBoundary(t *testing.T) {
	sectionStart := time.Date(2026, 9, 20, 2, 0, 0, 0, time.UTC) // 09:00 ICT
	deadline := sectionStart.Add(64 * time.Minute)

	cases := []struct {
		name     string
		role     string
		authored int
		want     time.Time
	}{
		{
			name:     "Module 1 ends at the section start plus its authored length",
			role:     "base",
			authored: 32 * 60,
			want:     sectionStart.Add(32 * time.Minute),
		},
		{
			name:     "a branch module ends with the section",
			role:     "higher_branch",
			authored: 32 * 60,
			want:     deadline,
		},
		{
			name:     "a roleless module ends with the section",
			role:     "none",
			authored: 32 * 60,
			want:     deadline,
		},
		{
			name:     "a base module longer than the section cannot outlive it",
			role:     "base",
			authored: 4200,
			want:     deadline,
		},
		{
			name:     "an unknown authored length falls back to the section",
			role:     "base",
			authored: 0,
			want:     deadline,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := cohortModuleWindowEnd(sectionStart, testCase.authored, testCase.role, deadline)
			if !got.Equal(testCase.want) {
				t.Fatalf("window end = %v, want %v", got, testCase.want)
			}
		})
	}
}

// The window handed to a starting module is its own allotment, never more than
// what the room has left of that module's boundary.
func TestCohortModuleWindowSecondsNeverExceedsTheRoom(t *testing.T) {
	now := time.Date(2026, 9, 20, 2, 20, 0, 0, time.UTC)

	cases := []struct {
		name         string
		allocated    int
		roomWindowIn time.Duration
		want         int
	}{
		{"an on-time entry keeps its full allotment", 1920, 32 * time.Minute, 1920},
		{"a late entry gets what the room has left", 1920, 12 * time.Minute, 720},
		{"an entry at the boundary gets nothing", 1920, 0, 0},
		{"an entry past the boundary gets nothing", 1920, -5 * time.Second, 0},
		{"a paused or unawarded module is left alone", 0, 12 * time.Minute, 0},
		{"an allotment shorter than the room's is untouched", 600, 12 * time.Minute, 600},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			got := cohortModuleWindowSeconds(testCase.allocated, now.Add(testCase.roomWindowIn), now)
			if got != testCase.want {
				t.Fatalf("window = %ds, want %ds", got, testCase.want)
			}
		})
	}
}

// startModuleCohortWindowFixture drives StartModule for one cohort-section
// module on a section that started at sectionStart and carries
// extensionMinutes of proctor time. The authoritative in-tx instant is staged
// explicitly, and the window the server writes is asserted exactly: the section
// clock started when the room did, so the arithmetic is deterministic.
func startModuleCohortWindowFixture(
	t *testing.T,
	sectionStart, gateNow time.Time,
	adaptiveRole string,
	authoredSeconds, storedAllocated, plannedMinutes, extensionMinutes, wantAllocatedSeconds int,
) {
	t.Helper()

	sectionDeadline := sectionStart.Add(time.Duration(plannedMinutes+extensionMinutes) * time.Minute)
	if !gateNow.Before(sectionDeadline) {
		t.Fatalf("fixture error: gate instant %v is past the section deadline %v", gateNow, sectionDeadline)
	}

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	svc := deliverySvc(db)

	deliverySaveBinding(mock)
	deliveryReconcileDrained(mock)
	deliverySaveBegin(mock)
	deliveryModuleWorkableTx(mock)
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? AND module_id = ? FOR UPDATE")).
		WithArgs("att-1", "mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason"}).
			AddRow("ma-1", "mod-1", "not_started", storedAllocated, sectionStart, nil, nil, 0, 0, nil))
	deliveryCohortRuntimeAndModule(mock, "reading-writing", "reading-writing", adaptiveRole, authoredSeconds)
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections rs JOIN exam_session_runtimes r")).
		WithArgs("sched-1", "reading-writing").
		WillReturnRows(sqlmock.NewRows([]string{"status", "actual_start_at", "paused_at", "planned_duration_minutes", "extension_minutes", "accumulated_paused_seconds"}).
			AddRow("live", sectionStart, nil, plannedMinutes, extensionMinutes, 0))
	// The in-tx instant the gate judges — and that the window is derived from.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT UTC_TIMESTAMP(6)")).
		WillReturnRows(sqlmock.NewRows([]string{"ts"}).AddRow(gateNow))
	// The assertion: the window the server hands the candidate is the room's.
	mock.ExpectExec(regexp.QuoteMeta("UPDATE assessment_module_attempts SET state = 'active'")).
		WithArgs(int64(wantAllocatedSeconds), sqlmock.AnyArg(), sqlmock.AnyArg(), "ma-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta("UPDATE student_attempts SET phase = 'exam'")).
		WithArgs("att-1").
		WillReturnResult(sqlmock.NewResult(0, 1))
	deliveryMaxRevision(mock, 7)
	deliveryBusInsert(mock, "attempt", "att-1", "sat_module_started", 7)
	deliveryBusInsert(mock, "schedule_roster", "sched-1", "sat_module_started", 7)
	mock.ExpectCommit()
	deliveryBootstrapLoads(mock, gateNow)

	if _, err := svc.StartModule(context.Background(), "sched-1", "att-1", "sched-1", "mod-1", "sess-test", "tok-1"); err != nil {
		t.Fatalf("start module: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// A candidate who opens Module 1 twenty minutes into the section gets the twelve
// minutes the room has left of it — not their own fresh thirty-two.
func TestStartModuleLateJoinGetsTheRoomsRemainingWindow(t *testing.T) {
	sectionStart := time.Date(2026, 9, 20, 2, 0, 0, 0, time.UTC)
	startModuleCohortWindowFixture(t, sectionStart, sectionStart.Add(20*time.Minute),
		"base", 32*60, 32*60, 64, 0, 12*60)
}

// A candidate who opens Module 1 after the room's window has closed gets no
// Module 1 time at all: the module is over for the room, so the timeout path
// finalizes it and the adaptive successor opens with what the section still has.
func TestStartModuleGivesNoTimeWhenTheRoomsWindowHasClosed(t *testing.T) {
	sectionStart := time.Date(2026, 9, 20, 2, 0, 0, 0, time.UTC)
	startModuleCohortWindowFixture(t, sectionStart, sectionStart.Add(40*time.Minute),
		"base", 32*60, 32*60, 64, 0, 0)
}

// An on-time entry is untouched: the room's boundary is exactly the module's own
// allotment away, so the window the candidate gets is what the authoring wrote.
func TestStartModuleOnTimeEntryKeepsItsAuthoredWindow(t *testing.T) {
	sectionStart := time.Date(2026, 9, 20, 2, 0, 0, 0, time.UTC)
	startModuleCohortWindowFixture(t, sectionStart, sectionStart,
		"base", 32*60, 32*60, 64, 0, 32*60)
}

// The branch module ends with the section, so a candidate opening Module 2 with
// twenty-four minutes left of the section gets twenty-four: the authored length
// is the allotment, the section clock is the room's boundary.
func TestStartModuleBranchWindowIsCappedByTheSectionClock(t *testing.T) {
	sectionStart := time.Date(2026, 9, 20, 2, 0, 0, 0, time.UTC)
	startModuleCohortWindowFixture(t, sectionStart, sectionStart.Add(40*time.Minute),
		"higher_branch", 32*60, 32*60, 64, 0, 24*60)
}

// A proctor extension is time the whole room shares: a ten-minute extension on a
// 64-minute section means a candidate opening the branch module twenty minutes
// in sees the section's own (extended) remainder, not the pre-extension clock.
func TestStartModuleBranchWindowHonoursAnExtendedSection(t *testing.T) {
	sectionStart := time.Date(2026, 9, 20, 2, 0, 0, 0, time.UTC)
	// 32-minute section + 10-minute extension = 42 minutes; 20 minutes in, the
	// branch module's authored 32 minutes would outlive the room, so the room's
	// 22 minutes govern.
	startModuleCohortWindowFixture(t, sectionStart, sectionStart.Add(20*time.Minute),
		"higher_branch", 32*60, 32*60, 32, 10, 22*60)
}

func secondsPtr(value int) *int { return &value }

// The late arrival's promise has to reach the payload the STUDENT reads, not
// just the pure rule. This drives the post-commit bootstrap assembly (the
// response the client renders its directions screen from) over a room twenty
// minutes into Module 1 and pins the published window — the end-to-end proof
// that the pre-entry claim and the grant cannot disagree.
func TestAssembleBootstrapPublishesTheLateArrivalsEntryWindow(t *testing.T) {
	// The room opened twenty minutes ago: the assembly reads its own clock, so the
	// fixture is anchored to the real one and the promise below is checked against
	// what is genuinely left rather than a frozen instant.
	now := time.Now().UTC()
	sectionStart := now.Add(-20 * time.Minute)

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// LoadSections (the nested read the post-commit assembly uses): one
	// 64-minute section holding one 32-minute base module with no questions.
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_sections WHERE exam_version_id")).WithArgs("pv-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "section_key", "title", "display_order", "duration_seconds", "break_after_seconds", "instructions"}).
			AddRow("sec-1", "reading-writing", "Reading & Writing", 0, 3840, 600, nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_modules WHERE section_id = ?")).WithArgs("sec-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_key", "title", "display_order", "duration_seconds", "target_question_count", "adaptive_role", "instructions", "tool_policy"}).
			AddRow("mod-1", "rw-m1", "Module 1", 0, 1920, 27, "base", nil, nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_exam_questions eq JOIN assessment_question_revisions qr")).WithArgs("mod-1").
		WillReturnRows(sqlmock.NewRows([]string{"exam_question_id", "question_id", "display_order", "is_pretest", "question_type", "stimulus", "prompt", "answer_definition", "metadata", "accessibility"}))
	deliveryUnscopedLink(mock)
	// The candidate's own row: seeded, still unstarted, full authored allotment.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id FROM assessment_module_attempts WHERE attempt_id = ?")).WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id"}).AddRow("ma-1"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_module_attempts WHERE attempt_id = ? ORDER BY")).WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_id", "state", "allocated_seconds", "available_at", "started_at", "paused_at", "accumulated_paused_seconds", "extension_seconds", "completion_reason", "raw_correct", "operational_question_count", "tool_state", "revision"}).
			AddRow("ma-1", "mod-1", "not_started", 1920, nil, nil, nil, 0, 0, nil, nil, nil, "{}", 1))
	mock.ExpectQuery(regexp.QuoteMeta("FROM assessment_question_responses ar JOIN")).WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "module_attempt_id", "exam_question_id", "response", "marked_for_review", "eliminated_options", "annotations", "revision"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_responses_v2 v LEFT JOIN")).WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"question_id", "module_id", "response", "server_revision", "module_attempt_id", "exam_question_id"}))
	mock.ExpectQuery(regexp.QuoteMeta("FROM student_attempts WHERE id = ?")).WithArgs("att-1").
		WillReturnRows(sqlmock.NewRows([]string{"candidate_name", "proctor_status", "proctor_note", "delivery_status", "submitted_at", "phase"}).
			AddRow("Jane", "active", nil, "running", nil, "exam"))
	mock.ExpectQuery(regexp.QuoteMeta("FROM attempt_sessions WHERE attempt_id")).WithArgs("att-1").
		WillReturnError(sql.ErrNoRows)
	// The room: Reading & Writing live on a 64-minute clock since 09:00.
	mock.ExpectQuery(regexp.QuoteMeta("SELECT status FROM exam_session_runtimes")).WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"status"}).AddRow("live"))
	mock.ExpectQuery(regexp.QuoteMeta("SELECT id, exam_id, provider_key")).WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "sat_timing_model"}).AddRow("sched-1", "exam-1", "sat", nil))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtimes WHERE schedule_id")).WithArgs("sched-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "schedule_id", "exam_id", "provider_key", "status",
			"plan_snapshot", "timing_model", "actual_start_at", "actual_end_at",
			"active_section_key", "current_section_key", "current_section_remaining_seconds",
			"waiting_for_next_section", "is_overrun", "total_paused_seconds",
			"created_at", "updated_at", "revision",
		}).AddRow("rt-1", "sched-1", "exam-1", "sat", "live",
			nil, "cohort_section_v3", sectionStart, nil,
			"reading-writing", "reading-writing", 44*60,
			nil, nil, 0,
			now, now, 3))
	mock.ExpectQuery(regexp.QuoteMeta("FROM exam_session_runtime_sections WHERE runtime_id")).WithArgs("rt-1").
		WillReturnRows(sqlmock.NewRows([]string{
			"id", "runtime_id", "section_key", "label", "section_order",
			"planned_duration_minutes", "gap_after_minutes", "status",
			"available_at", "actual_start_at", "actual_end_at", "paused_at",
			"accumulated_paused_seconds", "extension_minutes", "completion_reason",
			"projected_start_at", "projected_end_at",
		}).AddRow("sec-rt-1", "rt-1", "reading-writing", "Reading & Writing", 0, 64, 10, "live", nil, sectionStart, nil, nil, 0, 0, nil, nil, nil))

	boot, err := deliverySvc(db).assembleBootstrap(context.Background(), "sched-1", "exam-1", "sat", "pv-1", "att-1")
	if err != nil {
		t.Fatalf("assemble bootstrap: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
	if len(boot.Attempt.ModuleAttempts) != 1 {
		t.Fatalf("unexpected module attempts: %+v", boot.Attempt.ModuleAttempts)
	}
	// Twenty minutes into a 32-minute Module 1: the candidate is told the twelve
	// minutes the room has left — never the authored thirty-two. The window is
	// read on the assembly's own clock, so allow the couple of seconds the
	// surrounding statements take.
	got := boot.Attempt.ModuleAttempts[0].EntryWindowSeconds
	if got == nil || *got > 12*60 || *got < 12*60-5 {
		t.Fatalf("entry window = %v, want the room's remaining ~720s", got)
	}
	// and the row's own (unstarted) timing stays untouched: the pre-entry field
	// is additive, so nothing already reading deadlineAt/remainingSeconds moves.
	if boot.Attempt.ModuleAttempts[0].DeadlineAt != nil || boot.Attempt.ModuleAttempts[0].RemainingSeconds != nil {
		t.Fatalf("an unstarted module must not gain an authoritative window: %+v", boot.Attempt.ModuleAttempts[0])
	}
}

// The wire pin, server side. The client reads this field by name
// (satTimingPolicy.satModuleWindow reads `entryWindowSeconds`); if either side
// renames it the promise silently reverts to the authored length with every
// other test still green, so the exact JSON key is asserted here and mirrored by
// the raw-payload read in satTimingPolicy.test.ts. The absent case is pinned too:
// "no window for this candidate" must cross as null, never as 0, because a 0 is
// the server saying the room has closed the module.
func TestModuleAttemptEntryWindowJSONKey(t *testing.T) {
	value := 720
	payload, err := json.Marshal(ModuleAttempt{
		ID: "ma-1", ModuleID: "mod-1", State: "not_started",
		AllocatedSeconds: 32 * 60, EntryWindowSeconds: &value,
	})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(payload), `"entryWindowSeconds":720`) {
		t.Fatalf("entry window key/value missing from the wire shape: %s", payload)
	}

	silent, err := json.Marshal(ModuleAttempt{ID: "ma-1", ModuleID: "mod-1", State: "not_started"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if !strings.Contains(string(silent), `"entryWindowSeconds":null`) {
		t.Fatalf("an unpublished window must ship as null: %s", silent)
	}
}

// The pre-entry promise is the READ-side twin of the StartModule clamp
// (publishEntryWindows): the window a candidate is told they will get before
// they enter must be the window the write path grants on entry, or the
// directions screen quotes an authored length the room will never give them.
// These cases pin every branch of that rule, including the one the reported bug
// was about — a late arrival, whose promise is the room's remainder.
func TestPublishEntryWindowsMatchesTheGrant(t *testing.T) {
	sectionStart := time.Date(2026, 9, 20, 2, 0, 0, 0, time.UTC) // 09:00 ICT
	readingWriting := "reading-writing"
	math := "math"

	sections := []DeliverySection{
		{SectionKey: readingWriting, Modules: []DeliveryModule{
			{ID: "rw-m1", AdaptiveRole: "base", DurationSeconds: 32 * 60},
			{ID: "rw-m2", AdaptiveRole: "higher_branch", DurationSeconds: 32 * 60},
		}},
		{SectionKey: math, Modules: []DeliveryModule{
			{ID: "math-m1", AdaptiveRole: "base", DurationSeconds: 35 * 60},
		}},
	}
	// The room: Reading & Writing live since 09:00 on a 64-minute clock, Math
	// still locked behind it.
	liveRoom := []proctor.SessionRuntimeSection{
		{SectionKey: readingWriting, Status: "live", ActualStartAt: &sectionStart, PlannedDurationMinutes: 64},
		{SectionKey: math, Status: "locked"},
	}
	cohort := TimingSnapshot{
		Authority: "cohort_runtime", TimingModel: examruntime.TimingModelCohortSection,
		StageKey: &readingWriting, StageStatus: "live", ServerNow: sectionStart,
	}
	pausedAt := sectionStart.Add(20 * time.Minute)
	pausedRoom := []proctor.SessionRuntimeSection{
		{SectionKey: readingWriting, Status: "paused", ActualStartAt: &sectionStart, PausedAt: &pausedAt, PlannedDurationMinutes: 64},
	}

	cases := []struct {
		name      string
		timing    TimingSnapshot
		room      []proctor.SessionRuntimeSection
		moduleID  string
		allocated int
		state     string
		now       time.Time
		want      *int
	}{
		{
			name:   "a late arrival is promised the room's remainder",
			timing: cohort, room: liveRoom, moduleID: "rw-m1", allocated: 32 * 60, state: "not_started",
			now: sectionStart.Add(20 * time.Minute), want: secondsPtr(12 * 60),
		},
		{
			name:   "an arrival past the module's window is promised nothing",
			timing: cohort, room: liveRoom, moduleID: "rw-m1", allocated: 32 * 60, state: "not_started",
			now: sectionStart.Add(40 * time.Minute), want: secondsPtr(0),
		},
		{
			name:   "an on-time arrival keeps the authored window",
			timing: cohort, room: liveRoom, moduleID: "rw-m1", allocated: 32 * 60, state: "not_started",
			now: sectionStart, want: secondsPtr(32 * 60),
		},
		{
			name:   "the branch module is trimmed by the section clock",
			timing: cohort, room: liveRoom, moduleID: "rw-m2", allocated: 32 * 60, state: "not_started",
			// The section ends at 10:04, so fourteen minutes in it govern the
			// branch module's authored thirty-two.
			now: sectionStart.Add(50 * time.Minute), want: secondsPtr(14 * 60),
		},
		{
			name:   "a paused room promises the window the pause landed on",
			timing: cohort, room: pausedRoom, moduleID: "rw-m1", allocated: 32 * 60, state: "not_started",
			// The pause landed at 09:20 with twelve minutes of Module 1 left; the
			// wall clock that kept running does not drain the promise.
			now: sectionStart.Add(60 * time.Minute), want: secondsPtr(12 * 60),
		},
		{
			name:   "a started module keeps its own clock",
			timing: cohort, room: liveRoom, moduleID: "rw-m1", allocated: 32 * 60, state: "active",
			now: sectionStart.Add(20 * time.Minute), want: nil,
		},
		{
			name: "a section that has not opened has no window to promise",
			timing: TimingSnapshot{
				Authority: "cohort_runtime", TimingModel: examruntime.TimingModelCohortSection,
				StageKey: &math, StageStatus: "locked", ServerNow: sectionStart,
			},
			room: liveRoom, moduleID: "math-m1", allocated: 35 * 60, state: "not_started",
			now: sectionStart.Add(20 * time.Minute), want: nil,
		},
		{
			name:   "a module outside the active section is left alone",
			timing: cohort, room: liveRoom, moduleID: "math-m1", allocated: 35 * 60, state: "not_started",
			now: sectionStart.Add(20 * time.Minute), want: nil,
		},
		{
			name:   "an active section the runtime has no row for promises nothing",
			timing: cohort, room: nil, moduleID: "rw-m1", allocated: 32 * 60, state: "not_started",
			now: sectionStart.Add(20 * time.Minute), want: nil,
		},
		{
			name: "a legacy run publishes no room window at all",
			timing: TimingSnapshot{
				Authority: "legacy_attempt", TimingModel: examruntime.TimingModelLegacy,
				StageStatus: "live", ServerNow: sectionStart,
			},
			room: liveRoom, moduleID: "rw-m1", allocated: 32 * 60, state: "not_started",
			now: sectionStart.Add(20 * time.Minute), want: nil,
		},
		{
			name:   "a row with no allotment promises nothing",
			timing: cohort, room: liveRoom, moduleID: "rw-m1", allocated: 0, state: "not_started",
			now: sectionStart.Add(20 * time.Minute), want: nil,
		},
	}

	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			attempts := []ModuleAttempt{{
				ID: "ma-1", ModuleID: testCase.moduleID, State: testCase.state,
				AllocatedSeconds: testCase.allocated,
			}}
			publishEntryWindows(attempts, sections, testCase.timing, testCase.room, testCase.now)
			got := attempts[0].EntryWindowSeconds
			if testCase.want == nil {
				if got != nil {
					t.Fatalf("entry window = %d, want none published", *got)
				}
				return
			}
			if got == nil {
				t.Fatalf("entry window was not published, want %ds", *testCase.want)
			}
			if *got != *testCase.want {
				t.Fatalf("entry window = %ds, want %ds", *got, *testCase.want)
			}
		})
	}
}

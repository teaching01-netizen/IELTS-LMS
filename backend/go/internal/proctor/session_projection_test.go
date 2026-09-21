package proctor

// The proctor roster row is the only place the dashboard reads per-student
// cohort state, so it must carry the same between-sections truth as the room
// projection for cohort-timed SAT. Legacy SAT (no authoritative section clock)
// keeps showing the student's module clock.

import (
	"database/sql"
	"testing"
	"time"
)

func cohortWaitingRuntime() SessionRuntime {
	serverNow := time.Unix(1_800_000_000, 0).UTC()
	active := "reading-writing"
	return SessionRuntime{
		ID:                             "rt-1",
		ScheduleID:                     "sched-1",
		ExamID:                         "exam-1",
		ProviderKey:                    "sat",
		Status:                         "live",
		TimingModel:                    "cohort_section_v3",
		ActiveSectionKey:               &active,
		CurrentSectionKey:              &active,
		CurrentSectionRemainingSeconds: 3_000,
		ServerNow:                      serverNow,
		WaitingForNextSection:          true,
		Revision:                       9,
		Sections: []SessionRuntimeSection{
			{SectionKey: "reading-writing", Status: "completed"},
			{SectionKey: "math", Status: "locked"},
		},
	}
}

func satModuleRow(startedAt time.Time) studentSessionRow {
	return studentSessionRow{
		id: "att-1", candidateID: "cand-1", candidateName: "Candidate",
		scheduleID: "sched-1", currentModule: "m2", phase: "exam",
		examID: "exam-1", examTitle: "SAT", updatedAt: startedAt.UTC(),
		proctorStatus:  "active",
		providerKey:    "sat",
		satModuleTitle: sql.NullString{String: "Module 2", Valid: true},
		satModuleKey:   sql.NullString{String: "rw-m2", Valid: true},
		satStartedAt:   sql.NullTime{Time: startedAt.UTC(), Valid: true},
		satAllocated:   sql.NullInt64{Int64: 1_800, Valid: true},
	}
}

func TestAttemptRowToSessionCohortSATReportsTheWaitingWindow(t *testing.T) {
	runtime := cohortWaitingRuntime()
	row := satModuleRow(runtime.ServerNow.Add(-10 * time.Minute))

	got := attemptRowToSession(row, runtime)

	if !got.RuntimeWaiting {
		t.Fatal("a cohort SAT attempt in the between-sections window must project as waiting")
	}
	if got.RuntimeCurrentSection == nil || *got.RuntimeCurrentSection != "reading-writing" {
		t.Fatalf("the row must report the room's section, got %v", got.RuntimeCurrentSection)
	}
	// 3_000 is the room's section clock; the student's module clock is 1_800-600.
	if got.RuntimeTimeRemainingSeconds != 3_000 {
		t.Fatalf("the row must report the section clock (3000), got %d", got.RuntimeTimeRemainingSeconds)
	}
	if got.RuntimeSectionStatus == nil || *got.RuntimeSectionStatus != "completed" {
		t.Fatalf("the row must report the finished section, got %v", got.RuntimeSectionStatus)
	}
}

// The staff room reads the module clock beside the section clock for a
// cohort-timed section: the module a candidate is sitting has its own
// room-anchored window, and it can end before the section does, so the roster
// row must carry both. A paused module publishes its frozen remainder and no
// deadline (its window is not running).
// cohortLiveRuntimeWithDeadline is the same room inside a running section: the
// section clock publishes a deadline (the waiting projection does not, because a
// completed section has no live clock).
func cohortLiveRuntimeWithDeadline() SessionRuntime {
	runtime := cohortWaitingRuntime()
	deadline := runtime.ServerNow.Add(50 * time.Minute)
	runtime.CurrentSectionDeadlineAt = &deadline
	runtime.WaitingForNextSection = false
	runtime.Sections = []SessionRuntimeSection{
		{SectionKey: "reading-writing", Status: "live"},
		{SectionKey: "math", Status: "locked"},
	}
	return runtime
}

func TestAttemptRowToSessionCohortSATReportsTheModuleClock(t *testing.T) {
	runtime := cohortLiveRuntimeWithDeadline()
	startedAt := runtime.ServerNow.Add(-10 * time.Minute)
	row := satModuleRow(startedAt)
	row.satModuleRole = sql.NullString{String: "base", Valid: true}

	got := attemptRowToSession(row, runtime)

	if got.RuntimeCurrentModuleRole == nil || *got.RuntimeCurrentModuleRole != "base" {
		t.Fatalf("the row must name the module slot the candidate is sitting, got %v", got.RuntimeCurrentModuleRole)
	}
	if got.RuntimeModuleRemainingSeconds == nil || *got.RuntimeModuleRemainingSeconds != 1_200 {
		t.Fatalf("the module clock must be the module's own remaining (1200), got %v", got.RuntimeModuleRemainingSeconds)
	}
	wantDeadline := startedAt.Add(30 * time.Minute)
	if got.RuntimeModuleDeadlineAt == nil || !got.RuntimeModuleDeadlineAt.Equal(wantDeadline) {
		t.Fatalf("the module deadline must be start + allotment (%v), got %v", wantDeadline, got.RuntimeModuleDeadlineAt)
	}
	// The section clock stays the room's shared clock: both are projected.
	if got.RuntimeTimeRemainingSeconds != 3_000 {
		t.Fatalf("the section clock must be untouched (3000), got %d", got.RuntimeTimeRemainingSeconds)
	}
	if got.RuntimeDeadlineAt == nil {
		t.Fatal("the section deadline must stay projected for the room clock")
	}
}

func TestAttemptRowToSessionPausedModuleFreezesItsWindow(t *testing.T) {
	runtime := cohortLiveRuntimeWithDeadline()
	startedAt := runtime.ServerNow.Add(-10 * time.Minute)
	row := satModuleRow(startedAt)
	row.satPausedAt = sql.NullTime{Time: runtime.ServerNow.Add(-4 * time.Minute), Valid: true}

	got := attemptRowToSession(row, runtime)

	if got.RuntimeModuleDeadlineAt != nil {
		t.Fatalf("a paused module has no running deadline, got %v", got.RuntimeModuleDeadlineAt)
	}
	// 30 minutes allotted, 6 minutes elapsed when the pause landed.
	if got.RuntimeModuleRemainingSeconds == nil || *got.RuntimeModuleRemainingSeconds != 1_440 {
		t.Fatalf("a paused module keeps the window the pause landed on (1440), got %v", got.RuntimeModuleRemainingSeconds)
	}
}

// A module that never started has no window to project: the staff room must see
// the absence, not a synthesized clock.
func TestAttemptRowToSessionUnstartedModuleProjectsNoClock(t *testing.T) {
	runtime := cohortLiveRuntimeWithDeadline()
	row := satModuleRow(runtime.ServerNow)
	row.satStartedAt = sql.NullTime{}

	got := attemptRowToSession(row, runtime)

	if got.RuntimeModuleDeadlineAt != nil || got.RuntimeModuleRemainingSeconds != nil {
		t.Fatalf("an unstarted module must project no clock, got %v / %v", got.RuntimeModuleDeadlineAt, got.RuntimeModuleRemainingSeconds)
	}
}

func TestAttemptRowToSessionLegacySATKeepsTheModuleClock(t *testing.T) {
	runtime := cohortWaitingRuntime()
	runtime.TimingModel = "legacy_section_v1"
	row := satModuleRow(runtime.ServerNow.Add(-10 * time.Minute))

	got := attemptRowToSession(row, runtime)

	if got.RuntimeWaiting {
		t.Fatal("legacy SAT has no cohort clock to wait on")
	}
	if got.RuntimeCurrentSection == nil || *got.RuntimeCurrentSection != "Module 2" {
		t.Fatalf("legacy SAT must keep the module identity, got %v", got.RuntimeCurrentSection)
	}
	if got.RuntimeTimeRemainingSeconds != 1_200 {
		t.Fatalf("legacy SAT must keep the module clock (1200), got %d", got.RuntimeTimeRemainingSeconds)
	}
}

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

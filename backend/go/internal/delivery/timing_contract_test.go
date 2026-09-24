package delivery

import (
	"context"
	"database/sql"
	"example.com/ielts-proctoring/internal/proctor"
	sqlmock "github.com/DATA-DOG/go-sqlmock"
	"testing"
	"time"
)

func TestTimingContractPreservesCohortClock(t *testing.T) {
	now := time.Now().UTC()
	deadline := now.Add(time.Minute)
	key := "reading-writing"
	for _, model := range []string{"cohort_stage_v2", "cohort_section_v3", "legacy_section_v1"} {
		runtime := proctor.SessionRuntime{Status: "live", TimingModel: model, ActiveSectionKey: &key, ServerNow: now, CurrentSectionDeadlineAt: &deadline, CurrentSectionRemainingSeconds: 60, Revision: 7, Sections: []proctor.SessionRuntimeSection{{SectionKey: key, Status: "live"}}}
		out := timingFromRuntime(runtime)
		if out.Authority != "cohort_runtime" || out.TimingModel != model || out.RuntimeRevision != 7 || out.StageKey == nil || *out.StageKey != key || out.DeadlineAt != &deadline || out.RemainingSeconds != 60 {
			t.Fatalf("cohort contract lost: %+v", out)
		}
		runtime.Status = "paused"
		runtime.CurrentSectionDeadlineAt = nil
		runtime.Sections[0].Status = "paused"
		out = timingFromRuntime(runtime)
		if out.StageStatus != "paused" || out.DeadlineAt != nil || out.RemainingSeconds != 60 {
			t.Fatalf("paused clock changed: %+v", out)
		}
		// Between sections: both the state and its countdown instant project
		// through, so the client gates the break on the server's flag rather
		// than inferring the window from a present instant.
		runtime.Status = "live"
		runtime.Sections[0].Status = "completed"
		runtime.WaitingForNextSection = true
		next := now.Add(5 * time.Minute)
		runtime.NextSectionStartAt = &next
		out = timingFromRuntime(runtime)
		if !out.WaitingForNextSection || out.NextSectionStartAt == nil || !out.NextSectionStartAt.Equal(next) {
			t.Fatalf("between-sections window lost: %+v", out)
		}
		if out.StageStatus != "completed" {
			t.Fatalf("waiting window must report the completed section: %+v", out.StageStatus)
		}
	}
}

// TestTimingContractSATWithoutRuntimeIsNotStartedCohort is the pre-start
// contract for a SAT schedule whose exam_session_runtimes row does not exist
// yet (the proctor has not pressed Start).
//
// This used to project the legacy attempt clock — authority legacy_attempt,
// status "live" — which opened the student entry gate while the exam was
// still waiting, so the client POSTed /modules/start and got 409
// RUNTIME_NOT_LIVE on every retry window (the waiting-room 409 storm).
// "No runtime row" for a cohort-timed provider must mean not_started.
func TestTimingContractSATWithoutRuntimeIsNotStartedCohort(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT status FROM exam_session_runtimes").WithArgs("schedule").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT sat_timing_model FROM exam_schedules").WithArgs("schedule").
		WillReturnRows(sqlmock.NewRows([]string{"sat_timing_model"}).AddRow(nil))
	now := time.Now().UTC()
	timing, status, room, err := deliverySvc(db).loadTiming(context.Background(), "schedule", "sat", now)
	if err != nil {
		t.Fatalf("loadTiming failed: %v", err)
	}
	// Nothing has started, so there is no room clock and no module window to
	// promise: the entry-window projection has nothing to publish here.
	if len(room) != 0 {
		t.Fatalf("pre-start SAT must carry no runtime sections: %+v", room)
	}
	if status != "not_started" {
		t.Fatalf("pre-start SAT status = %q, want not_started", status)
	}
	if timing.Authority != "cohort_runtime" {
		t.Fatalf("pre-start SAT authority = %q, want cohort_runtime", timing.Authority)
	}
	if timing.TimingModel != "cohort_section_v3" {
		t.Fatalf("pre-start SAT timing model = %q, want cohort_section_v3", timing.TimingModel)
	}
	if timing.StageStatus != "not_started" {
		t.Fatalf("pre-start SAT stage status = %q, want not_started", timing.StageStatus)
	}
	if timing.StageKey != nil {
		t.Fatalf("pre-start SAT stage key = %v, want nil", *timing.StageKey)
	}
	if timing.DeadlineAt != nil {
		t.Fatalf("pre-start SAT deadline = %v, want nil", *timing.DeadlineAt)
	}
	if timing.RemainingSeconds != 0 {
		t.Fatalf("pre-start SAT remaining = %d, want 0", timing.RemainingSeconds)
	}
	if !timing.ServerNow.Equal(now) {
		t.Fatalf("pre-start SAT serverNow = %v, want %v", timing.ServerNow, now)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestTimingContractPersonalSATWithoutRuntimeUsesScheduleChoice(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT status FROM exam_session_runtimes").WithArgs("schedule").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT sat_timing_model FROM exam_schedules WHERE id = ?").WithArgs("schedule").
		WillReturnRows(sqlmock.NewRows([]string{"sat_timing_model"}).AddRow("sat_personal_v1"))

	timing, status, room, err := deliverySvc(db).loadTiming(context.Background(), "schedule", "sat", time.Now().UTC())
	if err != nil {
		t.Fatalf("load personal pre-start timing: %v", err)
	}
	if status != "not_started" || timing.TimingModel != "sat_personal_v1" || timing.Authority != "cohort_runtime" {
		t.Fatalf("personal pre-start projection = status %q, timing %+v", status, timing)
	}
	if len(room) != 0 || timing.DeadlineAt != nil {
		t.Fatalf("pre-start personal runtime must have no shared room deadline: %+v %v", room, timing.DeadlineAt)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

// TestTimingContractLegacyWithoutRuntimePreservesLegacyBehavior pins the
// non-cohort providers: no runtime row still means the legacy per-module
// clock is live (ACT/IELTS attempts have no cohort runtime to wait for).
func TestTimingContractLegacyWithoutRuntimePreservesLegacyBehavior(t *testing.T) {
	for _, provider := range []string{"act", "ielts"} {
		db, mock, err := sqlmock.New()
		if err != nil {
			t.Fatal(err)
		}
		mock.ExpectQuery("SELECT status FROM exam_session_runtimes").WithArgs("schedule").WillReturnError(sql.ErrNoRows)
		timing, status, room, err := deliverySvc(db).loadTiming(context.Background(), "schedule", provider, time.Now())
		if err != nil || status != "live" || timing.Authority != "legacy_attempt" || timing.TimingModel != "legacy_section_v1" || timing.StageStatus != "live" {
			t.Fatalf("unexpected legacy projection for %s: %+v %s %v", provider, timing, status, err)
		}
		if room != nil {
			t.Fatalf("legacy projection for %s must carry no runtime sections: %+v", provider, room)
		}
		if timing.StageKey != nil || timing.DeadlineAt != nil {
			t.Fatalf("legacy projection for %s must carry no cohort clock: %+v", provider, timing)
		}
		if err := mock.ExpectationsWereMet(); err != nil {
			t.Fatal(err)
		}
		db.Close()
	}
}

// TestTimingContractPreStartAgreesWithProctorProjection is the drift guard:
// the student bootstrap (delivery.loadTiming) and the proctor dashboard
// (proctor.LoadSessionRuntimeBySchedule) must describe the same not-yet-started
// SAT schedule identically. They did not before round 146 — the dashboard said
// not_started while the bootstrap said live — which is what let the client
// auto-enter. Both now read proctor.NotStartedRuntimeForProvider.
func TestTimingContractPreStartAgreesWithProctorProjection(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	// Student bootstrap probe: no runtime row.
	mock.ExpectQuery("SELECT status FROM exam_session_runtimes").WithArgs("schedule").WillReturnError(sql.ErrNoRows)
	mock.ExpectQuery("SELECT sat_timing_model FROM exam_schedules").WithArgs("schedule").
		WillReturnRows(sqlmock.NewRows([]string{"sat_timing_model"}).AddRow(nil))
	// Proctor detail path: schedule link, then the same absent runtime row.
	mock.ExpectQuery("SELECT id, exam_id, provider_key").WithArgs("schedule").
		WillReturnRows(sqlmock.NewRows([]string{"id", "exam_id", "provider_key", "sat_timing_model"}).AddRow("schedule", "exam-1", "sat", nil))
	mock.ExpectQuery("FROM exam_session_runtimes WHERE schedule_id").WithArgs("schedule").WillReturnError(sql.ErrNoRows)

	ctx := context.Background()
	timing, runtimeStatus, _, err := deliverySvc(db).loadTiming(ctx, "schedule", "sat", time.Now())
	if err != nil {
		t.Fatalf("loadTiming failed: %v", err)
	}
	runtime, err := proctor.LoadSessionRuntimeBySchedule(ctx, db, "schedule")
	if err != nil {
		t.Fatalf("proctor projection failed: %v", err)
	}
	proctored := timingFromRuntime(runtime)
	if runtimeStatus != runtime.Status {
		t.Fatalf("student status %q != proctor status %q", runtimeStatus, runtime.Status)
	}
	if timing.Authority != proctored.Authority || timing.TimingModel != proctored.TimingModel ||
		timing.StageStatus != proctored.StageStatus || timing.RemainingSeconds != proctored.RemainingSeconds {
		t.Fatalf("student projection %+v disagrees with proctor projection %+v", timing, proctored)
	}
	if runtime.TimingModel != "cohort_section_v3" || runtime.Status != "not_started" {
		t.Fatalf("proctor pre-start runtime = %+v", runtime)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

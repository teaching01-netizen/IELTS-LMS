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
func TestTimingContractWithoutRuntimeUsesLegacy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery("SELECT status FROM exam_session_runtimes").WithArgs("schedule").WillReturnError(sql.ErrNoRows)
	timing, status, err := deliverySvc(db).loadTiming(context.Background(), "schedule", time.Now())
	if err != nil || status != "live" || timing.Authority != "legacy_attempt" || timing.TimingModel != "legacy_section_v1" {
		t.Fatalf("unexpected legacy: %+v %s %v", timing, status, err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

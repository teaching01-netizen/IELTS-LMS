package proctor

import (
	"testing"
	"time"

	examruntime "example.com/ielts-proctoring/internal/runtime"
)

func sharedTimetable(t *testing.T) examruntime.IELTSSharedSchedule {
	t.Helper()
	s, err := examruntime.BuildIELTSSharedSchedule(planBase, []examruntime.PlanEntry{
		{SectionKey: "listening", Order: 1, DurationMinutes: 30},
		{SectionKey: "reading", Order: 2, DurationMinutes: 60, GapAfterMinutes: 5},
		{SectionKey: "writing", Order: 3, DurationMinutes: 60},
	}, examruntime.ResponseSaveGrace)
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func sharedRows() []runtimeSection {
	return []runtimeSection{
		liveSection("listening", 1, 30, 0, planBase),
		lockedSection("reading", 2, 60, 5),
		lockedSection("writing", 3, 60, 0),
	}
}

func TestPlanSharedScheduleAdvanceUsesTimetableInstants(t *testing.T) {
	s := sharedTimetable(t)
	rt := reconcileRuntime{activeSectionKey: ptr("listening"), timingModel: examruntime.TimingModelIELTSSharedSchedule}

	if plan := planSharedScheduleAdvance(rt, sharedRows(), s, s.Windows[0].SaveUntil.Add(-time.Microsecond)); len(plan.steps) != 0 {
		t.Fatalf("advanced inside the drain: %+v", plan.steps)
	}
	// A worker that wakes an hour late still starts reading at its committed
	// instant, and writing waits for the authored gap.
	late := s.Windows[1].SaveUntil.Add(time.Minute)
	plan := planSharedScheduleAdvance(rt, sharedRows(), s, late)
	kinds := []advanceStepKind{stepCompleteSection, stepStartSection, stepCompleteSection, stepEnterWaiting}
	if len(plan.steps) != len(kinds) {
		t.Fatalf("steps %+v", plan.steps)
	}
	for i, k := range kinds {
		if plan.steps[i].kind != k {
			t.Fatalf("step %d = %v want %v", i, plan.steps[i].kind, k)
		}
	}
	if !plan.steps[0].effectiveAt.Equal(s.Windows[0].SaveUntil) || !plan.steps[1].startAt.Equal(s.Windows[1].StartAt) {
		t.Fatalf("catch-up substituted asOf: %+v", plan.steps[:2])
	}
	if plan.steps[1].prepare || plan.steps[1].remaining != 3600 {
		t.Fatalf("successor behind a readiness barrier or wrong duration: %+v", plan.steps[1])
	}
	if !plan.steps[3].startAt.Equal(s.Windows[2].StartAt) {
		t.Fatalf("waiting window announced %s", plan.steps[3].startAt)
	}
	// Past the final drain the runtime completes at the committed end.
	end := planSharedScheduleAdvance(rt, sharedRows(), s, s.Windows[2].SaveUntil.Add(time.Hour))
	last := end.steps[len(end.steps)-1]
	if last.kind != stepCompleteRuntime || !last.effectiveAt.Equal(s.Windows[2].SaveUntil) {
		t.Fatalf("runtime end %+v", last)
	}
}

func TestPlanSharedScheduleAdvanceHoldsWhilePausedOrEnded(t *testing.T) {
	s := sharedTimetable(t)
	rt := reconcileRuntime{activeSectionKey: ptr("listening")}
	paused, _ := examruntime.PauseIELTSSharedSchedule(s, planBase.Add(time.Minute))
	if plan := planSharedScheduleAdvance(rt, sharedRows(), paused, planBase.Add(5*time.Hour)); len(plan.steps) != 0 {
		t.Fatalf("paused timetable advanced: %+v", plan.steps)
	}
	if plan := planSharedScheduleAdvance(reconcileRuntime{activeSectionKey: ptr("speaking")}, sharedRows(), s, planBase); !plan.activeSectionMissing {
		t.Fatal("missing active row not reported")
	}
}

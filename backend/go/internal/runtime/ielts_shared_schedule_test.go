package runtime

import (
	"encoding/json"
	"os"
	"testing"
	"time"
)

func mustTime(t *testing.T, v string) time.Time {
	t.Helper()
	at, err := time.Parse(time.RFC3339Nano, v)
	if err != nil {
		t.Fatal(err)
	}
	return at
}

func sharedPlan() []PlanEntry {
	return []PlanEntry{
		{SectionKey: "listening", Order: 1, DurationMinutes: 30, GapAfterMinutes: 0},
		{SectionKey: "reading", Order: 2, DurationMinutes: 60, GapAfterMinutes: 5},
		{SectionKey: "writing", Order: 3, DurationMinutes: 60},
	}
}

// sharedVectors is the cross-language contract shared with
// src/features/student/domain/exam-session/__tests__/ieltsSharedSchedule.vectors.json.
type sharedVector struct {
	Name     string              `json:"name"`
	Schedule IELTSSharedSchedule `json:"schedule"`
	Cases    []struct {
		At      string `json:"at"`
		Kind    string `json:"kind"`
		Section string `json:"section"`
	} `json:"cases"`
}

func TestIELTSSharedScheduleSharedVectors(t *testing.T) {
	raw, err := os.ReadFile("../../../../src/features/student/domain/exam-session/__tests__/ieltsSharedSchedule.vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []sharedVector
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, v := range vectors {
		for _, c := range v.Cases {
			pos, err := ResolveIELTSSharedWindow(v.Schedule, mustTime(t, c.At))
			if err != nil {
				t.Fatalf("%s: %v", v.Name, err)
			}
			got := ""
			if pos.Window != nil {
				got = pos.Window.SectionKey
			}
			if pos.Kind != c.Kind || got != c.Section {
				t.Fatalf("%s at %s: got %s/%s want %s/%s", v.Name, c.At, pos.Kind, got, c.Kind, c.Section)
			}
		}
	}
}

func TestBuildIELTSSharedScheduleLaysWindowsEndToEnd(t *testing.T) {
	start := mustTime(t, "2026-10-30T03:00:00Z")
	s, err := BuildIELTSSharedSchedule(start, sharedPlan(), ResponseSaveGrace)
	if err != nil {
		t.Fatal(err)
	}
	want := []string{
		"listening 03:00:00 03:30:00 03:30:03",
		"reading 03:30:03 04:30:03 04:30:06",
		"writing 04:35:06 05:35:06 05:35:09",
	}
	for i, w := range s.Windows {
		got := w.SectionKey + " " + w.StartAt.Format("15:04:05") + " " + w.DeadlineAt.Format("15:04:05") + " " + w.SaveUntil.Format("15:04:05")
		if got != want[i] {
			t.Fatalf("window %d = %s, want %s", i, got, want[i])
		}
	}
	if pos, _ := ResolveIELTSSharedWindow(s, mustTime(t, "2026-10-30T04:32:00Z")); pos.Kind != SharedGap || pos.Window.SectionKey != "writing" {
		t.Fatalf("authored gap resolved as %+v", pos)
	}
	if pos, _ := ResolveIELTSSharedWindow(s, mustTime(t, "2026-10-30T05:35:09Z")); pos.Kind != SharedComplete {
		t.Fatalf("after last drain = %s", pos.Kind)
	}
}

func TestIELTSSharedScheduleRejectsMalformed(t *testing.T) {
	start := mustTime(t, "2026-10-30T03:00:00Z")
	if _, err := BuildIELTSSharedSchedule(start, []PlanEntry{{SectionKey: "reading", Order: 1}}, ResponseSaveGrace); err == nil {
		t.Fatal("zero duration accepted")
	}
	if _, err := BuildIELTSSharedSchedule(start, []PlanEntry{{SectionKey: "speaking", Order: 1, DurationMinutes: 10}}, ResponseSaveGrace); err == nil {
		t.Fatal("speaking accepted")
	}
	if _, err := BuildIELTSSharedSchedule(start, []PlanEntry{{SectionKey: "reading", Order: 1, DurationMinutes: 10}, {SectionKey: "reading", Order: 2, DurationMinutes: 10}}, ResponseSaveGrace); err == nil {
		t.Fatal("duplicate accepted")
	}
	s, _ := BuildIELTSSharedSchedule(start, sharedPlan(), ResponseSaveGrace)
	s.Windows[1].StartAt = s.Windows[0].DeadlineAt
	if err := ValidateIELTSSharedSchedule(s); err == nil {
		t.Fatal("overlap accepted")
	}
	for _, raw := range []string{`{`, `{"schemaVersion":2,"scheduleRevision":1,"status":"active","windows":[]}`, `{"schemaVersion":1,"scheduleRevision":1,"status":"paused","windows":[{"sectionKey":"reading","order":1,"startAt":"2026-10-30T03:00:00Z","deadlineAt":"2026-10-30T04:00:00Z","saveUntil":"2026-10-30T04:00:03Z"}]}`} {
		if _, err := ParseIELTSSharedSchedule([]byte(raw)); err == nil {
			t.Fatalf("accepted %s", raw)
		}
	}
}

func TestIELTSSharedPauseResumeShiftsOnlyUnfinishedWindows(t *testing.T) {
	start := mustTime(t, "2026-10-30T03:00:00Z")
	s, _ := BuildIELTSSharedSchedule(start, sharedPlan(), ResponseSaveGrace)
	paused, err := PauseIELTSSharedSchedule(s, mustTime(t, "2026-10-30T03:40:00Z"))
	if err != nil {
		t.Fatal(err)
	}
	if pos, _ := ResolveIELTSSharedWindow(paused, mustTime(t, "2026-10-30T09:00:00Z")); pos.Kind != SharedPaused || pos.Window.SectionKey != "reading" {
		t.Fatalf("paused position %+v", pos)
	}
	if _, err := PauseIELTSSharedSchedule(paused, mustTime(t, "2026-10-30T03:41:00Z")); err == nil {
		t.Fatal("double pause accepted")
	}
	resumed, err := ResumeIELTSSharedSchedule(paused, 10*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := ResumeIELTSSharedSchedule(resumed, 10*time.Minute); err == nil {
		t.Fatal("duplicate resume shifted twice")
	}
	if resumed.ScheduleRevision != 3 || !resumed.Windows[0].SaveUntil.Equal(s.Windows[0].SaveUntil) {
		t.Fatalf("completed window changed or revision wrong: %+v", resumed)
	}
	if !resumed.Windows[1].StartAt.Equal(s.Windows[1].StartAt) || !resumed.Windows[1].DeadlineAt.Equal(s.Windows[1].DeadlineAt.Add(10*time.Minute)) {
		t.Fatalf("active window shift wrong: %+v", resumed.Windows[1])
	}
	if !resumed.Windows[2].StartAt.Equal(s.Windows[2].StartAt.Add(10 * time.Minute)) {
		t.Fatalf("successor not shifted: %+v", resumed.Windows[2])
	}
	// A pause before the first start moves the whole timetable.
	early, _ := PauseIELTSSharedSchedule(s, start.Add(-5*time.Second))
	early, _ = ResumeIELTSSharedSchedule(early, time.Minute)
	if !early.Windows[0].StartAt.Equal(start.Add(time.Minute)) || early.Windows[0].DeadlineAt.Sub(early.Windows[0].StartAt) != 30*time.Minute {
		t.Fatalf("pre-start pause awarded time: %+v", early.Windows[0])
	}
}

func TestIELTSSharedExtendAndEnd(t *testing.T) {
	start := mustTime(t, "2026-10-30T03:00:00Z")
	s, _ := BuildIELTSSharedSchedule(start, sharedPlan(), ResponseSaveGrace)
	now := mustTime(t, "2026-10-30T03:10:00Z")
	if _, err := ExtendIELTSSharedSection(s, "reading", time.Minute, now); err == nil {
		t.Fatal("extended a section that is not working")
	}
	ext, err := ExtendIELTSSharedSection(s, "listening", 5*time.Minute, now)
	if err != nil {
		t.Fatal(err)
	}
	for i := range s.Windows {
		if !ext.Windows[i].DeadlineAt.Equal(s.Windows[i].DeadlineAt.Add(5 * time.Minute)) {
			t.Fatalf("window %d not shifted by the extension", i)
		}
	}
	endAt := mustTime(t, "2026-10-30T03:20:00Z")
	ended, err := EndIELTSSharedSection(s, "listening", endAt, &endAt)
	if err != nil {
		t.Fatal(err)
	}
	if !ended.Windows[0].SaveUntil.Equal(endAt) || !ended.Windows[1].StartAt.Equal(endAt) || ended.Windows[1].DeadlineAt.Sub(ended.Windows[1].StartAt) != time.Hour {
		t.Fatalf("end-now rebase wrong: %+v", ended.Windows[:2])
	}
	if gap := ended.Windows[2].StartAt.Sub(ended.Windows[1].SaveUntil); gap != 5*time.Minute {
		t.Fatalf("authored gap lost: %s", gap)
	}
	last, err := EndIELTSSharedSection(ended, "writing", mustTime(t, "2026-10-30T05:00:00Z"), nil)
	if err != nil || last.Status != SharedScheduleEnded {
		t.Fatalf("final end: %v %+v", err, last)
	}
}

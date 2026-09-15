package proctor

// The section-advance rules are a pure function over the locked rows, so they
// are pinned here without a database. The sqlmock file
// (reconcile_sections_test.go) covers the SQL wiring of the plan: which
// statements a given plan issues, and in what order.

import (
	"testing"
	"time"
)

var planBase = time.Date(2026, 9, 14, 9, 0, 0, 0, time.UTC)

func liveSection(key string, order int64, planned, gap int64, startedAt time.Time) runtimeSection {
	start := startedAt.UTC()
	return runtimeSection{key: key, order: order, planned: planned, gap: gap, status: "live", startedAt: &start}
}

func lockedSection(key string, order int64, planned, gap int64) runtimeSection {
	return runtimeSection{key: key, order: order, planned: planned, gap: gap, status: "locked"}
}

func completedSection(key string, order int64, planned, gap int64, startedAt, endedAt time.Time) runtimeSection {
	start, end := startedAt.UTC(), endedAt.UTC()
	return runtimeSection{
		key: key, order: order, planned: planned, gap: gap, status: "completed",
		startedAt: &start, endedAt: &end,
	}
}

func sectionKeys(steps []advanceStep, kind advanceStepKind) []string {
	var keys []string
	for _, step := range steps {
		if step.kind == kind {
			keys = append(keys, step.sectionKey)
		}
	}
	return keys
}

func TestPlanSectionAdvance(t *testing.T) {
	// reading-writing: 64 planned minutes starting at 09:00 -> deadline 10:04.
	deadline := planBase.Add(64 * time.Minute)
	rw := liveSection("reading-writing", 1, 64, 0, planBase)
	math := lockedSection("math", 2, 35, 0)

	tests := []struct {
		name         string
		runtime      reconcileRuntime
		sections     []runtimeSection
		autoSubmit   bool
		asOf         time.Time
		wantKinds    []advanceStepKind
		wantMissing  bool
		wantStartAt  *time.Time
		wantComplete *time.Time
	}{
		{
			name:       "inside the closing grace the section does not move",
			runtime:    reconcileRuntime{activeSectionKey: ptr("reading-writing")},
			sections:   []runtimeSection{rw, math},
			autoSubmit: true,
			asOf:       deadline.Add(10 * time.Second),
			wantKinds:  nil,
		},
		{
			name:       "before the deadline nothing happens",
			runtime:    reconcileRuntime{activeSectionKey: ptr("reading-writing")},
			sections:   []runtimeSection{rw, math},
			autoSubmit: true,
			asOf:       deadline.Add(-time.Minute),
			wantKinds:  nil,
		},
		{
			name:        "not started section never advances",
			runtime:     reconcileRuntime{activeSectionKey: ptr("reading-writing")},
			sections:    []runtimeSection{{key: "reading-writing", order: 1, planned: 64, status: "live"}, math},
			autoSubmit:  true,
			asOf:        deadline.Add(time.Hour),
			wantKinds:   nil,
			wantMissing: false,
		},
		{
			name:        "missing active section row is reported",
			runtime:     reconcileRuntime{activeSectionKey: ptr("gone")},
			sections:    []runtimeSection{rw, math},
			autoSubmit:  true,
			asOf:        deadline.Add(time.Minute),
			wantMissing: true,
		},
		{
			name:       "no active section key plans nothing",
			runtime:    reconcileRuntime{},
			sections:   []runtimeSection{rw, math},
			autoSubmit: true,
			asOf:       deadline.Add(time.Minute),
			wantKinds:  nil,
		},
		{
			// Gap 0 = the previous immediate advance.
			name:         "gap 0 completes and starts in one plan",
			runtime:      reconcileRuntime{activeSectionKey: ptr("reading-writing")},
			sections:     []runtimeSection{rw, math},
			autoSubmit:   true,
			asOf:         deadline.Add(40 * time.Second),
			wantKinds:    []advanceStepKind{stepCompleteSection, stepStartSection},
			wantStartAt:  ptrTime(deadline),
			wantComplete: ptrTime(deadline),
		},
		{
			// The authored break: section closes, runtime waits, next start is
			// announced at the previous end plus the gap.
			name:    "gap opens the between-sections window",
			runtime: reconcileRuntime{activeSectionKey: ptr("reading-writing")},
			sections: []runtimeSection{
				func() runtimeSection { s := rw; s.gap = 10; return s }(),
				math,
			},
			autoSubmit:   true,
			asOf:         deadline.Add(40 * time.Second),
			wantKinds:    []advanceStepKind{stepCompleteSection, stepEnterWaiting},
			wantComplete: ptrTime(deadline),
		},
		{
			name: "an already-waiting runtime is not re-flagged",
			runtime: reconcileRuntime{
				activeSectionKey: ptr("reading-writing"), waiting: true,
			},
			sections: []runtimeSection{
				completedSection("reading-writing", 1, 64, 10, planBase, deadline),
				math,
			},
			autoSubmit: true,
			asOf:       deadline.Add(5 * time.Minute), // inside the 10-minute gap
			wantKinds:  nil,
		},
		{
			name: "the gap end starts the next section at its authored instant",
			runtime: reconcileRuntime{
				activeSectionKey: ptr("reading-writing"), waiting: true,
			},
			sections: []runtimeSection{
				completedSection("reading-writing", 1, 64, 10, planBase, deadline),
				math,
			},
			autoSubmit:  true,
			asOf:        deadline.Add(12 * time.Minute),
			wantKinds:   []advanceStepKind{stepStartSection},
			wantStartAt: ptrTime(deadline.Add(10 * time.Minute)),
		},
		{
			name:       "paused past the grace is flagged, never advanced",
			runtime:    reconcileRuntime{activeSectionKey: ptr("reading-writing")},
			sections:   []runtimeSection{pausedSection(rw, deadline.Add(-30*time.Minute)), math},
			autoSubmit: true,
			asOf:       deadline.Add(5 * time.Minute),
			wantKinds:  []advanceStepKind{stepFlagOverrun},
		},
		{
			name:       "auto-submit disabled is flagged, never advanced",
			runtime:    reconcileRuntime{activeSectionKey: ptr("reading-writing")},
			sections:   []runtimeSection{rw, math},
			autoSubmit: false,
			asOf:       deadline.Add(5 * time.Minute),
			wantKinds:  []advanceStepKind{stepFlagOverrun},
		},
		{
			name: "an overrun already recorded is not rewritten",
			runtime: reconcileRuntime{
				activeSectionKey: ptr("reading-writing"), overrun: true,
			},
			sections:   []runtimeSection{rw, math},
			autoSubmit: false,
			asOf:       deadline.Add(5 * time.Minute),
			wantKinds:  nil,
		},
		{
			name:       "last section completes the runtime",
			runtime:    reconcileRuntime{activeSectionKey: ptr("reading-writing")},
			sections:   []runtimeSection{pastDeadline(rw, deadline)},
			autoSubmit: true,
			asOf:       deadline.Add(time.Hour),
			wantKinds:  []advanceStepKind{stepCompleteSection, stepCompleteRuntime},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			plan := planSectionAdvance(tc.runtime, tc.sections, tc.autoSubmit, tc.asOf)
			if plan.activeSectionMissing != tc.wantMissing {
				t.Fatalf("activeSectionMissing = %v, want %v", plan.activeSectionMissing, tc.wantMissing)
			}
			if len(plan.steps) != len(tc.wantKinds) {
				t.Fatalf("steps = %d (%v), want %v", len(plan.steps), plan.steps, tc.wantKinds)
			}
			for i, want := range tc.wantKinds {
				if plan.steps[i].kind != want {
					t.Fatalf("step[%d] = %v, want %v", i, plan.steps[i].kind, want)
				}
			}
			if tc.wantStartAt != nil {
				start := stepOf(plan.steps, stepStartSection)
				if start == nil {
					t.Fatal("expected a start step")
				}
				if !start.startAt.Equal(*tc.wantStartAt) {
					t.Fatalf("startAt = %v, want %v", start.startAt, *tc.wantStartAt)
				}
			}
			if tc.wantComplete != nil {
				done := stepOf(plan.steps, stepCompleteSection)
				if done == nil {
					t.Fatal("expected a completion step")
				}
				if !done.effectiveAt.Equal(*tc.wantComplete) {
					t.Fatalf("effectiveAt = %v, want %v", done.effectiveAt, *tc.wantComplete)
				}
			}
		})
	}
}

// A sweep that returns after an outage catches up through every expired section
// and preserves the authored timeline: each section starts at its
// predecessor's end plus the gap, never at "now".
func TestPlanSectionAdvanceCatchesUpOnTheAuthoredTimeline(t *testing.T) {
	deadline1 := planBase.Add(64 * time.Minute)
	start2 := deadline1.Add(10 * time.Minute)
	deadline2 := start2.Add(35 * time.Minute)
	start3 := deadline2.Add(5 * time.Minute)
	deadline3 := start3.Add(30 * time.Minute)
	// The sweep returns long after the third section's own window too.
	asOf := deadline3.Add(4 * time.Minute)

	sections := []runtimeSection{
		func() runtimeSection { s := liveSection("reading-writing", 1, 64, 10, planBase); return s }(),
		lockedSection("math", 2, 35, 5),
		lockedSection("science", 3, 30, 0),
	}
	plan := planSectionAdvance(
		reconcileRuntime{activeSectionKey: ptr("reading-writing")},
		sections, true, asOf,
	)

	want := []advanceStepKind{
		stepCompleteSection, stepStartSection,
		stepCompleteSection, stepStartSection,
		stepCompleteSection, stepCompleteRuntime,
	}
	if len(plan.steps) != len(want) {
		t.Fatalf("steps = %v, want %d steps", plan.steps, len(want))
	}
	for i, kind := range want {
		if plan.steps[i].kind != kind {
			t.Fatalf("step[%d] = %v, want %v", i, plan.steps[i].kind, kind)
		}
	}
	starts := plan.steps
	if !starts[1].startAt.Equal(start2) {
		t.Fatalf("math must start at %v (section 1 end + gap), got %v", start2, starts[1].startAt)
	}
	if !starts[3].startAt.Equal(start3) {
		t.Fatalf("science must start at %v (math end + gap), got %v", start3, starts[3].startAt)
	}
	if !starts[2].effectiveAt.Equal(deadline2) {
		t.Fatalf("math must close at its own deadline %v, got %v", deadline2, starts[2].effectiveAt)
	}
	if !starts[4].effectiveAt.Equal(deadline3) {
		t.Fatalf("science must close at its own deadline %v, got %v", deadline3, starts[4].effectiveAt)
	}
	if !starts[5].effectiveAt.Equal(asOf) {
		t.Fatalf("runtime must end at the sweep instant %v, got %v", asOf, starts[5].effectiveAt)
	}
}

// The planner must not mutate the rows the caller locked.
func TestPlanSectionAdvanceLeavesLockedRowsUntouched(t *testing.T) {
	deadline := planBase.Add(64 * time.Minute)
	sections := []runtimeSection{liveSection("reading-writing", 1, 64, 0, planBase), lockedSection("math", 2, 35, 0)}
	planSectionAdvance(reconcileRuntime{activeSectionKey: ptr("reading-writing")}, sections, true, deadline.Add(time.Minute))

	if sections[0].status != "live" || sections[0].endedAt != nil {
		t.Fatalf("locked rows must not be mutated, got %+v", sections[0])
	}
	if sections[1].status != "locked" || sections[1].startedAt != nil {
		t.Fatalf("locked rows must not be mutated, got %+v", sections[1])
	}
}

func stepOf(steps []advanceStep, kind advanceStepKind) *advanceStep {
	for i := range steps {
		if steps[i].kind == kind {
			return &steps[i]
		}
	}
	return nil
}

func ptr(s string) *string { return &s }

func ptrTime(t time.Time) *time.Time { return &t }

// pastDeadline returns a live section started so early that its deadline is
// well behind asOf, without mutating the caller's row.
func pastDeadline(section runtimeSection, deadline time.Time) runtimeSection {
	start := deadline.Add(-time.Duration(section.planned) * time.Minute).UTC()
	section.startedAt = &start
	return section
}

// pausedSection freezes the given live section's clock at pausedAt.
func pausedSection(section runtimeSection, pausedAt time.Time) runtimeSection {
	p := pausedAt.UTC()
	section.pausedAt = &p
	return section
}

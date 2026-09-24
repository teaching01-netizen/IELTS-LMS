import { describe, expect, it } from "vitest";
import type { ExamPlanSection, ExamSessionRuntime, SectionRuntimeState } from "../../../../types/domain";
import {
  buildSatRunSheet,
  formatRunSheetClock,
  formatRunSheetRemaining,
  formatRunSheetWindow,
  SAT_RUN_SHEET_TIME_ZONE,
  satModuleSlotLabel,
  satRunSheetCurrentRows,
  satRunSheetTimingPlan,
  type SatRunSheetRow,
  type SatRunSheetRuntime,
} from "../sessionRunSheet";

// Every instant below is written in UTC; the assertions are all in Bangkok
// (UTC+7), which is the point of the sheet: a run anchored at 02:00Z reads
// 09:00 to the room regardless of the device's own timezone.
const SCHEDULED_START = "2026-09-20T02:00:00.000Z"; // 09:00 ICT
const ANCHOR = SCHEDULED_START;

const readingWritingPlan: ExamPlanSection = {
  sectionKey: "reading-writing",
  label: "Reading & Writing",
  order: 0,
  durationMinutes: 64,
  gapAfterMinutes: 10,
  modules: [
    { moduleKey: "rw-m1", title: "Module 1", adaptiveRole: "base", durationMinutes: 32 },
    { moduleKey: "rw-m2-lower", title: "Module 2 — Lower", adaptiveRole: "lower_branch", durationMinutes: 32 },
    { moduleKey: "rw-m2-higher", title: "Module 2 — Higher", adaptiveRole: "higher_branch", durationMinutes: 32 },
  ],
};

const mathPlan: ExamPlanSection = {
  sectionKey: "math",
  label: "Math",
  order: 1,
  durationMinutes: 70,
  gapAfterMinutes: 0,
  modules: [
    { moduleKey: "math-m1", title: "Module 1", adaptiveRole: "base", durationMinutes: 35 },
    { moduleKey: "math-m2-lower", title: "Module 2 — Lower", adaptiveRole: "lower_branch", durationMinutes: 35 },
    { moduleKey: "math-m2-higher", title: "Module 2 — Higher", adaptiveRole: "higher_branch", durationMinutes: 35 },
  ],
};

function runtimeSection(
  sectionKey: string,
  order: number,
  overrides: Partial<SectionRuntimeState> = {}
): SectionRuntimeState {
  return {
    sectionKey: sectionKey as SectionRuntimeState["sectionKey"],
    label: sectionKey,
    order,
    plannedDurationMinutes: sectionKey === "math" ? 70 : 64,
    gapAfterMinutes: sectionKey === "reading-writing" ? 10 : 0,
    status: "locked",
    availableAt: null,
    actualStartAt: null,
    actualEndAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    extensionMinutes: 0,
    ...overrides,
  };
}

function runtime(
  sections: SectionRuntimeState[],
  overrides: Partial<ExamSessionRuntime> = {}
): SatRunSheetRuntime {
  return {
    sections,
    actualStartAt: SCHEDULED_START,
    status: "live",
    serverNow: SCHEDULED_START,
    ...overrides,
  };
}

function rowById(rows: SatRunSheetRow[], id: string): SatRunSheetRow {
  const found = rows.find((row) => row.id === id);
  if (!found) throw new Error(`row ${id} missing (have ${rows.map((row) => row.id).join(", ")})`);
  return found;
}

describe("buildSatRunSheet", () => {
  it("projects the authored plan in Bangkok time before the proctor starts", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: { sections: [], actualStartAt: null, status: "not_started", serverNow: SCHEDULED_START },
      scheduledStartAt: SCHEDULED_START,
      now: SCHEDULED_START,
    });

    expect(sheet.anchor).toBe("scheduled");
    expect(sheet.anchorAt).toBe(SCHEDULED_START);
    // 09:00 + 64 min + 10 min break + 70 min = 11:24 ICT.
    expect(formatRunSheetClock(sheet.plannedEndAt)).toBe("11:24");
    expect(sheet.rows.map((row) => row.id)).toEqual([
      "reading-writing:section",
      "reading-writing:module:m1",
      "reading-writing:module:m2-lower_branch",
      "reading-writing:module:m2-higher_branch",
      "reading-writing:break",
      "math:section",
      "math:module:m1",
      "math:module:m2-lower_branch",
      "math:module:m2-higher_branch",
    ]);
    expect(sheet.rows.every((row) => row.status === "projected")).toBe(true);

    const rwSection = rowById(sheet.rows, "reading-writing:section");
    expect(rwSection.label).toBe("Section 1 · Reading & Writing");
    expect(formatRunSheetWindow(rwSection.plannedStartAt, rwSection.plannedEndAt, ANCHOR)).toBe("09:00–10:04");

    const rwModule1 = rowById(sheet.rows, "reading-writing:module:m1");
    expect(rwModule1.plannedDurationMinutes).toBe(32);
    expect(formatRunSheetWindow(rwModule1.plannedStartAt, rwModule1.plannedEndAt, ANCHOR)).toBe("09:00–09:32");

    // Both Module 2 branches are visible alternatives. They start together;
    // only one branch is routed to each student.
    const rwModule2Lower = rowById(sheet.rows, "reading-writing:module:m2-lower_branch");
    const rwModule2Higher = rowById(sheet.rows, "reading-writing:module:m2-higher_branch");
    expect(rwModule2Lower.detail).toBe("Alternative branch · 32′");
    expect(rwModule2Higher.detail).toBe("Alternative branch · 32′");
    expect(rwModule2Lower.plannedStartAt).toBe(rwModule2Higher.plannedStartAt);
    expect(formatRunSheetWindow(rwModule2Lower.plannedStartAt, rwModule2Lower.plannedEndAt, ANCHOR)).toBe("09:32–10:04");
    expect(formatRunSheetWindow(rwModule2Higher.plannedStartAt, rwModule2Higher.plannedEndAt, ANCHOR)).toBe("09:32–10:04");

    const rwBreak = rowById(sheet.rows, "reading-writing:break");
    expect(rwBreak.label).toBe("Break · 10 min");
    expect(formatRunSheetWindow(rwBreak.plannedStartAt, rwBreak.plannedEndAt, ANCHOR)).toBe("10:04–10:14");

    const mathSection = rowById(sheet.rows, "math:section");
    expect(formatRunSheetWindow(mathSection.plannedStartAt, mathSection.plannedEndAt, ANCHOR)).toBe("10:14–11:24");
    // Math's authored break is zero: no break row, and Math starts immediately.
    expect(sheet.rows.some((row) => row.id === "math:break")).toBe(false);
  });

  // The sheet must read the server's own end for the section the room is inside:
  // it is the instant the hero clock and every candidate's countdown are computed
  // from, so a reconstruction that drifts from it is exactly the "the timers are
  // not in sync" report — the sheet said 44:00 while every clock said 44:06.
  it("takes the published section deadline for the live section over its own derivation", () => {
    const publishedDeadline = "2026-09-20T03:04:06.000Z"; // 10:04:06 ICT: six seconds past the plan's 10:04
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime(
        [runtimeSection("reading-writing", 0, { status: "live", actualStartAt: SCHEDULED_START })],
        {
          activeSectionKey: "reading-writing",
          currentSectionKey: "reading-writing",
          currentSectionDeadlineAt: publishedDeadline,
        },
      ),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:20:00.000Z", // 09:20 ICT
    });

    const section = rowById(sheet.rows, "reading-writing:section");
    expect(section.plannedEndAt).toBe(publishedDeadline);
    expect(formatRunSheetRemaining(section.remainingSeconds)).toBe("44:06");
    // The module rows tile onto the same boundary the server published.
    expect(rowById(sheet.rows, "reading-writing:module:m2-higher_branch").plannedEndAt).toBe(publishedDeadline);

    // A read that publishes no deadline keeps the derivation (the plan's 10:04).
    const derived = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, { status: "live", actualStartAt: SCHEDULED_START }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:20:00.000Z",
    });
    const derivedSection = rowById(derived.rows, "reading-writing:section");
    expect(formatRunSheetWindow(derivedSection.plannedStartAt, derivedSection.plannedEndAt, ANCHOR)).toBe("09:00–10:04");
    expect(formatRunSheetRemaining(derivedSection.remainingSeconds)).toBe("44:00");
  });

  it("applies the published deadline only to the section it belongs to", () => {
    const publishedDeadline = "2026-09-20T03:04:06.000Z";
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime(
        [
          runtimeSection("reading-writing", 0, { status: "live", actualStartAt: SCHEDULED_START }),
          runtimeSection("math", 1),
        ],
        {
          activeSectionKey: "reading-writing",
          currentSectionKey: "reading-writing",
          currentSectionDeadlineAt: publishedDeadline,
        },
      ),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:20:00.000Z",
    });

    expect(rowById(sheet.rows, "reading-writing:section").plannedEndAt).toBe(publishedDeadline);
    // Math is still ahead: its window is projected from the plan (10:04's break,
    // then 70 minutes), never from the section the room is inside right now.
    const mathSection = rowById(sheet.rows, "math:section");
    expect(mathSection.plannedEndAt).not.toBe(publishedDeadline);
    expect(formatRunSheetWindow(mathSection.plannedStartAt, mathSection.plannedEndAt, ANCHOR)).toBe("10:14–11:24");
  });

  it("marks the live section and the module the cohort is inside", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, { status: "live", actualStartAt: SCHEDULED_START }),
        runtimeSection("math", 1),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:20:00.000Z", // 09:20 ICT, inside Module 1
    });

    expect(sheet.anchor).toBe("runtime");
    const section = rowById(sheet.rows, "reading-writing:section");
    expect(section.status).toBe("live");
    expect(rowById(sheet.rows, "reading-writing:module:m1").status).toBe("live");
    expect(rowById(sheet.rows, "reading-writing:module:m2-lower_branch").status).toBe("upcoming");
    expect(rowById(sheet.rows, "reading-writing:break").status).toBe("upcoming");
    expect(rowById(sheet.rows, "math:section").status).toBe("upcoming");
  });

  it("runs the break from the completed section's ACTUAL end, then the next section", () => {
    const actualEnd = "2026-09-20T03:04:00.000Z"; // 10:04 ICT
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "completed",
          actualStartAt: SCHEDULED_START,
          actualEndAt: actualEnd,
        }),
        runtimeSection("math", 1),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T03:07:00.000Z", // 10:07 ICT, on the break
    });

    const section = rowById(sheet.rows, "reading-writing:section");
    expect(section.status).toBe("done");
    expect(section.actualEndAt).toBe(actualEnd);
    const breakRow = rowById(sheet.rows, "reading-writing:break");
    expect(breakRow.status).toBe("live");
    expect(formatRunSheetWindow(breakRow.plannedStartAt, breakRow.plannedEndAt, ANCHOR)).toBe("10:04–10:14");
  });

  it("uses the longer adaptive branch for the shared boundary without summing branches", () => {
    const unequalPlan: ExamPlanSection = {
      ...readingWritingPlan,
      durationMinutes: 11,
      gapAfterMinutes: 5,
      modules: [
        { moduleKey: "m1", title: "Module 1", adaptiveRole: "base", durationMinutes: 5 },
        { moduleKey: "easy", title: "Module 2 — Easy", adaptiveRole: "lower_branch", durationMinutes: 4 },
        { moduleKey: "hard", title: "Module 2 — Hard", adaptiveRole: "higher_branch", durationMinutes: 6 },
      ],
    };
    const sheet = buildSatRunSheet({
      plan: [unequalPlan],
      runtime: {
        sections: [],
        actualStartAt: null,
        status: "not_started",
        serverNow: SCHEDULED_START,
      },
      scheduledStartAt: SCHEDULED_START,
      now: SCHEDULED_START,
    });

    const module1 = rowById(sheet.rows, "reading-writing:module:m1");
    const easy = rowById(sheet.rows, "reading-writing:module:m2-lower_branch");
    const hard = rowById(sheet.rows, "reading-writing:module:m2-higher_branch");
    const breakRow = rowById(sheet.rows, "reading-writing:break");
    expect(formatRunSheetWindow(module1.plannedStartAt, module1.plannedEndAt, ANCHOR)).toBe(
      "09:00–09:05"
    );
    expect(formatRunSheetWindow(easy.plannedStartAt, easy.plannedEndAt, ANCHOR)).toBe(
      "09:05–09:09"
    );
    expect(formatRunSheetWindow(hard.plannedStartAt, hard.plannedEndAt, ANCHOR)).toBe(
      "09:05–09:11"
    );
    expect(easy.plannedStartAt).toBe(hard.plannedStartAt);
    expect(formatRunSheetWindow(breakRow.plannedStartAt, breakRow.plannedEndAt, ANCHOR)).toBe(
      "09:11–09:16"
    );
  });

  it("marks a passed break done", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "completed",
          actualStartAt: SCHEDULED_START,
          actualEndAt: "2026-09-20T03:04:00.000Z",
        }),
        runtimeSection("math", 1, { status: "live", actualStartAt: "2026-09-20T03:14:00.000Z" }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T03:20:00.000Z", // 10:20 ICT, inside Math
    });

    expect(rowById(sheet.rows, "reading-writing:break").status).toBe("done");
    const math = rowById(sheet.rows, "math:section");
    expect(math.status).toBe("live");
    expect(formatRunSheetWindow(math.plannedStartAt, math.plannedEndAt, ANCHOR)).toBe("10:14–11:24");
  });

  it("shifts every later window by a proctor time extension", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "live",
          actualStartAt: SCHEDULED_START,
          extensionMinutes: 5,
        }),
        runtimeSection("math", 1),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:20:00.000Z",
    });

    expect(formatRunSheetWindow(
      rowById(sheet.rows, "reading-writing:section").plannedStartAt,
      rowById(sheet.rows, "reading-writing:section").plannedEndAt,
      ANCHOR
    )).toBe("09:00–10:09");
    expect(formatRunSheetWindow(
      rowById(sheet.rows, "reading-writing:break").plannedStartAt,
      rowById(sheet.rows, "reading-writing:break").plannedEndAt,
      ANCHOR
    )).toBe("10:09–10:19");
    expect(formatRunSheetWindow(
      rowById(sheet.rows, "math:section").plannedStartAt,
      rowById(sheet.rows, "math:section").plannedEndAt,
      ANCHOR
    )).toBe("10:19–11:29");
  });

  it("falls back to the runtime rows when the read carries no authored plan", () => {
    const sheet = buildSatRunSheet({
      plan: null,
      runtime: runtime([
        runtimeSection("reading-writing", 0, { status: "live", actualStartAt: SCHEDULED_START, label: "Reading & Writing" }),
        runtimeSection("math", 1, { label: "Math" }),
      ]),
      now: "2026-09-20T02:20:00.000Z",
    });

    expect(sheet.rows.map((row) => row.kind)).toEqual(["section", "break", "section"]);
    expect(formatRunSheetWindow(
      rowById(sheet.rows, "reading-writing:section").plannedStartAt,
      rowById(sheet.rows, "reading-writing:section").plannedEndAt,
      ANCHOR
    )).toBe("09:00–10:04");
  });

  it("keeps durations readable when nothing anchors the run", () => {
    const sheet = buildSatRunSheet({ plan: [mathPlan], runtime: null });

    expect(sheet.anchor).toBe("none");
    expect(sheet.anchorAt).toBeNull();
    expect(sheet.plannedEndAt).toBeNull();
    const section = rowById(sheet.rows, "math:section");
    expect(section.plannedStartAt).toBeNull();
    expect(section.plannedDurationMinutes).toBe(70);
    expect(section.status).toBe("projected");
  });

  // The production failure: 0065 repaired the authored rows to the candidate
  // length, but a session started before it still runs the sum of Module 1 and
  // BOTH Module 2 branches — 96 minutes of Reading & Writing, 105 of Math —
  // while the plan now says 64 and 70. Every candidate's countdown runs on the
  // snapshot, so that is the window the sheet must project, and the row must
  // say why it is long instead of quietly rendering the plan's number.
  it("reproduces the production mismatch: the runtime clock wins and no phantom break appears", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "live",
          actualStartAt: SCHEDULED_START,
          plannedDurationMinutes: 96,
        }),
        runtimeSection("math", 1, { plannedDurationMinutes: 105 }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T03:20:00.000Z", // 10:20 ICT, inside the phantom window
    });

    const section = rowById(sheet.rows, "reading-writing:section");
    expect(section.status).toBe("live");
    expect(section.runtimeDurationMinutes).toBe(96);
    expect(section.plannedDurationMinutes).toBe(64);
    expect(section.runtimeMismatch).toBe(true);
    expect(section.mismatchNote).toBe("Clock 96 min · plan 64 min");
    expect(
      formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR)
    ).toBe("09:00–10:36");

    // The module the cohort is inside ends with its section: no hole, and the
    // real remaining time to the end of Reading & Writing.
    const module2 = rowById(sheet.rows, "reading-writing:module:m2-lower_branch");
    expect(
      formatRunSheetWindow(module2.plannedStartAt, module2.plannedEndAt, ANCHOR)
    ).toBe("09:32–10:36");
    expect(module2.status).toBe("live");
    expect(rowById(sheet.rows, "reading-writing:module:m1").status).toBe("done");

    // No break at 10:04–10:14: the break begins when the section actually ends.
    const breakRow = rowById(sheet.rows, "reading-writing:break");
    expect(
      formatRunSheetWindow(breakRow.plannedStartAt, breakRow.plannedEndAt, ANCHOR)
    ).toBe("10:36–10:46");
    expect(breakRow.status).toBe("upcoming");

    // Math keeps its own snapshot length too, and starts after that break.
    const math = rowById(sheet.rows, "math:section");
    expect(
      formatRunSheetWindow(math.plannedStartAt, math.plannedEndAt, ANCHOR)
    ).toBe("10:46–12:31");
    expect(math.runtimeMismatch).toBe(true);
  });

  it("shows the real remaining Math time of an inflated live section", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "completed",
          actualStartAt: SCHEDULED_START,
          actualEndAt: "2026-09-20T03:36:00.000Z", // 10:36 ICT, the snapshot's end
          plannedDurationMinutes: 96,
        }),
        runtimeSection("math", 1, {
          status: "live",
          actualStartAt: "2026-09-20T03:46:00.000Z", // 10:46 ICT
          plannedDurationMinutes: 105,
        }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T04:30:00.000Z", // 11:30 ICT, inside inflated Math
    });

    const math = rowById(sheet.rows, "math:section");
    expect(
      formatRunSheetWindow(math.plannedStartAt, math.plannedEndAt, ANCHOR)
    ).toBe("10:46–12:31");
    expect(math.mismatchNote).toBe("Clock 105 min · plan 70 min");
    // Module 2 carries the same end, so the sheet reports the ~61 minutes the
    // room actually still has instead of the plan's 10:56 finish.
    const module2 = rowById(sheet.rows, "math:module:m2-lower_branch");
    expect(
      formatRunSheetWindow(module2.plannedStartAt, module2.plannedEndAt, ANCHOR)
    ).toBe("11:21–12:31");
    expect(module2.status).toBe("live");
    // The break that already happened ended when Math actually began.
    const breakRow = rowById(sheet.rows, "reading-writing:break");
    expect(breakRow.status).toBe("done");
    expect(formatRunSheetClock(breakRow.actualStartAt)).toBe("10:36");
    expect(formatRunSheetClock(breakRow.actualEndAt)).toBe("10:46");
  });

  it("tiles module rows to the section window under an accumulated pause", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "live",
          actualStartAt: SCHEDULED_START,
          accumulatedPausedSeconds: 300,
        }),
        runtimeSection("math", 1),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:40:00.000Z", // 09:40 ICT
    });

    const section = rowById(sheet.rows, "reading-writing:section");
    expect(
      formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR)
    ).toBe("09:00–10:09");
    expect(section.detail).toBe("5 min paused");
    const module1 = rowById(sheet.rows, "reading-writing:module:m1");
    const module2 = rowById(sheet.rows, "reading-writing:module:m2-lower_branch");
    const breakRow = rowById(sheet.rows, "reading-writing:break");
    // Contiguous: Module 1 → Module 2 → the break, with no unexplained gap
    // between the last module and the section it belongs to.
    expect(module1.plannedEndAt).toBe(module2.plannedStartAt);
    expect(module2.plannedEndAt).toBe(section.plannedEndAt);
    expect(breakRow.plannedStartAt).toBe(section.plannedEndAt);
    expect(
      formatRunSheetWindow(module2.plannedStartAt, module2.plannedEndAt, ANCHOR)
    ).toBe("09:32–10:09");
  });

  it("tiles module rows to the section window under a proctor extension", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "live",
          actualStartAt: SCHEDULED_START,
          extensionMinutes: 5,
        }),
        runtimeSection("math", 1),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:20:00.000Z", // 09:20 ICT, inside Module 1
    });

    const section = rowById(sheet.rows, "reading-writing:section");
    const module1 = rowById(sheet.rows, "reading-writing:module:m1");
    const module2 = rowById(sheet.rows, "reading-writing:module:m2-lower_branch");
    expect(section.detail).toBe("+5 min added");
    expect(
      formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR)
    ).toBe("09:00–10:09");
    // The live module absorbs the extra five minutes; the next one still ends
    // exactly with the section, instead of a stale 10:04.
    expect(
      formatRunSheetWindow(module1.plannedStartAt, module1.plannedEndAt, ANCHOR)
    ).toBe("09:00–09:37");
    expect(module1.plannedEndAt).toBe(module2.plannedStartAt);
    expect(module2.plannedEndAt).toBe(section.plannedEndAt);
  });

  it("keeps the runtime window when the plan is the longer side", () => {
    // The mirror of the production mismatch, so the rule is direction-blind: an
    // authored 105-minute section against a repaired 70-minute runtime clock.
    const longerPlan: ExamPlanSection = {
      ...mathPlan,
      durationMinutes: 105,
      gapAfterMinutes: 10,
    };
    const sheet = buildSatRunSheet({
      plan: [longerPlan],
      runtime: runtime([
        runtimeSection("math", 0, {
          status: "live",
          actualStartAt: SCHEDULED_START,
          plannedDurationMinutes: 70,
          gapAfterMinutes: 10,
        }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:20:00.000Z", // 09:20 ICT, inside Module 1
    });

    const section = rowById(sheet.rows, "math:section");
    expect(
      formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR)
    ).toBe("09:00–10:10");
    expect(section.runtimeMismatch).toBe(true);
    expect(section.mismatchNote).toBe("Clock 70 min · plan 105 min");
    const module1 = rowById(sheet.rows, "math:module:m1");
    const module2 = rowById(sheet.rows, "math:module:m2-lower_branch");
    expect(module1.plannedEndAt).toBe(module2.plannedStartAt);
    expect(module2.plannedEndAt).toBe(section.plannedEndAt);
  });

  it("honours a stored projection later than the clock and ignores one that is earlier", () => {
    const window = (projectedEndAt: string) => {
      const sheet = buildSatRunSheet({
        plan: [mathPlan],
        runtime: runtime([
          runtimeSection("math", 0, {
            status: "live",
            actualStartAt: SCHEDULED_START,
            plannedDurationMinutes: 70,
            projectedEndAt,
          }),
        ]),
        scheduledStartAt: SCHEDULED_START,
        now: SCHEDULED_START,
      });
      const section = rowById(sheet.rows, "math:section");
      return formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR);
    };

    // 09:40 is before the candidates' remaining seconds run out: a stored
    // projection may never close a section early.
    expect(window("2026-09-20T02:40:00.000Z")).toBe("09:00–10:10");
    // Later is the session's own deadline, and outranks the arithmetic.
    expect(window("2026-09-20T03:30:00.000Z")).toBe("09:00–10:30");
  });

  it("uses the server's projected window for a section that has not started", () => {
    const sheet = buildSatRunSheet({
      plan: null,
      runtime: {
        sections: [
          runtimeSection("math", 0, {
            status: "locked",
            plannedDurationMinutes: 70,
            projectedStartAt: "2026-09-20T02:30:00.000Z",
            projectedEndAt: "2026-09-20T03:40:00.000Z",
          }),
        ],
        actualStartAt: null,
        status: "not_started",
        serverNow: SCHEDULED_START,
      },
      now: SCHEDULED_START,
    });

    const section = rowById(sheet.rows, "math:section");
    expect(sheet.anchor).toBe("none");
    expect(
      formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR)
    ).toBe("09:30–10:40");
  });

  it("never reports a break the room has not reached", () => {
    // A section can sit past its derived window (a stalled reconciler, a paused
    // clock) while the room is still inside it: the break stays ahead, and the
    // section's own window keeps telling the truth.
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "live",
          actualStartAt: SCHEDULED_START,
          plannedDurationMinutes: 96,
        }),
        runtimeSection("math", 1),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T04:00:00.000Z", // 11:00 ICT, past the derived break window
    });

    const section = rowById(sheet.rows, "reading-writing:section");
    expect(section.status).toBe("live");
    expect(
      formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR)
    ).toBe("09:00–10:36");
    const breakRow = rowById(sheet.rows, "reading-writing:break");
    expect(breakRow.status).toBe("upcoming");
    // …and the next section waits behind it, not on the clock of a phantom end.
    const math = rowById(sheet.rows, "math:section");
    expect(
      formatRunSheetWindow(math.plannedStartAt, math.plannedEndAt, ANCHOR)
    ).toBe("10:46–11:56");
  });

  it("ignores a start instant on a section that never started", () => {
    // Locked rows carry no actual start; a stray one must not drag the window
    // back to the runtime's beginning.
    const sheet = buildSatRunSheet({
      plan: [mathPlan],
      runtime: runtime([
        runtimeSection("math", 0, { status: "locked", actualStartAt: SCHEDULED_START }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: SCHEDULED_START,
    });

    const section = rowById(sheet.rows, "math:section");
    expect(section.status).toBe("upcoming");
    expect(section.actualStartAt).toBeNull();
    expect(
      formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR)
    ).toBe("09:00–10:10");
  });

  it("carries the module and break actual windows the runtime records", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "completed",
          actualStartAt: SCHEDULED_START,
          actualEndAt: "2026-09-20T03:04:00.000Z", // 10:04 ICT
        }),
        runtimeSection("math", 1, {
          status: "live",
          actualStartAt: "2026-09-20T03:14:00.000Z", // 10:14 ICT
        }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T03:20:00.000Z",
    });

    // Module 1 begins when its section begins: a real instant, shown.
    expect(rowById(sheet.rows, "reading-writing:module:m1").actualStartAt).toBe(
      SCHEDULED_START
    );
    // Module 2's own boundary is per-candidate and is not invented.
    expect(rowById(sheet.rows, "reading-writing:module:m2-lower_branch").actualStartAt).toBeNull();

    const breakRow = rowById(sheet.rows, "reading-writing:break");
    expect(breakRow.status).toBe("done");
    expect(formatRunSheetClock(breakRow.actualStartAt)).toBe("10:04");
    expect(formatRunSheetClock(breakRow.actualEndAt)).toBe("10:14");
  });
});

describe("module tiling invariants", () => {
  // The module rows must tile their section window no matter what the authored
  // plan lists against the clock the session actually runs on. The matrix below
  // sweeps every module shape the sheet can meet, clocks shorter/equal/longer
  // than the plan, pauses and extensions, the cohort at every position, and both
  // a started and a not-yet-started section. Every combination is checked
  // against the same invariants instead of one hand-picked case at a time.
  interface TileShape {
    name: string;
    sectionKey: string;
    authoredMinutes: number;
    modules: ExamPlanSection["modules"];
  }

  const shapes: TileShape[] = [
    {
      name: "adaptive base + both branches (equal)",
      sectionKey: "equal",
      authoredMinutes: 64,
      modules: readingWritingPlan.modules,
    },
    {
      name: "adaptive base + both branches (unequal)",
      sectionKey: "unequal",
      authoredMinutes: 70,
      modules: [
        { moduleKey: "m1", title: "Module 1", adaptiveRole: "base", durationMinutes: 35 },
        { moduleKey: "lo", title: "Module 2 — Lower", adaptiveRole: "lower_branch", durationMinutes: 32 },
        { moduleKey: "hi", title: "Module 2 — Higher", adaptiveRole: "higher_branch", durationMinutes: 35 },
      ],
    },
    {
      name: "adaptive base + one branch",
      sectionKey: "single-branch",
      authoredMinutes: 64,
      modules: [
        { moduleKey: "m1", title: "Module 1", adaptiveRole: "base", durationMinutes: 32 },
        { moduleKey: "lo", title: "Module 2 — Lower", adaptiveRole: "lower_branch", durationMinutes: 32 },
      ],
    },
    {
      name: "legacy sequential three",
      sectionKey: "legacy-three",
      authoredMinutes: 60,
      modules: [
        { moduleKey: "a", title: "Part A", adaptiveRole: "", durationMinutes: 20 },
        { moduleKey: "b", title: "Part B", adaptiveRole: "", durationMinutes: 20 },
        { moduleKey: "c", title: "Part C", adaptiveRole: "", durationMinutes: 20 },
      ],
    },
    {
      name: "single module",
      sectionKey: "single-module",
      authoredMinutes: 45,
      modules: [
        { moduleKey: "a", title: "Part A", adaptiveRole: "", durationMinutes: 45 },
      ],
    },
  ];

  const nowCases = [
    { label: "now before the run", now: "2026-09-20T01:00:00.000Z" },
    { label: "now at the start", now: SCHEDULED_START },
    { label: "now inside", now: "2026-09-20T02:20:00.000Z" },
    { label: "now long past", now: "2026-09-20T04:00:00.000Z" },
    { label: "no now at all", now: null },
  ];

  it("keeps every module window ordered, inside and boundary-aligned for every plan-vs-clock combination", () => {
    const violations: string[] = [];
    for (const shape of shapes) {
      const clocks = [
        0,
        1,
        shape.authoredMinutes - 20,
        shape.authoredMinutes - 5,
        shape.authoredMinutes,
        shape.authoredMinutes + 7,
        shape.authoredMinutes + 30,
      ].map((minutes) => Math.max(0, minutes));
      for (const clock of clocks) {
        for (const pauseSeconds of [0, 300]) {
          for (const extensionMinutes of [0, 5]) {
            for (const status of ["live", "locked"] as const) {
              for (const nowCase of nowCases) {
                const planSection: ExamPlanSection = {
                  sectionKey: shape.sectionKey,
                  label: shape.name,
                  order: 0,
                  durationMinutes: shape.authoredMinutes,
                  gapAfterMinutes: 0,
                  modules: shape.modules,
                };
                const sheet = buildSatRunSheet({
                  plan: [planSection],
                  runtime: runtime(
                    [
                      runtimeSection(shape.sectionKey, 0, {
                        status,
                        actualStartAt: status === "live" ? SCHEDULED_START : null,
                        plannedDurationMinutes: clock,
                        accumulatedPausedSeconds: pauseSeconds,
                        extensionMinutes,
                      }),
                    ],
                    { serverNow: null }
                  ),
                  scheduledStartAt: SCHEDULED_START,
                  now: nowCase.now,
                });
                const tag = `${shape.name} | clock=${clock}min pause=${pauseSeconds}s ext=${extensionMinutes}m status=${status} | ${nowCase.label}`;
                const section = sheet.rows.find(
                  (row) => row.id === `${shape.sectionKey}:section`
                );
                const modules = sheet.rows.filter((row) => row.kind === "module");
                if (!section || section.plannedStartAt === null || section.plannedEndAt === null) {
                  violations.push(`${tag}: section window missing`);
                  continue;
                }
                if (modules.length === 0) {
                  violations.push(`${tag}: no module rows`);
                  continue;
                }
                const sectionStart = Date.parse(section.plannedStartAt);
                const sectionEnd = Date.parse(section.plannedEndAt);
                modules.forEach((row, index) => {
                  if (row.plannedStartAt === null || row.plannedEndAt === null) {
                    violations.push(`${tag}: module ${index} has no window`);
                    return;
                  }
                  const start = Date.parse(row.plannedStartAt);
                  const end = Date.parse(row.plannedEndAt);
                  if (!(end >= start)) {
                    violations.push(
                      `${tag}: module ${index} ends before it starts (${row.plannedStartAt} → ${row.plannedEndAt})`
                    );
                  }
                  if (start < sectionStart) {
                    violations.push(
                      `${tag}: module ${index} starts before its section (${row.plannedStartAt} < ${section.plannedStartAt})`
                    );
                  }
                  if (end > sectionEnd) {
                    violations.push(
                      `${tag}: module ${index} ends after its section (${row.plannedEndAt} > ${section.plannedEndAt})`
                    );
                  }
                });

                const moduleGroups: SatRunSheetRow[][] = [];
                for (const row of modules) {
                  const previous = moduleGroups[moduleGroups.length - 1];
                  const isAlternative = row.label.startsWith("Module 2 · ");
                  if (
                    isAlternative &&
                    previous &&
                    previous[0]?.label.startsWith("Module 2 · ")
                  ) {
                    previous.push(row);
                  } else {
                    moduleGroups.push([row]);
                  }
                }

                moduleGroups.forEach((group, groupIndex) => {
                  const groupStartAt = group[0]?.plannedStartAt;
                  if (groupStartAt === null || groupStartAt === undefined) return;
                  const groupStart = Date.parse(groupStartAt);
                  const groupEnds = group
                    .map((row) => (row.plannedEndAt === null ? null : Date.parse(row.plannedEndAt)))
                    .filter((end): end is number => end !== null && Number.isFinite(end));
                  if (group.some((row) => row.plannedStartAt !== groupStartAt)) {
                    violations.push(`${tag}: alternative branches do not share a start`);
                  }
                  const previousGroup = moduleGroups[groupIndex - 1];
                  if (previousGroup) {
                    const previousEnd = Math.max(
                      ...previousGroup.map((row) => Date.parse(row.plannedEndAt!))
                    );
                    if (groupStart !== previousEnd) {
                      violations.push(
                        `${tag}: group ${groupIndex} starts at ${groupStartAt}, previous group ended at ${new Date(previousEnd).toISOString()}`
                      );
                    }
                  } else if (groupStart !== sectionStart) {
                    violations.push(
                      `${tag}: first module group starts at ${groupStartAt}, section at ${section.plannedStartAt}`
                    );
                  }
                  if (
                    groupIndex === moduleGroups.length - 1 &&
                    Math.max(...groupEnds) !== sectionEnd
                  ) {
                    violations.push(
                      `${tag}: last module group ends at ${new Date(Math.max(...groupEnds)).toISOString()}, section at ${section.plannedEndAt}`
                    );
                  }
                });
              }
            }
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("gives a single authored module exactly one row", () => {
    const sheet = buildSatRunSheet({
      plan: [
        {
          sectionKey: "single-module",
          label: "Single module",
          order: 0,
          durationMinutes: 45,
          gapAfterMinutes: 0,
          modules: [
            { moduleKey: "a", title: "Part A", adaptiveRole: "", durationMinutes: 45 },
          ],
        },
      ],
      runtime: runtime([
        runtimeSection("single-module", 0, {
          status: "live",
          actualStartAt: SCHEDULED_START,
          plannedDurationMinutes: 45,
        }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: SCHEDULED_START,
    });

    const modules = sheet.rows.filter((row) => row.kind === "module");
    expect(modules).toHaveLength(1);
    expect(
      formatRunSheetWindow(modules[0]!.plannedStartAt, modules[0]!.plannedEndAt, ANCHOR)
    ).toBe("09:00–09:45");
  });

  // The three shapes the audit's probe found broken, pinned explicitly.
  const lockedTwentyAgainstSixtyFour = () =>
    buildSatRunSheet({
      plan: [readingWritingPlan],
      runtime: runtime(
        [
          runtimeSection("reading-writing", 0, {
            status: "locked",
            plannedDurationMinutes: 20,
          }),
        ],
        { serverNow: null }
      ),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T01:00:00.000Z",
    });

  const legacyTenMinutes = (now: string | null) =>
    buildSatRunSheet({
      plan: [
        {
          sectionKey: "legacy",
          label: "Legacy sequential",
          order: 0,
          durationMinutes: 60,
          gapAfterMinutes: 0,
          modules: [
            { moduleKey: "a", title: "Part A", adaptiveRole: "", durationMinutes: 20 },
            { moduleKey: "b", title: "Part B", adaptiveRole: "", durationMinutes: 20 },
            { moduleKey: "c", title: "Part C", adaptiveRole: "", durationMinutes: 20 },
          ],
        },
      ],
      runtime: runtime(
        [
          runtimeSection("legacy", 0, {
            status: "live",
            actualStartAt: SCHEDULED_START,
            plannedDurationMinutes: 10,
          }),
        ],
        { serverNow: null }
      ),
      scheduledStartAt: SCHEDULED_START,
      now,
    });

  it("compresses a locked 20-minute clock against 32+32 instead of overrunning and inverting", () => {
    const sheet = lockedTwentyAgainstSixtyFour();
    const section = rowById(sheet.rows, "reading-writing:section");
    const module1 = rowById(sheet.rows, "reading-writing:module:m1");
    const module2 = rowById(sheet.rows, "reading-writing:module:m2-lower_branch");

    expect(
      formatRunSheetWindow(section.plannedStartAt, section.plannedEndAt, ANCHOR)
    ).toBe("09:00–09:20");
    expect(
      formatRunSheetWindow(module1.plannedStartAt, module1.plannedEndAt, ANCHOR)
    ).toBe("09:00–09:10");
    expect(
      formatRunSheetWindow(module2.plannedStartAt, module2.plannedEndAt, ANCHOR)
    ).toBe("09:10–09:20");
    // The audit's probe read Module 2 as "09:32" with no end here: the window
    // must end at the section end, after it starts.
    expect(module2.plannedEndAt).toBe(section.plannedEndAt);
    expect(module1.plannedEndAt).toBe(module2.plannedStartAt);
    // The section's 20-minute clock against its 64-minute plan is on the row…
    expect(section.mismatchNote).toBe("Clock 20 min · plan 64 min");
    // …and each scaled module says what it got against the plan's 32.
    expect(module1.mismatchNote).toBe("Plan 32 min · 10 min on the clock");
    expect(module2.mismatchNote).toBe("Plan 32 min · 10 min on the clock");
    expect(module1.runtimeMismatch).toBe(true);
    expect(module2.runtimeMismatch).toBe(true);
  });

  it("compresses a legacy three-module plan onto a 10-minute clock, with or without a now", () => {
    for (const now of [null, "2026-09-20T02:20:00.000Z"]) {
      const sheet = legacyTenMinutes(now);
      const windows = ["legacy:module:a", "legacy:module:b", "legacy:module:c"].map(
        (id) => {
          const row = rowById(sheet.rows, id);
          return formatRunSheetWindow(row.plannedStartAt, row.plannedEndAt, ANCHOR);
        }
      );
      // Each module gets a third of the clock; the tail lands exactly on the
      // section end instead of running past it (the probe's "09:40" with no end).
      expect(windows).toEqual(["09:00–09:03", "09:03–09:06", "09:06–09:10"]);
    }
  });
});

// The module clock was the missing fact: the sheet named every stage but only
// the section row ever counted anything down, so "which module is the room in,
// and how long does it have?" took arithmetic across three rows. Each live row
// now carries its own window's remainder.
describe("run sheet module clocks", () => {
  function liveReadingWriting(overrides: Partial<SectionRuntimeState> = {}) {
    return buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "live",
          actualStartAt: SCHEDULED_START,
          ...overrides,
        }),
        runtimeSection("math", 1),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T02:20:00.000Z", // 09:20 ICT, inside Module 1
    });
  }

  it("counts down the section and the module the room is inside", () => {
    const sheet = liveReadingWriting();
    // Section 09:00–10:04 → 44 minutes left; Module 1 09:00–09:32 → 12.
    expect(rowById(sheet.rows, "reading-writing:section").remainingSeconds).toBe(2_640);
    expect(rowById(sheet.rows, "reading-writing:module:m1").remainingSeconds).toBe(720);
    expect(formatRunSheetRemaining(720)).toBe("12:00");
  });

  it("reports no window for a row the room has not reached or has finished", () => {
    const sheet = liveReadingWriting();
    // Upcoming rows report nothing: their window and length are on the row, and
    // a clamped 0:00 would read as live.
    expect(rowById(sheet.rows, "reading-writing:module:m2-lower_branch").remainingSeconds).toBeNull();
    expect(rowById(sheet.rows, "reading-writing:break").remainingSeconds).toBeNull();
    expect(rowById(sheet.rows, "math:section").remainingSeconds).toBeNull();

    const finished = buildSatRunSheet({
      plan: [readingWritingPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "completed",
          actualStartAt: SCHEDULED_START,
          actualEndAt: "2026-09-20T03:04:00.000Z",
        }),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T03:20:00.000Z",
    });
    expect(rowById(finished.rows, "reading-writing:section").remainingSeconds).toBeNull();
    expect(rowById(finished.rows, "reading-writing:module:m1").remainingSeconds).toBeNull();
  });

  it("freezes the clock on the window a pause landed on", () => {
    const sheet = liveReadingWriting({
      status: "paused",
      pausedAt: "2026-09-20T02:20:00.000Z",
    });
    // The pause landed at 09:20: the section had 44 minutes, Module 1 had 12,
    // and neither is running. The candidates' own timers are frozen with it.
    expect(rowById(sheet.rows, "reading-writing:section").status).toBe("paused");
    expect(rowById(sheet.rows, "reading-writing:section").remainingSeconds).toBe(2_640);
    expect(rowById(sheet.rows, "reading-writing:module:m1").remainingSeconds).toBe(720);
  });

  it("reads each module clock off the extension-shifted window", () => {
    const sheet = liveReadingWriting({ extensionMinutes: 10 });
    // The extension stretches the section to 09:00–10:14 (54 minutes left at
    // 09:20) and its surplus lands on the module the cohort is inside, so
    // Module 1 runs 09:00–09:42 — 22 minutes left — and Module 2 still closes
    // the section at 10:14. Neither row may claim time the other already owns.
    expect(rowById(sheet.rows, "reading-writing:section").remainingSeconds).toBe(3_240);
    expect(rowById(sheet.rows, "reading-writing:module:m1").remainingSeconds).toBe(1_320);
    expect(rowById(sheet.rows, "reading-writing:module:m2-lower_branch").status).toBe("upcoming");
    // …and the two module rows still meet each other and the section end exactly.
    const module1 = rowById(sheet.rows, "reading-writing:module:m1");
    const module2 = rowById(sheet.rows, "reading-writing:module:m2-lower_branch");
    expect(module1.plannedEndAt).toBe(module2.plannedStartAt);
    expect(module2.plannedEndAt).toBe(rowById(sheet.rows, "reading-writing:section").plannedEndAt);
  });

  it("hands the header the rows it highlights", () => {
    const sheet = liveReadingWriting();
    const current = satRunSheetCurrentRows(sheet);
    expect(current.section?.id).toBe("reading-writing:section");
    expect(current.module?.id).toBe("reading-writing:module:m1");
    expect(current.module?.label).toBe("Module 1");
    expect(current.break).toBeNull();

    // On the break between sections the room's current rows say so: the break
    // is live, no module is.
    const onBreak = buildSatRunSheet({
      plan: [readingWritingPlan, mathPlan],
      runtime: runtime([
        runtimeSection("reading-writing", 0, {
          status: "completed",
          actualStartAt: SCHEDULED_START,
          actualEndAt: "2026-09-20T03:04:00.000Z",
        }),
        runtimeSection("math", 1),
      ]),
      scheduledStartAt: SCHEDULED_START,
      now: "2026-09-20T03:07:00.000Z", // 10:07 ICT, on the break
    });
    const breakRows = satRunSheetCurrentRows(onBreak);
    expect(breakRows.break?.id).toBe("reading-writing:break");
    expect(breakRows.module).toBeNull();
  });

  it("never names a module clock the room cannot read", () => {
    const sheet = buildSatRunSheet({
      plan: [readingWritingPlan],
      runtime: { sections: [], actualStartAt: null, status: "not_started", serverNow: SCHEDULED_START },
      scheduledStartAt: SCHEDULED_START,
      now: SCHEDULED_START,
    });
    const current = satRunSheetCurrentRows(sheet);
    expect(current.section).toBeNull();
    expect(current.module).toBeNull();
    expect(rowById(sheet.rows, "reading-writing:module:m1").remainingSeconds).toBeNull();
  });
});

// The staff room names a candidate's slot from the role the projection carries,
// not from an authored title: Module 1 is the base module and Module 2 is
// whichever branch routing picked.
describe("satModuleSlotLabel", () => {
  it("names the adaptive slot and nothing else", () => {
    expect(satModuleSlotLabel("base")).toBe("Module 1");
    expect(satModuleSlotLabel("lower_branch")).toBe("Module 2 · Lower");
    expect(satModuleSlotLabel("higher_branch")).toBe("Module 2 · Higher");
  });

  it("returns null when there is no adaptive module to name", () => {
    expect(satModuleSlotLabel("none")).toBeNull();
    expect(satModuleSlotLabel(null)).toBeNull();
    expect(satModuleSlotLabel(undefined)).toBeNull();
  });
});

// The run sheet must say which timing PLAN its rows describe. The same rows mean
// different things per plan: a personal-model session hands each candidate their
// own window (so a section row is this sheet's projection and no section clock
// cuts anybody off), while a cohort session is capped by the shared section
// clock. A proctor reading the table cannot infer that from the numbers.
describe("run sheet timing plan label", () => {
  it("describes the personal model as a per-candidate plan", () => {
    const plan = satRunSheetTimingPlan("sat_personal_v1");
    expect(plan).not.toBeNull();
    expect(plan?.model).toBe("sat_personal_v1");
    expect(plan?.perCandidate).toBe(true);
    expect(plan?.label).toMatch(/personal/i);
    expect(plan?.note).toMatch(/author(ed|ing)/i);
  });

  it("describes the cohort models as a shared-clock plan", () => {
    for (const model of ["cohort_section_v3", "cohort_stage_v2"]) {
      const plan = satRunSheetTimingPlan(model);
      expect(plan?.perCandidate).toBe(false);
      expect(plan?.label).toMatch(/cohort/i);
      expect(plan?.note).toMatch(/cap/i);
    }
  });

  it("carries the plan onto the sheet, and omits it when the runtime does not say", () => {
    const liveRuntime = runtime([
      runtimeSection("reading-writing", 0, { status: "live", actualStartAt: SCHEDULED_START }),
    ]);
    const withModel = buildSatRunSheet({
      plan: [readingWritingPlan],
      runtime: liveRuntime,
      scheduledStartAt: SCHEDULED_START,
      now: SCHEDULED_START,
      timingModel: "sat_personal_v1",
    });
    expect(withModel.timingPlan?.model).toBe("sat_personal_v1");

    // A read that does not carry the field (summary/pre-field rows) must leave
    // the line out rather than assume a cohort run.
    const withoutModel = buildSatRunSheet({
      plan: [readingWritingPlan],
      runtime: liveRuntime,
      scheduledStartAt: SCHEDULED_START,
      now: SCHEDULED_START,
    });
    expect(withoutModel.timingPlan).toBeNull();
  });

  it("labels a timing model this build does not describe instead of guessing", () => {
    const plan = satRunSheetTimingPlan("some_future_model_v9");
    expect(plan?.label).toContain("some_future_model_v9");
    expect(plan?.perCandidate).toBe(false);
  });
});

describe("run sheet Bangkok formatting", () => {
  it("pins the display zone regardless of the runtime's local timezone", () => {
    expect(SAT_RUN_SHEET_TIME_ZONE).toBe("Asia/Bangkok");
    expect(formatRunSheetClock("2026-09-20T02:00:00.000Z")).toBe("09:00");
    // 18:30Z is already the next day in Bangkok.
    expect(formatRunSheetClock("2026-09-20T18:30:00.000Z")).toBe("01:30");
    expect(formatRunSheetClock(null)).toBe("—");
    expect(formatRunSheetClock("not-a-date")).toBe("—");
  });

  it("formats a remaining window the way staff read it", () => {
    expect(formatRunSheetRemaining(720)).toBe("12:00");
    expect(formatRunSheetRemaining(9)).toBe("0:09");
    expect(formatRunSheetRemaining(3_900)).toBe("1:05:00");
    // No running window, and a clock that somehow reads backwards, both round
    // to the sheet's "nothing to show" / "over" marks rather than inventing one.
    expect(formatRunSheetRemaining(null)).toBe("—");
    expect(formatRunSheetRemaining(undefined)).toBe("—");
    expect(formatRunSheetRemaining(-30)).toBe("0:00");
  });

  it("dates a window that leaves the reference day", () => {
    expect(formatRunSheetWindow("2026-09-20T02:00:00.000Z", "2026-09-20T03:04:00.000Z", ANCHOR)).toBe("09:00–10:04");
    // 17:00Z = 00:00 on 21 Sep in Bangkok, while the reference instant is 20 Sep.
    expect(
      formatRunSheetWindow("2026-09-20T17:00:00.000Z", "2026-09-20T18:00:00.000Z", "2026-09-20T16:00:00.000Z")
    ).toMatch(/^[A-Za-z]{3} \d{1,2} [A-Za-z]+ 00:00–01:00$/);
    expect(formatRunSheetWindow(null, null, ANCHOR)).toBe("—");
  });
});

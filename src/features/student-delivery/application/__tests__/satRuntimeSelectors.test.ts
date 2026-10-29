import { describe, expect, it } from "vitest";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentPersonalBreakSnapshot,
} from "../../contracts/assessmentDelivery";
import {
  moduleStartsNewSection,
  previousModuleInExamOrder,
  satPendingAuthoredBreak,
  satPendingAuthoredBreakSeconds,
} from "../satRuntimeSelectors";

/**
 * Exam order, not any single display-order number, decides a section boundary.
 *
 * This is the fact the student surfaces read: section orders and module orders
 * number independently, so `section.displayOrder > 0` says nothing about whether
 * a module begins a new section — the mistake that made Math Module 1 → Module 2
 * render the scheduled-break screen in the middle of the Math section.
 */

function para(text: string) {
  return { version: 1 as const, nodes: [{ type: "paragraph" as const, id: `p-${text}`, text }] };
}

function moduleShape(id: string, displayOrder: number, sectionKey: "reading-writing" | "math") {
  return {
    id,
    moduleKey: id,
    title: id,
    displayOrder,
    durationSeconds: 1800,
    targetQuestionCount: 1,
    adaptiveRole: displayOrder === 0 ? "base" : "higher_branch",
    instructions: para(id),
    toolPolicy: { calculator: sectionKey === "math", reference_sheet: sectionKey === "math" },
    questions: [],
  };
}

function examData(
  sections: Array<{
    id: string;
    sectionKey: "reading-writing" | "math";
    displayOrder: number;
    modules: Array<{ id: string; displayOrder: number }>;
  }>,
): AssessmentDeliveryBootstrap {
  const now = new Date("2026-09-23T09:00:00.000Z").toISOString();
  return {
    scheduleId: "schedule-1",
    examId: "exam-1",
    providerKey: "sat",
    versionId: "v1",
    serverNow: now,
    candidateName: "Ada Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "cohort_runtime",
      timingModel: "cohort_section_v3",
      stageKey: "reading-writing",
      stageStatus: "live",
      serverNow: now,
      deadlineAt: null,
      remainingSeconds: 1800,
      runtimeRevision: 4,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: sections.map((section) => ({
      ...section,
      title: section.id,
      durationSeconds: 3600,
      breakAfterSeconds: 0,
      instructions: para(section.id),
      modules: section.modules.map((module) =>
        moduleShape(module.id, module.displayOrder, section.sectionKey),
      ),
    })) as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "attempt-1",
      moduleAttempts: [],
      responses: [],
    } as unknown as AssessmentDeliveryBootstrap["attempt"],
    result: null,
  };
}

const TWO_SECTIONS = examData([
  {
    id: "sec-rw",
    sectionKey: "reading-writing",
    displayOrder: 0,
    modules: [
      { id: "rw-m1", displayOrder: 0 },
      { id: "rw-m2", displayOrder: 1 },
    ],
  },
  {
    id: "sec-math",
    sectionKey: "math",
    displayOrder: 1,
    modules: [
      { id: "math-m1", displayOrder: 0 },
      { id: "math-m2", displayOrder: 1 },
    ],
  },
]);

describe("moduleStartsNewSection", () => {
  it("is false for Module 1 → Module 2 inside one section", () => {
    expect(moduleStartsNewSection(TWO_SECTIONS, "rw-m2")).toBe(false);
    expect(moduleStartsNewSection(TWO_SECTIONS, "math-m2")).toBe(false);
  });

  it("is true for the first module of a later section", () => {
    expect(moduleStartsNewSection(TWO_SECTIONS, "math-m1")).toBe(true);
  });

  it("is false for the exam's own first module and for an unknown one", () => {
    expect(moduleStartsNewSection(TWO_SECTIONS, "rw-m1")).toBe(false);
    expect(moduleStartsNewSection(TWO_SECTIONS, "not-in-payload")).toBe(false);
  });

  it("does not mistake a later section's Module 2 for a boundary on its own", () => {
    // The regression shape: one section (Math) whose display order is 1, so the
    // OLD rule (`pendingSection.displayOrder > 0`) read both of its modules as a
    // section crossing. Exam order knows better: Math Module 1 has no
    // predecessor at all, and Math Module 2 follows Math Module 1.
    const mathOnly = examData([
      {
        id: "sec-math",
        sectionKey: "math",
        displayOrder: 1,
        modules: [
          { id: "math-m1", displayOrder: 0 },
          { id: "math-m2", displayOrder: 1 },
        ],
      },
    ]);
    expect(moduleStartsNewSection(mathOnly, "math-m2")).toBe(false);
    expect(moduleStartsNewSection(mathOnly, "math-m1")).toBe(false);
  });

  it("reads exam order even when the payload lists sections and modules out of order", () => {
    const shuffled = examData([
      {
        id: "sec-math",
        sectionKey: "math",
        displayOrder: 1,
        modules: [{ id: "math-m2", displayOrder: 1 }, { id: "math-m1", displayOrder: 0 }],
      },
      {
        id: "sec-rw",
        sectionKey: "reading-writing",
        displayOrder: 0,
        modules: [{ id: "rw-m2", displayOrder: 1 }, { id: "rw-m1", displayOrder: 0 }],
      },
    ]);
    expect(previousModuleInExamOrder(shuffled, "math-m1")?.id).toBe("rw-m2");
    expect(previousModuleInExamOrder(shuffled, "math-m2")?.id).toBe("math-m1");
    expect(previousModuleInExamOrder(shuffled, "rw-m1")).toBeNull();
    expect(moduleStartsNewSection(shuffled, "math-m1")).toBe(true);
    expect(moduleStartsNewSection(shuffled, "math-m2")).toBe(false);
  });
});

function breakRow(
  afterSectionId: string,
  state: AssessmentPersonalBreakSnapshot["state"],
): AssessmentPersonalBreakSnapshot {
  return {
    id: `break-${afterSectionId}`,
    afterSectionId,
    durationSeconds: 600,
    state,
    startsAt: null,
    deadlineAt: null,
    enteredAt: null,
    pausedAt: null,
    accumulatedPausedSeconds: 0,
    entryGeneration: 0,
    entryStartsAt: null,
    entryConfirmedAt: null,
    entryEnteredAt: null,
    remainingSeconds: 0,
    revision: 0,
  };
}

function withAuthoredBreak(
  data: AssessmentDeliveryBootstrap,
  sectionId: string,
  seconds: number,
  breaks: AssessmentPersonalBreakSnapshot[] = [],
): AssessmentDeliveryBootstrap {
  return {
    ...data,
    sections: data.sections.map((section) =>
      section.id === sectionId ? { ...section, breakAfterSeconds: seconds } : section,
    ),
    attempt: { ...data.attempt, personalBreaks: breaks },
  } as AssessmentDeliveryBootstrap;
}

describe("satPendingAuthoredBreak", () => {
  it("reports the authored break of the section that precedes the pending module", () => {
    const data = withAuthoredBreak(TWO_SECTIONS, "sec-rw", 600);
    expect(satPendingAuthoredBreak(data, "math-m1")).toEqual({ sectionId: "sec-rw", seconds: 600 });
    expect(satPendingAuthoredBreakSeconds(data, "math-m1")).toBe(600);
  });

  it("is silent once any row exists for that boundary, whatever its state", () => {
    // A completed break must not re-enter `preparing` and block the next module.
    for (const state of ["pending", "armed", "active", "completed"] as const) {
      const data = withAuthoredBreak(TWO_SECTIONS, "sec-rw", 600, [breakRow("sec-rw", state)]);
      expect(satPendingAuthoredBreak(data, "math-m1")).toBeNull();
    }
  });

  it("ignores a row recorded for a different boundary", () => {
    const data = withAuthoredBreak(TWO_SECTIONS, "sec-rw", 600, [breakRow("sec-math", "pending")]);
    expect(satPendingAuthoredBreak(data, "math-m1")?.seconds).toBe(600);
  });

  it("is null inside a section, at the first module, and when nothing is authored", () => {
    expect(satPendingAuthoredBreak(withAuthoredBreak(TWO_SECTIONS, "sec-rw", 600), "rw-m2")).toBeNull();
    expect(satPendingAuthoredBreak(withAuthoredBreak(TWO_SECTIONS, "sec-rw", 600), "rw-m1")).toBeNull();
    expect(satPendingAuthoredBreak(TWO_SECTIONS, "math-m1")).toBeNull();
    expect(satPendingAuthoredBreakSeconds(TWO_SECTIONS, "math-m1")).toBe(0);
  });

  it("is null for an unknown module", () => {
    expect(satPendingAuthoredBreak(withAuthoredBreak(TWO_SECTIONS, "sec-rw", 600), "not-in-payload")).toBeNull();
  });
});

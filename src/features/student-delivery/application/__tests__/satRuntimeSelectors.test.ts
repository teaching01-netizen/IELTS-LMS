import { describe, expect, it } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { moduleStartsNewSection, previousModuleInExamOrder } from "../satRuntimeSelectors";

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

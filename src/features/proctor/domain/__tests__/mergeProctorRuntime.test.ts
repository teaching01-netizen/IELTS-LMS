import { describe, expect, it } from "vitest";
import type { ExamPlanSection, ExamSessionRuntime, ProctorPresence } from "../../../../types/domain";
import { mergeProctorRuntime } from "../mergeProctorRuntime";

const examPlan: ExamPlanSection[] = [
  {
    sectionKey: "reading-writing",
    label: "Reading & Writing",
    order: 0,
    durationMinutes: 64,
    gapAfterMinutes: 10,
    modules: [
      { moduleKey: "m1", title: "Module 1", adaptiveRole: "base", durationMinutes: 32 },
      { moduleKey: "m2-easy", title: "Module 2 Easy", adaptiveRole: "lower_branch", durationMinutes: 32 },
      { moduleKey: "m2-hard", title: "Module 2 Hard", adaptiveRole: "higher_branch", durationMinutes: 32 },
    ],
  },
];

const presence: ProctorPresence = {
  proctorId: "proctor-1",
  proctorName: "Proctor One",
  joinedAt: "2026-01-01T09:00:00.000Z",
  lastHeartbeat: "2026-01-01T09:01:00.000Z",
};

function runtime(overrides: Partial<ExamSessionRuntime> = {}): ExamSessionRuntime {
  return {
    id: "runtime-1",
    scheduleId: "schedule-1",
    examId: "exam-1",
    providerKey: "sat",
    examTitle: "SAT",
    cohortName: "Cohort A",
    deliveryMode: "proctor_start",
    status: "live",
    timingModel: "cohort_section_v3",
    actualStartAt: "2026-01-01T09:00:00.000Z",
    actualEndAt: null,
    activeSectionKey: "reading-writing",
    currentSectionKey: "reading-writing",
    currentSectionRemainingSeconds: 300,
    currentSectionDeadlineAt: "2026-01-01T09:05:00.000Z",
    nextSectionStartAt: null,
    serverNow: "2026-01-01T09:00:00.000Z",
    waitingForNextSection: false,
    isOverrun: false,
    totalPausedSeconds: 0,
    sections: [],
    examPlan: null,
    proctorPresence: [],
    revision: 1,
    createdAt: "2026-01-01T09:00:00.000Z",
    updatedAt: "2026-01-01T09:00:00.000Z",
    ...overrides,
  };
}

describe("mergeProctorRuntime", () => {
  it("preserves the detail-only exam plan when a newer summary omits it", () => {
    const detail = runtime({ examPlan, revision: 4 });
    const newerSummary = runtime({
      revision: 5,
      examPlan: null,
      currentSectionRemainingSeconds: 240,
      updatedAt: "2026-01-01T09:01:00.000Z",
    });

    const merged = mergeProctorRuntime(detail, newerSummary);

    expect(merged.examPlan).toEqual(examPlan);
    expect(merged.revision).toBe(5);
    expect(merged.currentSectionRemainingSeconds).toBe(240);
  });

  it("treats an empty summary plan as absent", () => {
    const detail = runtime({ examPlan, revision: 4 });
    const newerSummary = runtime({ revision: 5, examPlan: [] });

    expect(mergeProctorRuntime(detail, newerSummary).examPlan).toEqual(examPlan);
  });

  it("enriches a same-revision summary with the detail plan without regressing live fields", () => {
    const summary = runtime({ revision: 7, examPlan: null, currentSectionRemainingSeconds: 120 });
    const detail = runtime({
      revision: 7,
      examPlan,
      currentSectionRemainingSeconds: 600,
    });

    const merged = mergeProctorRuntime(summary, detail);

    expect(merged.examPlan).toEqual(examPlan);
    expect(merged.currentSectionRemainingSeconds).toBe(120);
  });

  it("keeps the newest runtime while retaining plan and presence from older reads", () => {
    const current = runtime({ examPlan, revision: 8, proctorPresence: [presence] });
    const incoming = runtime({
      revision: 6,
      examPlan: null,
      currentSectionRemainingSeconds: 1,
      proctorPresence: [],
    });

    const merged = mergeProctorRuntime(current, incoming, [
      { ...presence, lastHeartbeat: "2026-01-01T09:02:00.000Z" },
    ]);

    expect(merged.revision).toBe(8);
    expect(merged.currentSectionRemainingSeconds).toBe(300);
    expect(merged.examPlan).toEqual(examPlan);
    expect(merged.proctorPresence).toEqual([
      { ...presence, lastHeartbeat: "2026-01-01T09:02:00.000Z" },
    ]);
  });

  it("preserves an existing boundary when a newer partial update omits it", () => {
    const detail = runtime({
      revision: 4,
      waitingForNextSection: true,
      nextSectionStartAt: "2026-01-01T09:10:00.000Z",
    });
    const newerSummary = runtime({
      revision: 5,
      waitingForNextSection: true,
      nextSectionStartAt: undefined,
    });

    expect(mergeProctorRuntime(detail, newerSummary).nextSectionStartAt).toBe(
      "2026-01-01T09:10:00.000Z",
    );
  });

  it("clears an existing boundary only when a newer update explicitly sends null", () => {
    const detail = runtime({
      revision: 4,
      waitingForNextSection: true,
      nextSectionStartAt: "2026-01-01T09:10:00.000Z",
    });
    const newerRuntime = runtime({
      revision: 5,
      waitingForNextSection: false,
      nextSectionStartAt: null,
    });

    expect(mergeProctorRuntime(detail, newerRuntime).nextSectionStartAt).toBeNull();
  });
});

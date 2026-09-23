import { describe, expect, it } from "vitest";
import type { ExamPlanSection, ExamSessionRuntime, ProctorPresence } from "../../../../types/domain";
import { mergeProctorRuntime, runtimeProjectionSupersedes } from "../mergeProctorRuntime";

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

// The socket ingest path asks the same question before it accepts a frame, so
// the decision is asserted on its own as well as through the merge.
describe("runtimeProjectionSupersedes", () => {
  it("accepts a newer revision and rejects an older one", () => {
    expect(
      runtimeProjectionSupersedes(
        runtime({ revision: 4, serverNow: "2026-01-01T09:00:00.000Z" }),
        runtime({ revision: 5, serverNow: "2026-01-01T09:00:01.000Z" }),
      ),
    ).toBe(true);
    expect(
      runtimeProjectionSupersedes(
        runtime({ revision: 5, serverNow: "2026-01-01T09:00:00.000Z" }),
        runtime({ revision: 4, serverNow: "2026-01-01T09:00:09.000Z" }),
      ),
    ).toBe(false);
  });

  it("orders two reads of one revision by their own stamp", () => {
    expect(
      runtimeProjectionSupersedes(
        runtime({ revision: 7, serverNow: "2026-01-01T09:00:00.000Z" }),
        runtime({ revision: 7, serverNow: "2026-01-01T09:00:06.000Z" }),
      ),
    ).toBe(true);
    expect(
      runtimeProjectionSupersedes(
        runtime({ revision: 7, serverNow: "2026-01-01T09:00:06.000Z" }),
        runtime({ revision: 7, serverNow: "2026-01-01T09:00:00.000Z" }),
      ),
    ).toBe(false);
  });
});

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

  // A live section sits on one revision for as long as it runs, so "the revision
  // did not change" only means "another read of the same state" — the read's own
  // stamp decides which copy is fresh. Gating the whole object on a strictly
  // greater revision froze the room's clock (serverNow, deadline, sections) at
  // the first payload of the revision while the per-student rows kept advancing.
  it("accepts a newer read of the same revision, including its live clock", () => {
    const stale = runtime({
      revision: 7,
      examPlan: null,
      serverNow: "2026-01-01T09:00:00.000Z",
      currentSectionRemainingSeconds: 120,
      currentSectionDeadlineAt: "2026-01-01T09:02:00.000Z",
    });
    const fresherRead = runtime({
      revision: 7,
      examPlan,
      serverNow: "2026-01-01T09:00:06.000Z",
      currentSectionRemainingSeconds: 600,
      currentSectionDeadlineAt: "2026-01-01T09:10:00.000Z",
    });

    const merged = mergeProctorRuntime(stale, fresherRead);

    expect(merged.examPlan).toEqual(examPlan);
    expect(merged.serverNow).toBe("2026-01-01T09:00:06.000Z");
    expect(merged.currentSectionRemainingSeconds).toBe(600);
    expect(merged.currentSectionDeadlineAt).toBe("2026-01-01T09:10:00.000Z");
  });

  it("still refuses an older read of the same revision", () => {
    const fresh = runtime({
      revision: 7,
      examPlan,
      serverNow: "2026-01-01T09:00:06.000Z",
      currentSectionRemainingSeconds: 600,
    });
    const lateArrival = runtime({
      revision: 7,
      examPlan: null,
      serverNow: "2026-01-01T09:00:00.000Z",
      currentSectionRemainingSeconds: 120,
    });

    const merged = mergeProctorRuntime(fresh, lateArrival);

    expect(merged.currentSectionRemainingSeconds).toBe(600);
    expect(merged.serverNow).toBe("2026-01-01T09:00:06.000Z");
    expect(merged.examPlan).toEqual(examPlan);
  });

  it("falls back to updatedAt when a projection carries no serverNow", () => {
    const stale = runtime({
      revision: 7,
      updatedAt: "2026-01-01T09:00:00.000Z",
      serverNow: undefined,
      currentSectionRemainingSeconds: 120,
    });
    const fresherRead = runtime({
      revision: 7,
      updatedAt: "2026-01-01T09:00:06.000Z",
      serverNow: undefined,
      currentSectionRemainingSeconds: 600,
    });

    expect(mergeProctorRuntime(stale, fresherRead).currentSectionRemainingSeconds).toBe(600);
  });

  it("keeps what it holds when two reads of one revision are stamped alike", () => {
    const held = runtime({ revision: 7, examPlan, currentSectionRemainingSeconds: 120 });
    const incoming = runtime({ revision: 7, currentSectionRemainingSeconds: 600 });

    const merged = mergeProctorRuntime(held, incoming);

    expect(merged.currentSectionRemainingSeconds).toBe(120);
    expect(merged.examPlan).toEqual(examPlan);
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

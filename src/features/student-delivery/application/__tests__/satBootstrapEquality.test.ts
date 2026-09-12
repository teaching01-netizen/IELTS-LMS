import { describe, expect, it } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import {
  isEquivalentBootstrap,
  SERVER_NOW_SKIP_TOLERANCE_MS,
} from "../satBootstrapEquality";

function basePayload(): AssessmentDeliveryBootstrap {
  const now = new Date("2026-09-10T08:00:00.000Z").toISOString();
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "v1",
    serverNow: now,
    candidateName: "Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "legacy_attempt",
      timingModel: "legacy_section_v1",
      stageKey: null,
      stageStatus: null,
      serverNow: now,
      deadlineAt: null,
      remainingSeconds: 600,
      runtimeRevision: 3,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: "fp",
    sections: [],
    attempt: {
      id: "attempt-a",
      moduleAttempts: [
        {
          id: "ma-1",
          moduleId: "m-1",
          state: "active",
          allocatedSeconds: 600,
          availableAt: now,
          startedAt: now,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionSeconds: 0,
          deadlineAt: null,
          remainingSeconds: 590,
          completionReason: null,
          rawCorrect: null,
          operationalQuestionCount: null,
          toolState: {},
          revision: 2,
        },
      ],
      responses: [
        {
          id: "r-1",
          moduleAttemptId: "ma-1",
          examQuestionId: "q1",
          response: "A",
          markedForReview: false,
          eliminatedOptions: [],
          annotations: {},
          revision: 4,
        },
      ],
    },
    result: null,
  };
}

describe("isEquivalentBootstrap (Phase 04 poll-skip)", () => {
  it("treats a fresh clone with new refs as equivalent", () => {
    expect(isEquivalentBootstrap(basePayload(), structuredClone(basePayload()))).toBe(true);
  });

  it("returns false with no previous payload", () => {
    expect(isEquivalentBootstrap(null, basePayload())).toBe(false);
  });

  it("detects changed runtimeRevision / versionId / attempt id", () => {
    const prev = basePayload();
    const rev = structuredClone(prev);
    rev.timing.runtimeRevision += 1;
    expect(isEquivalentBootstrap(prev, rev)).toBe(false);
    const ver = structuredClone(prev);
    ver.versionId = "v2";
    expect(isEquivalentBootstrap(prev, ver)).toBe(false);
    const att = structuredClone(prev);
    att.attempt.id = "attempt-b";
    expect(isEquivalentBootstrap(prev, att)).toBe(false);
  });

  it("detects attempt-slice changes (state/revision/remaining/deadline/paused)", () => {
    const prev = basePayload();
    for (const mutate of [
      (p: AssessmentDeliveryBootstrap) => {
        p.attempt.moduleAttempts[0].state = "submitted";
      },
      (p: AssessmentDeliveryBootstrap) => {
        p.attempt.moduleAttempts[0].revision += 1;
      },
      (p: AssessmentDeliveryBootstrap) => {
        p.attempt.moduleAttempts[0].remainingSeconds = 100;
      },
      (p: AssessmentDeliveryBootstrap) => {
        p.attempt.moduleAttempts[0].deadlineAt = new Date("2026-09-10T09:00:00Z").toISOString();
      },
      (p: AssessmentDeliveryBootstrap) => {
        p.attempt.moduleAttempts[0].pausedAt = new Date().toISOString();
      },
    ]) {
      const next = structuredClone(prev);
      mutate(next);
      expect(isEquivalentBootstrap(prev, next)).toBe(false);
    }
  });

  it("detects response-revision changes and length changes", () => {
    const prev = basePayload();
    const rev = structuredClone(prev);
    rev.attempt.responses[0].revision += 1;
    expect(isEquivalentBootstrap(prev, rev)).toBe(false);
    const added = structuredClone(prev);
    added.attempt.responses.push(structuredClone(prev.attempt.responses[0]));
    expect(isEquivalentBootstrap(prev, added)).toBe(false);
  });

  it("detects proctor / schedule / device / result changes", () => {
    const prev = basePayload();
    const paused = structuredClone(prev);
    paused.proctorStatus = "paused";
    expect(isEquivalentBootstrap(prev, paused)).toBe(false);
    const note = structuredClone(prev);
    note.proctorNote = "hello";
    expect(isEquivalentBootstrap(prev, note)).toBe(false);
    const sched = structuredClone(prev);
    sched.scheduleRuntimeStatus = "paused";
    expect(isEquivalentBootstrap(prev, sched)).toBe(false);
    const withResult = structuredClone(prev);
    withResult.result = {
      id: "result-1",
      submissionId: "attempt-a",
      providerKey: "sat",
      totalScore: 800,
      scorePayload: {},
      scoreKind: "practice",
      sections: [],
    };
    expect(isEquivalentBootstrap(prev, withResult)).toBe(false);
  });

  it("ignores serverNow drift within tolerance, flags drift beyond it", () => {
    const prev = basePayload();
    const within = structuredClone(prev);
    within.serverNow = new Date(
      Date.parse(prev.serverNow) + SERVER_NOW_SKIP_TOLERANCE_MS - 1,
    ).toISOString();
    expect(isEquivalentBootstrap(prev, within)).toBe(true);
    const beyond = structuredClone(prev);
    beyond.serverNow = new Date(
      Date.parse(prev.serverNow) + SERVER_NOW_SKIP_TOLERANCE_MS + 1000,
    ).toISOString();
    expect(isEquivalentBootstrap(prev, beyond)).toBe(false);
  });

  it("treats reordered attempts/responses as changed (safe direction)", () => {
    const prev = basePayload();
    const doubled = structuredClone(prev);
    const secondAttempt = structuredClone(prev.attempt.moduleAttempts[0]);
    secondAttempt.id = "ma-2";
    secondAttempt.moduleId = "m-2";
    doubled.attempt.moduleAttempts.push(secondAttempt);
    const secondResponse = structuredClone(prev.attempt.responses[0]);
    secondResponse.id = "r-2";
    secondResponse.examQuestionId = "q2";
    doubled.attempt.responses.push(secondResponse);
    const reordered = structuredClone(doubled);
    reordered.attempt.moduleAttempts.reverse();
    reordered.attempt.responses.reverse();
    expect(isEquivalentBootstrap(doubled, reordered)).toBe(false);
  });

  it("ignores section content at equal versionId (sections excluded by design)", () => {
    const prev = basePayload();
    const next = structuredClone(prev);
    (next as unknown as { sections: unknown[] }).sections = [
      { id: "brand-new-section" },
    ];
    expect(isEquivalentBootstrap(prev, next)).toBe(true);
  });
});

import { describe, expect, it } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import {
  isEquivalentBootstrap,
  regressesAttemptState,
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

  it("detects a break-only advance at an unchanged runtime revision", () => {
    const prev = basePayload();
    prev.attempt.personalBreaks = [{
      id: "break-1",
      afterSectionId: "section-rw",
      durationSeconds: 600,
      state: "armed",
      startsAt: null,
      deadlineAt: null,
      enteredAt: null,
      pausedAt: null,
      accumulatedPausedSeconds: 0,
      entryGeneration: 1,
      entryStartsAt: prev.serverNow,
      entryConfirmedAt: null,
      entryEnteredAt: null,
      remainingSeconds: 600,
      revision: 1,
    }];
    const active = structuredClone(prev);
    active.attempt.personalBreaks![0].state = "active";
    active.attempt.personalBreaks![0].revision = 2;
    expect(isEquivalentBootstrap(prev, active)).toBe(false);
    expect(isEquivalentBootstrap(active, prev)).toBe(false);

    const added = structuredClone(prev);
    added.attempt.personalBreaks!.push({ ...prev.attempt.personalBreaks[0], id: "break-2" });
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

function m2Attempt(revision: number, state: string): AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"][number] {
  const base = structuredClone(basePayload().attempt.moduleAttempts[0]);
  return { ...base, id: "ma-2", moduleId: "m-2", startedAt: null, deadlineAt: null, state, revision };
}

/** Post-handoff shape: Module 1 locked, Module 2 open at `m2Revision`. */
function handedOff(m2Revision: number, m2State: string): AssessmentDeliveryBootstrap {
  const payload = basePayload();
  payload.attempt.moduleAttempts[0] = {
    ...payload.attempt.moduleAttempts[0],
    state: "locked",
    revision: 3,
    completionReason: "time_expired",
  };
  payload.attempt.moduleAttempts.push(m2Attempt(m2Revision, m2State));
  return payload;
}

describe("regressesAttemptState (attempt-scoped stale guard)", () => {
  it("accepts an identical payload", () => {
    const prev = basePayload();
    expect(regressesAttemptState(prev, structuredClone(prev))).toBe(false);
  });

  it("rejects a payload that drops a module attempt row", () => {
    const prev = handedOff(1, "not_started");
    const next = basePayload();
    next.attempt.moduleAttempts[0].revision = 3;
    expect(regressesAttemptState(prev, next)).toBe(true);
  });

  it("rejects an older per-row revision", () => {
    const prev = handedOff(2, "active");
    const next = handedOff(1, "not_started");
    expect(regressesAttemptState(prev, next)).toBe(true);
  });

  it("rejects a finalized module reverting to a working state", () => {
    const prev = handedOff(2, "active");
    const next = structuredClone(prev);
    next.attempt.moduleAttempts[0].state = "active";
    // Bumping the revision does not make the payload newer: a locked module
    // never reopens.
    next.attempt.moduleAttempts[0].revision = 9;
    expect(regressesAttemptState(prev, next)).toBe(true);
  });

  it("rejects a break revision regression", () => {
    const prev = basePayload();
    prev.attempt.personalBreaks = [
      {
        id: "break-1",
        afterSectionId: "section-rw",
        durationSeconds: 600,
        state: "active",
        startsAt: null,
        deadlineAt: null,
        enteredAt: null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        entryGeneration: 1,
        entryStartsAt: null,
        entryConfirmedAt: null,
        entryEnteredAt: null,
        remainingSeconds: 300,
        revision: 4,
      },
    ];
    const next = structuredClone(prev);
    next.attempt.personalBreaks![0].revision = 3;
    expect(regressesAttemptState(prev, next)).toBe(true);
    const dropped = structuredClone(prev);
    dropped.attempt.personalBreaks = [];
    expect(regressesAttemptState(prev, dropped)).toBe(true);
  });

  it("rejects a payload that loses a persisted result", () => {
    const prev = basePayload();
    prev.result = {
      id: "result-1",
      submissionId: "attempt-a",
      providerKey: "sat",
      totalScore: 800,
      scorePayload: {},
      scoreKind: "practice",
      sections: [],
    };
    const next = structuredClone(prev);
    next.result = null;
    expect(regressesAttemptState(prev, next)).toBe(true);
  });

  it("accepts a genuinely newer handoff", () => {
    const prev = basePayload();
    const next = handedOff(2, "active");
    expect(regressesAttemptState(prev, next)).toBe(false);
  });

  it("leaves the attempt-identity guard to its own check", () => {
    const prev = basePayload();
    const next = structuredClone(prev);
    next.attempt.id = "attempt-b";
    expect(regressesAttemptState(prev, next)).toBe(false);
  });

  // The personal-timing handoff keeps the SAME schedule-wide runtime revision
  // across all four snapshots (that is the defect this guard fixes), so only
  // per-row revisions can order them. Every arrival order must converge: Module
  // 1 can never reopen, and a closed Module 2 can never be replaced by an
  // earlier snapshot that still shows it open.
  it("converges on the newest state for every arrival order, closed module included", () => {
    const m1Active = basePayload();
    const m1Locked = handedOff(1, "not_started");
    const m2Entered = handedOff(2, "active");
    const m2Locked = handedOff(3, "locked");
    const snapshots = [m1Active, m1Locked, m2Entered, m2Locked];
    const permutations = [
      [0, 1, 2, 3],
      [0, 1, 3, 2],
      [0, 2, 1, 3],
      [0, 2, 3, 1],
      [0, 3, 1, 2],
      [0, 3, 2, 1],
      [1, 0, 2, 3],
      [1, 0, 3, 2],
      [1, 2, 0, 3],
      [1, 2, 3, 0],
      [1, 3, 0, 2],
      [1, 3, 2, 0],
      [2, 0, 1, 3],
      [2, 0, 3, 1],
      [2, 1, 0, 3],
      [2, 1, 3, 0],
      [2, 3, 0, 1],
      [2, 3, 1, 0],
      [3, 0, 1, 2],
      [3, 0, 2, 1],
      [3, 1, 0, 2],
      [3, 1, 2, 0],
      [3, 2, 0, 1],
      [3, 2, 1, 0],
    ];
    for (const order of permutations) {
      const label = order.join("");
      let accepted: AssessmentDeliveryBootstrap | null = null;
      for (const index of order) {
        const candidate = snapshots[index];
        if (accepted && regressesAttemptState(accepted, candidate)) continue;
        accepted = candidate;
      }
      expect(accepted).not.toBeNull();
      const module1 = accepted!.attempt.moduleAttempts.find((module) => module.id === "ma-1");
      const module2 = accepted!.attempt.moduleAttempts.find((module) => module.id === "ma-2");
      // Module 1 is closed in every post-handoff snapshot and never reopens.
      expect(`${label}:${module1?.state}`).toBe(`${label}:locked`);
      expect(["active", "locked"]).toContain(module2?.state);
      // Once the closed snapshot has been seen, an earlier "still open" one can
      // never win: that is the regression the guard exists to stop.
      if (order.includes(3)) {
        expect(`${label}:${module2?.state}`).toBe(`${label}:locked`);
      }
    }
  });
});

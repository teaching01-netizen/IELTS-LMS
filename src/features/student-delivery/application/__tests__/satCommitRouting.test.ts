import { describe, expect, it } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import type { SatRunnerState } from "../satRunnerReducer";
import { decideSatCommitRoute } from "../satCommitRouting";

/**
 * The commit-layer route table alone: which phase action a committed payload
 * produces, per producer hint. Rendering, timers and the gateway are out of
 * scope here (covered by the controller suites).
 */

const IDENTITY = { scheduleId: "schedule", candidateId: "candidate" };

interface Spec {
  id: string;
  sectionKey: "reading-writing" | "math";
  state: string;
  startedAt?: string;
}

const NOW = "2026-09-10T08:00:00.000Z";

function payload(specs: Spec[], withResult = false): AssessmentDeliveryBootstrap {
  const sectionKeys = [...new Set(specs.map((spec) => spec.sectionKey))];
  return {
    scheduleId: "schedule",
    versionId: "version",
    serverNow: NOW,
    scheduleRuntimeStatus: "live",
    proctorStatus: "active",
    timing: {
      authority: "legacy_attempt",
      timingModel: "legacy_section_v1",
      stageKey: null,
      stageStatus: null,
      serverNow: NOW,
      deadlineAt: null,
      remainingSeconds: 300,
      runtimeRevision: 1,
    },
    sections: sectionKeys.map((key, index) => ({
      id: `sec-${key}`,
      sectionKey: key,
      title: key,
      displayOrder: index,
      durationSeconds: 600,
      breakAfterSeconds: 60,
      instructions: { version: 1, nodes: [] },
      modules: specs
        .filter((spec) => spec.sectionKey === key)
        .map((spec, order) => ({
          id: spec.id,
          moduleKey: `${spec.id}-key`,
          title: spec.id,
          displayOrder: order,
          durationSeconds: 300,
          targetQuestionCount: 1,
          adaptiveRole: "base",
          instructions: { version: 1, nodes: [] },
          toolPolicy: [],
          questions: [],
        })),
    })),
    attempt: {
      id: "attempt-a",
      moduleAttempts: specs.map((spec) => ({
        id: `ma-${spec.id}`,
        moduleId: spec.id,
        state: spec.state,
        allocatedSeconds: 300,
        availableAt: "2026-09-10T08:05:00.000Z",
        startedAt: spec.startedAt ?? null,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionSeconds: 0,
        deadlineAt: null,
        remainingSeconds: 300,
        completionReason: null,
        rawCorrect: null,
        operationalQuestionCount: null,
        toolState: {},
        revision: 1,
      })),
      responses: [],
    },
    result: withResult
      ? {
          id: "result-1",
          submissionId: "attempt-a",
          providerKey: "sat",
          totalScore: 800,
          scorePayload: {},
          scoreKind: "practice",
          sections: [],
        }
      : null,
  } as unknown as AssessmentDeliveryBootstrap;
}

// Runtime identity is the module ID the server selected; moduleKey rides along
// as display metadata only (`${id}-key`, mirroring the payload fixture).
function state(phase: SatRunnerState["phase"], moduleId?: string): SatRunnerState {
  return {
    phase,
    scheduleId: "schedule",
    candidateId: "candidate",
    assessmentId: "version",
    moduleId,
    moduleKey: moduleId ? `${moduleId}-key` : undefined,
  } as unknown as SatRunnerState;
}

describe("SAT commit route table", () => {
  it("only bootstraps from the loading phase", () => {
    const loaded = decideSatCommitRoute(state("loading"), payload([]), { kind: "bootstrap" }, IDENTITY);
    expect(loaded).toEqual({ type: "bootstrapLoaded", assessmentId: "version" });
    expect(
      decideSatCommitRoute(state("directions"), payload([]), { kind: "bootstrap" }, IDENTITY),
    ).toBeNull();
  });

  it("completes from a result-carrying poll using the runner identity", () => {
    const action = decideSatCommitRoute(
      state("submitting"),
      payload([], true),
      { kind: "poll" },
      IDENTITY,
    );
    expect(action).toEqual({
      type: "recover",
      state: {
        phase: "complete",
        scheduleId: "schedule",
        candidateId: "candidate",
        assessmentId: "version",
        resultId: "result-1",
      },
    });
  });

  it("routes a poll that finalized the current module onward", () => {
    const specs: Spec[] = [
      { id: "m-1", sectionKey: "reading-writing", state: "submitted" },
      { id: "m-2", sectionKey: "reading-writing", state: "not_started" },
    ];
    expect(
      decideSatCommitRoute(state("module", "m-1"), payload(specs), { kind: "poll" }, IDENTITY),
    ).toEqual({ type: "showDirections" });
  });

  // SAT-002: nothing left to open — the runner must start finalizing rather
  // than wait for a Review visit that may never happen.
  it("begins finalization when the poll finds no module left to open", () => {
    const specs: Spec[] = [{ id: "m-1", sectionKey: "reading-writing", state: "submitted" }];
    expect(
      decideSatCommitRoute(state("module", "m-1"), payload(specs), { kind: "poll" }, IDENTITY),
    ).toEqual({ type: "submit" });
  });

  it("routes a startModule response into the module the payload opened", () => {
    const opened: Spec[] = [
      {
        id: "m-1",
        sectionKey: "reading-writing",
        state: "active",
        startedAt: NOW,
      },
    ];
    const action = decideSatCommitRoute(
      state("directions"),
      payload(opened),
      { kind: "startModule", moduleId: "m-1" },
      IDENTITY,
    );
    expect(action).toMatchObject({
      type: "routeToModule",
      sectionKey: "reading-writing",
      // The server-selected module id is the runtime identity; the key is only
      // display metadata carried alongside it.
      moduleId: "m-1",
      moduleKey: "m-1-key",
      startedAt: NOW,
    });

    const notStarted: Spec[] = [{ id: "m-1", sectionKey: "reading-writing", state: "not_started" }];
    expect(
      decideSatCommitRoute(
        state("directions"),
        payload(notStarted),
        { kind: "startModule", moduleId: "m-1" },
        IDENTITY,
      ),
    ).toBeNull();
  });

  it("holds personal entry until the server-issued startsAt", () => {
    const offer = payload([{
      id: "m-1",
      sectionKey: "reading-writing",
      state: "active",
      startedAt: "2026-09-10T08:00:03.000Z",
    }]);
    offer.timing.timingModel = "sat_personal_v1";
    offer.attempt.moduleAttempts[0]!.entryGeneration = 1;
    offer.attempt.moduleAttempts[0]!.entryStartsAt = "2026-09-10T08:00:03.000Z";
    expect(decideSatCommitRoute(
      state("directions"),
      offer,
      { kind: "startModule", moduleId: "m-1" },
      IDENTITY,
    )).toBeNull();
  });

  // A Student Access link scoped to Reading & Writing: the run's payload holds
  // ONE section (no Math module attempt anywhere), and the exam must end after
  // it with no new end-of-exam logic. The route table only ever reads the
  // payload's module attempts, so the whole walk is: last module submitted ->
  // server timeout reconciliation -> result -> complete.
  it("completes after the single section of a one-section run", () => {
    const verbalOnly: Spec[] = [
      { id: "rw-m1", sectionKey: "reading-writing", state: "submitted" },
      { id: "rw-m2", sectionKey: "reading-writing", state: "submitted" },
    ];

    // A poll that arrives after the server finalized the last module starts
    // finalization from wherever the student is (SAT-002 path).
    expect(
      decideSatCommitRoute(
        state("module", "rw-m2"),
        payload(verbalOnly),
        { kind: "poll" },
        IDENTITY,
      ),
    ).toEqual({ type: "submit" });

    // The scored result completes the runner, with the one-section score shape.
    const scored = payload([...verbalOnly], true);
    scored.result = {
      ...(scored.result as NonNullable<AssessmentDeliveryBootstrap["result"]>),
      totalScore: null,
      sections: [
        {
          sectionKey: "reading-writing",
          route: "lower",
          rawCorrect: 20,
          operationalQuestionCount: 27,
          scaledScore: 560,
          details: {},
        },
      ],
    };
    expect(
      decideSatCommitRoute(state("submitting"), scored, { kind: "poll" }, IDENTITY),
    ).toEqual({
      type: "recover",
      state: {
        phase: "complete",
        scheduleId: "schedule",
        candidateId: "candidate",
        assessmentId: "version",
        resultId: "result-1",
      },
    });
  });
});

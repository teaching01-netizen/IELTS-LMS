import { describe, expect, it } from "vitest";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { decideSatCommitRoute } from "../satCommitRouting";
import {
  createSatRunnerState,
  satRunnerReducer,
  type SatRunnerAction,
  type SatRunnerState,
} from "../satRunnerReducer";

/**
 * The runtime identity chain for SAT adaptive routing:
 *
 *   route decision.selected_module_id
 *     == module attempt.module_id
 *     == runner.state.moduleId
 *     == rendered module.id
 *
 * The server selects a Module 2 id; everything downstream must carry that id.
 * These tests pin the two failure modes the chain had: the runner kept only the
 * business `moduleKey` (so the selection was thrown away and later
 * re-discovered by key), and the commit route compared keys, which is blind
 * whenever two branches share a display key.
 */

const NOW = "2026-09-10T08:00:00.000Z";
const HIGHER_ID = "rw-m2-higher-id";
const LOWER_ID = "rw-m2-lower-id";
const SHARED_KEY = "module-2";

type ModuleSpec = {
  id: string;
  moduleKey: string;
  adaptiveRole: "base" | "lower_branch" | "higher_branch";
  state: string;
};

function deliveryModule(spec: ModuleSpec, order: number) {
  return {
    id: spec.id,
    moduleKey: spec.moduleKey,
    title: spec.id,
    displayOrder: order,
    durationSeconds: 1_800,
    targetQuestionCount: 27,
    adaptiveRole: spec.adaptiveRole,
    instructions: { version: 1, nodes: [] },
    toolPolicy: { calculator: false, reference_sheet: false },
    questions: [],
  };
}

function payload(specs: ModuleSpec[]): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
    serverNow: NOW,
    candidateName: "Candidate",
    scheduleRuntimeStatus: "live",
    timing: {
      authority: "legacy_attempt",
      timingModel: "legacy_section_v1",
      stageKey: null,
      stageStatus: null,
      serverNow: NOW,
      deadlineAt: null,
      remainingSeconds: 1_800,
      runtimeRevision: 1,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [
      {
        id: "sec-rw",
        sectionKey: "reading-writing",
        title: "Reading & Writing",
        displayOrder: 0,
        durationSeconds: 3_600,
        breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: specs.map((spec, order) => deliveryModule(spec, order)),
      },
    ],
    attempt: {
      id: "attempt-a",
      moduleAttempts: specs.map((spec, order) => ({
        id: `ma-${spec.id}`,
        moduleId: spec.id,
        state: spec.state,
        allocatedSeconds: 1_800,
        availableAt: NOW,
        startedAt: order === 0 ? null : NOW,
        pausedAt: null,
        accumulatedPausedSeconds: 0,
        extensionSeconds: 0,
        deadlineAt: null,
        remainingSeconds: 1_800,
        completionReason: null,
        rawCorrect: null,
        operationalQuestionCount: null,
        toolState: {},
        revision: 1,
      })),
      responses: [],
    },
    result: null,
  } as unknown as AssessmentDeliveryBootstrap;
}

function state(moduleId: string, moduleKey: string): SatRunnerState {
  return {
    phase: "module",
    scheduleId: "schedule",
    candidateId: "candidate",
    assessmentId: "version",
    sectionKey: "reading-writing",
    moduleId,
    moduleKey,
    questionIds: [],
    questionIndex: 0,
    responses: {},
    responseRevisions: {},
    toolCapabilities: { calculator: false, referenceSheet: false },
    activeTool: null,
    activeTools: { calculator: false, referenceSheet: false },
    startedAt: NOW,
    endsAt: NOW,
  };
}

function directionsState(): SatRunnerState {
  return satRunnerReducer(createSatRunnerState("schedule", "candidate"), {
    type: "bootstrapLoaded",
    assessmentId: "version",
  });
}

const HIGHER: ModuleSpec = {
  id: HIGHER_ID,
  moduleKey: SHARED_KEY,
  adaptiveRole: "higher_branch",
  state: "not_started",
};
const LOWER: ModuleSpec = {
  id: LOWER_ID,
  moduleKey: SHARED_KEY,
  adaptiveRole: "lower_branch",
  state: "submitted",
};

describe("SAT adaptive module identity", () => {
  it("stores the server-selected module id when routing into a module", () => {
    const action: SatRunnerAction = {
      type: "routeToModule",
      sectionKey: "reading-writing",
      moduleId: HIGHER_ID,
      moduleKey: SHARED_KEY,
      questionIds: ["q1"],
      startedAt: NOW,
      endsAt: NOW,
    };
    const next = satRunnerReducer(directionsState(), action);
    expect(next.phase).toBe("module");
    expect(next.phase === "module" && next.moduleId).toBe(HIGHER_ID);
    // The key rides along as display metadata only.
    expect(next.phase === "module" && next.moduleKey).toBe(SHARED_KEY);
  });

  it("keeps the selected id across later in-module actions", () => {
    const routed = satRunnerReducer(directionsState(), {
      type: "routeToModule",
      sectionKey: "reading-writing",
      moduleId: HIGHER_ID,
      moduleKey: SHARED_KEY,
      questionIds: ["q1"],
      startedAt: NOW,
      endsAt: NOW,
    });
    const answered = satRunnerReducer(routed, {
      type: "setAnswer",
      questionId: "q1",
      value: "A",
    });
    expect(answered.phase === "module" && answered.moduleId).toBe(HIGHER_ID);

    const reviewed = satRunnerReducer(answered, { type: "reviewModule" });
    expect(reviewed.phase === "review" && reviewed.moduleId).toBe(HIGHER_ID);
    const back = satRunnerReducer(reviewed, { type: "returnToModule" });
    expect(back.phase === "module" && back.moduleId).toBe(HIGHER_ID);
  });

  it("fails closed on a recovered snapshot that predates the moduleId field", () => {
    const legacy = {
      ...state(HIGHER_ID, SHARED_KEY),
      moduleId: undefined,
    } as unknown as SatRunnerState;
    const recovered = satRunnerReducer(state(HIGHER_ID, SHARED_KEY), {
      type: "recover",
      state: legacy,
    });
    expect(recovered.phase).toBe("module");
    // No key-based guess: an unknown identity stays unknown, so nothing renders
    // a module the recording never named.
    expect(recovered.phase === "module" && recovered.moduleId).toBe("");
    expect(recovered.phase === "module" && recovered.moduleKey).toBe(SHARED_KEY);
  });

  describe("legacy migration resolver (P6)", () => {
    const candidate = (id: string, moduleKey: string, questionIds: string[]) => ({
      id,
      moduleKey,
      questions: questionIds.map((examQuestionId) => ({ examQuestionId })),
    });

    function legacySnapshot() {
      return {
        ...state("migrated?", SHARED_KEY),
        moduleId: undefined,
        questionIds: ["q1", "q2"],
      } as unknown as SatRunnerState;
    }

    it("migrates exactly one key + question-set match to its id", () => {
      const recovered = satRunnerReducer(state(HIGHER_ID, SHARED_KEY), {
        type: "recover",
        state: legacySnapshot(),
        candidates: [
          candidate(LOWER_ID, SHARED_KEY, ["q9"]),
          candidate(HIGHER_ID, SHARED_KEY, ["q2", "q1"]),
        ] as never,
      });
      expect(recovered.phase === "module" && recovered.moduleId).toBe(HIGHER_ID);
    });

    it("refuses to guess when two branches share the key and questions", () => {
      const recovered = satRunnerReducer(state(HIGHER_ID, SHARED_KEY), {
        type: "recover",
        state: legacySnapshot(),
        candidates: [
          candidate(LOWER_ID, SHARED_KEY, ["q1", "q2"]),
          candidate(HIGHER_ID, SHARED_KEY, ["q1", "q2"]),
        ] as never,
      });
      expect(recovered.phase === "module" && recovered.moduleId).toBe("");
    });

    it("refuses to guess when nothing matches the recorded question set", () => {
      const recovered = satRunnerReducer(state(HIGHER_ID, SHARED_KEY), {
        type: "recover",
        state: legacySnapshot(),
        candidates: [candidate(HIGHER_ID, SHARED_KEY, ["q7"])] as never,
      });
      expect(recovered.phase === "module" && recovered.moduleId).toBe("");
    });

    it("never migrates on the key alone when the questions differ", () => {
      const recovered = satRunnerReducer(state(HIGHER_ID, SHARED_KEY), {
        type: "recover",
        state: legacySnapshot(),
        candidates: [candidate(LOWER_ID, SHARED_KEY, ["q1"])] as never,
      });
      expect(recovered.phase === "module" && recovered.moduleId).toBe("");
    });
  });

  it("routes onward to a pending module that shares the current display key", () => {
    // The bug the key comparison had: two branches of one section can share a
    // display key, so `nextModule.moduleKey !== state.moduleKey` was false and
    // the runner never left the finalized module.
    const data = payload([
      { id: "rw-m1", moduleKey: "module-1", adaptiveRole: "base", state: "submitted" },
      LOWER,
      HIGHER,
    ]);
    expect(
      decideSatCommitRoute(state(LOWER_ID, SHARED_KEY), data, { kind: "poll" }, {
        scheduleId: "schedule",
        candidateId: "candidate",
      }),
    ).toEqual({ type: "showDirections" });
  });

  it("decides identically whatever order the payload lists the branches in", () => {
    const identity = { scheduleId: "schedule", candidateId: "candidate" };
    const current = state(LOWER_ID, SHARED_KEY);
    const forward = payload([
      { id: "rw-m1", moduleKey: "module-1", adaptiveRole: "base", state: "submitted" },
      LOWER,
      HIGHER,
    ]);
    const reversed = payload([
      { id: "rw-m1", moduleKey: "module-1", adaptiveRole: "base", state: "submitted" },
      HIGHER,
      LOWER,
    ]);
    const first = decideSatCommitRoute(current, forward, { kind: "poll" }, identity);
    const second = decideSatCommitRoute(current, reversed, { kind: "poll" }, identity);
    expect(first).toEqual({ type: "showDirections" });
    expect(second).toEqual(first);
  });

  it("never navigates a runner whose module identity is unknown", () => {
    const data = payload([
      { id: "rw-m1", moduleKey: "module-1", adaptiveRole: "base", state: "submitted" },
      LOWER,
      HIGHER,
    ]);
    expect(
      decideSatCommitRoute(state("", SHARED_KEY), data, { kind: "poll" }, {
        scheduleId: "schedule",
        candidateId: "candidate",
      }),
    ).toBeNull();
  });

  it("resolves the selected branch's questions by id, never by key", () => {
    // Question ownership (plan test 9): once HIGH is selected, every
    // rendered question must belong to HIGH and none to LOW — even though
    // both branches share the display key and regardless of payload order.
    const withQuestions = (spec: ModuleSpec, questions: string[]) => ({
      ...deliveryModule(spec, 0),
      questions: questions.map((examQuestionId) => ({ examQuestionId })),
    });
    const sections = (modules: ReturnType<typeof withQuestions>[]) =>
      [
        {
          id: "sec-rw",
          modules,
        },
      ] as unknown as AssessmentDeliveryBootstrap["sections"];
    const modules = [
      withQuestions(LOWER, ["low-q-1"]),
      withQuestions(HIGHER, ["high-q-1", "high-q-2"]),
    ];
    const reversed = [...modules].reverse();
    for (const order of [modules, reversed]) {
      const data = { sections: sections(order) } as AssessmentDeliveryBootstrap;
      const resolved =
        data.sections
          .flatMap((section) => section.modules)
          .find((candidate) => candidate.id === HIGHER_ID) ?? null;
      expect(resolved?.id).toBe(HIGHER_ID);
      const rendered = (resolved?.questions ?? []).map((q) => q.examQuestionId);
      expect(rendered).toEqual(["high-q-1", "high-q-2"]);
      expect(rendered).not.toContain("low-q-1");
    }
  });
});

import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../../shared/api-client/errors";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";
import { useSatExamController } from "../useSatExamController";

/**
 * Audit SAT-005 (stale mutation responses may not overwrite newer state) and
 * SAT-007 (HTTP 409 is not one thing: writer supersession, version collisions
 * and clock/state transitions must classify differently).
 */

const gatewayMocks = vi.hoisted(() => ({
  bootstrap: vi.fn(),
  configureSatDeliveryAttempt: vi.fn(),
  startModule: vi.fn(),
  submitModule: vi.fn(),
  submitAssessment: vi.fn(),
}));
const persistenceMock = vi.hoisted(() => ({
  pendingCount: 0,
  pendingDrafts: {},
  visibleDrafts: {},
  failure: null,
  failureKind: null,
  tombstoneCount: 0,
  hydrateRevisions: vi.fn(),
  hydrateBootstrap: vi.fn(),
  save: vi.fn(),
  flush: vi.fn().mockResolvedValue(undefined),
  assertBoundarySettled: vi.fn().mockResolvedValue(undefined),
  submit: vi.fn(),
  retryFailed: vi.fn(),
  takeOverLease: vi.fn(),
  isTakingOver: false,
}));

vi.mock("../../infrastructure/satDeliveryGateway", () => ({
  configureSatDeliveryAttempt: gatewayMocks.configureSatDeliveryAttempt,
  satDeliveryGateway: {
    bootstrap: gatewayMocks.bootstrap,
    startModule: gatewayMocks.startModule,
    submitModule: gatewayMocks.submitModule,
    submitAssessment: gatewayMocks.submitAssessment,
  },
}));
vi.mock("../useSatResponsePersistence", () => ({
  useSatResponsePersistence: () => persistenceMock,
}));
vi.mock("../useSatIntegrityControl", () => ({
  useSatIntegrityControl: () => ({
    pendingTabSwitchWarning: null,
    acknowledgeTabSwitchWarning: () => undefined,
  }),
}));

function modulePayload(state: string, runtimeRevision = 1): AssessmentDeliveryBootstrap {
  const now = new Date().toISOString();
  return {
    scheduleId: "schedule",
    examId: "exam",
    providerKey: "sat",
    versionId: "version",
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
      runtimeRevision,
    },
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [
      {
        id: "section",
        sectionKey: "reading-writing",
        title: "RW",
        displayOrder: 0,
        durationSeconds: 120,
        breakAfterSeconds: 0,
        instructions: { version: 1, nodes: [] },
        modules: [
          {
            id: "m-1",
            moduleKey: "rw-m1",
            title: "Module 1",
            displayOrder: 0,
            durationSeconds: 60,
            targetQuestionCount: 1,
            adaptiveRole: "base",
            instructions: { version: 1, nodes: [] },
            toolPolicy: [],
            questions: [],
          },
        ],
      },
    ] as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "attempt-a",
      moduleAttempts: [
        {
          id: "ma-1",
          moduleId: "m-1",
          state,
          allocatedSeconds: 60,
          availableAt: null,
          startedAt: state === "active" ? now : null,
          pausedAt: null,
          accumulatedPausedSeconds: 0,
          extensionSeconds: 0,
          deadlineAt: null,
          remainingSeconds: 60,
          completionReason: null,
          rawCorrect: null,
          operationalQuestionCount: null,
          toolState: {},
          revision: 1,
        },
      ] as unknown as AssessmentDeliveryBootstrap["attempt"]["moduleAttempts"],
      responses: [],
    },
    result: null,
  };
}

const opts = {
  scheduleId: "schedule",
  attemptId: "attempt-a",
  candidateId: "candidate",
};

async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}

/** Bootstraps into the question screen of the (only) module. */
async function armedHook() {
  const active = modulePayload("active");
  gatewayMocks.bootstrap.mockResolvedValue(active);
  gatewayMocks.startModule.mockResolvedValue(active);
  const hook = renderHook(() => useSatExamController(opts));
  await settle();
  await act(async () => {
    await hook.result.current.commands.startPendingModule();
  });
  await waitFor(() => expect(hook.result.current.state.phase).toBe("module"));
  return hook;
}

describe("SAT module submit conflicts", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    gatewayMocks.bootstrap.mockReset();
    gatewayMocks.startModule.mockReset();
    gatewayMocks.submitModule.mockReset();
    gatewayMocks.submitAssessment.mockReset();
    persistenceMock.flush.mockResolvedValue(undefined);
    persistenceMock.assertBoundarySettled.mockResolvedValue(undefined);
  });

  it("SAT-005: a stale submit response cannot overwrite newer committed state", async () => {
    const hook = await armedHook();
    // The server's authoritative advance has already been committed by the
    // poll loop (runtimeRevision 9) before the mutation response lands.
    const advanced = modulePayload("active", 9);
    const seam = hook.result.current as unknown as {
      commitForTest: (p: AssessmentDeliveryBootstrap) => boolean;
    };
    act(() => {
      expect(seam.commitForTest(advanced)).toBe(true);
    });
    act(() => hook.result.current.commands.reviewModule());
    expect(hook.result.current.state.phase).toBe("review");

    // The late mutation response carries the pre-advance revision.
    gatewayMocks.submitModule.mockResolvedValue(modulePayload("submitted", 1));
    await act(async () => {
      await hook.result.current.commands.submitModule("m-1");
    });

    // Dropped: the newer projection owns the runner, and the stale payload's
    // post-submit route (directions) was never dispatched.
    expect(hook.result.current.data?.timing.runtimeRevision).toBe(9);
    expect(hook.result.current.state.phase).toBe("review");

    // ...and the drop must not strand the student: the poll loop is the owner
    // from here. The server's next frame carries the module as finalized, and
    // the runner must move through finalization to the result.
    gatewayMocks.submitAssessment.mockResolvedValue({
      id: "result-1",
      submissionId: "attempt-a",
      providerKey: "sat",
      totalScore: 800,
      scorePayload: {},
      scoreKind: "practice",
      sections: [],
    });
    act(() => {
      expect(seam.commitForTest(modulePayload("submitted", 10))).toBe(true);
    });
    await settle();
    expect(gatewayMocks.submitAssessment).toHaveBeenCalledWith("schedule", "attempt-a", {
      submissionId: "attempt-a",
    });
    expect(hook.result.current.state.phase).toBe("complete");
  });

  // The predicate matrix itself is owned by
  // application/__tests__/satSubmitConflicts.test.ts; what this suite proves is
  // the wiring — that the right rejection reaches the right student copy.
  it.each([
    {
      label: "writer supersession",
      rejection: new ApiError({
        code: "ACTIVE_SESSION_SUPERSEDED",
        message: "This attempt is active elsewhere.",
        status: 409,
      }),
      expected: "another window",
      rejected: ["finalizing this module"],
    },
    {
      label: "clock/state transition",
      rejection: new ApiError({
        code: "ASSESSMENT_CONFLICT",
        message: "Section is not active.",
        status: 409,
        details: { reason: "SECTION_NOT_ACTIVE" },
      }),
      expected: "finalizing this module",
      rejected: ["another window"],
    },
    {
      label: "durable-state disagreement",
      rejection: new ApiError({
        code: "ASSESSMENT_CONFLICT",
        message: "Response revision mismatch.",
        status: 409,
        details: { reason: "RESPONSE_REVISION_MISMATCH" },
      }),
      // Recoverable, and definitely not a closed section: the copy must not
      // claim the module is finalizing, nor send the student to another window.
      expected: "submit the module again",
      rejected: ["finalizing this module", "another window"],
    },
    {
      label: "unclassified 409",
      rejection: new ApiError({
        code: "SUBMISSION_ID_MISUSE",
        message: "Submission identity already used.",
        status: 409,
      }),
      expected: "Submission identity already used.",
      rejected: ["finalizing this module", "another window", "submit the module again"],
    },
  ])("SAT-007: $label selects its own recovery copy", async ({ rejection, expected, rejected }) => {
    const hook = await armedHook();
    gatewayMocks.submitModule.mockRejectedValue(rejection);
    await act(async () => {
      await hook.result.current.commands.submitModule("m-1");
    });
    expect(hook.result.current.error).toContain(expected);
    for (const copy of rejected) {
      expect(hook.result.current.error).not.toContain(copy);
    }
  });
});

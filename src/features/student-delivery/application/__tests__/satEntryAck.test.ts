import { describe, expect, it } from "vitest";
import type {
  AssessmentDeliveryBootstrap,
  AssessmentDeliveryModule,
  AssessmentModuleAttemptSnapshot,
  AssessmentModuleCloseAck,
} from "../../contracts/assessmentDelivery";
import { applyCloseAck, applyEntryAck } from "../satEntryAck";

const row = (id: string, moduleId: string, state: string, extra: Partial<AssessmentModuleAttemptSnapshot> = {}): AssessmentModuleAttemptSnapshot => ({
  id, moduleId, state, allocatedSeconds: 1_920, availableAt: null, startedAt: null, pausedAt: null,
  accumulatedPausedSeconds: 0, extensionSeconds: 0, deadlineAt: null, remainingSeconds: 1_920,
  completionReason: null, rawCorrect: null, operationalQuestionCount: null, toolState: {}, revision: 0, ...extra,
});
const module = (id: string, questions: string[], extra: Partial<AssessmentDeliveryModule> = {}) =>
  ({ id, adaptiveRole: id.endsWith("m1") ? "base" : "higher_branch", questions: questions.map((examQuestionId) => ({ examQuestionId })), ...extra }) as unknown as AssessmentDeliveryModule;

function base(): AssessmentDeliveryBootstrap {
  return {
    scheduleId: "s",
    serverNow: "2026-10-04T10:00:00Z",
    timing: { serverNow: "2026-10-04T10:00:00Z", runtimeRevision: 4 },
    sections: [{ id: "rw", modules: [module("rw-m1", ["q1", "q2"])] }],
    attempt: { id: "a", moduleAttempts: [row("ma-1", "rw-m1", "active", { startedAt: "2026-10-04T09:28:00Z" })] },
  } as unknown as AssessmentDeliveryBootstrap;
}

describe("module-close ack merge", () => {
  it("adopts the routed module row and a metadata-only stub, then the start ack fills in the content", () => {
    const ack: AssessmentModuleCloseAck = {
      scheduleId: "s", attemptId: "a", moduleId: "rw-m1", moduleAttemptId: "ma-1", routeBasis: "client_confirmed",
      alreadyClosed: false,
      moduleAttempts: [
        row("ma-1", "rw-m1", "locked", { completionReason: "time_expired" }),
        row("ma-2", "rw-m2-high", "not_started", { availableAt: "2026-10-04T10:00:01Z", autoStartAt: "2026-10-04T10:01:01Z" }),
      ],
      nextModuleId: "rw-m2-high",
      selectedSection: { id: "rw", modules: [module("rw-m2-high", [], { contentWithheld: true })] } as never,
      serverNow: "2026-10-04T10:00:01Z",
    };
    const closed = applyCloseAck(base(), ack);
    expect(closed?.attempt.moduleAttempts.map((item) => `${item.moduleId}:${item.state}`)).toEqual([
      "rw-m1:locked",
      "rw-m2-high:not_started",
    ]);
    const stub = closed?.sections[0]?.modules.find((item) => item.id === "rw-m2-high");
    expect(stub?.contentWithheld).toBe(true);
    // Module 1's content is retained for review rendering.
    expect(closed?.sections[0]?.modules.find((item) => item.id === "rw-m1")?.questions).toHaveLength(2);

    const started = applyEntryAck(closed!, {
      scheduleId: "s", attemptId: "a", moduleId: "rw-m2-high", moduleAttemptId: "ma-2", moduleRevision: 1,
      selectedSection: { id: "rw", modules: [module("rw-m2-high", ["h1", "h2"])] } as never,
      state: "active", timingModel: "sat_personal_v1", entryState: "none", entryGeneration: 0,
      startedAt: "2026-10-04T10:00:02Z", deadlineAt: "2026-10-04T10:32:02Z", remainingSeconds: 1_920,
      serverNow: "2026-10-04T10:00:02Z", controlEpoch: 5, runtimeRevision: 4,
    });
    const full = started?.sections[0]?.modules.find((item) => item.id === "rw-m2-high");
    expect(full?.contentWithheld).toBeUndefined();
    expect(full?.questions.map((question) => question.examQuestionId)).toEqual(["h1", "h2"]);
    expect(started?.attempt.moduleAttempts.find((item) => item.id === "ma-2")?.state).toBe("active");
  });

  it("refuses an ack for another attempt", () => {
    expect(applyCloseAck(base(), {
      scheduleId: "s", attemptId: "other", moduleId: "rw-m1", moduleAttemptId: "ma-1", alreadyClosed: true,
      moduleAttempts: [], nextModuleId: null, serverNow: "2026-10-04T10:00:01Z",
    })).toBeNull();
  });
});

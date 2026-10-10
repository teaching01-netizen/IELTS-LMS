import { describe, expect, it } from "vitest";

import { classifyStartCodeError, normalizeStartCodeInput } from "../satStartCode";
import { deriveSatEntryDecision, isSatStartCodePending } from "../satEntry";
import type { AssessmentDeliveryBootstrap } from "../../contracts/assessmentDelivery";

describe("normalizeStartCodeInput", () => {
  it("keeps leading zeros and repeated digits", () => {
    expect(normalizeStartCodeInput("004827")).toBe("004827");
    expect(normalizeStartCodeInput("000000")).toBe("000000");
    expect(normalizeStartCodeInput("  123456 ")).toBe("123456");
  });

  it("refuses rather than strips anything that is not six ASCII digits", () => {
    for (const raw of ["12345", "1234567", "12 456", "12-456", "12a456", "١٢٣٤٥٦", ""]) {
      expect(normalizeStartCodeInput(raw)).toBeNull();
    }
  });
});

describe("classifyStartCodeError", () => {
  const apiError = (code: string, status: number, details?: Record<string, unknown>) =>
    Object.assign(new Error(code), { code, status, details });

  it("tells a wrong code apart from an uncertain commit", () => {
    expect(classifyStartCodeError(apiError("START_CODE_INVALID", 403, { reason: "START_CODE_INVALID" })))
      .toMatchObject({ kind: "invalid", readStateFirst: false });
    expect(classifyStartCodeError(Object.assign(new Error("offline"), { statusCode: 0 })))
      .toMatchObject({ kind: "uncertain", readStateFirst: true });
    expect(classifyStartCodeError(apiError("SERVICE_UNAVAILABLE", 503)))
      .toMatchObject({ kind: "uncertain", readStateFirst: true });
  });

  it("carries the server cooldown instead of inviting immediate guesses", () => {
    expect(classifyStartCodeError(apiError("RATE_LIMITED", 429, { reason: "START_CODE_COOLDOWN", retryAfterSeconds: 42 })))
      .toMatchObject({ kind: "rate_limited", retryAfterSeconds: 42 });
  });

  it("keeps admission capacity distinct from a wrong code and checks state before retry", () => {
    expect(classifyStartCodeError(apiError("RATE_LIMITED", 429, {
      reason: "START_CODE_BUSY",
      retryAfterSeconds: 15,
    }))).toMatchObject({
      kind: "busy",
      retryAfterSeconds: 15,
      readStateFirst: true,
    });
  });

  it("maps window and lifecycle refusals to their own guidance", () => {
    expect(classifyStartCodeError(apiError("ASSESSMENT_CONFLICT", 409, { reason: "START_WINDOW_NOT_OPEN" })).kind).toBe("not_open");
    expect(classifyStartCodeError(apiError("ASSESSMENT_CONFLICT", 409, { reason: "START_WINDOW_CLOSED" })).kind).toBe("closed");
    expect(classifyStartCodeError(apiError("ASSESSMENT_CONFLICT", 409, { reason: "START_LINK_PAUSED" })).kind).toBe("paused");
    expect(classifyStartCodeError(apiError("ACTIVE_SESSION_SUPERSEDED", 409)).kind).toBe("writer");
  });
});

describe("code-start entry gate", () => {
  const payload = (policy: AssessmentDeliveryBootstrap["satStartPolicy"]): AssessmentDeliveryBootstrap => ({
    scheduleId: "s",
    examId: "e",
    providerKey: "sat",
    versionId: "v",
    serverNow: "2026-10-10T09:00:00Z",
    candidateName: "B",
    // Another candidate already opened the room: the runtime is live.
    scheduleRuntimeStatus: "live",
    timing: { timingModel: "sat_personal_v1", runtimeRevision: 1 } as AssessmentDeliveryBootstrap["timing"],
    proctorStatus: "active",
    proctorNote: null,
    deviceFingerprintHash: null,
    sections: [{
      id: "sec", sectionKey: "reading-writing", title: "RW", displayOrder: 0, durationSeconds: 1920, breakAfterSeconds: 0,
      instructions: null,
      modules: [{ id: "m1", moduleKey: "rw-m1", title: "M1", displayOrder: 0, durationSeconds: 1920, targetQuestionCount: 1, adaptiveRole: "base", questions: [] }],
    }] as unknown as AssessmentDeliveryBootstrap["sections"],
    attempt: {
      id: "a",
      moduleAttempts: [{ id: "ma", moduleId: "m1", state: "not_started", allocatedSeconds: 1920, startedAt: null }],
      responses: [],
    } as unknown as AssessmentDeliveryBootstrap["attempt"],
    result: null,
    satStartPolicy: policy,
  });
  const module = { id: "m1", adaptiveRole: "base" } as never;

  it("never auto-starts a candidate who has not redeemed the code, even in a live room", () => {
    const data = payload({ mode: "access_code", state: "code_required" });
    expect(isSatStartCodePending(data)).toBe(true);
    const decision = deriveSatEntryDecision({ data, module, stageReady: true, breakSeconds: 0, sectionWaitSeconds: 0, phase: "directions" });
    expect(decision).toMatchObject({ shouldStart: false, reason: "start-code-required" });
  });

  it("keeps the proctor-start initial entry for proctor-mode sessions", () => {
    const data = payload({ mode: "proctor" });
    expect(isSatStartCodePending(data)).toBe(false);
    const decision = deriveSatEntryDecision({ data, module, stageReady: true, breakSeconds: 0, sectionWaitSeconds: 0, phase: "directions" });
    expect(decision).toMatchObject({ shouldStart: true, reason: "initial-entry" });
  });
});
